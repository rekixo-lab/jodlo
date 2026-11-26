import assert from "node:assert/strict";
import test from "node:test";
import {createHmac} from "node:crypto";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession,revokeSession,sessionHash} from "../src/modules/identity/sessions.ts";
import {preparePrivateCallInvitation} from "../src/modules/interactions/private-call-invitation.ts";
import {claimPrivateCallDispatch} from "../src/modules/interactions/private-call-dispatch.ts";
import {ownPrivateCallSignal} from "../src/modules/interactions/private-call-signaling.ts";
import {issueOwnAgoraAudioGrant} from "../src/modules/interactions/private-agora-media.ts";
import {recordTrustedCallCreditEvent,readOwnCallCreditBalance} from "../src/modules/interactions/private-call-credits.ts";
import {callUsageDigest,closeCallUsage,recordVerifiedCallInterval,reserveOwnCallUsage,
  settleDueCallUsage,verifiedOverlapSeconds} from "../src/modules/interactions/verified-call-usage.ts";
import {handleAgoraUsageWebhook} from "../src/modules/interactions/agora-usage-webhook.ts";
import {stageTrustedPlayConsumable} from "../src/modules/interactions/play-consumable-outbox.ts";
import {recordTrustedPlayRevocation} from "../src/modules/interactions/google-play-rtdn-fences.ts";
import {registerPlayRefundPolicy} from "../src/modules/interactions/play-refund-review.ts";
import {setOwnWorkerAgoraCallPreference} from "../src/modules/workers/agora-call-preference.ts";
import {setOwnWorkerAvailability,setOwnAgoraAccountBlock} from "../src/modules/interactions/agora-private-safety-state.ts";
import {changeOwnAgoraListingBlock} from "../src/modules/interactions/agora-listing-blocks.ts";
import {prepareAccountErasure,eraseOwnD1Account} from "../src/modules/identity/account-erasure.ts";

const APPROVAL="a".repeat(64),SECRET="synthetic-agora-notification-secret";
async function fixture(seconds=300,offsetMs=0){
  const f=openLocalDatabase(),{db,adapter}=f;
  const now=Math.floor(Date.now()/1000)*1000+offsetMs,listing=crypto.randomUUID();
  db.function("unixepoch",()=>Math.floor(now/1000));
  db.exec(`INSERT INTO accounts(id) VALUES('usage-caller'),('usage-worker'),('usage-outsider');
    INSERT INTO categories(id,slug,name_en,is_active) VALUES('repair','repair','Repair',1);
    INSERT INTO worker_profiles(account_id,status) VALUES('usage-worker','draft');
    INSERT INTO worker_agora_call_preferences VALUES('usage-worker',1,1);
    INSERT INTO worker_agora_availability_preferences VALUES('usage-worker',1,1);`);
  db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id,status) VALUES(?,'usage-worker','repair','published')").run(listing);
  const caller=(await issueSession(adapter,"usage-caller")).accessToken;
  const worker=(await issueSession(adapter,"usage-worker")).accessToken;
  const outsider=(await issueSession(adapter,"usage-outsider")).accessToken;
  if(seconds)await recordTrustedCallCreditEvent(adapter,{accountId:"usage-caller",
    sourceKeyHash:await callUsageDigest("synthetic-initial-credit"),kind:"purchase_grant",seconds,createdAtMs:now});
  const invitation=await preparePrivateCallInvitation(adapter,caller,listing,"usage-test-attempt",now);
  assert.equal(invitation.kind,"created");
  assert.ok(await claimPrivateCallDispatch(adapter,caller,invitation.invitationId,"usage-worker",now));
  assert.equal((await ownPrivateCallSignal(adapter,worker,invitation.invitationId,"accept",now)).phase,"accepted");
  return {...f,now,listing,id:invitation.invitationId,caller,worker,outsider};
}
async function nextAcceptedInvitation(f,now,attempt){
  const next=await preparePrivateCallInvitation(f.adapter,f.caller,f.listing,attempt,now);
  assert.equal(next.kind,"created");
  assert.ok(await claimPrivateCallDispatch(f.adapter,f.caller,next.invitationId,"usage-worker",now));
  assert.equal((await ownPrivateCallSignal(f.adapter,f.worker,next.invitationId,"accept",now)).phase,"accepted");
  return next.invitationId;
}
function callback(id,uid,seq,start,end,reason=1,now=end*1000){
  const raw=JSON.stringify({noticeId:`synthetic:${uid}:${seq}`,productId:1,eventType:108,notifyMs:now,
    payload:{channelName:"jodlo-"+id,uid,clientSeq:seq,ts:end,duration:end-start,reason,platform:1}});
  return new Request("https://example.invalid/api/v1/agora/usage",{method:"POST",body:raw,
    headers:{"Content-Type":"application/json","Agora-Signature-V2":createHmac("sha256",SECRET).update(raw).digest("hex")}});
}
const env=adapter=>({DB:adapter,CALL_USAGE_ENABLED:"1",CALL_USAGE_POLICY_VERSION:"agora-overlap-v1",
  CALL_USAGE_APPROVAL_SHA256:APPROVAL,AGORA_NOTIFICATIONS_SECRET:SECRET,
  CALL_USAGE_LIMITER:{limit:async()=>({success:true})}});

