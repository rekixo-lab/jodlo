import assert from "node:assert/strict";
import test from "node:test";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {handleRequest} from "../src/http/router.ts";
import {issueSession,sessionHash} from "../src/modules/identity/sessions.ts";
import {setOwnWorkerAvailability,setOwnAgoraAccountBlock,readOwnWorkerAvailability,
  INSERT_OWN_AVAILABILITY_QUERY,UPDATE_OWN_AVAILABILITY_QUERY} from "../src/modules/interactions/agora-private-safety-state.ts";
import {changeOwnAgoraListingBlock,removeOwnContactBlock,readOwnContactBlocks} from "../src/modules/interactions/agora-listing-blocks.ts";
import {registerOwnCallDevice,hasOwnCallDevice,readRegisteredCallDestination,purgeExpiredCallDevices} from "../src/modules/notifications/private-call-devices.ts";
import {preparePrivateCallInvitation} from "../src/modules/interactions/private-call-invitation.ts";
import {claimPrivateCallDispatch} from "../src/modules/interactions/private-call-dispatch.ts";
import {sendPrivateCallRing} from "../src/modules/interactions/private-call-ring.ts";
import {ownPrivateCallSignal} from "../src/modules/interactions/private-call-signaling.ts";
import {issueOwnAgoraAudioGrant} from "../src/modules/interactions/private-agora-media.ts";
import {reserveOwnCallUsage,callUsageDigest,recordVerifiedCallInterval} from "../src/modules/interactions/verified-call-usage.ts";
import {recordTrustedCallCreditEvent,readOwnCallCreditSnapshot} from "../src/modules/interactions/private-call-credits.ts";
import {readOwnCallHistory,clearOwnCallHistory} from "../src/modules/interactions/call-history.ts";
import {readCallerSessionBoundAgoraOptInTarget} from "../src/modules/interactions/request-target.ts";

const CALLER="clock-caller",WORKER="clock-worker",APPROVAL="a".repeat(64);
const DEVICE="synthetic-registration-token-for-database-clock-000001";
async function fixture(phase=null){
  const f=openLocalDatabase();f.start=Math.floor(Date.now()/1000);f.now=f.start*1000;f.clock=f.start;f.expiry=f.start+60;
  f.db.function("unixepoch",()=>f.clock);
  f.db.exec(`INSERT INTO accounts(id) VALUES('${CALLER}'),('${WORKER}');
    INSERT INTO categories(id,slug,name_en,is_active) VALUES('clock-repair','clock-repair','Repair',1);
    INSERT INTO worker_profiles(account_id,status) VALUES('${WORKER}','draft');
    INSERT INTO worker_agora_call_preferences VALUES('${WORKER}',1,1);
    INSERT INTO worker_agora_availability_preferences VALUES('${WORKER}',1,1);`);
  f.listing=crypto.randomUUID();
  f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id,status) VALUES(?,?,'clock-repair','published')").run(f.listing,WORKER);
  f.caller=(await issueSession(f.adapter,CALLER)).accessToken;f.worker=(await issueSession(f.adapter,WORKER)).accessToken;
  f.callerHash=await sessionHash(f.caller);f.workerHash=await sessionHash(f.worker);
  f.db.prepare("UPDATE auth_sessions SET expires_at=?").run(f.expiry);
  await recordTrustedCallCreditEvent(f.adapter,{accountId:CALLER,sourceKeyHash:await callUsageDigest("clock-initial"),
    kind:"purchase_grant",seconds:300,createdAtMs:f.now});
  assert.equal(await registerOwnCallDevice(f.adapter,f.worker,DEVICE,f.start),true);
  f.expire=()=>{f.clock=f.expiry;};
  if(phase){
    const invitation=await preparePrivateCallInvitation(f.adapter,f.caller,f.listing,"database-clock-call",f.now);
    assert.equal(invitation.kind,"created");f.id=invitation.invitationId;
    if(phase!=="unclaimed")assert.ok(await claimPrivateCallDispatch(f.adapter,f.caller,f.id,WORKER,f.now));
    if(phase==="accepted")assert.equal((await ownPrivateCallSignal(f.adapter,f.worker,f.id,"accept",f.now)).phase,"accepted");
  }
  return f;
}
// Only advance SQLite's execution clock. The bound JS timestamp and stored
// session expiry remain unchanged, modelling real queue latency deterministically.
function beforeSql(f,matches,before=f.expire){
  const adapter=f.adapter;
  let hits=0;
  const check=query=>{if(matches(query)){hits++;before();}};
  return {...adapter,get hits(){return hits;},async batch(statements){
    for(const statement of statements)check(statement._query);
    return adapter.batch(statements);
  },prepare(query){
    const statement=adapter.prepare(query);
    for(const method of ["all","run"]){const execute=statement[method].bind(statement);
      statement[method]=async()=>{check(query);return execute();};}
    return statement;
  }};
}
const rows=(f,table)=>f.db.prepare("SELECT * FROM "+table).all();

