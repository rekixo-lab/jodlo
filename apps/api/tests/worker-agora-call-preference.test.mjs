import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { issueSession, revokeSession, revokeAllSessions } from "../src/modules/identity/sessions.ts";
import {
  readOwnWorkerAgoraCallPreference, setOwnWorkerAgoraCallPreference,
  READ_OWN_AGORA_CALL_PREFERENCE_QUERY, INSERT_AGORA_CALL_PREFERENCE_QUERY,
  UPDATE_AGORA_CALL_PREFERENCE_QUERY,
} from "../src/modules/workers/agora-call-preference.ts";
import {
  readTwoSessionBoundCallTarget, readTwoSessionBoundAgoraOptInTarget,
  READ_TWO_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,
} from "../src/modules/interactions/request-target.ts";
import { prepareSyntheticAgoraInvite, decideSyntheticAgoraCallEvent }
  from "../src/modules/interactions/agora-call-lifecycle.ts";
import { assessSyntheticAgoraRtcPreflight }
  from "../src/modules/interactions/agora-rtc-preflight.ts";

const CALLER="account-optin-caller001";
const WORKER="account-optin-worker001";
const OTHER="account-optin-stranger1";
const CATEGORY="optin-test-trade";
const NOW=1800000000000;
const consent=()=>({
  listingAvailable:true,blockedByRequester:false,blockedByWorker:false,
  workerConsentedToCalls:true,callDestinationVerified:true,
  connectionPrivacyApproved:true,abuseLimitPassed:true,
});

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const id of [CALLER,WORKER,OTHER])await ensureAccount(adapter,id);
  await optInAsWorker(adapter,WORKER);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run(CATEGORY,"optin-test-trade","Synthetic opt-in work","परीक्षण कार्य");
  const listing=await publishListing(adapter,WORKER,CATEGORY);
  const callerToken=(await issueSession(adapter,CALLER))?.accessToken;
  const workerToken=(await issueSession(adapter,WORKER))?.accessToken;
  const otherToken=(await issueSession(adapter,OTHER))?.accessToken;
  assert.ok(listing&&callerToken&&workerToken&&otherToken);
  const strict=()=>readTwoSessionBoundAgoraOptInTarget(adapter,callerToken,workerToken,listing.id);
  const base=()=>readTwoSessionBoundCallTarget(adapter,callerToken,workerToken,listing.id);
  return {db,adapter,listing,callerToken,workerToken,otherToken,strict,base,
    close(){db.close();}};
}

test("M-005 default OFF; publishing a listing does not imply call consent",async()=>{
  const f=await fixture();
  try {
    assert.deepEqual(await readOwnWorkerAgoraCallPreference(f.adapter,f.workerToken),
      {enabled:false,revision:0});
    assert.equal((await f.strict()),null);
    assert.ok(await f.base(),"an unconsented worker listing still exists");
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_agora_call_preferences").get().n,0);
    assert.equal(await readOwnWorkerAgoraCallPreference(f.adapter,f.callerToken),null);
    assert.equal(await readOwnWorkerAgoraCallPreference(f.adapter,f.otherToken),null);
    assert.ok(READ_TWO_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY.includes("pref.calls_enabled=1"));
    assert.equal((READ_TWO_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY.match(/\?/g)||[]).length,5);
  }finally{f.close();}
});

test("worker explicitly enables calls with owner session and gets a private revision",async()=>{
  const f=await fixture();
  try {
    const updated=await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,true,0);
    assert.deepEqual(updated,{kind:"updated",preference:{enabled:true,revision:1}});
    assert.equal(Object.isFrozen(updated.preference),true);
    assert.deepEqual(await readOwnWorkerAgoraCallPreference(f.adapter,f.workerToken),
      {enabled:true,revision:1});
    assert.ok(await f.strict());
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_agora_call_preferences").get().n,1);
    const row=f.db.prepare("SELECT * FROM worker_agora_call_preferences").get();
    assert.deepEqual(Object.keys(row).sort(),["account_id","calls_enabled","revision"]);
    assert.equal(row.account_id,WORKER);
    assert.equal(row.calls_enabled,1);
    assert.equal(row.revision,1);
    assert.equal(JSON.stringify(updated).includes(WORKER),false);
  }finally{f.close();}
});