test("funded media grants reserve caller seconds once; verified provider overlap debits exactly once",async()=>{
  const f=await fixture();const {db,adapter,id,now,caller,worker,outsider}=f;
  try{
    const issue=t=>issueOwnAgoraAudioGrant(adapter,t,id,"b".repeat(32),now,{approvalHash:APPROVAL});
    assert.equal(await issue(outsider),null);
    const grants=await Promise.all([issue(caller),issue(worker),issue(caller)]);
    assert.ok(grants.every(Boolean));
    assert.equal(db.prepare("SELECT count(*) n FROM call_usage_sessions").get().n,1);
    assert.equal((await readOwnCallCreditBalance(adapter,caller,now)).availableSeconds,0);
    assert.equal((await readOwnCallCreditBalance(adapter,worker,now)).availableSeconds,0);
    await assert.rejects(recordTrustedCallCreditEvent(adapter,{accountId:"usage-caller",
      sourceKeyHash:await callUsageDigest("cannot-spend-reserved"),kind:"verified_usage",seconds:1,createdAtMs:now}),/CALL_SECONDS_RESERVED/);
    const start=now/1000;
    for(const [uid,seq,from,to] of [[2,20,start+10,start+50],[1,10,start+5,start+55],[2,20,start+10,start+50]]){
      assert.equal((await handleAgoraUsageWebhook(callback(id,uid,seq,from,to),env(adapter),to*1000)).status,200);
    }
    await closeCallUsage(adapter,id,now+55000);
    assert.deepEqual(await settleDueCallUsage(adapter,now+100000),{settled:0,charged:0});
    const results=await Promise.all([settleDueCallUsage(adapter,now+420000),settleDueCallUsage(adapter,now+420000)]);
    assert.equal(results.reduce((n,x)=>n+x.charged,0),40);
    assert.equal(results.reduce((n,x)=>n+x.settled,0),1);
    assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,260);
    assert.equal(db.prepare("SELECT count(*) n FROM call_credit_events WHERE kind='verified_usage'").get().n,1);
    assert.equal(db.prepare("SELECT charged_seconds FROM call_usage_sessions").get().charged_seconds,40);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
    assert.deepEqual(await settleDueCallUsage(adapter,now+421000),{settled:0,charged:0});
    assert.throws(()=>db.exec("UPDATE call_usage_sessions SET charged_seconds=41"),/IMMUTABLE_CALL_USAGE/);
  }finally{db.close();}
});

test("usage policy/authentication/default flags gate every debit; bogus callbacks cannot exhaust provider quota",async()=>{
  const f=await fixture(0);const {db,adapter,id,now,caller}=f;
  try{
    assert.equal(await issueOwnAgoraAudioGrant(adapter,caller,id,"b".repeat(32),now,{approvalHash:APPROVAL}),null);
    let limits=0;const config={...env(adapter),CALL_USAGE_LIMITER:{limit:async()=>{limits++;return {success:true};}}};
    const start=now/1000;
    assert.equal((await handleAgoraUsageWebhook(callback(id,1,1,start,start+5),{},now+5000)).status,404);
    assert.equal((await handleAgoraUsageWebhook(callback(id,1,1,start,start+5),{...config,CALL_USAGE_APPROVAL_SHA256:""},now+5000)).status,503);
    assert.equal((await handleAgoraUsageWebhook(callback(id,1,1,start,start+5),{...config,CALL_USAGE_APPROVAL_SHA256:"0".repeat(64)},now+5000)).status,503);
    assert.equal(await reserveOwnCallUsage(adapter,caller,id,"0".repeat(64),now),null);
    const forged=callback(id,1,1,start,start+5);forged.headers.set("Agora-Signature-V2","0".repeat(64));
    assert.equal((await handleAgoraUsageWebhook(forged,config,now+5000)).status,401);
    assert.equal(limits,0);
    assert.equal((await handleAgoraUsageWebhook(callback(id,1,1,start,start+5),config,now+5000)).status,200);
    assert.equal(db.prepare("SELECT count(*) n FROM call_usage_intervals").get().n,0,"unfunded/unknown channel cannot create evidence or credit");
    assert.equal(db.prepare("SELECT count(*) n FROM call_credit_events").get().n,0);
  }finally{db.close();}
});

