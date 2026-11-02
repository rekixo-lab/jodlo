import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { setOwnWorkerAgoraCallPreference } from
  "../src/modules/workers/agora-call-preference.ts";
import {
  prepareSyntheticConsentEpochBoundAgoraInvite,
  prepareSyntheticSafetyCheckedAgoraInvite,
} from "../src/modules/interactions/agora-invite-safety.ts";
import {
  READ_CALLER_SESSION_BOUND_AGORA_CONSENT_EPOCH_QUERY,
  readCallerSessionBoundAgoraConsentEpochMatch,
} from "../src/modules/interactions/request-target.ts";
import { sessionHash } from "../src/modules/identity/sessions.ts";

/**
 * Test-only, D1-backed, no provider, cloud, public route or real review-policy
 * grant. A prepared result is NOT permission to send or issue credentials.
 */
const CALLER="account-one-read-caller-001";
const WORKER="account-one-read-worker-001";
const OTHER="account-one-read-other-0001";
const CAT="one-read-epoch-category";
const NOW=1_800_000_000_000;
const DEADLINE=NOW+30_000;
const CALL_ID="call-one-read-epoch-00001";
const denied={kind:"denied"};

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  try{
    for(const id of [CALLER,WORKER,OTHER]) await ensureAccount(adapter,id);
    await optInAsWorker(adapter,WORKER);
    db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)"
    ).run(CAT,CAT,"Offline voice review","परीक्षण आवाज़");
    const listing=await publishListing(adapter,WORKER,CAT);
    assert.ok(listing);
    const callerBearer=(await issueSession(adapter,CALLER))?.accessToken;
    const workerBearer=(await issueSession(adapter,WORKER))?.accessToken;
    const otherBearer=(await issueSession(adapter,OTHER))?.accessToken;
    assert.ok(callerBearer&&workerBearer&&otherBearer);
    const risk=(changes={})=>({
      kind:"synthetic_invite_risk_v1",
      callerAccountId:CALLER,workerAccountId:WORKER,listingId:listing.id,
      checkedAtMs:NOW-100,expiresAtMs:DEADLINE,
      workerPresence:"online",workerAvailability:"available",
      blockedByCaller:false,blockedByWorker:false,rateGate:"pass",
      recipientVerified:true,privacyApproved:true,...changes,
    });
    const prepare=(source=adapter,riskFacts=risk(),
      bearer=callerBearer,listingId=listing.id)=>
      prepareSyntheticConsentEpochBoundAgoraInvite(
        source,bearer,listingId,CALL_ID,NOW,DEADLINE,riskFacts,
      );
    return {db,adapter,listing,callerBearer,workerBearer,otherBearer,
      risk,prepare,close(){db.close();}};
  }catch(error){db.close();throw error;}
}

test("strict original-epoch invitation is default-OFF and never resurrects an old generation",async()=>{
  const f=await fixture();
  try{
    assert.deepEqual(await f.prepare(),denied);
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,true,0)).kind,"updated");
    const original=await f.prepare();
    assert.equal(original.kind,"prepared");
    assert.equal(original.originalConsentRevision,1);
    assert.equal(original.call.callerAccountId,CALLER);
    assert.equal(original.call.workerAccountId,WORKER);
    assert.equal(original.call.phase,"ringing");
    assert.equal(Object.isFrozen(original),true);
    assert.equal(Object.isFrozen(original.call),true);

    const off=await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,false,1);
    assert.equal(off.kind,"updated");
    assert.deepEqual(await f.prepare(),denied);

    const on=await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,true,2);
    assert.equal(on.kind,"updated");
    const newer=await f.prepare();
    assert.equal(newer.kind,"prepared");
    assert.equal(newer.originalConsentRevision,3);
    assert.equal(original.originalConsentRevision,1,
      "already-captured original generation never mutates");
    assert.equal(await readCallerSessionBoundAgoraConsentEpochMatch(
      f.adapter,f.callerBearer,f.listing.id,original.originalConsentRevision),null);
    assert.equal((await readCallerSessionBoundAgoraConsentEpochMatch(
      f.adapter,f.callerBearer,f.listing.id,newer.originalConsentRevision))
      ?.consentRevision,3);
    assert.equal(JSON.stringify(newer).includes(f.callerBearer),false);
    assert.equal(JSON.stringify(newer).includes(f.workerBearer),false);
    assert.equal(JSON.stringify(newer).includes("token"),false);
    assert.equal(JSON.stringify(newer).includes("phone"),false);
  }finally{f.close();}
});