test("explicit OFF revokes future Agora RTC preconditions immediately",async()=>{
  const f=await fixture();
  try{
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerToken,true,0)).kind,"updated");
    const target=await f.base();
    const prepared=prepareSyntheticAgoraInvite(target,consent(),"call-optin-000001",NOW,NOW+30000);
    assert.equal(prepared.kind,"prepared");
    const accepted=decideSyntheticAgoraCallEvent(prepared.call,{
      actorAccountId:WORKER,event:"accept",expectedRevision:0,
      idempotencyKey:"optin-accept-000001",nowMs:NOW+1000,
    });
    assert.equal(accepted.kind,"apply");
    const grant=()=>assessSyntheticAgoraRtcPreflight(f.adapter,
      accepted.result,f.callerToken,"caller",1,consent());
    assert.deepEqual(await grant(),{kind:"prerequisite_only",role:"caller"});
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,false,1),
      {kind:"updated",preference:{enabled:false,revision:2}});
    assert.equal(await f.strict(),null);
    assert.deepEqual(await grant(),
      {kind:"denied",reason:"SESSION_OR_TARGET_UNAVAILABLE"});
    assert.ok(target,"earlier preview must never authorize a new Agora token");
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerToken,true,2)).kind,"updated");
    assert.deepEqual(await grant(),{kind:"prerequisite_only",role:"caller"});
  }finally{f.close();}
});

test("only owner session can turn on calls, not a customer or third party",async()=>{
  const f=await fixture();
  try{
    for(const token of [f.callerToken,f.otherToken]){
      assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,token,true,0),
        {kind:"denied"});
    }
    assert.equal(await f.strict(),null);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_agora_call_preferences").get().n,0);
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerToken,true,0)).kind,"updated");
    for(const token of [f.callerToken,f.otherToken]){
      assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,token,false,1),
        {kind:"denied"});
    }
    assert.deepEqual(await readOwnWorkerAgoraCallPreference(f.adapter,f.workerToken),
      {enabled:true,revision:1});
  }finally{f.close();}
});

test("stale revisions, duplicate retry and forged expectedRevision are denied",async()=>{
  const f=await fixture();
  try {
    assert.equal((await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,true,0)).kind,
      "updated");
    for(const [enabled,rev] of [[false,0],[true,0],[false,9]]){
      assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,enabled,rev),
        {kind:"denied"});
    }
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,false,1),
      {kind:"updated",preference:{enabled:false,revision:2}});
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,false,1),
      {kind:"denied"});
    assert.deepEqual(await readOwnWorkerAgoraCallPreference(f.adapter,f.workerToken),
      {enabled:false,revision:2});
  }finally{f.close();}
});

test("malformed bearer, booleans and revisions fail before touching D1",async()=>{
  const bomb={prepare(){throw Error("unreachable D1");}};
  for(const invalid of [null,false,123,"", "bad","x".repeat(42),"Bearer "+"x".repeat(43)]){
    assert.equal(await readOwnWorkerAgoraCallPreference(bomb,invalid),null);
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(bomb,invalid,true,0),
      {kind:"denied"});
  }
  for(const enabled of ["true",1,0,null,undefined]){
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(
      bomb,"x".repeat(43),enabled,0),{kind:"denied"});
  }
  for(const rev of [-1,0.2,null,NaN,Infinity,2147483647,Number.MAX_SAFE_INTEGER]){
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(
      bomb,"x".repeat(43),true,rev),{kind:"denied"});
  }
});

test("revoked and expired worker sessions cannot read or modify opt-in",async()=>{
  const f=await fixture();
  try{
    assert.equal((await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,true,0)).kind,
      "updated");
    assert.equal(await revokeSession(f.adapter,f.workerToken),true);
    assert.equal(await readOwnWorkerAgoraCallPreference(f.adapter,f.workerToken),null);
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,false,1),
      {kind:"denied"});
    assert.equal(await f.strict(),null);
    const reissued=(await issueSession(f.adapter,WORKER))?.accessToken;
    assert.ok(reissued);
    assert.deepEqual(await readOwnWorkerAgoraCallPreference(f.adapter,reissued),
      {enabled:true,revision:1});
    assert.equal(await revokeAllSessions(f.adapter,reissued),true);
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,reissued,false,1),
      {kind:"denied"});
  }finally{f.close();}
});

test("disabled worker account and revoked profile ownership never authorize",async()=>{
  const f=await fixture();
  try {
    assert.equal((await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,true,0)).kind,
      "updated");
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER);
    assert.equal(await readOwnWorkerAgoraCallPreference(f.adapter,f.workerToken),null);
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,false,1),
      {kind:"denied"});
    assert.equal(await f.strict(),null);
    f.db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(WORKER);
    f.db.prepare("DELETE FROM worker_profiles WHERE account_id=?").run(WORKER);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_agora_call_preferences").get().n,0,
      "FK CASCADE removes private preference when worker profile is deleted");
    assert.equal(await readOwnWorkerAgoraCallPreference(f.adapter,f.workerToken),null);
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(f.adapter,f.workerToken,true,0),
      {kind:"denied"});
  }finally{f.close();}
});