test("missing, abnormal or conflicting media evidence releases the hold without inventing a charge",async()=>{
  for(const kind of ["missing","abnormal","conflict"]){
    const f=await fixture();const {db,adapter,id,now,caller}=f;
    try{
      assert.ok(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now));
      const base={invitationId:id,uid:1,clientSeq:1,startedAtSeconds:now/1000,endedAtSeconds:now/1000+40,reason:1};
      await recordVerifiedCallInterval(adapter,base,now+40000);
      if(kind==="abnormal")await recordVerifiedCallInterval(adapter,{...base,uid:2,reason:2},now+40000);
      if(kind==="conflict"){
        await recordVerifiedCallInterval(adapter,{...base,uid:2},now+40000);
        assert.equal(await recordVerifiedCallInterval(adapter,{...base,endedAtSeconds:base.endedAtSeconds-1},now+40000),"conflict");
      }
      assert.deepEqual(await settleDueCallUsage(adapter,now+420000),{settled:1,charged:0});
      assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,300);
      assert.equal(db.prepare("SELECT count(*) n FROM call_credit_events WHERE kind='verified_usage'").get().n,0);
      // A late callback cannot reopen a settled invoice or mint a second debit.
      await recordVerifiedCallInterval(adapter,{...base,uid:2,clientSeq:9},now+421000);
      assert.deepEqual(await settleDueCallUsage(adapter,now+422000),{settled:0,charged:0});
    }finally{db.close();}
  }
});

test("normal RTC overlap uses interval unions, clamps to authorization and rounds in customer's favour",()=>{
  const i=(uid,start,end,reason=1)=>({uid,start,end,reason});
  assert.equal(verifiedOverlapSeconds([i(1,0,50),i(1,20,70),i(2,10,40),i(2,35,80)],1000,90000),60);
  assert.equal(verifiedOverlapSeconds([i(1,0,50),i(2,0,50)],1250,48750),46);
  assert.equal(verifiedOverlapSeconds([i(1,10,30),i(2,40,60)],1000,90000),0);
  assert.equal(verifiedOverlapSeconds([i(1,0,50),i(2,0,50,2)],1000,90000),0);
  assert.equal(verifiedOverlapSeconds([],1000,90000),0);
});

test("account erasure removes operational usage evidence; expired evidence never removes financial journal",async()=>{
  const f=await fixture();const {db,adapter,id,now,caller}=f;
  try{
    assert.ok(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now));
    await recordVerifiedCallInterval(adapter,{invitationId:id,uid:1,clientSeq:1,
      startedAtSeconds:now/1000,endedAtSeconds:now/1000+40,reason:1},now+40000);
    const before=(await readOwnCallCreditBalance(adapter,caller)).revision;
    db.exec("DELETE FROM accounts WHERE id='usage-worker'");
    assert.equal(db.prepare("SELECT count(*) n FROM call_usage_sessions").get().n,0);
    assert.equal(db.prepare("SELECT count(*) n FROM call_usage_intervals").get().n,0);
    assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,300);
    assert.equal((await readOwnCallCreditBalance(adapter,caller)).revision,before+1,
      "receiver erasure releases caller reservation with a new snapshot revision");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();}
});

