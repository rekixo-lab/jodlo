import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { issueSession, revokeSession } from "../src/modules/identity/sessions.ts";
import { setOwnWorkerAgoraCallPreference } from "../src/modules/workers/agora-call-preference.ts";
import { prepareSyntheticSafetyCheckedAgoraInvite } from "../src/modules/interactions/agora-invite-safety.ts";
import { composeSyntheticAgoraInviteRisk } from "../src/modules/interactions/agora-risk-evidence.ts";
import {
  READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,
  readCallerSessionBoundAgoraOptInTarget,
} from "../src/modules/interactions/request-target.ts";
import { sessionHash } from "../src/modules/identity/sessions.ts";

const CALLER="account-agora-guard-caller";
const WORKER="account-agora-guard-worker";
const OTHER="account-agora-guard-other1";
const CAT="agora-guard-synthetic-trade";
const NOW=1800000000000;
const DEADLINE=NOW+35000;
const CALL_ID="call-agora-guard-00001";
const denied={kind:"denied"};

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  for (const id of [CALLER,WORKER,OTHER]) await ensureAccount(adapter,id);
  await optInAsWorker(adapter,WORKER);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run(CAT,"agora-guard-synthetic","Synthetic call safety","परीक्षण कार्य");
  const listing=await publishListing(adapter,WORKER,CAT);
  assert.ok(listing);
  const callerBearer=(await issueSession(adapter,CALLER))?.accessToken;
  const workerBearer=(await issueSession(adapter,WORKER))?.accessToken;
  const otherBearer=(await issueSession(adapter,OTHER))?.accessToken;
  assert.ok(callerBearer&&workerBearer&&otherBearer);
  const risk=(overrides={})=>({
    kind:"synthetic_invite_risk_v1",
    callerAccountId:CALLER,workerAccountId:WORKER,listingId:listing.id,
    checkedAtMs:NOW-1,expiresAtMs:DEADLINE,
    workerPresence:"online",workerAvailability:"available",
    blockedByCaller:false,blockedByWorker:false,rateGate:"pass",
    recipientVerified:true,privacyApproved:true,...overrides,
  });
  const prepare=(riskFacts=risk(),cb=callerBearer,id=listing.id,
    callId=CALL_ID,now=NOW,deadline=DEADLINE)=>
    prepareSyntheticSafetyCheckedAgoraInvite(adapter,cb,id,callId,now,deadline,riskFacts);
  const enable=()=>setOwnWorkerAgoraCallPreference(adapter,workerBearer,true,0);
  return {db,adapter,listing,callerBearer,workerBearer,otherBearer,
    risk,prepare,enable,close(){db.close();}};
}

/**
 * Independent scripted checks: deliberately NOT D1-backed availability,
 * presence, relationships, rate reservation, or real device routing.
 */
function syntheticCallabilityChecks(listingId){
  const bound={
    callerAccountId:CALLER,workerAccountId:WORKER,listingId,
    checkedAtMs:NOW-100,expiresAtMs:DEADLINE,
  };
  return [
    {...bound,kind:"synthetic_presence_check_v1",workerPresence:"online"},
    {...bound,kind:"synthetic_availability_check_v1",workerAvailability:"available"},
    {...bound,kind:"synthetic_mutual_blocks_check_v1",
      blockedByCaller:false,blockedByWorker:false},
    {...bound,kind:"synthetic_rate_check_v1",rateGate:"pass"},
    {...bound,kind:"synthetic_connection_check_v1",
      recipientVerified:true,privacyApproved:true},
  ];
}