test("one caller-owned D1 statement binds the original revision and listing eligibility together",async()=>{
  const f=await fixture();
  try{
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,true,0)).kind,"updated");
    const calls=[];
    const db={
      prepare(sql){
        calls.push({sql,binds:null});
        const entry=calls.at(-1);
        const statement=f.adapter.prepare(sql);
        return {bind(...args){
          entry.binds=args;
          return {all:()=>statement.bind(...args).all()};
        }};
      },
    };
    const result=await f.prepare(db);
    assert.equal(result.kind,"prepared");
    assert.equal(result.originalConsentRevision,1);
    assert.equal(calls.length,1,"one source read, no later free-floating consent query");
    assert.equal(calls[0].sql,READ_CALLER_SESSION_BOUND_AGORA_CONSENT_EPOCH_QUERY);
    assert.deepEqual(calls[0].binds,[
      await sessionHash(f.callerBearer),
      Math.floor(Date.now()/1000),f.listing.id,
    ]);
    assert.equal(calls[0].binds.includes(f.workerBearer),false);
    assert.equal(calls[0].binds.includes(f.callerBearer),false);
    assert.equal(calls[0].sql.includes("pref.calls_enabled=1"),true);

    assert.deepEqual(await f.prepare(f.adapter,f.risk(),f.workerBearer),denied,
      "caller cannot substitute the worker session as initiating identity");
    assert.deepEqual(await f.prepare(f.adapter,f.risk(),f.otherBearer),denied);
    assert.deepEqual(await f.prepare(f.adapter,
      f.risk({workerAccountId:OTHER})),denied);
  }finally{f.close();}
});

test("invalid risk facts never reach D1 and malformed consent evidence always denies",async()=>{
  const f=await fixture();
  try{
    const failIfRead={prepare(){throw Error("invalid risk reached D1");}};
    for(const risk of [
      null,{},f.risk({workerPresence:"unknown"}),
      f.risk({workerAvailability:"busy"}),
      f.risk({rateGate:"unknown"}),
      f.risk({checkedAtMs:NOW+1}),
      f.risk({expiresAtMs:NOW}),
      {...f.risk(),workerPhone:"not approved"},
    ]){
      assert.deepEqual(await f.prepare(failIfRead,risk),denied);
    }
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,true,0)).kind,"updated");
    const badRevision={prepare(sql){
      const original=f.adapter.prepare(sql);
      return {bind(...args){
        const prepared=original.bind(...args);
        return {async all(){
          const out=await prepared.all();
          return {results:out.results.map(row=>({
            ...row,consentRevision:0,
          }))};
        }};
      }};
    }};
    assert.deepEqual(await f.prepare(badRevision),denied);
    const duplicateRows={prepare(sql){
      const original=f.adapter.prepare(sql);
      return {bind(...args){
        const prepared=original.bind(...args);
        return {async all(){
          const out=await prepared.all();
          return {results:[...out.results,...out.results]};
        }};
      }};
    }};
    assert.deepEqual(await f.prepare(duplicateRows),denied);
  }finally{f.close();}
});

test("old epoch-less preview remains non-authorizing and does not invent an epoch",async()=>{
  const f=await fixture();
  try{
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,true,0)).kind,"updated");
    const old=await prepareSyntheticSafetyCheckedAgoraInvite(
      f.adapter,f.callerBearer,f.listing.id,CALL_ID,NOW,DEADLINE,f.risk());
    assert.equal(old.kind,"prepared");
    assert.deepEqual(Object.keys(old),["kind","call"]);
    assert.equal(Object.hasOwn(old,"originalConsentRevision"),false);
    const newResult=await f.prepare();
    assert.equal(newResult.kind,"prepared");
    assert.equal(newResult.originalConsentRevision,1);
    assert.deepEqual(newResult.call,old.call);
  }finally{f.close();}
});