test("signed Agora Console health probe acknowledges setup without quota or database side effects",async()=>{
  const f=await fixture();const {db,adapter,now}=f;
  try{
    let limits=0;
    const config={...env(adapter),CALL_USAGE_LIMITER:{limit:async()=>{limits++;return {success:true};}}};
    const raw=JSON.stringify({noticeId:"agora-console-probe",productId:1,eventType:108,notifyMs:now,
      payload:{channelName:"test_webhook",uid:12121212,clientSeq:123,ts:1560496834,duration:600,reason:1}});
    const request=()=>new Request("https://example.invalid/api/v1/agora/usage",{method:"POST",body:raw,
      headers:{"Content-Type":"application/json","Agora-Signature-V2":createHmac("sha256",SECRET).update(raw).digest("hex")}});
    const before=db.prepare("SELECT total_changes() n").get().n;
    assert.equal((await handleAgoraUsageWebhook(request(),config,now)).status,200);
    assert.equal(limits,0);
    assert.equal(db.prepare("SELECT total_changes() n").get().n,before);
    const forged=request();forged.headers.set("Agora-Signature-V2","0".repeat(64));
    assert.equal((await handleAgoraUsageWebhook(forged,config,now)).status,401);
    assert.equal(limits,0);
    assert.equal(db.prepare("SELECT total_changes() n").get().n,before);
  }finally{db.close();}
});

test("a contradictory duplicate atomically fences a concurrently settling invoice",async()=>{
  for(const contradiction of ["overlapping","outside-authorization","past-grace"]){
  const f=await fixture();const {db,adapter,id,now,caller}=f;
  try{
    assert.ok(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now));
    const evidence={invitationId:id,uid:1,clientSeq:1,startedAtSeconds:now/1000,
      endedAtSeconds:now/1000+40,reason:1};
    await recordVerifiedCallInterval(adapter,evidence,now+40000);
    await recordVerifiedCallInterval(adapter,{...evidence,uid:2},now+40000);
    let raced;
    const racingDb={...adapter,prepare(sql){
      const stmt=adapter.prepare(sql),run=stmt.run.bind(stmt);
      stmt.run=async()=>{
        const answer=await run();
        if(sql.startsWith("INSERT INTO call_usage_intervals"))
          raced=await settleDueCallUsage(adapter,now+420000);
        return answer;
      };
      return stmt;
    }};
    const incoming=contradiction==="outside-authorization"?
      {...evidence,startedAtSeconds:now/1000-2,endedAtSeconds:now/1000-1}:
      {...evidence,endedAtSeconds:evidence.endedAtSeconds-1};
    assert.equal(await recordVerifiedCallInterval(racingDb,incoming,
      now+(contradiction==="past-grace"?421000:40000)),"conflict");
    assert.deepEqual(raced,{settled:1,charged:0});
    assert.equal(db.prepare("SELECT count(*) n FROM call_credit_events WHERE kind='verified_usage'").get().n,0);
    assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,300);
  }finally{db.close();}
  }
});

test("terminal signaling caps charge atomically before a separate close request can run",async()=>{
  const f=await fixture();const {db,adapter,id,now,caller,worker}=f;
  try{
    assert.ok(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now));
    const event={invitationId:id,uid:1,clientSeq:1,startedAtSeconds:now/1000,
      endedAtSeconds:now/1000+40,reason:1};
    await recordVerifiedCallInterval(adapter,event,now+40000);
    await recordVerifiedCallInterval(adapter,{...event,uid:2},now+40000);
    assert.equal((await ownPrivateCallSignal(adapter,worker,id,"hangup",now+20000)).phase,"ended");
    assert.equal(db.prepare("SELECT ended_at_ms FROM call_usage_sessions").get().ended_at_ms,now+20000);
    assert.throws(()=>db.prepare("UPDATE call_usage_sessions SET ended_at_ms=?").run(now+40000),/IMMUTABLE_CALL_USAGE/);
    assert.deepEqual(await settleDueCallUsage(adapter,now+420000),{settled:1,charged:20});
    assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,280);
  }finally{db.close();}
});

