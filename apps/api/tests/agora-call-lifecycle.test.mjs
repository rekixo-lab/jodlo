import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { issueSession, revokeSession } from "../src/modules/identity/sessions.ts";
import { readSessionBoundCallTarget, readCurrentRequestTarget } from "../src/modules/interactions/request-target.ts";
import {
  prepareSyntheticAgoraInvite, decideSyntheticAgoraCallEvent,
  assessSyntheticAgoraJoinPrerequisites, MAX_SYNTHETIC_RING_WINDOW_MS,
} from "../src/modules/interactions/agora-call-lifecycle.ts";

const CALLER="account-agora-customer01";
const WORKER="account-agora-worker0001";
const STRANGER="account-agora-stranger1";
const CAT="synthetic-agora-category";
const NOW=1_800_000_000_000;
const DEADLINE=NOW+40_000;
const approved=()=>({
  listingAvailable:true,blockedByRequester:false,blockedByWorker:false,
  workerConsentedToCalls:true,callDestinationVerified:true,
  connectionPrivacyApproved:true,abuseLimitPassed:true,
});
const deny=(reason)=>({kind:"denied",reason});
let serial=0;
const cmd=(actor,event,revision=0,time=NOW+5000,key)=>({
  actorAccountId:actor,expectedRevision:revision,
  idempotencyKey:key??"attemptkey-"+String(++serial).padStart(9,"0"),
  event,nowMs:time,
});
async function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const id of [CALLER,WORKER,STRANGER])await ensureAccount(adapter,id);
  await optInAsWorker(adapter,WORKER);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run(CAT,"synthetic-agora","Synthetic Agora trade","परीक्षण कार्य");
  const listing=await publishListing(adapter,WORKER,CAT);
  assert.ok(listing);
  const token=(await issueSession(adapter,CALLER))?.accessToken;
  assert.ok(token);
  const target=()=>readSessionBoundCallTarget(adapter,token,listing.id);
  const prepare=async()=>prepareSyntheticAgoraInvite(await target(),
    approved(),"call-local-agora-0001",NOW,DEADLINE);
  return {db,adapter,listing,token,target,prepare,close(){db.close();}};
}

test("local-only Agora invite requires current D1 session, listing, and complete synthetic consent",async()=>{
  const f=await fixture();
  try{
    const prepared=await f.prepare();
    assert.equal(prepared.kind,"prepared");
    assert.deepEqual(prepared.call,{
      callId:"call-local-agora-0001",listingId:f.listing.id,categoryId:CAT,
      callerAccountId:CALLER,workerAccountId:WORKER,
      phase:"ringing",revision:0,createdAtMs:NOW,ringDeadlineMs:DEADLINE,
    });
    assert.equal(Object.isFrozen(prepared.call),true);
    const raw=JSON.stringify(prepared.call);
    for(const key of ["phone","tel:","token","channel","rtcUid","google","microphone"])
      assert.equal(raw.includes(key),false,key);
    for(const key of ["workerConsentedToCalls","abuseLimitPassed","connectionPrivacyApproved"]){
      assert.deepEqual(prepareSyntheticAgoraInvite(await f.target(),
        {...approved(),[key]:false},"call-local-agora-0002",NOW,DEADLINE),
        deny("CONTACT_NOT_APPROVED"));
    }
    assert.deepEqual(prepareSyntheticAgoraInvite(await f.target(),null,
      "call-local-agora-0002",NOW,DEADLINE),deny("CONTACT_NOT_APPROVED"));
  }finally{f.close();}
});

test("invalid synthetic call IDs and time windows do not create an invite",async()=>{
  const f=await fixture();
  try{
    const target=await f.target();
    for(const args of [
      ["x",NOW,DEADLINE],["call-12345678",-1,DEADLINE],
      ["call-12345678",NOW,NOW],["call-12345678",NOW,NOW-1],
      ["call-12345678",NOW,NOW+MAX_SYNTHETIC_RING_WINDOW_MS+1],
      ["call-12345678",NOW,Number.MAX_SAFE_INTEGER+1],
    ])assert.deepEqual(prepareSyntheticAgoraInvite(target,approved(),...args),
      deny("INVALID_INVITE"));
  }finally{f.close();}
});

