import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import {
  issueSession, revokeSession, revokeAllSessions, sessionHash,
} from "../src/modules/identity/sessions.ts";
import { setOwnWorkerAgoraCallPreference } from "../src/modules/workers/agora-call-preference.ts";
import {
  readWorkerSessionBoundAgoraOptInTarget,
  READ_WORKER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,
  readWorkerSessionBoundAgoraConsentEpochMatch,
  READ_WORKER_SESSION_BOUND_AGORA_CONSENT_EPOCH_MATCH_QUERY,
  READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,
} from "../src/modules/interactions/request-target.ts";
import {
  prepareSyntheticAgoraInvite, decideSyntheticAgoraCallEvent,
} from "../src/modules/interactions/agora-call-lifecycle.ts";
import { assessSyntheticAgoraRtcPreflight }
  from "../src/modules/interactions/agora-rtc-preflight.ts";

const CALLER="account-own-rtc-caller001";
const WORKER="account-own-rtc-worker001";
const OTHER="account-own-rtc-other0001";
const CATEGORY="own-rtc-test-service";
const NOW=1800000000000;
const CONSENT=()=>({
  listingAvailable:true,blockedByRequester:false,blockedByWorker:false,
  workerConsentedToCalls:true,callDestinationVerified:true,
  connectionPrivacyApproved:true,abuseLimitPassed:true,
});
const denied=reason=>({kind:"denied",reason});

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const id of [CALLER,WORKER,OTHER]) await ensureAccount(adapter,id);
  await optInAsWorker(adapter,WORKER);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run(CATEGORY,"own-rtc-test-service","Synthetic voice work","परीक्षण आवाज़ सेवा");
  const listing=await publishListing(adapter,WORKER,CATEGORY);
  assert.ok(listing);
  const callerToken=(await issueSession(adapter,CALLER))?.accessToken;
  const workerToken=(await issueSession(adapter,WORKER))?.accessToken;
  const otherToken=(await issueSession(adapter,OTHER))?.accessToken;
  assert.ok(callerToken&&workerToken&&otherToken);
  const enable=()=>setOwnWorkerAgoraCallPreference(adapter,workerToken,true,0);
  const call=()=>{
    // An accepted INTERNAL synthetic call, NOT an authenticated client payload.
    const snapshot=prepareSyntheticAgoraInvite({
      requesterAccountId:CALLER,workerAccountId:WORKER,
      listingId:listing.id,listingOwnerAccountId:WORKER,categoryId:CATEGORY,
      requesterActive:true,workerActive:true,workerOptedIn:true,
      categoryActive:true,listingPublished:true,moderationApproved:true,
    },CONSENT(),"call-own-rtc-synthetic01",NOW,NOW+30000);
    assert.equal(snapshot.kind,"prepared");
    const next=decideSyntheticAgoraCallEvent(snapshot.call,{
      actorAccountId:WORKER,event:"accept",expectedRevision:0,
      idempotencyKey:"own-rtc-accept-000001",nowMs:NOW+1000,
    });
    assert.equal(next.kind,"apply");
    return next.result;
  };
  const rtc=(snapshot,role="caller",token=role==="worker"?workerToken:callerToken,
    policy=CONSENT(),revision=snapshot?.revision)=>
    assessSyntheticAgoraRtcPreflight(adapter,snapshot,token,role,revision,policy);
  return {db,adapter,listing,callerToken,workerToken,otherToken,call,enable,rtc,
    close(){db.close();}};
}