for(const revision of [0,1])test("natural expiry blocks queued availability "+(revision?"update":"insert"),async()=>{
  const f=await fixture();
  try{
    if(!revision)f.db.exec("DELETE FROM worker_agora_availability_preferences");
    const initial=rows(f,"worker_agora_availability_preferences");
    const queued=beforeSql(f,q=>q===(revision?UPDATE_OWN_AVAILABILITY_QUERY:INSERT_OWN_AVAILABILITY_QUERY));
    assert.deepEqual(await setOwnWorkerAvailability(queued,f.worker,false,revision),{kind:"denied"});
    assert.equal(queued.hits,1);assert.deepEqual(rows(f,"worker_agora_availability_preferences"),initial);
  }finally{f.db.close();}
});

for(const path of ["account-block","account-unblock","listing-block","listing-unblock","managed-unblock"])
  test("natural expiry prevents queued "+path+" without changing another session's safety state",async()=>{
    const f=await fixture();
    try{
      if(path.includes("unblock"))assert.equal(await changeOwnAgoraListingBlock(f.adapter,f.caller,f.listing,true),true);
      const initial=rows(f,"agora_account_blocks");
      const queued=beforeSql(f,q=>q.startsWith(path.includes("unblock")?"DELETE FROM agora_account_blocks":"INSERT INTO agora_account_blocks"));
      if(path.startsWith("account"))assert.deepEqual(await setOwnAgoraAccountBlock(queued,f.caller,WORKER,path==="account-block"),{kind:"denied"});
      else if(path==="managed-unblock")assert.equal(await removeOwnContactBlock(queued,f.caller,initial[0].management_id),false);
      else assert.equal(await changeOwnAgoraListingBlock(queued,f.caller,f.listing,path==="listing-block"),false);
      assert.equal(queued.hits,1);assert.deepEqual(rows(f,"agora_account_blocks"),initial);
    }finally{f.db.close();}
  });

test("device registration rejects natural expiry before insert and preserves the original binding on a queued transfer",async()=>{
  for(const transfer of [false,true]){
    const f=await fixture();
    try{
      let bearer=f.worker;
      if(transfer){
        f.db.prepare("UPDATE auth_sessions SET expires_at=? WHERE token_hash=?").run(f.start+3600,f.workerHash);
        bearer=(await issueSession(f.adapter,WORKER)).accessToken;
        f.db.prepare("UPDATE auth_sessions SET expires_at=? WHERE token_hash=?").run(f.expiry,await sessionHash(bearer));
      }
      const initial=rows(f,"private_call_devices");
      const queued=beforeSql(f,q=>q.includes(transfer?"DELETE FROM private_call_devices WHERE registration_token":"INSERT INTO private_call_devices"));
      assert.equal(await registerOwnCallDevice(queued,bearer,transfer?DEVICE:DEVICE+"-new",f.start),false);
      assert.equal(queued.hits,1);assert.deepEqual(rows(f,"private_call_devices"),initial);
    }finally{f.db.close();}
  }
});