test("worker answering is a ringing event, not a service Request accept lifecycle",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const first=decideSyntheticAgoraCallEvent(call,cmd(WORKER,"accept"));
    assert.equal(first.kind,"apply");
    assert.equal(first.result.phase,"accepted");
    assert.equal(first.result.revision,1);
    assert.equal(call.phase,"ringing");
    assert.equal(Object.isFrozen(first.result),true);
    assert.equal(Object.isFrozen(first.receipt),true);
    const media=decideSyntheticAgoraCallEvent(first.result,cmd(null,"media_ready",1));
    assert.equal(media.kind,"apply");
    assert.equal(media.result.phase,"connected");
    const hangup=decideSyntheticAgoraCallEvent(media.result,cmd(CALLER,"hangup",2));
    assert.equal(hangup.kind,"apply");
    assert.equal(hangup.result.phase,"ended");
    assert.deepEqual(decideSyntheticAgoraCallEvent(hangup.result,cmd(WORKER,"accept",3)),
      {kind:"reject",code:"TRANSITION_DENIED"});
  }finally{f.close();}
});

test("worker may decline or report busy; caller may cancel a ringing invite",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const options=[[WORKER,"decline","declined"],[WORKER,"busy","busy"],
      [CALLER,"cancel","cancelled"]];
    for(const [actor,event,phase] of options){
      const out=decideSyntheticAgoraCallEvent(call,cmd(actor,event));
      assert.equal(out.kind,"apply");
      assert.equal(out.result.phase,phase);
      assert.deepEqual(decideSyntheticAgoraCallEvent(out.result,cmd(actor,event,1)),
        {kind:"reject",code:"TRANSITION_DENIED"});
    }
  }finally{f.close();}
});

test("server-only timeout cannot run early; stale ring cannot be answered",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    assert.deepEqual(decideSyntheticAgoraCallEvent(call,cmd(null,"ring_timeout",0,DEADLINE-1)),
      {kind:"reject",code:"TOO_EARLY"});
    assert.deepEqual(decideSyntheticAgoraCallEvent(call,cmd(WORKER,"accept",0,DEADLINE)),
      {kind:"reject",code:"RING_EXPIRED"});
    assert.deepEqual(decideSyntheticAgoraCallEvent(call,cmd(CALLER,"cancel",0,DEADLINE+1)),
      {kind:"reject",code:"RING_EXPIRED"});
    const result=decideSyntheticAgoraCallEvent(call,cmd(null,"ring_timeout",0,DEADLINE));
    assert.equal(result.kind,"apply");
    assert.equal(result.result.phase,"missed");
    assert.deepEqual(decideSyntheticAgoraCallEvent(result.result,cmd(WORKER,"accept",1)),
      {kind:"reject",code:"TRANSITION_DENIED"});
  }finally{f.close();}
});

test("untrusted actor cannot accept, cancel, hang up, or claim a server media signal",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    for(const [actor,event] of [
      [CALLER,"accept"],[CALLER,"decline"],[STRANGER,"accept"],
      [STRANGER,"cancel"],[WORKER,"cancel"],[WORKER,"ring_timeout"],
      [CALLER,"media_ready"],[STRANGER,"media_failed"],
    ]) assert.deepEqual(decideSyntheticAgoraCallEvent(call,cmd(actor,event)),
      {kind:"reject",code:"NOT_PARTICIPANT"});
    assert.deepEqual(decideSyntheticAgoraCallEvent(call,cmd(null,"accept")),
      {kind:"reject",code:"NOT_PARTICIPANT"});
  }finally{f.close();}
});

