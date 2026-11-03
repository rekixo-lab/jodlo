import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { setOwnWorkerAgoraCallPreference } from
  "../src/modules/workers/agora-call-preference.ts";
import {
  setOwnWorkerAvailability, setOwnAgoraAccountBlock,
  READ_CALLER_AGORA_PRIVATE_SAFETY_QUERY,
} from "../src/modules/interactions/agora-private-safety-state.ts";
import { prepareSyntheticServerRiskReadAgoraInvite } from
  "../src/modules/interactions/agora-server-risk-sources.ts";

/** No real presence, block store, abuse quota or external Agora service. */
const CALLER="account-server-risk-caller";
const WORKER="account-server-risk-worker";
const OTHER="account-server-risk-other";
const CAT="server-risk-review-category";
const NOW=1_800_000_000_000;
const DEADLINE=NOW+20_000;
const CALL="call-server-risk-00001";
const DENIED={kind:"denied"};
const NAMES=["presence","availability","mutualBlocks","abuse","connection"];
const BASE={
  presence:{kind:"synthetic_presence_check_v1",workerPresence:"online"},
  availability:{kind:"synthetic_availability_check_v1",workerAvailability:"available"},
  mutualBlocks:{kind:"synthetic_mutual_blocks_check_v1",
    blockedByCaller:false,blockedByWorker:false},
  abuse:{kind:"synthetic_rate_check_v1",rateGate:"pass"},
  connection:{kind:"synthetic_connection_check_v1",
    recipientVerified:true,privacyApproved:true},
};

function sourcePorts(overrides={},onRead=()=>{},expiresAtMs=NOW+500){
  return Object.fromEntries(NAMES.map(name=>[
    name,async identity=>{
      onRead(name,identity);
      return {...identity,checkedAtMs:NOW-5,expiresAtMs,
        ...BASE[name],...(overrides[name]??{})};
    },
  ]));
}

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  try{
    for(const account of [CALLER,WORKER,OTHER])
      await ensureAccount(adapter,account);
    await optInAsWorker(adapter,WORKER);
    db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)"
    ).run(CAT,CAT,"Synthetic safe contact","परीक्षण सुरक्षित संपर्क");
    const listing=await publishListing(adapter,WORKER,CAT);
    assert.ok(listing);
    const caller=(await issueSession(adapter,CALLER))?.accessToken;
    const worker=(await issueSession(adapter,WORKER))?.accessToken;
    const other=(await issueSession(adapter,OTHER))?.accessToken;
    assert.ok(caller&&worker&&other);
    const opt=(enabled,revision)=>setOwnWorkerAgoraCallPreference(
      adapter,worker,enabled,revision);
    const availability=(enabled,revision)=>setOwnWorkerAvailability(
      adapter,worker,enabled,revision);
    const block=(bearer,target,enabled=true)=>setOwnAgoraAccountBlock(
      adapter,bearer,target,enabled);
    const prepare=(readers=sourcePorts(),clock=()=>NOW,bearer=caller,
      dbSource=adapter)=>prepareSyntheticServerRiskReadAgoraInvite(
        dbSource,bearer,listing.id,CALL,DEADLINE,readers,clock);
    return {db,adapter,listing,caller,worker,other,opt,availability,block,prepare,
      close(){db.close();}};
  }catch(e){db.close();throw e;}
}

test("missing or malformed server reader ports deny before any D1 access",async()=>{
  const f=await fixture();
  try{
    let queries=0;
    const noDb={prepare(){queries++;throw Error("unexpected D1 access");}};
    const good=sourcePorts();
    const missing={...good};delete missing.abuse;
    const hidden={...good};
    Object.defineProperty(hidden,"providerAuthToken",{
      enumerable:false,value:"secret",
    });
    const withSymbol={...good};
    withSymbol[Symbol("privateDevice")]="secret";
    const accessor={...good};
    let called=0;
    Object.defineProperty(accessor,"availability",{
      enumerable:true,get(){called++;return good.availability;},
    });
    for(const readers of [
      null,{},missing,{...good,extraTrusted:true},hidden,withSymbol,accessor,
      {...good,abuse:null},{...good,mutualBlocks:"allow"},
      new Proxy(good,{ownKeys(){throw Error("bad adapter");}}),
    ]){
      assert.deepEqual(await f.prepare(readers,()=>NOW,f.caller,noDb),DENIED);
    }
    assert.equal(queries,0);
    assert.equal(called,0,"getter must not run to invent an allow verdict");
  }finally{f.close();}
});