test("an invitation queued across session expiry or caller disable creates neither an invitation nor quota reservation",async()=>{
  for(const reason of ["expired","disabled","ring-expired"]){
    const f=await fixture();
    try{
      if(reason==="ring-expired")f.db.prepare("UPDATE auth_sessions SET expires_at=?").run(f.start+3600);
      const queued=beforeSql(f,q=>q.includes("INSERT INTO private_call_invitations"),()=>{
        if(reason==="disabled")f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(CALLER);
        else f.clock=reason==="ring-expired"?f.start+90:f.expiry;
      });
      assert.deepEqual(await preparePrivateCallInvitation(queued,f.caller,f.listing,"queued-invitation-race",f.now),{kind:"denied"});
      assert.equal(queued.hits,1);assert.equal(rows(f,"private_call_invitations").length,0);
      assert.equal(rows(f,"call_attempt_windows").length,0);
    }finally{f.db.close();}
  }
});

test("queued dispatch cannot claim a slot after natural caller expiry or the ring deadline",async()=>{
  for(const reason of ["session","ring"]){
    const f=await fixture("unclaimed");
    try{
      if(reason==="ring")f.db.prepare("UPDATE auth_sessions SET expires_at=?").run(f.start+3600);
      const queued=beforeSql(f,q=>q.includes("INSERT INTO private_call_dispatch_slots"),()=>{f.clock=f.start+(reason==="ring"?90:60);});
      assert.equal(await claimPrivateCallDispatch(queued,f.caller,f.id,WORKER,f.now),null);
      assert.equal(queued.hits,1);assert.equal(rows(f,"private_call_dispatch_slots").length,0);
    }finally{f.db.close();}
  }
});

for(const action of ["ack","accept","decline","cancel","hangup"])
  test("natural expiry blocks queued call signal "+action+" before it changes the invitation",async()=>{
    const f=await fixture(action==="hangup"?"accepted":"ringing");
    try{
      const initial=rows(f,"private_call_invitations");
      const queued=beforeSql(f,q=>q.includes("UPDATE private_call_invitations SET"));
      const bearer=action==="cancel"?f.caller:f.worker;
      assert.equal(await ownPrivateCallSignal(queued,bearer,f.id,action,f.now),null);
      assert.equal(queued.hits,1);assert.deepEqual(rows(f,"private_call_invitations"),initial);
      assert.equal(rows(f,"call_history").length,0);
    }finally{f.db.close();}
  });

test("queued usage reservation checks both original sessions and current call deadline before holding credit",async()=>{
  for(const expiry of ["caller","worker","invitation"]){
    const f=await fixture("accepted");
    try{
      f.db.prepare("UPDATE auth_sessions SET expires_at=?").run(f.start+3600);
      if(expiry!=="invitation")f.db.prepare("UPDATE auth_sessions SET expires_at=? WHERE token_hash=?")
        .run(f.expiry,f[expiry+"Hash"]);
      const queued=beforeSql(f,q=>q.includes("INSERT INTO call_usage_sessions"),()=>{f.clock=f.start+(expiry==="invitation"?300:60);});
      assert.equal(await reserveOwnCallUsage(queued,f.caller,f.id,APPROVAL,f.now),null);
      assert.equal(queued.hits,1);assert.equal(rows(f,"call_usage_sessions").length,0);
      assert.equal(rows(f,"call_credit_balances")[0].available_seconds,300);
    }finally{f.db.close();}
  }
});

test("a delayed reservation starts at actual database authorization time without charging earlier provider use",async()=>{
  const f=await fixture("accepted");
  try{
    f.db.prepare("UPDATE auth_sessions SET expires_at=?").run(f.start+3600);
    const queued=beforeSql(f,q=>q.includes("INSERT INTO call_usage_sessions"),()=>{f.clock=f.start+30;});
    assert.ok(await reserveOwnCallUsage(queued,f.caller,f.id,APPROVAL,f.now));
    const row=rows(f,"call_usage_sessions")[0];
    assert.equal(row.authorized_from_ms,f.now+30000);
    assert.equal(row.authorized_until_ms,f.now+300000);
    assert.equal(row.reserved_seconds,270);
  }finally{f.db.close();}
});