test("accepted phase can fail media or hang up without any Agora join token",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const accepted=decideSyntheticAgoraCallEvent(call,cmd(WORKER,"accept"));
    assert.equal(accepted.kind,"apply");
    for(const [actor,event] of [[null,"media_failed"],[WORKER,"hangup"],[CALLER,"hangup"]]){
      const decision=decideSyntheticAgoraCallEvent(accepted.result,cmd(actor,event,1));
      assert.equal(decision.kind,"apply");
      assert.equal(decision.result.phase,"ended");
    }
    assert.deepEqual(decideSyntheticAgoraCallEvent(accepted.result,cmd(null,"ring_timeout",1,DEADLINE)),
      {kind:"reject",code:"TRANSITION_DENIED"});
  }finally{f.close();}
});

test("compare-and-set revision stops accept/cancel/busy races from applying twice",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const cancel=decideSyntheticAgoraCallEvent(call,cmd(CALLER,"cancel"));
    assert.equal(cancel.kind,"apply");
    assert.deepEqual(decideSyntheticAgoraCallEvent(cancel.result,cmd(WORKER,"accept",0)),
      {kind:"reject",code:"STALE_REVISION"});
    const accept=decideSyntheticAgoraCallEvent(call,cmd(WORKER,"accept"));
    assert.equal(accept.kind,"apply");
    assert.deepEqual(decideSyntheticAgoraCallEvent(accept.result,cmd(WORKER,"busy",0)),
      {kind:"reject",code:"STALE_REVISION"});
    // Only a future ATOMIC store can enforce this across actual Workers.
  }finally{f.close();}
});

test("stored idempotency receipt replays only same exact event and identity",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const command=cmd(WORKER,"accept",0,NOW+5000,"repeatkey-0000001");
    const first=decideSyntheticAgoraCallEvent(call,command);
    assert.equal(first.kind,"apply");
    assert.deepEqual(decideSyntheticAgoraCallEvent(first.result,command,first.receipt),
      {kind:"replay",receipt:first.receipt});
    for(const change of [{event:"decline"},{nowMs:NOW+5001},{expectedRevision:1},
      {idempotencyKey:"repeatkey-0000002"}]){
      assert.deepEqual(decideSyntheticAgoraCallEvent(first.result,{...command,...change},first.receipt),
        {kind:"reject",code:"KEY_CONFLICT"});
    }
    assert.deepEqual(decideSyntheticAgoraCallEvent(first.result,
      {...command,actorAccountId:STRANGER},first.receipt),
      {kind:"reject",code:"NOT_PARTICIPANT"});
  }finally{f.close();}
});

test("corrupt, cross-call or future revision receipts fail closed",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const command=cmd(WORKER,"accept",0,NOW+5000,"repeatkey-0000003");
    const first=decideSyntheticAgoraCallEvent(call,command);
    assert.equal(first.kind,"apply");
    for(const bad of [
      {},false,{...first.receipt,callId:"call-OTHER-0001"},
      {...first.receipt,result:{...first.result,revision:45}},
      {...first.receipt,result:{...first.result,listingId:"other-listing-00001"}},
      {...first.receipt,result:{...first.result,phase:"declined"}},
      {...first.receipt,result:{...first.result,phone:"fake"}},
    ])assert.deepEqual(decideSyntheticAgoraCallEvent(first.result,command,bad),
      {kind:"reject",code:"KEY_CONFLICT"});
    assert.deepEqual(decideSyntheticAgoraCallEvent(call,command,first.receipt),
      {kind:"reject",code:"KEY_CONFLICT"});
  }finally{f.close();}
});