test("mutating availability, bilateral blocks and rate facts during awaited D1 cannot turn denial into admission",async()=>{
  const f=await fixture();
  try{
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter,f.workerBearer,true,0)).kind,"updated");
    const unsafeFields=[
      {workerPresence:"offline"},
      {workerAvailability:"busy"},
      {blockedByCaller:true},
      {blockedByWorker:true},
      {rateGate:"deny"},
      {recipientVerified:false},
      {privacyApproved:false},
    ];
    for(const initial of unsafeFields){
      const risk=f.risk(initial);
      let statements=0;
      const db={
        prepare(sql){
          statements++;
          const statement=f.adapter.prepare(sql);
          return {bind(...args){
            const prepared=statement.bind(...args);
            return {async all(){
              // Mimic a provider/cache object being rewritten while D1 is
              // pending. Previously the post-await read could promote a
              // denied fact into an all-pass synthetic invitation.
              Object.assign(risk,{
                workerPresence:"online",workerAvailability:"available",
                blockedByCaller:false,blockedByWorker:false,rateGate:"pass",
                recipientVerified:true,privacyApproved:true,
              });
              await Promise.resolve();
              return prepared.all();
            }};
          }};
        },
      };
      assert.deepEqual(await f.prepare(db,risk),denied,
        "pre-query evidence must remain authoritative: "+
        JSON.stringify(initial));
      assert.equal(statements,1);

      const legacyRisk=f.risk(initial);
      const legacyDb={
        prepare(sql){
          const statement=f.adapter.prepare(sql);
          return {bind(...args){
            const prepared=statement.bind(...args);
            return {async all(){
              Object.assign(legacyRisk,{
                workerPresence:"online",workerAvailability:"available",
                blockedByCaller:false,blockedByWorker:false,rateGate:"pass",
                recipientVerified:true,privacyApproved:true,
              });
              await Promise.resolve();
              return prepared.all();
            }};
          }};
        },
      };
      assert.deepEqual(await prepareSyntheticSafetyCheckedAgoraInvite(
        legacyDb,f.callerBearer,f.listing.id,CALL_ID,NOW,DEADLINE,legacyRisk),
        denied,"epoch-less legacy preview must also reject async risk upgrades");
    }
    assert.equal((await f.prepare()).kind,"prepared",
      "ordinary all-pass test evidence remains valid");
  }finally{f.close();}
});

test("invisible fields, symbols and getters never authorize raw invitation risk or hit D1",async()=>{
  const f=await fixture();
  try{
    const raw=[
      f.risk(),
      f.risk(),
      f.risk(),
      new Proxy(f.risk(),{
        ownKeys(){throw Error("untrusted risk adapter");},
      }),
    ];
    Object.defineProperty(raw[0],"hiddenProviderToken",{
      value:"secret",enumerable:false,
    });
    raw[1][Symbol("privateSession")]="secret";
    let getterCalls=0;
    Object.defineProperty(raw[2],"blockedByWorker",{
      enumerable:true,configurable:true,
      get(){getterCalls++;return false;},
    });
    let queryCount=0;
    const noD1={prepare(){queryCount++;throw Error("no read permitted");}};
    for(const evidence of raw){
      assert.deepEqual(await f.prepare(noD1,evidence),denied);
      assert.deepEqual(await prepareSyntheticSafetyCheckedAgoraInvite(
        noD1,f.callerBearer,f.listing.id,CALL_ID,NOW,DEADLINE,evidence),denied);
    }
    assert.equal(queryCount,0,
      "all invalid risk facts must fail before opening a D1 statement");
    assert.equal(getterCalls,0,
      "risk descriptors must be checked without evaluating accessors");
  }finally{f.close();}
});
