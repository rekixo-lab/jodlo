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
  const prepare=(riskFacts=risk(),cb=callerBearer,wb=workerBearer,id=listing.id,
    callId=CALL_ID,now=NOW,deadline=DEADLINE)=>
    prepareSyntheticSafetyCheckedAgoraInvite(adapter,cb,wb,id,callId,now,deadline,riskFacts);
  const enable=()=>setOwnWorkerAgoraCallPreference(adapter,workerBearer,true,0);
  return {db,adapter,listing,callerBearer,workerBearer,otherBearer,
    risk,prepare,enable,close(){db.close();}};
}

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
    assert.deepEqual(await f.prepare(f.risk(),f.otherBearer,f.workerBearer),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,f.otherBearer),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.workerBearer,f.workerBearer),denied);
  }finally{f.close();}
});

test("expired consent evidence cannot authorize a later invitation",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const old=f.risk();
    assert.equal((await f.prepare(old)).kind,"prepared");
    assert.deepEqual(await f.prepare(old,
      f.callerBearer,f.workerBearer,f.listing.id,CALL_ID,DEADLINE,DEADLINE+2000),denied);
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

test("caller or worker logout, disabled accounts and revoked worker deny",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    assert.equal((await f.prepare()).kind,"prepared");
    assert.equal(await revokeSession(f.adapter,f.workerBearer),true);
    assert.deepEqual(await f.prepare(),denied);
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
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,f.workerBearer,
      f.listing.id,"x"),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,f.workerBearer,
      f.listing.id,CALL_ID,NOW,NOW),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,f.workerBearer,
      f.listing.id,CALL_ID,NOW,NOW+120001),denied);
    assert.deepEqual(await f.prepare(f.risk(),f.callerBearer,f.workerBearer,
      f.listing.id,CALL_ID,-1,DEADLINE),denied);
  }finally{f.close();}
});

test("fake database outage, corrupt projection and fake consent cannot place a ring",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.enable()).kind,"updated");
    const broken={prepare(){throw Error("sensitive-offline-DB-error");}};
    assert.deepEqual(await prepareSyntheticSafetyCheckedAgoraInvite(
      broken,f.callerBearer,f.workerBearer,f.listing.id,CALL_ID,NOW,DEADLINE,f.risk()),
      denied);
    const malformed={prepare(){return {bind(){return this;},
      async all(){return {results:[{workerAccountId:WORKER,phone:"+91_private"}]};}};}};
    assert.deepEqual(await prepareSyntheticSafetyCheckedAgoraInvite(
      malformed,f.callerBearer,f.workerBearer,f.listing.id,CALL_ID,NOW,DEADLINE,f.risk()),
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
