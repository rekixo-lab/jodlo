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
import {
  readTwoSessionBoundCallTarget,
  READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY,
} from "../src/modules/interactions/request-target.ts";
import {
  prepareSyntheticAgoraInvite, decideSyntheticAgoraCallEvent,
} from "../src/modules/interactions/agora-call-lifecycle.ts";
import {
  assessSyntheticAgoraRtcPreflight,
} from "../src/modules/interactions/agora-rtc-preflight.ts";
import {
  assessSyntheticAgoraSignalingIntent,
} from "../src/modules/interactions/agora-signaling-intent.ts";

const CALLER="account-rtc-caller-00001";
const WORKER="account-rtc-worker-00001";
const OTHER="account-rtc-other-000001";
const CATEGORY="test-rtc-service";
const NOW=1_800_000_000_000;
const DEADLINE=NOW+40_000;
const ready=()=>({
  listingAvailable:true,blockedByRequester:false,blockedByWorker:false,
  workerConsentedToCalls:true,callDestinationVerified:true,
  connectionPrivacyApproved:true,abuseLimitPassed:true,
});
const refused=reason=>({kind:"denied",reason});
let serial=0;
const command=(actorAccountId,event,expectedRevision=0,nowMs=NOW+1000,key)=>({
  actorAccountId,event,expectedRevision,nowMs,
  idempotencyKey:key??"rtc-key-"+String(++serial).padStart(12,"0"),
});

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const account of [CALLER,WORKER,OTHER]) await ensureAccount(adapter,account);
  await optInAsWorker(adapter,WORKER);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run(CATEGORY,"synthetic-rtc-trade","Synthetic RTC work","परीक्षण कार्य");
  const listing=await publishListing(adapter,WORKER,CATEGORY);
  assert.ok(listing);
  const callerToken=(await issueSession(adapter,CALLER))?.accessToken;
  const workerToken=(await issueSession(adapter,WORKER))?.accessToken;
  const otherToken=(await issueSession(adapter,OTHER))?.accessToken;
  assert.ok(callerToken&&workerToken&&otherToken);
  const target=()=>readTwoSessionBoundCallTarget(adapter,callerToken,workerToken,listing.id);
  const invite=async()=>prepareSyntheticAgoraInvite(await target(),ready(),
    "call-rtc-synthetic-0001",NOW,DEADLINE);
  const accepted=async()=>{
    const prepared=await invite();
    assert.equal(prepared.kind,"prepared");
    const decision=decideSyntheticAgoraCallEvent(
      prepared.call,command(WORKER,"accept"));
    assert.equal(decision.kind,"apply");
    return decision.result;
  };
  const rtc=(call,role="caller",policy=ready(),version=call?.revision)=>
    assessSyntheticAgoraRtcPreflight(adapter,call,callerToken,workerToken,role,version,policy);
  return {
    db,adapter,listing,callerToken,workerToken,otherToken,
    target,invite,accepted,rtc,close(){db.close();}
  };
}

test("one D1 statement verifies BOTH revocable caller/worker sessions and current target",async()=>{
  const f=await fixture();
  try {
    const facts=await f.target();
    assert.ok(facts);
    assert.equal(facts.requesterAccountId,CALLER);
    assert.equal(facts.workerAccountId,WORKER);
    assert.equal(facts.listingId,f.listing.id);
    assert.equal(Object.isFrozen(facts),true);
    assert.match(READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY,/worker_session\.account_id=worker\.id/);
    assert.match(READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY,/worker_session\.token_hash=\?/);
    assert.match(READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY,/worker_session\.expires_at>\?/);
    assert.match(READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY,/requester\.status='active'/);
    assert.equal((READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY.match(/\?/g)||[]).length,5);
    assert.equal(READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY.includes("phone"),false);
    assert.equal(READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY.includes("tel:"),false);
    assert.equal(JSON.stringify(facts).includes(f.callerToken),false);
    assert.equal(JSON.stringify(facts).includes(f.workerToken),false);
  } finally {f.close();}
});