test("either original session revocation stops billing; an unrelated session cannot end another device's call",async()=>{
  for(const role of ["caller","worker"]){
    const f=await fixture();const {db,adapter,id,now,caller}=f;
    try{
      assert.ok(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now));
      const extra=(await issueSession(adapter,"usage-caller")).accessToken;
      assert.equal(await reserveOwnCallUsage(adapter,extra,id,APPROVAL,now),null,
        "same account on another device is not the original accepted RTC session");
      await revokeSession(adapter,extra);
      assert.equal(db.prepare("SELECT ended_at_ms FROM call_usage_sessions").get().ended_at_ms,null);
      assert.equal(await revokeSession(adapter,f[role]),true);
      const end=db.prepare("SELECT ended_at_ms FROM call_usage_sessions").get().ended_at_ms;
      assert.ok(Number.isSafeInteger(end)&&end>=now&&end<=Date.now());
      const event={invitationId:id,uid:1,clientSeq:1,startedAtSeconds:now/1000+2,
        endedAtSeconds:now/1000+40,reason:1};
      await recordVerifiedCallInterval(adapter,event,now+40000);
      await recordVerifiedCallInterval(adapter,{...event,uid:2},now+40000);
      assert.deepEqual(await settleDueCallUsage(adapter,now+420000),{settled:1,charged:0});
    }finally{db.close();}
  }
});

test("reservation bounds follow the earliest original-session expiry and account disable",async()=>{
  const f=await fixture();const {db,adapter,id,now,caller,worker}=f;
  try{
    db.prepare("UPDATE auth_sessions SET expires_at=? WHERE token_hash=?")
      .run(now/1000+40,await sessionHash(caller));
    db.prepare("UPDATE auth_sessions SET expires_at=? WHERE token_hash=?")
      .run(now/1000+80,await sessionHash(worker));
    assert.deepEqual(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now),{deadlineMs:now+40000});
    assert.equal(db.prepare("SELECT reserved_seconds FROM call_usage_sessions").get().reserved_seconds,40);
    db.prepare("UPDATE accounts SET status='disabled' WHERE id='usage-worker'").run();
    const end=db.prepare("SELECT ended_at_ms FROM call_usage_sessions").get().ended_at_ms;
    assert.ok(Number.isSafeInteger(end)&&end>=now&&end<=Date.now());
    assert.deepEqual(await settleDueCallUsage(adapter,now+420000),{settled:1,charged:0});
  }finally{db.close();}
});

test("early hangup releases only unusable held seconds and admits the next funded call before provider settlement",async()=>{
  for(const refundHeld of [false,true]){
    const f=await fixture();const {db,adapter,id,now,caller,worker}=f;
    try{
      assert.ok(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now));
      if(refundHeld){
        const source="9".repeat(64);
        await registerPlayRefundPolicy(adapter,{version:"jodlo-play-refund-hold-v1",approvalSha256:"e".repeat(64)},now);
        assert.equal(await stageTrustedPlayConsumable(adapter,{accountId:"usage-caller",sourceKeyHash:source,
          productId:"jodlo.minutes5",seconds:300,createdAtMs:now},new Map([["jodlo.minutes5",5]]),{
          sessionHash:await sessionHash(caller),policyVersion:"jodlo-play-minutes-v1",
          approvalSha256:"f".repeat(64),purchasedAtMs:now-1000}),"applied");
        await recordTrustedPlayRevocation(adapter,{sourceKeyHash:source,reason:"voided_purchase",recordedAtMs:now+1});
      }
      const before=await readOwnCallCreditBalance(adapter,caller);
      assert.equal(before.availableSeconds,0);
      assert.equal((await ownPrivateCallSignal(adapter,worker,id,"hangup",now+10500)).phase,"ended");
      const ended=db.prepare("SELECT reserved_seconds AS held,settle_after_ms AS due FROM call_usage_sessions WHERE invitation_id=?").get(id);
      assert.deepEqual({...ended},{held:11,due:now+130500},"keep a rounded-up worst case, with only a two-minute evidence grace");
      assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,289);
      assert.equal((await readOwnCallCreditBalance(adapter,caller)).revision,before.revision+1);
      for(const seconds of [0,5,12,300])
        assert.throws(()=>db.prepare("UPDATE call_usage_sessions SET reserved_seconds=? WHERE invitation_id=?").run(seconds,id),/IMMUTABLE_CALL_USAGE/);
      assert.throws(()=>db.prepare("UPDATE call_usage_sessions SET settle_after_ms=? WHERE invitation_id=?").run(now+130501,id),/IMMUTABLE_CALL_USAGE/);
      assert.equal(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now+11000),null,"an ended authorization cannot reopen");
      const next=await nextAcceptedInvitation(f,now+11000,"next-after-early-end");
      const reservations=await Promise.all([caller,worker,caller].map(token=>reserveOwnCallUsage(adapter,token,next,APPROVAL,now+11000)));
      assert.ok(reservations.every(Boolean));
      assert.equal(db.prepare("SELECT reserved_seconds FROM call_usage_sessions WHERE invitation_id=?").get(next).reserved_seconds,289);
      assert.equal(db.prepare("SELECT count(*) AS n FROM call_usage_sessions WHERE state='active'").get().n,2);
      assert.equal(db.prepare("SELECT SUM(reserved_seconds) AS n FROM call_usage_sessions WHERE state='active'").get().n,300);
      assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,0);
      await assert.rejects(recordTrustedCallCreditEvent(adapter,{accountId:"usage-caller",
        sourceKeyHash:await callUsageDigest("cannot-double-spend-shortened-hold"),kind:"verified_usage",seconds:1,createdAtMs:now+12000}),/CALL_SECONDS_RESERVED/);
      for(const uid of [1,2]){
        await recordVerifiedCallInterval(adapter,{invitationId:id,uid,clientSeq:1,
          startedAtSeconds:now/1000,endedAtSeconds:now/1000+11,reason:1},now+11000);
        await recordVerifiedCallInterval(adapter,{invitationId:next,uid,clientSeq:1,
          startedAtSeconds:now/1000+11,endedAtSeconds:now/1000+31,reason:1},now+31000);
      }
      assert.equal((await ownPrivateCallSignal(adapter,worker,next,"hangup",now+31000)).phase,"ended");
      assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,269);
      assert.deepEqual(await settleDueCallUsage(adapter,now+130499),{settled:0,charged:0});
      assert.deepEqual(await settleDueCallUsage(adapter,now+130500),{settled:1,charged:10});
      assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,270,
        "the first customer's rounded-up remainder releases without affecting the next call's hold");
      assert.deepEqual(await settleDueCallUsage(adapter,now+151000),{settled:1,charged:20});
      assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,270);
      assert.equal(db.prepare("SELECT available_seconds FROM call_credit_balances WHERE account_id='usage-caller'").get().available_seconds,refundHeld?570:270);
      assert.equal(db.prepare("SELECT count(*) AS n FROM call_credit_events WHERE kind='verified_usage'").get().n,2);
    }finally{db.close();}
  }
});

