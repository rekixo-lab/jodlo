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