test("caller and worker join proofs need exactly OWN active bearer, not each other's",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const call=f.call();
    assert.deepEqual(await f.rtc(call,"caller"),
      {kind:"prerequisite_only",role:"caller"});
    assert.deepEqual(await f.rtc(call,"worker"),
      {kind:"prerequisite_only",role:"worker"});
    assert.deepEqual(await f.rtc(call,"caller",f.workerToken),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    assert.deepEqual(await f.rtc(call,"worker",f.callerToken),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    assert.deepEqual(await f.rtc(call,"caller",f.otherToken),
      denied("CALL_OR_POLICY_DENIED"),
      "different legitimate customer cannot impersonate accepted caller");
    assert.deepEqual(await f.rtc(call,"worker",f.otherToken),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    assert.equal(JSON.stringify(await f.rtc(call,"worker")).includes(f.workerToken),false);
  }finally{f.close();}
});

test("worker own-session SQL reads only worker bearer hash, time, trusted caller ID, listing",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const query=READ_WORKER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY;
    assert.equal((query.match(/\?/g)||[]).length,4);
    assert.match(query,/participant_session\.account_id=worker\.id/);
    assert.match(query,/participant_session\.token_hash=\?/);
    assert.match(query,/participant_session\.expires_at>\?/);
    assert.match(query,/requester\.id=\?/);
    assert.match(query,/requester\.status='active'/);
    assert.match(query,/pref\.calls_enabled=1/);
    assert.match(query,/c\.is_active=1/);
    assert.match(query,/wl\.moderation_status='allowed'/);
    assert.equal(query.includes("caller_session"),false);
    assert.equal(query.includes("phone"),false);
    assert.equal(query.includes("tel:"),false);
    assert.equal((READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY.match(/\?/g)||[]).length,3);
    const observed=[];
    const db={prepare(sql){
      const event={sql,params:[]};
      observed.push(event);
      return {bind(...params){event.params=params;return {
        all:()=>f.adapter.prepare(sql).bind(...params).all(),
      };}};
    }};
    const target=await readWorkerSessionBoundAgoraOptInTarget(
      db,f.workerToken,f.listing.id,CALLER);
    assert.ok(target);
    assert.equal(target.workerAccountId,WORKER);
    assert.equal(target.requesterAccountId,CALLER);
    assert.equal(Object.isFrozen(target),true);
    assert.equal(observed.length,1);
    assert.deepEqual(observed[0].params,[
      await sessionHash(f.workerToken),observed[0].params[1],CALLER,f.listing.id,
    ]);
    assert.ok(Number.isSafeInteger(observed[0].params[1]));
    assert.equal(JSON.stringify(observed).includes(f.callerToken),false);
    assert.equal(JSON.stringify(observed).includes(f.workerToken),false);
    assert.equal(JSON.stringify(target).includes(f.workerToken),false);
  }finally{f.close();}
});

test("worker logout revokes own RTC prerequisite while caller session stays valid",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const call=f.call();
    assert.equal((await f.rtc(call,"worker")).kind,"prerequisite_only");
    assert.equal(await revokeSession(f.adapter,f.workerToken),true);
    assert.deepEqual(await f.rtc(call,"worker"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    assert.deepEqual(await f.rtc(call,"caller"),
      {kind:"prerequisite_only",role:"caller"});
    assert.equal(await readWorkerSessionBoundAgoraOptInTarget(
      f.adapter,f.workerToken,f.listing.id,CALLER),null);
  }finally{f.close();}
});

test("caller logout revokes own RTC prerequisite without needing worker to reveal token",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const call=f.call();
    assert.equal(await revokeAllSessions(f.adapter,f.callerToken),true);
    assert.deepEqual(await f.rtc(call,"caller"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    assert.deepEqual(await f.rtc(call,"worker"),
      {kind:"prerequisite_only",role:"worker"},
      "caller account remains active; actual call validity needs durable state");
  }finally{f.close();}
});