test("five separate synthetic checks compose only with matching account and listing",async()=>{
  const f=await fixture();
  try{
    const identity={callerAccountId:CALLER,workerAccountId:WORKER,listingId:f.listing.id};
    const checks=syntheticCallabilityChecks(f.listing.id);
    checks[0]={...checks[0],checkedAtMs:NOW-10};
    checks[1]={...checks[1],expiresAtMs:NOW+10};
    const risk=composeSyntheticAgoraInviteRisk(identity,NOW,checks);
    assert.ok(risk);
    assert.equal(risk.checkedAtMs,NOW-10,"newest check is the evidence start");
    assert.equal(risk.expiresAtMs,NOW+10,"earliest expiry wins; no extension");
    assert.equal(Object.isFrozen(risk),true);
    assert.equal(JSON.stringify(risk).includes(f.workerBearer),false);
    assert.deepEqual(await f.prepare(risk),denied,"real D1 opt-in remains default-OFF");
    assert.equal((await f.enable()).kind,"updated");
    assert.equal((await f.prepare(risk)).kind,"prepared");
    assert.deepEqual(await f.prepare(risk,f.callerBearer,
      f.listing.id,CALL_ID,NOW+10,DEADLINE+10),denied,
    "reassembled risk expires at the earliest check expiration");
    const off=await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,false,1);
    assert.equal(off.kind,"updated");
    assert.deepEqual(await f.prepare(risk),denied,"opt-out cannot be bypassed by evidence");
  }finally{f.close();}
});

test("missing, duplicated, forged or malformed synthetic provider dimensions fail closed",async()=>{
  const f=await fixture();
  try{
    const identity={callerAccountId:CALLER,workerAccountId:WORKER,listingId:f.listing.id};
    const good=syntheticCallabilityChecks(f.listing.id);
    const invalids=[
      null,{},false,[],[...good.slice(0,4)],
      [good[0],good[0],...good.slice(2)],
      good.map((x,i)=>i===0?{...x,kind:"client_provided_presence"}:x),
      good.map((x,i)=>i===0?{...x,workerAccountId:OTHER}:x),
      good.map((x,i)=>i===1?{...x,listingId:"other-listing-000001"}:x),
      good.map((x,i)=>i===2?{...x,callerAccountId:OTHER}:x),
      good.map((x,i)=>i===2?{...x,blockedByWorker:"false"}:x),
      good.map((x,i)=>i===2?{...x,blockedByCaller:null}:x),
      good.map((x,i)=>i===3?{...x,rateGate:true}:x),
      good.map((x,i)=>i===4?{...x,privacyApproved:1}:x),
      good.map((x,i)=>i===4?{...x,phone:"+91_private"}:x),
      good.map((x,i)=>i===0?{...x,checkedAtMs:NOW+1}:x),
      good.map((x,i)=>i===1?{...x,checkedAtMs:-1}:x),
      good.map((x,i)=>i===2?{...x,expiresAtMs:NOW}:x),
      good.map((x,i)=>i===3?{...x,expiresAtMs:NaN}:x),
      good.map((x,i)=>i===4?{...x,checkedAtMs:NOW-0.5}:x),
    ];
    for(const checks of invalids)
      assert.equal(composeSyntheticAgoraInviteRisk(identity,NOW,checks),null,
        JSON.stringify(checks));
    assert.equal(composeSyntheticAgoraInviteRisk(
      {...identity,workerAccountId:CALLER},NOW,good),null);
    assert.equal(composeSyntheticAgoraInviteRisk(
      {...identity,listingId:"wrong-listing-00001"},NOW,good),null);
    assert.equal(composeSyntheticAgoraInviteRisk(
      {...identity,phone:"fake"},NOW,good),null);
    assert.equal(composeSyntheticAgoraInviteRisk(identity,NaN,good),null);
    assert.equal(composeSyntheticAgoraInviteRisk(identity,-1,good),null);
  }finally{f.close();}
});