test("default OFF never invokes risk readers; enabled consent provides only scoped private IDs",async()=>{
  const f=await fixture();
  try{
    const scopes=[];
    const readers=sourcePorts({},(name,identity)=>scopes.push([name,identity]));
    assert.deepEqual(await f.prepare(readers),DENIED);
    assert.equal(scopes.length,0,"no source reads without caller session/consent");
    assert.equal((await f.opt(true,0)).kind,"updated");
    assert.deepEqual(await f.prepare(readers),DENIED,
      "Explicit call consent alone does not imply availability");
    assert.equal(scopes.length,0,
      "no synthetic risk reader is used until D1 availability intent is ON");
    assert.equal((await f.availability(true,0)).kind,"updated");
    const prepared=await f.prepare(readers);
    assert.equal(prepared.kind,"prepared");
    assert.equal(prepared.originalConsentRevision,1);
    assert.equal(prepared.call.phase,"ringing");
    assert.equal(scopes.length,5);
    assert.deepEqual(scopes.map(x=>x[0]),NAMES);
    for(const [,scope] of scopes){
      assert.deepEqual(scope,{
        callerAccountId:CALLER,workerAccountId:WORKER,listingId:f.listing.id,
      });
      assert.equal(Object.isFrozen(scope),true);
      assert.equal(JSON.stringify(scope).includes(f.caller),false);
      assert.equal(JSON.stringify(scope).includes(f.worker),false);
    }
    assert.equal(Object.isFrozen(prepared),true);
    assert.equal(Object.isFrozen(prepared.call),true);
    assert.equal(JSON.stringify(prepared).includes("Bearer"),false);
    assert.equal(JSON.stringify(prepared).includes("phone"),false);
    assert.equal(JSON.stringify(prepared).includes("channel"),false);
    assert.deepEqual(await f.prepare(readers,()=>NOW,f.worker),DENIED,
      "worker bearer cannot impersonate the initiating customer");
    const secondCustomer=await f.prepare(readers,()=>NOW,f.other);
    assert.equal(secondCustomer.kind,"prepared",
      "a distinct active customer can initiate with their OWN bearer");
    assert.equal(secondCustomer.call.callerAccountId,OTHER);
    assert.notEqual(secondCustomer.call.callerAccountId,CALLER,
      "the test source must derive the caller identity from the new bearer");
  }finally{f.close();}
});

test("unknown/busy/blocked/rate denied or privacy false facts never prepare",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.opt(true,0)).kind,"updated");
    assert.equal((await f.availability(true,0)).kind,"updated");
    const cases=[
      {presence:{workerPresence:"offline"}},
      {presence:{workerPresence:"unknown"}},
      {availability:{workerAvailability:"busy"}},
      {availability:{workerAvailability:"unknown"}},
      {mutualBlocks:{blockedByCaller:true}},
      {mutualBlocks:{blockedByWorker:true}},
      {abuse:{rateGate:"deny"}},
      {abuse:{rateGate:"unknown"}},
      {connection:{recipientVerified:false}},
      {connection:{privacyApproved:false}},
      {mutualBlocks:{blockedByWorker:"false"}},
      {abuse:{rateGate:true}},
      {connection:{workerPhone:"PRIVATE"}},
    ];
    for(const change of cases){
      assert.deepEqual(await f.prepare(sourcePorts(change)),DENIED,
        JSON.stringify(change));
    }
    const wrong=sourcePorts({
      mutualBlocks:{callerAccountId:OTHER},
    });
    assert.deepEqual(await f.prepare(wrong),DENIED);
    const failure=sourcePorts();
    failure.abuse=async()=>{throw Error("not configured");};
    assert.deepEqual(await f.prepare(failure),DENIED);
    const expired=sourcePorts({},()=>{},NOW);
    assert.deepEqual(await f.prepare(expired),DENIED);
  }finally{f.close();}
});

test("consent OFF or OFF then ON while sources read never resurrects the earlier epoch",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.opt(true,0)).kind,"updated");
    assert.equal((await f.availability(true,0)).kind,"updated");
    const off=sourcePorts();
    off.abuse=async scope=>{
      const changed=await f.opt(false,1);
      assert.equal(changed.kind,"updated");
      return sourcePorts().abuse(scope);
    };
    assert.deepEqual(await f.prepare(off),DENIED);
    assert.deepEqual(await f.prepare(),DENIED,
      "subsequent attempt is still default-off");
    assert.equal((await f.opt(true,2)).kind,"updated");
    const current=await f.prepare();
    assert.equal(current.kind,"prepared");
    assert.equal(current.originalConsentRevision,3);

    const toggled=sourcePorts();
    toggled.abuse=async scope=>{
      assert.equal((await f.opt(false,3)).kind,"updated");
      assert.equal((await f.opt(true,4)).kind,"updated");
      return sourcePorts().abuse(scope);
    };
    assert.deepEqual(await f.prepare(toggled),DENIED,
      "original enabled epoch must not turn into a newer approved epoch");
    const after=await f.prepare();
    assert.equal(after.kind,"prepared");
    assert.equal(after.originalConsentRevision,5);
  }finally{f.close();}
});