test("expired session, disabled account and worker opt-out deny prospective join",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const call=f.call();
    f.db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?")
      .run(await sessionHash(f.workerToken));
    assert.deepEqual(await f.rtc(call,"worker"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    assert.equal((await f.rtc(call,"caller")).kind,"prerequisite_only");
  }finally{f.close();}
  const g=await fixture();
  try{
    assert.equal((await g.enable()).kind,"updated");
    const call=g.call();
    g.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(CALLER);
    assert.deepEqual(await g.rtc(call,"worker"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    assert.deepEqual(await g.rtc(call,"caller"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
  }finally{g.close();}
  const h=await fixture();
  try{
    assert.equal((await h.enable()).kind,"updated");
    const call=h.call();
    assert.equal((await h.rtc(call,"worker")).kind,"prerequisite_only");
    assert.equal((await setOwnWorkerAgoraCallPreference(
      h.adapter,h.workerToken,false,1)).kind,"updated");
    assert.deepEqual(await h.rtc(call,"worker"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    assert.deepEqual(await h.rtc(call,"caller"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
  }finally{h.close();}
});

test("worker-own reader denies wrong listing, invalid ID, bearer and D1 corruption",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    for(const token of [f.callerToken,f.otherToken,"z".repeat(43)]){
      assert.equal(await readWorkerSessionBoundAgoraOptInTarget(
        f.adapter,token,f.listing.id,CALLER),null);
    }
    assert.equal(await readWorkerSessionBoundAgoraOptInTarget(
      f.adapter,f.workerToken,"bad listing",CALLER),null);
    assert.equal(await readWorkerSessionBoundAgoraOptInTarget(
      f.adapter,f.workerToken,f.listing.id,"bad caller"),null);
    assert.equal(await readWorkerSessionBoundAgoraOptInTarget(
      f.adapter,f.workerToken,"different-listing-id",CALLER),null);
    const outage={prepare(){throw Error("PRIVATE_DB_ERROR");}};
    assert.deepEqual(await assessSyntheticAgoraRtcPreflight(
      outage,f.call(),f.workerToken,"worker",1,CONSENT()),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
  }finally{f.close();}
});

test("invalid role and expired/fake call snapshot cannot produce RTC credentials",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const call=f.call();
    assert.deepEqual(await f.rtc(call,"another",f.callerToken),
      denied("INVALID_ROLE"));
    assert.deepEqual(await f.rtc(call,"worker",f.workerToken,CONSENT(),0),
      denied("CALL_OR_POLICY_DENIED"));
    assert.deepEqual(await f.rtc({...call,categoryId:"other-category"},"worker"),
      denied("CALL_OR_POLICY_DENIED"));
    assert.deepEqual(await f.rtc({...call,phase:"ringing"},"worker"),
      denied("CALL_OR_POLICY_DENIED"));
    assert.deepEqual(await f.rtc({...call,workerAccountId:OTHER},"worker"),
      denied("CALL_OR_POLICY_DENIED"));
    assert.deepEqual(await f.rtc({...call,listingId:"listing-fake-00001"},"worker"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
  }finally{f.close();}
});

test("worker-own session query fails closed on Category/moderation changes",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const call=f.call();
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(await f.rtc(call,"worker"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed',status='unpublished' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(await f.rtc(call,"worker"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
    f.db.prepare("UPDATE worker_listings SET status='published' WHERE id=?")
      .run(f.listing.id);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY);
    assert.deepEqual(await f.rtc(call,"worker"),
      denied("SESSION_OR_TARGET_UNAVAILABLE"));
  }finally{f.close();}
});

test("no public token/join API or personal call data schema introduced",async()=>{
  const f=await fixture();
  try{
    for(const path of ["/api/v1/rtc/token","/api/v1/rtc/join","/api/v1/agora","/api/v1/calls"]){
      const response=await worker.fetch(
        new Request("https://jodlo.rekixo.com"+path,{method:"POST"}),
        {DB:f.adapter},
      );
      assert.equal(response.status,404,path);
    }
    const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all().map(x=>x.name);
    for(const missing of ["agora_tokens","agora_channels","rtc_participants",
      "call_sessions","call_history","phone_numbers"]){
      assert.equal(tables.includes(missing),false,missing);
    }
  }finally{f.close();}
});


test("worker own-session consent-epoch match stays OFF without an explicit worker switch",async()=>{
  const f=await fixture();
  try{
    const call=f.call();
    const result=await readWorkerSessionBoundAgoraConsentEpochMatch(
      f.adapter,f.workerToken,call.listingId,call.callerAccountId,1);
    assert.equal(result,null);
    assert.equal(f.db.prepare(
      "SELECT COUNT(*) AS n FROM worker_agora_call_preferences").get().n,0);
  }finally{f.close();}
});

test("worker accepts only current exact consent epoch for an eligible accepted caller",async()=>{
  const f=await fixture();
  try{
    const call=f.call();
    assert.equal((await f.enable()).kind,"updated");
    const matched=await readWorkerSessionBoundAgoraConsentEpochMatch(
      f.adapter,f.workerToken,call.listingId,call.callerAccountId,1);
    assert.ok(matched);
    assert.equal(matched.requesterAccountId,CALLER);
    assert.equal(matched.workerAccountId,WORKER);
    assert.equal(matched.listingId,f.listing.id);
    assert.equal(Object.isFrozen(matched),true);
    for(const forbidden of [f.workerToken,f.callerToken,"phoneNumber","tel:","token","channel"]){
      assert.equal(JSON.stringify(matched).includes(forbidden),false);
    }
    assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(
      f.adapter,f.workerToken,call.listingId,call.callerAccountId,2),null,
      "future/nonmatching epochs cannot authorize a historical accepted call");
  }finally{f.close();}
});

test("worker OFF then ON cannot resurrect a synthetic accepted call bound to the old consent epoch",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const call=f.call();
    const args=[f.adapter,f.workerToken,call.listingId,call.callerAccountId];
    assert.ok(await readWorkerSessionBoundAgoraConsentEpochMatch(...args,1));
    const disabled=await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerToken,false,1);
    assert.equal(disabled.kind,"updated");
    assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(...args,1),null);
    const reenabled=await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerToken,true,2);
    assert.equal(reenabled.kind,"updated");
    assert.equal(reenabled.preference.revision,3);
    assert.ok(await readWorkerSessionBoundAgoraOptInTarget(
      f.adapter,f.workerToken,call.listingId,call.callerAccountId),
      "legacy no-epoch synthetic preview is intentionally not token authorization");
    assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(...args,1),null,
      "revoked epoch must remain invalid after another ON toggle");
    assert.ok(await readWorkerSessionBoundAgoraConsentEpochMatch(...args,3),
      "only a new trusted epoch may pass the separate read-only prerequisite");
    assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(...args,2),null);
  }finally{f.close();}
});