test("scripted offline, busy, bilateral blocks and rate denial never become invitations",async()=>{
  const f=await fixture();
  try{
    const identity={callerAccountId:CALLER,workerAccountId:WORKER,listingId:f.listing.id};
    assert.equal((await f.enable()).kind,"updated");
    const base=syntheticCallabilityChecks(f.listing.id);
    const blockedCases=[
      [0,"workerPresence","offline"],
      [0,"workerPresence","unknown"],
      [1,"workerAvailability","busy"],
      [1,"workerAvailability","unknown"],
      [2,"blockedByCaller",true],
      [2,"blockedByWorker",true],
      [3,"rateGate","deny"],
      [3,"rateGate","unknown"],
      [4,"recipientVerified",false],
      [4,"privacyApproved",false],
    ];
    for(const [index,field,value] of blockedCases){
      const checks=base.map((v,i)=>i===index?{...v,[field]:value}:v);
      const risk=composeSyntheticAgoraInviteRisk(identity,NOW,checks);
      assert.ok(risk,`structured explicit denial can be represented: ${field}`);
      assert.deepEqual(await f.prepare(risk),denied,field);
    }
    assert.equal((await f.prepare(composeSyntheticAgoraInviteRisk(
      identity,NOW,base))).kind,"prepared",
      "an internal synthetic pass is NOT proof of live availability or a quota");
  }finally{f.close();}
});

test("default-OFF worker consent blocks ring despite all synthetic risk facts",async()=>{
  const f=await fixture();
  try{
    assert.deepEqual(await f.prepare(),denied);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_agora_call_preferences").get().n,0);
    const enabled=await f.enable();
    assert.equal(enabled.kind,"updated");
    const ready=await f.prepare();
    assert.equal(ready.kind,"prepared");
    assert.equal(ready.call.phase,"ringing");
    assert.equal(ready.call.callerAccountId,CALLER);
    assert.equal(ready.call.workerAccountId,WORKER);
    assert.equal(ready.call.listingId,f.listing.id);
    assert.equal(ready.call.revision,0);
    assert.ok(Object.isFrozen(ready.call));
    assert.equal(JSON.stringify(ready.call).includes(f.workerBearer),false);
  }finally{f.close();}
});

test("offline, unknown and busy synthetic worker states all deny invite",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    for(const state of ["offline","unknown"]){
      assert.deepEqual(await f.prepare(f.risk({workerPresence:state})),denied,state);
    }
    for(const state of ["busy","unavailable","unknown"]){
      assert.deepEqual(await f.prepare(f.risk({workerAvailability:state})),denied,state);
    }
    assert.equal((await f.prepare()).kind,"prepared");
  }finally{f.close();}
});

test("either direction of block denies; unknown or nonboolean block is not consent",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    for(const change of [
      {blockedByCaller:true},{blockedByWorker:true},
      {blockedByCaller:null},{blockedByWorker:undefined},
      {blockedByCaller:"false"},{blockedByWorker:0},
    ])assert.deepEqual(await f.prepare(f.risk(change)),denied,JSON.stringify(change));
  }finally{f.close();}
});

test("unknown or denied abuse verdict cannot be guessed into allow",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    for(const verdict of ["unknown","deny",true,false,null,"allowed"]){
      assert.deepEqual(await f.prepare(f.risk({rateGate:verdict})),denied,String(verdict));
    }
    assert.equal((await f.prepare(f.risk({rateGate:"pass"}))).kind,"prepared");
    // This fake pass does NOT reserve/consume a durable quota.
  }finally{f.close();}
});

test("destination verification and Agora participant privacy must both be true",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    for(const delta of [
      {recipientVerified:false},{privacyApproved:false},
      {recipientVerified:null},{privacyApproved:"yes"},
    ])assert.deepEqual(await f.prepare(f.risk(delta)),denied,JSON.stringify(delta));
  }finally{f.close();}
});

test("risk must be exact, complete, bounded in time, and never from the future",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const invalid=[
      null,false,[],{},f.risk({phone:"fake"}),
      f.risk({checkedAtMs:NOW+1}),f.risk({checkedAtMs:-1}),
      f.risk({checkedAtMs:NOW+0.1}),f.risk({checkedAtMs:NaN}),
      f.risk({expiresAtMs:NOW}),f.risk({expiresAtMs:NOW-1}),
      f.risk({expiresAtMs:Number.MAX_SAFE_INTEGER+1}),
      f.risk({kind:"some_other_message"}),
    ];
    for(const facts of invalid)
      assert.deepEqual(await f.prepare(facts),denied,JSON.stringify(facts));
  }finally{f.close();}
});