test("media issuance rechecks expiry both before and after its usage reservation",async()=>{
  for(const afterReservation of [false,true]){
    const f=await fixture("accepted");
    try{
      let mediaReads=0;
      const queued=beforeSql(f,q=>q.includes("AS uid")&&q.includes("answering_session"),()=>{
        mediaReads++;if(!afterReservation||mediaReads===2)f.expire();
      });
      assert.equal(await issueOwnAgoraAudioGrant(queued,f.caller,f.id,"b".repeat(32),f.now,{approvalHash:APPROVAL}),null);
      assert.equal(mediaReads,afterReservation?2:1);
    }finally{f.db.close();}
  }
});

test("late provider evidence cannot cross its grace deadline merely because verification captured an earlier clock",async()=>{
  const f=await fixture("accepted");
  try{
    assert.ok(await reserveOwnCallUsage(f.adapter,f.caller,f.id,APPROVAL,f.now));
    const session=rows(f,"call_usage_sessions")[0];
    const queued=beforeSql(f,q=>q.includes("INSERT INTO call_usage_intervals"),()=>{f.clock=Math.ceil(session.settle_after_ms/1000)+1;});
    assert.equal(await recordVerifiedCallInterval(queued,{invitationId:f.id,uid:1,clientSeq:1,
      startedAtSeconds:f.start,endedAtSeconds:f.start+20,reason:1},f.now+20000),"ignored");
    assert.equal(queued.hits,1);assert.equal(rows(f,"call_usage_intervals").length,0);
  }finally{f.db.close();}
});

test("expired ring-target reads cannot reach OAuth, device resolution or FCM",async()=>{
  const f=await fixture("unclaimed");
  try{
    const queued=beforeSql(f,q=>q.includes("AS receiverId")&&q.includes("ringDeadlineMs"));
    const forbidden=async()=>{throw Error("Expired ring cannot contact a provider");};
    assert.equal(await sendPrivateCallRing(queued,f.caller,f.id,{projectId:"synthetic-clock-project",now:()=>f.now,
      accessToken:forbidden,resolveReachableDevice:forbidden,request:forbidden}),"not_sent");
    assert.equal(queued.hits,1);assert.equal(rows(f,"private_call_dispatch_slots").length,0);
  }finally{f.db.close();}
});

test("session expiry at SQL execution suppresses private safety, device, target, history and balance reads",async()=>{
  const readers=[
    f=>readOwnWorkerAvailability(f.adapter,f.worker),
    f=>readOwnContactBlocks(f.adapter,f.caller,"","en"),
    f=>readRegisteredCallDestination(f.adapter,WORKER),
    f=>readCallerSessionBoundAgoraOptInTarget(f.adapter,f.caller,f.listing),
    f=>readOwnCallHistory(f.adapter,f.caller,null,f.start),
    f=>readOwnCallCreditSnapshot(f.adapter,f.caller,f.now),
  ];
  for(const read of readers){
    const f=await fixture();
    try{f.adapter=beforeSql(f,()=>true);assert.equal(await read(f),null);assert.ok(f.adapter.hits>0);}
    finally{f.db.close();}
  }
  const f=await fixture();
  try{
    assert.equal(await hasOwnCallDevice(beforeSql(f,()=>true),f.worker,f.start),false);
    await purgeExpiredCallDevices(f.adapter,f.start);
    assert.equal(rows(f,"private_call_devices").length,0,"cleanup also uses the execution clock");
  }finally{f.db.close();}
});

test("the second credit snapshot read suppresses an older captured balance after natural expiry",async()=>{
  const f=await fixture();
  try{
    const queued=beforeSql(f,q=>q.startsWith("SELECT o.product_id AS productId"));
    assert.equal(await readOwnCallCreditSnapshot(queued,f.caller,f.now),null);assert.equal(queued.hits,1);
  }finally{f.db.close();}
});