test("one worker-own D1 SELECT matches epoch with five binds; no caller bearer or raw token",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const call=f.call();
    const query=READ_WORKER_SESSION_BOUND_AGORA_CONSENT_EPOCH_MATCH_QUERY;
    assert.equal((query.match(/\?/g)||[]).length,5);
    assert.match(query,/participant_session\.account_id=worker\.id/);
    assert.match(query,/pref\.calls_enabled=1/);
    assert.match(query,/pref\.revision=\?/);
    assert.match(query,/wl\.moderation_status='allowed'/);
    const observed=[];
    const proxy={prepare(sql){
      const item={sql,params:[]};
      observed.push(item);
      return {bind(...params){
        item.params=params;
        return {all:()=>f.adapter.prepare(sql).bind(...params).all()};
      }};
    }};
    const match=await readWorkerSessionBoundAgoraConsentEpochMatch(
      proxy,f.workerToken,call.listingId,call.callerAccountId,1);
    assert.ok(match);
    assert.equal(observed.length,1,"do not read caller, worker, opt-in and listing in separate queries");
    assert.equal(observed[0].sql,query);
    assert.deepEqual(observed[0].params,[
      await sessionHash(f.workerToken),observed[0].params[1],
      CALLER,f.listing.id,1,
    ]);
    assert.ok(Number.isSafeInteger(observed[0].params[1]));
    for(const forbidden of [f.callerToken,f.workerToken,f.otherToken]){
      assert.equal(JSON.stringify(observed).includes(forbidden),false);
    }
  }finally{f.close();}
});

test("wrong worker bearer, revoked worker session and disabled caller deny current epoch",async()=>{
  for(const mode of ["wrong_actor","revoked","disabled_caller"]){
    const f=await fixture();
    try{
      assert.equal((await f.enable()).kind,"updated");
      const call=f.call();
      let bearer=f.workerToken;
      if(mode==="wrong_actor")bearer=f.otherToken;
      if(mode==="revoked")assert.equal(await revokeSession(
        f.adapter,f.workerToken),true);
      if(mode==="disabled_caller")f.db.prepare(
        "UPDATE accounts SET status='disabled' WHERE id=?").run(CALLER);
      assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(
        f.adapter,bearer,call.listingId,call.callerAccountId,1),null,mode);
    }finally{f.close();}
  }
});