test("cross-listing, wrong worker and wrong caller risk are rejected",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    for(const delta of [
      {callerAccountId:OTHER},{workerAccountId:OTHER},
      {listingId:"listing-another-00001"},
      {callerAccountId:WORKER,workerAccountId:CALLER},
    ])assert.deepEqual(await f.prepare(f.risk(delta)),denied,JSON.stringify(delta));
    assert.deepEqual(await f.prepare(f.risk(),f.otherBearer),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.workerBearer),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,"other-listing-00001"),denied);
  }finally{f.close();}
});

test("expired consent evidence cannot authorize a later invitation",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const old=f.risk();
    assert.equal((await f.prepare(old)).kind,"prepared");
    assert.deepEqual(await f.prepare(old,
      f.callerBearer,f.listing.id,CALL_ID,DEADLINE,DEADLINE+2000),denied);
    assert.deepEqual(await f.prepare(f.risk({checkedAtMs:NOW+10})),denied);
  }finally{f.close();}
});

test("worker opt-out immediately blocks new invite even with previously passing evidence",async()=>{
  const f=await fixture();
  try{
    const evidence=f.risk();
    assert.equal((await f.enable()).kind,"updated");
    const first=await f.prepare(evidence);
    assert.equal(first.kind,"prepared");
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,false,1),
      {kind:"updated",preference:{enabled:false,revision:2}});
    assert.deepEqual(await f.prepare(evidence),denied);
    assert.ok(first.call,"an old preview cannot grant a new call");
  }finally{f.close();}
});

test("caller logout and worker deactivation deny; worker login is NOT invitation consent",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    assert.equal((await f.prepare()).kind,"prepared");
    assert.equal(await revokeSession(f.adapter,f.workerBearer),true);
    assert.equal((await f.prepare()).kind,"prepared",
      "worker session is NOT a credential the caller must provide; mock risk still says online");
    assert.deepEqual(await f.prepare(f.risk({workerPresence:"offline"})),denied,
      "a future real server-owned presence system must enforce availability");
  }finally{f.close();}
  const g=await fixture();
  try{
    assert.equal((await g.enable()).kind,"updated");
    assert.equal(await revokeSession(g.adapter,g.callerBearer),true);
    assert.deepEqual(await g.prepare(),denied);
  }finally{g.close();}
  const h=await fixture();
  try{
    assert.equal((await h.enable()).kind,"updated");
    h.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER);
    assert.deepEqual(await h.prepare(),denied);
  }finally{h.close();}
});

test("listing unpublished/hidden and Category inactive block rings",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(await f.prepare(),denied);
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed',status='unpublished' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(await f.prepare(),denied);
    f.db.prepare("UPDATE worker_listings SET status='published' WHERE id=?").run(f.listing.id);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CAT);
    assert.deepEqual(await f.prepare(),denied);
  }finally{f.close();}
});

test("invalid synthetic call ID and ring bounds do not bypass existing reducer",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,
      f.listing.id,"x"),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,
      f.listing.id,CALL_ID,NOW,NOW),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,
      f.listing.id,CALL_ID,NOW,NOW+120001),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,
      f.listing.id,CALL_ID,-1,DEADLINE),denied);
  }finally{f.close();}
});

test("fake database outage, corrupt projection and fake consent cannot place a ring",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const broken={prepare(){throw Error("sensitive-offline-DB-error");}};
    assert.deepEqual(await prepareSyntheticSafetyCheckedAgoraInvite(
      broken,f.callerBearer,f.listing.id,CALL_ID,NOW,DEADLINE,f.risk()),
      denied);
    const malformed={prepare(){return {bind(){return this;},
      async all(){return {results:[{workerAccountId:WORKER,phone:"+91_private"}]};}};}};
    assert.deepEqual(await prepareSyntheticSafetyCheckedAgoraInvite(
      malformed,f.callerBearer,f.listing.id,CALL_ID,NOW,DEADLINE,f.risk()),
      denied);
    assert.equal(JSON.stringify(await f.prepare(f.risk({rateGate:"deny"}))).includes(WORKER),false);
  }finally{f.close();}
});