test("synthetic Agora replay refuses receipts impossible in time or lifecycle step",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const acceptCmd=cmd(WORKER,"accept",0,NOW+5000,"timeguard-accept-0001");
    const accepted=decideSyntheticAgoraCallEvent(call,acceptCmd);
    assert.equal(accepted.kind,"apply");
    assert.deepEqual(decideSyntheticAgoraCallEvent(
      accepted.result,acceptCmd,accepted.receipt,
    ),{kind:"replay",receipt:accepted.receipt});

    // A fabricated receipt with a matching fabricated command must not replay:
    // before invite creation or after the worker's ring window expires.
    for(const time of [NOW-1,DEADLINE,DEADLINE+1]){
      const bad={...accepted.receipt,nowMs:time};
      assert.deepEqual(decideSyntheticAgoraCallEvent(
        accepted.result,{...acceptCmd,nowMs:time},bad,
      ),{kind:"reject",code:"KEY_CONFLICT"},String(time));
    }

    const timeoutCmd=cmd(null,"ring_timeout",0,DEADLINE,"timeguard-timeout-0001");
    const timeout=decideSyntheticAgoraCallEvent(call,timeoutCmd);
    assert.equal(timeout.kind,"apply");
    assert.deepEqual(decideSyntheticAgoraCallEvent(
      timeout.result,timeoutCmd,timeout.receipt,
    ),{kind:"replay",receipt:timeout.receipt});
    const forgedTimeout={...timeout.receipt,nowMs:DEADLINE-1};
    assert.deepEqual(decideSyntheticAgoraCallEvent(timeout.result,
      {...timeoutCmd,nowMs:DEADLINE-1},forgedTimeout),
    {kind:"reject",code:"KEY_CONFLICT"});

    // Media and hangup events require a previous accepted/connected revision.
    // Matching identity/revision alone is not evidence that a call existed.
    for(const [event,actor,phase] of [
      ["media_ready",null,"connected"],
      ["media_failed",null,"ended"],
      ["hangup",WORKER,"ended"],
    ]){
      const fake={
        ...accepted.receipt,event,actorAccountId:actor,
        result:{...accepted.result,phase},
      };
      assert.deepEqual(decideSyntheticAgoraCallEvent(
        fake.result,{...acceptCmd,event,actorAccountId:actor},fake,
      ),{kind:"reject",code:"KEY_CONFLICT"},event);
    }

    const hangupCmd=cmd(WORKER,"hangup",1,NOW+6000,"timeguard-hangup-0001");
    const ended=decideSyntheticAgoraCallEvent(accepted.result,hangupCmd);
    assert.equal(ended.kind,"apply");
    assert.deepEqual(decideSyntheticAgoraCallEvent(
      ended.result,hangupCmd,ended.receipt,
    ),{kind:"replay",receipt:ended.receipt});
  }finally{f.close();}
});

test("malformed event, unauthorized field and overflow revisions cannot mutate",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const good=cmd(WORKER,"accept");
    for(const x of [
      null,false,{}, {...call,phone:"123"}, {...call,phase:"unknown"},
      {...call,revision:-1},{...call,ringDeadlineMs:NOW},
      {...call,callerAccountId:WORKER},
    ])assert.deepEqual(decideSyntheticAgoraCallEvent(x,good),
      {kind:"reject",code:"INVALID_INPUT"});
    for(const x of [
      null,false,{}, {...good,phone:"123"}, {...good,event:"unlock"},
      {...good,idempotencyKey:"short"}, {...good,expectedRevision:-1},
      {...good,nowMs:NOW-1},
    ])assert.deepEqual(decideSyntheticAgoraCallEvent(call,x),
      {kind:"reject",code:"INVALID_INPUT"});
    assert.deepEqual(decideSyntheticAgoraCallEvent({...call,revision:Number.MAX_SAFE_INTEGER},good),
      {kind:"reject",code:"INVALID_INPUT"});
  }finally{f.close();}
});