test("an immediate end holds zero seconds, cannot produce a charge and releases the ongoing-call slot",async()=>{
  const f=await fixture();const {db,adapter,id,now,caller,worker}=f;
  try{
    assert.ok(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now));
    assert.equal((await ownPrivateCallSignal(adapter,worker,id,"hangup",now)).phase,"ended");
    assert.deepEqual({...db.prepare("SELECT reserved_seconds AS held,settle_after_ms AS due FROM call_usage_sessions WHERE invitation_id=?").get(id)},
      {held:0,due:now+120000});
    assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,300);
    const next=await nextAcceptedInvitation(f,now+1000,"next-after-zero-time-end");
    assert.ok(await reserveOwnCallUsage(adapter,caller,next,APPROVAL,now+1000));
    assert.equal(db.prepare("SELECT reserved_seconds FROM call_usage_sessions WHERE invitation_id=?").get(next).reserved_seconds,300);
    for(const uid of [1,2])await recordVerifiedCallInterval(adapter,{invitationId:id,uid,clientSeq:1,
      startedAtSeconds:now/1000,endedAtSeconds:now/1000+5,reason:1},now+5000);
    assert.deepEqual(await settleDueCallUsage(adapter,now+120000),{settled:1,charged:0});
    assert.equal(db.prepare("SELECT count(*) AS n FROM call_credit_events WHERE kind='verified_usage'").get().n,0);
    assert.equal((await readOwnCallCreditBalance(adapter,caller)).availableSeconds,0,
      "settling the old zero-time call cannot release the new reservation");
  }finally{db.close();}
});