test("risk verdict does not persist blocks, presence, quota or any user metadata",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    assert.equal((await f.prepare()).kind,"prepared");
    assert.equal((await f.prepare()).kind,"prepared",
      "test contract is non-atomic and does NOT claim to consume rate quota");
    const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all().map(row=>row.name);
    for(const name of ["call_history","agora_rate_reservations","blocked_accounts",
      "worker_presence","worker_availability","call_invitations","agora_tokens",
      "agora_channels","rtc_participants","phone_numbers"]){
      assert.equal(tables.includes(name),false,name);
    }
    for(const path of ["/api/v1/calls","/api/v1/invite","/api/v1/rtc/token"]){
      const response=await worker.fetch(new Request("https://jodlo.rekixo.com"+path,
        {method:"POST",headers:{"Content-Type":"application/json"},
         body:JSON.stringify({listingId:f.listing.id,phone:"+91_PRIVATE",rateGate:"pass"})}),
         {DB:f.adapter});
      assert.equal(response.status,404,path);
    }
  }finally{f.close();}
});


test("caller-only SQL does not ask for or compare a worker bearer",async()=>{
  const f=await fixture();
  try{
    assert.match(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,/session\.token_hash=\?/);
    assert.match(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,/session\.expires_at>\?/);
    assert.match(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,/worker\.id<>requester\.id|requester\.id<>worker\.id/);
    assert.match(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,/pref\.account_id=worker\.id/);
    assert.match(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,/pref\.calls_enabled=1/);
    assert.match(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,/wl\.status='published'/);
    assert.match(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,/c\.is_active=1/);
    assert.equal((READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY.match(/\?/g)||[]).length,3);
    assert.equal(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY.includes("worker_session"),false);
    assert.equal(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY.includes("phone"),false);
    assert.equal(READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY.includes("tel:"),false);
    assert.equal(await readCallerSessionBoundAgoraOptInTarget(
      f.adapter,f.callerBearer,f.listing.id),null,"default-OFF");
    assert.equal((await f.enable()).kind,"updated");
    const target=await readCallerSessionBoundAgoraOptInTarget(
      f.adapter,f.callerBearer,f.listing.id);
    assert.ok(target);
    assert.equal(target.requesterAccountId,CALLER);
    assert.equal(target.workerAccountId,WORKER);
    assert.equal(target.listingOwnerAccountId,WORKER);
    assert.equal(target.categoryId,CAT);
    assert.equal(Object.isFrozen(target),true);
    assert.equal(JSON.stringify(target).includes(f.callerBearer),false);
    assert.equal(JSON.stringify(target).includes(f.workerBearer),false);
  }finally{f.close();}
});

test("one owner-bound query binds ONLY caller hash, server time and listing ID",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const observed=[];
    const proxy={
      prepare(query){
        const row={query,values:[]};
        observed.push(row);
        return {bind(...values){row.values=values;return {
          all:()=>f.adapter.prepare(query).bind(...values).all(),
        };}};
      },
    };
    const result=await readCallerSessionBoundAgoraOptInTarget(
      proxy,f.callerBearer,f.listing.id);
    assert.ok(result);
    assert.equal(observed.length,1);
    assert.deepEqual(observed[0].values,[
      await sessionHash(f.callerBearer),observed[0].values[1],f.listing.id,
    ]);
    assert.ok(Number.isSafeInteger(observed[0].values[1]));
    for(const secret of [f.callerBearer,f.workerBearer,f.otherBearer,WORKER,CALLER]){
      assert.equal(JSON.stringify(observed).includes(secret),false,secret);
    }
    assert.equal(observed[0].query,READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY);
  }finally{f.close();}
});