test("RTC preflight requires accepted call and CURRENT nonblocked policy, never creates tokens",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const original=await f.target();
    const initial=assessSyntheticAgoraJoinPrerequisites(call,CALLER,0,original,approved());
    assert.deepEqual(initial,deny("CALL_NOT_ACCEPTED"));
    const accepted=decideSyntheticAgoraCallEvent(call,cmd(WORKER,"accept"));
    assert.equal(accepted.kind,"apply");
    for(const actor of [CALLER,WORKER]){
      const out=assessSyntheticAgoraJoinPrerequisites(accepted.result,actor,1,
        await f.target(),approved());
      assert.deepEqual(out,{kind:"prerequisite_only",
        role:actor===CALLER?"caller":"worker"});
      assert.equal(Object.isFrozen(out),true);
      assert.equal(JSON.stringify(out).includes("token"),false);
      assert.equal(JSON.stringify(out).includes("channel"),false);
    }
    assert.deepEqual(assessSyntheticAgoraJoinPrerequisites(accepted.result,STRANGER,1,
      original,approved()),deny("NOT_PARTICIPANT"));
    assert.deepEqual(assessSyntheticAgoraJoinPrerequisites(accepted.result,CALLER,0,
      original,approved()),deny("STALE_REVISION"));
    assert.deepEqual(assessSyntheticAgoraJoinPrerequisites(accepted.result,CALLER,1,
      original,{...approved(),blockedByWorker:true}),deny("CURRENT_POLICY_DENIED"));
  }finally{f.close();}
});

test("logout, listing hidden or deactivated category revoke any synthetic join premise",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const accepted=decideSyntheticAgoraCallEvent(call,cmd(WORKER,"accept"));
    assert.equal(accepted.kind,"apply");
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(assessSyntheticAgoraJoinPrerequisites(accepted.result,CALLER,1,
      await f.target(),approved()),deny("CURRENT_POLICY_DENIED"));
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed' WHERE id=?")
      .run(f.listing.id);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CAT);
    assert.deepEqual(assessSyntheticAgoraJoinPrerequisites(accepted.result,CALLER,1,
      await f.target(),approved()),deny("CURRENT_POLICY_DENIED"));
    f.db.prepare("UPDATE categories SET is_active=1 WHERE id=?").run(CAT);
    assert.equal(await revokeSession(f.adapter,f.token),true);
    assert.equal(await f.target(),null);
    assert.deepEqual(assessSyntheticAgoraJoinPrerequisites(accepted.result,CALLER,1,
      await f.target(),approved()),deny("CURRENT_POLICY_DENIED"));
    // Prior policy snapshot is NOT live permission to issue external RTC tokens.
  }finally{f.close();}
});

test("call account bindings cannot be replayed against an unrelated service or owner",async()=>{
  const f=await fixture();
  try{
    const {call}=await f.prepare();
    const accepted=decideSyntheticAgoraCallEvent(call,cmd(WORKER,"accept"));
    assert.equal(accepted.kind,"apply");
    const target=await readCurrentRequestTarget(f.adapter,CALLER,f.listing.id);
    for(const corrupted of [
      {...target,workerAccountId:STRANGER,listingOwnerAccountId:STRANGER},
      {...target,requesterAccountId:STRANGER},
      {...target,listingId:"another-listing-0001"},
    ])assert.deepEqual(assessSyntheticAgoraJoinPrerequisites(accepted.result,CALLER,1,
      corrupted,approved()),deny("CURRENT_POLICY_DENIED"));
  }finally{f.close();}
});

test("no actual Agora signaling/RTC channel, phone fields, new D1 table or public call route",async()=>{
  const f=await fixture();
  try{
    const prepared=await f.prepare();
    assert.equal(prepared.kind,"prepared");
    for(const path of ["/api/v1/calls","/api/v1/voice","/api/v1/rtc","/api/v1/requests"]){
      const response=await worker.fetch(new Request("https://jodlo.rekixo.com"+path,{
        method:"POST",headers:{Authorization:"Bearer "+f.token,
          "Content-Type":"application/json"},
        body:JSON.stringify({listingId:f.listing.id,agoraChannel:"forged",rtcUid:1234}),
      }),{DB:f.adapter});
      assert.equal(response.status,404,path);
    }
    const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all().map(x=>x.name);
    for(const t of ["call_sessions","agora_channels","call_invitations","call_history",
      "rtc_participants","phone_numbers"]){
      assert.equal(tables.includes(t),false);
    }
  }finally{f.close();}
});