test("query binds only hashed bearer proofs, clock and listing; never raw credentials",async()=>{
  const f=await fixture();
  try {
    const seen=[];
    const proxy={prepare(query){
      const record={query,params:[]};
      seen.push(record);
      return {bind(...params){
        record.params=params;
        return {all:()=>f.adapter.prepare(query).bind(...params).all()};
      }};
    }};
    assert.ok(await readTwoSessionBoundCallTarget(
      proxy,f.callerToken,f.workerToken,f.listing.id));
    assert.equal(seen.length,1);
    assert.deepEqual(seen[0].params,[
      await sessionHash(f.callerToken),seen[0].params[1],f.listing.id,
      await sessionHash(f.workerToken),seen[0].params[4],
    ]);
    assert.equal(seen[0].params[1],seen[0].params[4]);
    assert.ok(Number.isSafeInteger(seen[0].params[1]));
    assert.equal(JSON.stringify(seen).includes(f.callerToken),false);
    assert.equal(JSON.stringify(seen).includes(f.workerToken),false);
  } finally {f.close();}
});

test("worker session is owner-bound, cannot be substituted with another user's token",async()=>{
  const f=await fixture();
  try {
    assert.equal(await readTwoSessionBoundCallTarget(
      f.adapter,f.callerToken,f.otherToken,f.listing.id),null);
    const otherCustomer=await readTwoSessionBoundCallTarget(
      f.adapter,f.otherToken,f.workerToken,f.listing.id);
    assert.ok(otherCustomer);
    assert.equal(otherCustomer.requesterAccountId,OTHER,
      "a different legitimately authenticated customer has their own identity");
    assert.equal(await readTwoSessionBoundCallTarget(
      f.adapter,f.workerToken,f.workerToken,f.listing.id),null);
    assert.equal(await readTwoSessionBoundCallTarget(
      f.adapter,f.workerToken,f.callerToken,f.listing.id),null);
  } finally {f.close();}
});

test("invalid bearer and listing are rejected BEFORE touching D1",async()=>{
  const exploding={prepare(){throw Error("should not hit D1");}};
  for(const bad of [null,false,"",42,"short","b".repeat(42),"b".repeat(44),
    "Bearer "+"b".repeat(43),"a!".repeat(22)]){
    assert.equal(await readTwoSessionBoundCallTarget(exploding,bad,
      "b".repeat(43),"listing-opaque-00001"),null);
    assert.equal(await readTwoSessionBoundCallTarget(exploding,
      "b".repeat(43),bad,"listing-opaque-00001"),null);
  }
  assert.equal(await readTwoSessionBoundCallTarget(exploding,
    "a".repeat(43),"b".repeat(43),"bad id"),null);
});

test("worker logout and logout-all revoke RTC preflight without disabling caller",async()=>{
  const f=await fixture();
  try{
    const call=await f.accepted();
    assert.deepEqual(await f.rtc(call),
      {kind:"prerequisite_only",role:"caller"});
    assert.deepEqual(await f.rtc(call,"worker"),
      {kind:"prerequisite_only",role:"worker"});
    assert.equal(await revokeSession(f.adapter,f.workerToken),true);
    assert.equal(await f.target(),null);
    assert.deepEqual(await f.rtc(call),
      refused("SESSION_OR_TARGET_UNAVAILABLE"));
    const token=(await issueSession(f.adapter,WORKER))?.accessToken;
    assert.ok(token);
    assert.ok(await readTwoSessionBoundCallTarget(
      f.adapter,f.callerToken,token,f.listing.id));
    assert.equal(await revokeAllSessions(f.adapter,f.callerToken),true);
    assert.equal(await readTwoSessionBoundCallTarget(
      f.adapter,f.callerToken,token,f.listing.id),null);
  }finally{f.close();}
});

test("expired worker or caller session never meets token preflight",async()=>{
  const f=await fixture();
  try {
    const call=await f.accepted();
    for(const token of [f.workerToken,f.callerToken]){
      f.db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?")
        .run(await sessionHash(token));
      assert.equal(await f.target(),null);
      assert.deepEqual(await f.rtc(call),
        refused("SESSION_OR_TARGET_UNAVAILABLE"));
    }
  }finally{f.close();}
});