test("call-history deletion reports unauthorized when expiry or logout overtakes DELETE, preserving truthful empty idempotence",async()=>{
  for(const race of ["expired","revoked"]){
    const f=await fixture();
    try{
      f.db.prepare("INSERT INTO call_history(id,account_id,direction,outcome,ended_at,connected_seconds) VALUES(?,?,'outgoing','ended',?,10)")
        .run(crypto.randomUUID(),CALLER,f.start);
      const queued=beforeSql(f,q=>q.startsWith("DELETE FROM call_history WHERE account_id="),()=>{
        if(race==="revoked")f.db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(f.callerHash);
        else f.expire();
      });
      const response=await handleRequest(new Request("https://jodlo.example/api/v1/me/call-history",{
        method:"DELETE",headers:{Authorization:"Bearer "+f.caller}}),{DB:queued,CALL_HISTORY_ENABLED:"1"});
      assert.equal(response.status,401,race);assert.equal(rows(f,"call_history").length,1,race);
      assert.equal(queued.hits,1);
      assert.equal(JSON.stringify(await response.json()).includes("cleared"),false);
    }finally{f.db.close();}
  }
  const f=await fixture();
  try{
    assert.equal(await clearOwnCallHistory(f.adapter,f.caller,f.start),true);
    assert.equal(await clearOwnCallHistory(f.adapter,f.caller,f.start),true);
    f.expire();assert.equal(await clearOwnCallHistory(f.adapter,f.caller,f.start),false);
  }finally{f.db.close();}
});

test("a dispatch claim that returns after logout or expiry cannot send an FCM ring to a withdrawn session",async()=>{
  for(const change of ["caller-expiry","worker-expiry","worker-logout","consent-withdrawal"]){
    const f=await fixture("unclaimed");
    try{
      f.db.prepare("UPDATE auth_sessions SET expires_at=?").run(f.start+3600);
      if(change.endsWith("expiry"))f.db.prepare("UPDATE auth_sessions SET expires_at=? WHERE token_hash=?")
        .run(f.start+1,change.startsWith("caller")?f.callerHash:f.workerHash);
      let posts=0;
      const delayed={...f.adapter,prepare(sql){
        const statement=f.adapter.prepare(sql),all=statement.all.bind(statement);
        statement.all=async()=>{
          const result=await all();
          if(sql.includes("INSERT INTO private_call_dispatch_slots")){
            if(change.endsWith("expiry"))f.clock=f.start+1;
            if(change==="worker-logout")f.db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(f.workerHash);
            if(change==="consent-withdrawal")f.db.exec("UPDATE worker_agora_call_preferences SET calls_enabled=0,revision=revision+1");
          }
          return result;
        };
        return statement;
      }};
      assert.equal(await sendPrivateCallRing(delayed,f.caller,f.id,{projectId:"synthetic-clock-project",now:()=>f.now,
        accessToken:async()=>"synthetic-oauth",resolveReachableDevice:account=>readRegisteredCallDestination(f.adapter,account),
        request:async()=>{posts++;return new Response(null,{status:200});}}),"not_sent",change);
      assert.equal(posts,0,change);
      assert.equal(rows(f,"private_call_dispatch_slots").length,0,"the definitely unsent exact claim can be released");
    }finally{f.db.close();}
  }
});

test("the final ring confirmation cannot outlive either session while its SQL result returns",async()=>{
  const f=await fixture("unclaimed");
  try{
    f.db.prepare("UPDATE auth_sessions SET expires_at=? WHERE token_hash=?").run(f.start+1,f.workerHash);
    let posts=0,confirmations=0;
    const delayed={...f.adapter,prepare(sql){
      const statement=f.adapter.prepare(sql),all=statement.all.bind(statement);
      statement.all=async()=>{
        const result=await all();
        if(sql.includes("SELECT 1 AS authorized,min(s.expires_at,receiving.expires_at)")){
          confirmations++;f.clock=f.start+1;
        }
        return result;
      };
      return statement;
    }};
    assert.equal(await sendPrivateCallRing(delayed,f.caller,f.id,{projectId:"synthetic-clock-project",now:()=>f.clock*1000,
      accessToken:async()=>"synthetic-oauth",resolveReachableDevice:account=>readRegisteredCallDestination(f.adapter,account),
      request:async()=>{posts++;return new Response(null,{status:200});}}),"not_sent");
    assert.equal(confirmations,1);assert.equal(posts,0);assert.equal(rows(f,"private_call_dispatch_slots").length,0);
  }finally{f.db.close();}
});