test("time is sampled after async facts AND consent recheck; expired or regressing evidence denies",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.opt(true,0)).kind,"updated");
    assert.equal((await f.availability(true,0)).kind,"updated");
    const clockValues=[
      [NOW,NOW,NOW],                 // valid, no policy timeout inferred
      [NOW,NOW+500,NOW+500],         // expired during source collection
      [NOW,NOW,NOW+500],             // expired while final D1 read awaited
      [NOW,NOW-1,NOW],               // clock went backwards
      [NOW,NOW,NOW-1],               // clock went backwards after D1
      [NOW,NOW,NOW+20_000],          // ring deadline reached during recheck
    ];
    const expected=["prepared","denied","denied","denied","denied","denied"];
    for(let i=0;i<clockValues.length;i++){
      let at=0;
      const value=await f.prepare(sourcePorts(),
        ()=>clockValues[i][at++]);
      assert.equal(value.kind,expected[i],"clock scenario "+i);
    }
    assert.deepEqual(await f.prepare(
      sourcePorts(),()=>Number.NaN),DENIED);
    const bad=sourcePorts();
    bad.connection=async()=>null;
    assert.deepEqual(await f.prepare(bad),DENIED);
  }finally{f.close();}
});

test("real D1 directional blocks veto all-pass synthetic reader evidence",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.opt(true,0)).kind,"updated");
    assert.equal((await f.availability(true,0)).kind,"updated");
    let reads=0;
    const sources=sourcePorts({},()=>reads++);
    assert.equal((await f.prepare(sources)).kind,"prepared");
    reads=0;
    assert.deepEqual(await f.block(f.caller,WORKER),{kind:"updated"});
    assert.deepEqual(await f.prepare(sources),DENIED);
    assert.equal(reads,0,"D1 caller block denies before test-only readers");
    const other=await f.prepare(sources,()=>NOW,f.other);
    assert.equal(other.kind,"prepared");
    assert.equal(other.call.callerAccountId,OTHER);
    assert.deepEqual(await f.block(f.caller,WORKER,false),{kind:"updated"});
    reads=0;
    assert.deepEqual(await f.block(f.worker,CALLER),{kind:"updated"});
    assert.deepEqual(await f.prepare(sources),DENIED);
    assert.equal(reads,0,"D1 worker block denies before test-only readers");
    assert.deepEqual(await f.block(f.worker,CALLER,false),{kind:"updated"});
    assert.equal((await f.prepare(sources)).kind,"prepared");
  }finally{f.close();}
});

test("private availability OFF or OFF-ON during source awaits denies stale candidate",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.opt(true,0)).kind,"updated");
    let reads=0;
    const sources=sourcePorts({},()=>reads++);
    assert.deepEqual(await f.prepare(sources),DENIED);
    assert.equal(reads,0,"no default availability intent");
    assert.equal((await f.availability(true,0)).kind,"updated");
    assert.equal((await f.prepare(sources)).kind,"prepared");
    const off=sourcePorts();
    off.abuse=async scope=>{
      assert.equal((await f.availability(false,1)).kind,"updated");
      return sourcePorts().abuse(scope);
    };
    assert.deepEqual(await f.prepare(off),DENIED);
    assert.deepEqual(await f.prepare(sources),DENIED);
    assert.equal((await f.availability(true,2)).kind,"updated");
    assert.equal((await f.prepare(sources)).kind,"prepared");
    const offOn=sourcePorts();
    offOn.abuse=async scope=>{
      assert.equal((await f.availability(false,3)).kind,"updated");
      assert.equal((await f.availability(true,4)).kind,"updated");
      return sourcePorts().abuse(scope);
    };
    assert.deepEqual(await f.prepare(offOn),DENIED,
      "availability epoch change cannot reuse an earlier candidate");
    assert.equal((await f.prepare(sources)).kind,"prepared");
  }finally{f.close();}
});

test("a block inserted just before final D1 safety recheck denies",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.opt(true,0)).kind,"updated");
    assert.equal((await f.availability(true,0)).kind,"updated");
    let safetyReads=0;
    const adapter={
      prepare(sql){
        if(sql===READ_CALLER_AGORA_PRIVATE_SAFETY_QUERY){
          safetyReads++;
          if(safetyReads===2){
            f.db.prepare(
              "INSERT INTO agora_account_blocks(blocker_account_id,blocked_account_id) VALUES(?,?)"
            ).run(WORKER,CALLER);
          }
        }
        return f.adapter.prepare(sql);
      },
    };
    assert.deepEqual(await f.prepare(sourcePorts(),()=>NOW,f.caller,adapter),
      DENIED,"scripted unblocked evidence cannot override a late D1 block");
    assert.equal(safetyReads,2);
    assert.deepEqual(await f.prepare(),DENIED);
    assert.deepEqual(await f.block(f.worker,CALLER,false),{kind:"updated"});
    assert.equal((await f.prepare()).kind,"prepared");
  }finally{f.close();}
});