test("disabled worker and disabled caller are denied despite prior accept snapshot",async()=>{
  const f=await fixture();
  try{
    const call=await f.accepted();
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER);
    assert.equal(await f.target(),null);
    assert.deepEqual(await f.rtc(call),refused("SESSION_OR_TARGET_UNAVAILABLE"));
    f.db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(WORKER);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(CALLER);
    assert.equal(await f.target(),null);
    assert.deepEqual(await f.rtc(call),refused("SESSION_OR_TARGET_UNAVAILABLE"));
  }finally{f.close();}
});

test("hidden/unpublished listing and deactivated Category deny RTC preflight",async()=>{
  const f=await fixture();
  try{
    const call=await f.accepted();
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(await f.rtc(call),refused("CALL_OR_POLICY_DENIED"));
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed',status='unpublished' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(await f.rtc(call),refused("CALL_OR_POLICY_DENIED"));
    f.db.prepare("UPDATE worker_listings SET status='published' WHERE id=?")
      .run(f.listing.id);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY);
    assert.deepEqual(await f.rtc(call),refused("CALL_OR_POLICY_DENIED"));
  }finally{f.close();}
});

test("policy refusal, invalid role, stale call revision and inactive call deny credentials",async()=>{
  const f=await fixture();
  try {
    const call=await f.accepted();
    for(const key of Object.keys(ready())){
      const value=key.startsWith("blockedBy")?true:false;
      assert.deepEqual(await f.rtc(call,"caller",{...ready(),[key]:value}),
        refused("CALL_OR_POLICY_DENIED"),key);
    }
    assert.deepEqual(await f.rtc(call,"hacker"),
      refused("INVALID_ROLE"));
    assert.deepEqual(await f.rtc(call,"caller",ready(),call.revision-1),
      refused("CALL_OR_POLICY_DENIED"));
    const prepared=await f.invite();
    assert.equal(prepared.kind,"prepared");
    assert.deepEqual(await f.rtc(prepared.call),
      refused("CALL_OR_POLICY_DENIED"));
    const done=decideSyntheticAgoraCallEvent(call,command(CALLER,"hangup",call.revision));
    assert.equal(done.kind,"apply");
    assert.deepEqual(await f.rtc(done.result),
      refused("CALL_OR_POLICY_DENIED"));
  }finally{f.close();}
});

test("D1 exception or malformed fake target fails closed, never issues RTC tokens",async()=>{
  const f=await fixture();
  try {
    const call=await f.accepted();
    const faulty={prepare(){return {bind(){return this;},
      async all(){throw Error("D1 offline");}};}};
    assert.deepEqual(await assessSyntheticAgoraRtcPreflight(
      faulty,call,f.callerToken,f.workerToken,"worker",call.revision,ready()),
      refused("SESSION_OR_TARGET_UNAVAILABLE"));
    const malformed={prepare(){return {bind(){return this;},
      async all(){return {results:[{requesterId:CALLER,workerAccountId:WORKER}]};}};}};
    assert.deepEqual(await assessSyntheticAgoraRtcPreflight(
      malformed,call,f.callerToken,f.workerToken,"worker",call.revision,ready()),
      refused("SESSION_OR_TARGET_UNAVAILABLE"));
  }finally{f.close();}
});

test("synthetic signaling intent maps only authorized transitions to opaque role updates",async()=>{
  const f=await fixture();
  try {
    const prepared=await f.invite();
    assert.equal(prepared.kind,"prepared");
    const variants=[
      [WORKER,"accept","call_answered","caller"],
      [WORKER,"decline","call_declined","caller"],
      [WORKER,"busy","call_busy","caller"],
      [CALLER,"cancel","call_cancelled","worker"],
      [null,"ring_timeout","call_missed","both"],
    ];
    for(const [actor,event,signal,recipientRole] of variants){
      const time=event==="ring_timeout"?DEADLINE:NOW+1000;
      const plan=assessSyntheticAgoraSignalingIntent(
        prepared.call,command(actor,event,0,time));
      assert.equal(plan.kind,"transition_only",event);
      assert.deepEqual(plan.signal,{
        kind:"intent_only",signal,recipientRole,revision:1,
      },event);
      assert.equal(Object.isFrozen(plan.signal),true);
      const raw=JSON.stringify(plan.signal);
      for(const secret of [CALLER,WORKER, f.callerToken, f.workerToken,
        "phone","token","channel","rtcUid","tel:"]) {
        assert.equal(raw.includes(secret),false,secret);
      }
    }
  }finally{f.close();}
});