test("worker login/logout is NOT caller-supplied; revoked worker cannot turn off consent",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    assert.equal((await f.prepare()).kind,"prepared");
    assert.equal(await revokeSession(f.adapter,f.workerBearer),true);
    assert.ok(await readCallerSessionBoundAgoraOptInTarget(
      f.adapter,f.callerBearer,f.listing.id),
      "caller authorization is independent of whether worker is logged in");
    assert.equal((await f.prepare()).kind,"prepared",
      "synthetic online evidence does NOT become real presence");
    assert.deepEqual(await f.prepare(f.risk({workerPresence:"offline"})),denied);
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,false,1),{kind:"denied"},
      "revoked worker bearer cannot toggle future call permission");
  }finally{f.close();}
});

test("real D1 preference OFF overrides fabricated pass/online risk",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const evidence=f.risk();
    assert.equal((await f.prepare(evidence)).kind,"prepared");
    const off=await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,false,1);
    assert.equal(off.kind,"updated");
    assert.deepEqual(await f.prepare(evidence),denied);
    assert.equal(await readCallerSessionBoundAgoraOptInTarget(
      f.adapter,f.callerBearer,f.listing.id),null);
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,true,2)).kind,"updated");
    assert.equal((await f.prepare(evidence)).kind,"prepared");
  }finally{f.close();}
});

test("invalid caller token or listing is rejected before any D1 access",async()=>{
  const bomb={prepare(){throw Error("should not access DB");}};
  const listing="opaque-listing-00001";
  for(const invalid of [
    null,undefined,"","bad",123,false,"a".repeat(42),"a".repeat(44),
    "Bearer "+"a".repeat(43),
  ])assert.equal(await readCallerSessionBoundAgoraOptInTarget(
    bomb,invalid,listing),null);
  for(const invalid of [null,undefined,42,false,"", "bad listing"])
    assert.equal(await readCallerSessionBoundAgoraOptInTarget(
      bomb,"a".repeat(43),invalid),null);
});

test("a fake row with disallowed account/status/moderation/category cannot pass",async()=>{
  const f=await fixture();
  try{
    const good={
      requesterId:CALLER,requesterStatus:"active",
      workerAccountId:WORKER,workerStatus:"active",
      listingId:f.listing.id,listingOwnerAccountId:WORKER,
      categoryId:CAT,listingStatus:"published",moderationStatus:"allowed",
      workerProfileStatus:"draft",categoryActive:1,
    };
    const forged=rows=>({prepare(){return {bind(){return this;},
      async all(){return {results:rows};}};}});
    const attempt=async row=>readCallerSessionBoundAgoraOptInTarget(
      forged([row]),f.callerBearer,f.listing.id);
    assert.ok(await attempt(good),
      "This is only a mock projection; SQL is responsible for real consent");
    for(const patch of [
      {requesterId:WORKER,workerAccountId:WORKER,listingOwnerAccountId:WORKER},
      {requesterStatus:"disabled"},
      {workerStatus:"disabled"},
      {listingStatus:"unpublished"},
      {moderationStatus:"hidden"},
      {workerProfileStatus:"verified"},
      {categoryActive:0},
      {listingOwnerAccountId:OTHER},
      {listingId:"other-listing-000001"},
    ])assert.equal(await attempt({...good,...patch}),null,JSON.stringify(patch));
    assert.equal(await readCallerSessionBoundAgoraOptInTarget(
      forged([]),f.callerBearer,f.listing.id),null);
    assert.equal(await readCallerSessionBoundAgoraOptInTarget(
      forged([good,good]),f.callerBearer,f.listing.id),null);
  }finally{f.close();}
});

test("unknown/expired caller or wrong-account bearer never creates an invitation",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    assert.deepEqual(await f.prepare(f.risk(),"x".repeat(43)),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.otherBearer),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.workerBearer),denied);
    f.db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?")
      .run(await sessionHash(f.callerBearer));
    assert.deepEqual(await f.prepare(),denied);
  }finally{f.close();}
});