test("active listing and Category are rechecked for worker-own exact epoch",async()=>{
  const mutations=[
    (f)=>f.db.prepare("UPDATE worker_listings SET status='unpublished' WHERE id=?")
      .run(f.listing.id),
    (f)=>f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.listing.id),
    (f)=>f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY),
    (f)=>f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER),
    (f)=>f.db.prepare("DELETE FROM worker_listings WHERE id=?").run(f.listing.id),
  ];
  for(const change of mutations){
    const f=await fixture();
    try{
      assert.equal((await f.enable()).kind,"updated");
      const call=f.call();
      change(f);
      assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(
        f.adapter,f.workerToken,call.listingId,call.callerAccountId,1),null);
    }finally{f.close();}
  }
});

test("malformed consent revision or untrusted caller ID denies before D1, outage withholds",async()=>{
  const bomb={prepare(){throw Error("D1 must not be queried for malformed args");}};
  const validWorker="a".repeat(43),listing="listing-worker-epoch-001",caller=CALLER;
  for(const invalid of [undefined,null,0,-1,1.1,NaN,Infinity,
    2147483648,Number.MAX_SAFE_INTEGER,"1",true]){
    assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(
      bomb,validWorker,listing,caller,invalid),null,String(invalid));
  }
  for(const bad of [null,undefined,"","bad",12,"Bearer "+validWorker]){
    assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(
      bomb,bad,listing,caller,1),null);
  }
  for(const bad of [null,"bad id",undefined,123]){
    assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(
      bomb,validWorker,bad,caller,1),null);
    assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(
      bomb,validWorker,listing,bad,1),null);
  }
  assert.equal(await readWorkerSessionBoundAgoraConsentEpochMatch(
    bomb,validWorker,listing,caller,1),null,
    "unexpected database failure cannot turn into consent proof");
});

test("fake D1 rows must match exact trusted actor and consent epoch; no grants or new routes",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const call=f.call();
    const good={
      requesterId:CALLER,requesterStatus:"active",workerAccountId:WORKER,
      workerStatus:"active",listingId:call.listingId,
      listingOwnerAccountId:WORKER,categoryId:CATEGORY,
      listingStatus:"published",moderationStatus:"allowed",
      workerProfileStatus:"draft",categoryActive:1,consentRevision:1,
    };
    const fake=results=>({prepare(){return{bind(){return this;},
      async all(){return {results};}};}});
    const attempt=rows=>readWorkerSessionBoundAgoraConsentEpochMatch(
      fake(rows),f.workerToken,call.listingId,call.callerAccountId,1);
    assert.equal((await attempt([good]))?.workerAccountId,WORKER,
      "test adapter is not an authentic session provider or D1 proof");
    for(const badRev of [null,0,2,2147483648,"1",undefined]){
      assert.equal(await attempt([{...good,consentRevision:badRev}]),null);
    }
    for(const change of [
      {requesterId:OTHER},{workerAccountId:OTHER},
      {listingOwnerAccountId:OTHER},{moderationStatus:"hidden"},
      {workerStatus:"disabled"},{categoryActive:0},
      {listingId:"other-listing-000001"},
    ])assert.equal(await attempt([{...good,...change}]),null,JSON.stringify(change));
    for(const rows of [[],[good,good],null,{}]){
      assert.equal(await attempt(rows),null);
    }
    for(const path of ["/api/v1/calls","/api/v1/rtc/token","/api/v1/agora"]){
      const result=await worker.fetch(
        new Request("https://jodlo.rekixo.com"+path,{method:"POST"}),
        {DB:f.adapter},
      );
      assert.equal(result.status,404,path);
    }
    const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all().map(row=>row.name);
    for(const name of ["call_sessions","agora_tokens","call_history"]){
      assert.equal(tables.includes(name),false);
    }
  }finally{f.close();}
});