test("accepted/media-connected events yield logical updates, never real signaling",async()=>{
  const f=await fixture();
  try {
    const prepared=await f.invite();
    const first=assessSyntheticAgoraSignalingIntent(prepared.call,
      command(WORKER,"accept"));
    assert.equal(first.kind,"transition_only");
    const connected=assessSyntheticAgoraSignalingIntent(first.next,
      command(null,"media_ready",1));
    assert.equal(connected.kind,"transition_only");
    assert.deepEqual(connected.signal,{
      kind:"intent_only",signal:"call_connected",recipientRole:"both",revision:2,
    });
    const ended=assessSyntheticAgoraSignalingIntent(connected.next,
      command(WORKER,"hangup",2));
    assert.equal(ended.kind,"transition_only");
    assert.deepEqual(ended.signal,{
      kind:"intent_only",signal:"call_ended",recipientRole:"both",revision:3,
    });
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(ended.next,
      command(CALLER,"hangup",3)),
      {kind:"denied",reason:"TRANSITION_DENIED"});
  }finally{f.close();}
});

test("unauthorized actor, premature timeout, expiry and revision mismatch never signal",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.invite();
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(call,
      command(CALLER,"accept")),
      {kind:"denied",reason:"NOT_PARTICIPANT"});
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(call,
      command(OTHER,"cancel")),
      {kind:"denied",reason:"NOT_PARTICIPANT"});
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(call,
      command(null,"ring_timeout",0,DEADLINE-1)),
      {kind:"denied",reason:"TOO_EARLY"});
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(call,
      command(WORKER,"accept",0,DEADLINE)),
      {kind:"denied",reason:"RING_EXPIRED"});
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(call,
      command(WORKER,"accept",1)),
      {kind:"denied",reason:"STALE_REVISION"});
  }finally{f.close();}
});

test("idempotent replay suppresses duplicate signals and rejects changed retry",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.invite();
    const cmd=command(WORKER,"accept",0,NOW+1000,"rtc-signal-retry-0001");
    const first=assessSyntheticAgoraSignalingIntent(call,cmd);
    assert.equal(first.kind,"transition_only");
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(
      first.next,cmd,first.receipt),{kind:"replay_suppressed"});
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(
      first.next,{...cmd,event:"decline"},first.receipt),
      {kind:"denied",reason:"KEY_CONFLICT"});
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(
      first.next,{...cmd,actorAccountId:OTHER},first.receipt),
      {kind:"denied",reason:"NOT_PARTICIPANT"});
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(
      call,cmd,first.receipt),{kind:"denied",reason:"KEY_CONFLICT"});
  }finally{f.close();}
});

test("no public RTC/token/signaling endpoint, call schema, SDK or phone numbers enabled",async()=>{
  const f=await fixture();
  try {
    const call=await f.accepted();
    assert.deepEqual(await f.rtc(call),{kind:"prerequisite_only",role:"caller"});
    for(const route of [
      "/api/v1/calls","/api/v1/rtc/token","/api/v1/rtc/join",
      "/api/v1/agora","/api/v1/signaling","/api/v1/voice",
    ]){
      const response=await worker.fetch(new Request("https://jodlo.rekixo.com"+route,{
        method:"POST",headers:{Authorization:"Bearer "+f.callerToken,
          "Content-Type":"application/json"},
        body:JSON.stringify({listingId:f.listing.id,uid:12345,
          channel:"attacker",phone:"+91-PRIVATE"}),
      }),{DB:f.adapter});
      assert.equal(response.status,404,route);
    }
    const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all().map(row=>row.name);
    for(const name of ["agora_tokens","agora_channels","rtc_participants",
      "call_sessions","call_invitations","call_history","phone_numbers"]) {
      assert.equal(tables.includes(name),false);
    }
  }finally{f.close();}
});