test("withdrawing current call authorization ends the peer signal and caps verified billing in the same mutation",async()=>{
  const cases=[
    ["consent",async f=>assert.equal((await setOwnWorkerAgoraCallPreference(f.adapter,f.worker,false,1)).kind,"updated")],
    ["availability",async f=>assert.equal((await setOwnWorkerAvailability(f.adapter,f.worker,false,1)).kind,"updated")],
    ["caller block",async f=>assert.equal(await changeOwnAgoraListingBlock(f.adapter,f.caller,f.listing,true),true)],
    ["receiver block",async f=>assert.equal((await setOwnAgoraAccountBlock(f.adapter,f.worker,"usage-caller",true)).kind,"updated")],
    ["unpublish",async f=>f.db.exec("UPDATE worker_listings SET status='unpublished'")],
    ["moderation",async f=>f.db.exec("UPDATE worker_listings SET moderation_status='hidden'")],
    ["report hold",async f=>f.db.exec("UPDATE worker_listings SET report_hold=1")],
    ["consent row deletion",async f=>f.db.exec("DELETE FROM worker_agora_call_preferences")],
    ["availability row deletion",async f=>f.db.exec("DELETE FROM worker_agora_availability_preferences")],
    ["listing deletion",async f=>f.db.exec("DELETE FROM worker_listings")],
    ["worker withdrawal",async f=>f.db.exec("DELETE FROM worker_profiles")],
    ["category withdrawal",async f=>f.db.exec("UPDATE categories SET is_active=0")],
  ];
  for(const [name,revoke] of cases){
    const f=await fixture(300,-60_000);const {db,adapter,id,caller,now}=f;
    try{
      assert.ok(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,now),name);
      const before=(await readOwnCallCreditBalance(adapter,caller)).revision;
      db.function("unixepoch",()=>Math.floor(Date.now()/1000));
      // Cloudflare may count trigger side effects in meta.changes. A mutation
      // must prove its own RETURNING row, not assume exactly one total write.
      f.adapter={...adapter,prepare(sql){
        const statement=adapter.prepare(sql),run=statement.run.bind(statement);
        statement.run=async()=>{
          const initial=db.prepare("SELECT total_changes() AS n").get().n;
          const result=await run();
          return {...result,meta:{...result.meta,changes:db.prepare("SELECT total_changes() AS n").get().n-initial}};
        };
        return statement;
      }};
      await revoke(f);
      const row=db.prepare("SELECT ended_at_ms AS end,reserved_seconds AS held,settle_after_ms AS due FROM call_usage_sessions WHERE invitation_id=?").get(id);
      assert.ok(row.end>=now+60_000&&row.end<=Date.now(),name);
      assert.equal(row.held,Math.ceil((row.end-now)/1000),name);
      assert.equal(row.due,row.end+120_000,name);
      assert.ok((await readOwnCallCreditBalance(adapter,caller)).revision>before,name);
      const signal=await ownPrivateCallSignal(adapter,caller,id);
      assert.ok(signal===null||signal.phase==="ended",name+" cannot keep the peer in an accepted call");
      assert.equal(await issueOwnAgoraAudioGrant(adapter,caller,id,"b".repeat(32),Date.now(),{approvalHash:APPROVAL}),null,name);
      assert.equal(await reserveOwnCallUsage(adapter,caller,id,APPROVAL,Date.now()),null,name);
      for(const uid of [1,2])assert.equal(await recordVerifiedCallInterval(adapter,{invitationId:id,uid,clientSeq:1,
        startedAtSeconds:now/1000+10,endedAtSeconds:now/1000+90,reason:1},now+90_000),"recorded",name);
      const expected=Math.floor(row.end/1000)-(now/1000+10);
      assert.ok(expected>=50&&expected<80,name+" only pre-withdrawal overlap may be billed");
      assert.deepEqual(await settleDueCallUsage(adapter,now+420_000),{settled:1,charged:expected},name);
      assert.equal(db.prepare("SELECT count(*) AS n FROM call_credit_events WHERE kind='verified_usage'").get().n,1,name);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[],name);
    }finally{db.close();}
  }
});