test("malformed stored preferences fail closed and SQLite enforces 0/1 and revision",async()=>{
  const f=await fixture();
  try {
    for(const invalid of [2,-1,99,null]){
      assert.throws(()=>f.db.prepare(
        "INSERT INTO worker_agora_call_preferences(account_id,calls_enabled,revision) VALUES(?,?,?)")
        .run(WORKER,invalid,1));
    }
    for(const invalid of [0,-1,2147483648,null]){
      assert.throws(()=>f.db.prepare(
        "INSERT INTO worker_agora_call_preferences(account_id,calls_enabled,revision) VALUES(?,?,?)")
        .run(WORKER,1,invalid));
    }
    assert.equal(await readOwnWorkerAgoraCallPreference({
      prepare(){return {bind(){return this;},
        async all(){return {results:[{enabled:1,revision:"1"}]};}};}
    },"x".repeat(43)),null);
    assert.equal(await readOwnWorkerAgoraCallPreference({
      prepare(){return {bind(){return this;},
        async all(){return {results:[{enabled:true,revision:2}]};}};}
    },"x".repeat(43)),null);
  }finally{f.close();}
});

test("database failures never return success or a forged call preference",async()=>{
  const broken={prepare(){return {bind(){return this;},
    async all(){throw Error("private-DB-OUTAGE");},
    async run(){throw Error("private-DB-OUTAGE");}};}};
  assert.equal(await readOwnWorkerAgoraCallPreference(broken,"x".repeat(43)),null);
  assert.deepEqual(await setOwnWorkerAgoraCallPreference(broken,"x".repeat(43),true,0),
    {kind:"denied"});
});

test("SQL read and writes bind hash-based live session, no account/phone value",async()=>{
  const f=await fixture();
  try {
    assert.match(READ_OWN_AGORA_CALL_PREFERENCE_QUERY,/session\.token_hash=\?/);
    assert.match(INSERT_AGORA_CALL_PREFERENCE_QUERY,/session\.token_hash=\?/);
    assert.match(UPDATE_AGORA_CALL_PREFERENCE_QUERY,/session\.token_hash=\?/);
    assert.match(UPDATE_AGORA_CALL_PREFERENCE_QUERY,/revision=\?/);
    for(const query of [
      READ_OWN_AGORA_CALL_PREFERENCE_QUERY,INSERT_AGORA_CALL_PREFERENCE_QUERY,
      UPDATE_AGORA_CALL_PREFERENCE_QUERY,READ_TWO_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,
    ]){
      assert.equal(query.includes("phone"),false);
      assert.equal(query.includes("tel:"),false);
      assert.equal(query.includes(f.workerToken),false);
    }
    const observed=[];
    const proxy={prepare(query){
      const row={query,values:[]};
      observed.push(row);
      return {bind(...args){row.values=args;return{
        all:()=>f.adapter.prepare(query).bind(...args).all(),
        run:()=>f.adapter.prepare(query).bind(...args).run(),
      };}};
    }};
    assert.equal((await setOwnWorkerAgoraCallPreference(proxy,f.workerToken,true,0)).kind,
      "updated");
    assert.equal(observed.length,1);
    assert.equal(JSON.stringify(observed).includes(f.workerToken),false);
    assert.equal(JSON.stringify(observed).includes(WORKER),false);
  }finally{f.close();}
});

test("no public preference/call endpoint, phone, channel or call-history schema",async()=>{
  const f=await fixture();
  try{
    for(const path of [
      "/api/v1/me/agora-call-preference", "/api/v1/calls",
      "/api/v1/rtc/token", "/api/v1/signaling",
    ]){
      const res=await worker.fetch(new Request("https://jodlo.rekixo.com"+path,{
        method:"POST",headers:{Authorization:"Bearer "+f.workerToken,
          "Content-Type":"application/json"},
        body:JSON.stringify({enabled:true,accountId:OTHER,phone:"+91_private"}),
      }),{DB:f.adapter});
      assert.equal(res.status,404,path);
    }
    const names=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all().map(row=>row.name);
    assert.ok(names.includes("worker_agora_call_preferences"));
    for(const name of ["call_history","agora_tokens","agora_channels",
      "rtc_participants","phone_numbers","call_sessions"]) {
      assert.equal(names.includes(name),false,name);
    }
  }finally{f.close();}
});