test("later opt-in, unblock or republication cannot revive an accepted authorization that was withdrawn",async()=>{
  for(const kind of ["consent","availability","block","listing"]){
    const f=await fixture();
    try{
      assert.ok(await reserveOwnCallUsage(f.adapter,f.caller,f.id,APPROVAL,f.now));
      if(kind==="consent"){
        assert.equal((await setOwnWorkerAgoraCallPreference(f.adapter,f.worker,false,1)).kind,"updated");
        assert.equal((await setOwnWorkerAgoraCallPreference(f.adapter,f.worker,true,2)).kind,"updated");
      }else if(kind==="availability"){
        assert.equal((await setOwnWorkerAvailability(f.adapter,f.worker,false,1)).kind,"updated");
        assert.equal((await setOwnWorkerAvailability(f.adapter,f.worker,true,2)).kind,"updated");
      }else if(kind==="block"){
        assert.equal(await changeOwnAgoraListingBlock(f.adapter,f.caller,f.listing,true),true);
        assert.equal(await changeOwnAgoraListingBlock(f.adapter,f.caller,f.listing,false),true);
      }else{
        f.db.exec("UPDATE worker_listings SET status='unpublished'");
        f.db.exec("UPDATE worker_listings SET status='published'");
      }
      assert.equal((await ownPrivateCallSignal(f.adapter,f.caller,f.id)).phase,"ended",kind);
      assert.equal(await issueOwnAgoraAudioGrant(f.adapter,f.caller,f.id,"b".repeat(32),Date.now(),{approvalHash:APPROVAL}),null,kind);
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM call_history").get().n,2,kind+" records one end per participant");
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM call_credit_events WHERE kind='verified_usage'").get().n,0,kind);
    }finally{f.db.close();}
  }
});

test("authorization withdrawn immediately before reservation cannot leave a fresh credit hold",async()=>{
  const f=await fixture();
  try{
    let revoked=false;
    const racing={...f.adapter,prepare(sql){
      const stmt=f.adapter.prepare(sql),run=stmt.run.bind(stmt);
      stmt.run=async()=>{
        if(sql.includes("INSERT INTO call_usage_sessions")&&!revoked){
          revoked=true;f.db.exec("UPDATE worker_agora_call_preferences SET calls_enabled=0,revision=revision+1");
        }
        return run();
      };
      return stmt;
    }};
    assert.equal(await reserveOwnCallUsage(racing,f.caller,f.id,APPROVAL,f.now),null);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM call_usage_sessions").get().n,0);
    assert.equal((await readOwnCallCreditBalance(f.adapter,f.caller)).availableSeconds,300);
  }finally{f.db.close();}
});

test("real account erasure cascades accepted calls, usage, dispatch and existing history without resurrecting deleted parents",async()=>{
  for(const role of ["caller","worker"]){
    const f=await fixture();
    try{
      const account=role==="caller"?"usage-caller":"usage-worker",subject="synthetic-erase-"+role;
      f.db.prepare("INSERT INTO google_identities(google_sub,account_id) VALUES(?,?)").run(subject,account);
      assert.ok(await reserveOwnCallUsage(f.adapter,f.caller,f.id,APPROVAL,f.now));
      assert.equal((await ownPrivateCallSignal(f.adapter,f.worker,f.id,"hangup",f.now+1000)).phase,"ended");
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM call_history").get().n,2);
      const active=await nextAcceptedInvitation(f,f.now+2000,"erasure-with-existing-history");
      assert.ok(await reserveOwnCallUsage(f.adapter,f.caller,active,APPROVAL,f.now+2000));
      await recordVerifiedCallInterval(f.adapter,{invitationId:active,uid:1,clientSeq:1,
        startedAtSeconds:f.now/1000+2,endedAtSeconds:f.now/1000+20,reason:1},f.now+20000);
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM private_call_dispatch_slots").get().n,1);
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM call_usage_sessions").get().n,2);
      const signingKey=new Uint8Array(32).fill(79);
      const challenge=await prepareAccountErasure(f.adapter,f[role],signingKey);
      assert.ok(challenge);
      let checks=0;
      const verifyGoogle=async(token,audience,_keys,_android,nonce)=>{
        checks++;assert.equal(token,"synthetic-google-erasure-proof");
        assert.equal(audience,"synthetic-client");assert.equal(nonce,challenge.nonce);return subject;
      };
      assert.equal(await eraseOwnD1Account(f.adapter,f[role],challenge.challenge,"synthetic-google-erasure-proof",
        {signingKey,googleAudience:"synthetic-client"},verifyGoogle),true,role);
      assert.equal(checks,1);
      for(const table of ["private_call_invitations","private_call_dispatch_slots","call_usage_sessions","call_usage_intervals"])
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM "+table).get().n,0,role+":"+table);
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM call_history WHERE account_id=?").get(account).n,0);
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM call_history").get().n,1,
        "the existing other-participant summary survives; cascades do not manufacture a new history row");
      assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
      if(role==="worker")assert.equal((await readOwnCallCreditBalance(f.adapter,f.caller)).availableSeconds,300,
        "receiver erasure releases every operational reservation without charging for unconfirmed use");
    }finally{f.db.close();}
  }
});
