import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validOpaqueId } from "../src/modules/shared/identifiers.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

/**
 * M-005 P02 OPTION COMPARISON — DISPOSABLE TWO-CONNECTION SQLITE ONLY.
 *
 * A fixture explicitly seeds 1 or 2 worker-wide capacity slots to compare
 * possible founder decisions. NEITHER option is approved or selected here.
 * No production worker-slot table, authenticated calling actor, real worker
 * presence, block/report/rate evidence, live D1/DO cross-worker guarantee,
 * provider event, RTC token, Agora SDK, phone/PSTN or real queued alert.
 * The synthetic "incoming" row is UNSENT and tombstoned by local release.
 *
 * This is NOT a client-admission function: all identities, consent revisions
 * and hypothetical capacities are injected by a TRUSTED TEST FIXTURE.
 * Real M-003/M-005 admission/retention/presence and M-006 delivery remain gated.
 */

const WORKER="worker-capacity-test-000001";
const OTHER_WORKER="worker-capacity-test-000002";
const CALLER_A="caller-capacity-test-000001";
const CALLER_B="caller-capacity-test-000002";
const CALLER_C="caller-capacity-test-000003";
const LISTING_A="listing-capacity-test-00001";
const LISTING_B="listing-capacity-test-00002";
const CALL_A="call-capacity-test-0000001";
const CALL_B="call-capacity-test-0000002";
const CALL_C="call-capacity-test-0000003";
const denied=reason=>({kind:"denied",reason});
const exact=(obj,keys)=>Boolean(obj) && typeof obj==="object" &&
  !Array.isArray(obj) && Object.keys(obj).length===keys.length &&
  keys.every(key=>Object.hasOwn(obj,key));
const admissionFields=[
  "kind","callId","callerAccountId","workerAccountId","listingId",
  "observedConsentRevision",
];
const releaseFields=["kind","workerAccountId","callId","fence"];

function createTrial({workerSlots=1,includeOtherWorker=false}={}){
  assert.ok([1,2].includes(workerSlots),"fixture-only P02 option: one or two slots");
  const dir=mkdtempSync(join(tmpdir(),"jodlo-agora-capacity-"));
  const file=join(dir,"test-only.sqlite");
  const a=new DatabaseSync(file);
  const b=new DatabaseSync(file);
  try{
    a.exec("PRAGMA journal_mode=WAL");
    a.exec("PRAGMA foreign_keys=ON");
    b.exec("PRAGMA foreign_keys=ON");
    a.exec("PRAGMA busy_timeout=0");
    b.exec("PRAGMA busy_timeout=0");
    a.exec(
      "CREATE TABLE fake_worker_consent ("+
      "worker_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0 "+
      "CHECK(enabled IN(0,1)),revision INTEGER NOT NULL DEFAULT 0);"+
      "CREATE TABLE fake_worker_capacity_slots ("+
      "worker_id TEXT NOT NULL REFERENCES fake_worker_consent(worker_id),"+
      "slot INTEGER NOT NULL,call_id TEXT UNIQUE,fence INTEGER NOT NULL DEFAULT 0,"+
      "PRIMARY KEY(worker_id,slot));"+
      "CREATE TABLE fake_call_reservations ("+
      "call_id TEXT PRIMARY KEY,worker_id TEXT NOT NULL,caller_id TEXT NOT NULL,"+
      "listing_id TEXT NOT NULL,slot INTEGER NOT NULL,fence INTEGER NOT NULL,"+
      "consent_revision INTEGER NOT NULL,state TEXT NOT NULL "+
      "CHECK(state IN('reserved_test_only','released_test_only')));"+
      "CREATE TABLE fake_unsent_call_intents ("+
      "call_id TEXT PRIMARY KEY REFERENCES fake_call_reservations(call_id),"+
      "state TEXT NOT NULL CHECK(state IN('pending_test_only','revoked_test_only')),"+
      "kind TEXT NOT NULL CHECK(kind='incoming_audio_intent_only'));"
    );
    a.prepare("INSERT INTO fake_worker_consent(worker_id) VALUES(?)").run(WORKER);
    for(let slot=1;slot<=workerSlots;slot++){
      a.prepare(
        "INSERT INTO fake_worker_capacity_slots(worker_id,slot) VALUES(?,?)"
      ).run(WORKER,slot);
    }
    if(includeOtherWorker){
      a.prepare("INSERT INTO fake_worker_consent(worker_id) VALUES(?)")
        .run(OTHER_WORKER);
      a.prepare(
        "INSERT INTO fake_worker_capacity_slots(worker_id,slot) VALUES(?,1)"
      ).run(OTHER_WORKER);
    }
    return {
      a,b,close(){
        a.close();b.close();
        rmSync(dir,{recursive:true,force:true});
      },
    };
  }catch(error){
    a.close();b.close();
    rmSync(dir,{recursive:true,force:true});
    throw error;
  }
}
async function withTrial(config,fn){
  const t=createTrial(config);
  try{await fn(t);}finally{t.close();}
}
function setFixtureWorkerConsent(db,workerId,enabled){
  assert.equal(typeof enabled,"boolean");
  const result=db.prepare(
    "UPDATE fake_worker_consent SET enabled=?,revision=revision+1 WHERE worker_id=?"
  ).run(enabled?1:0,workerId);
  assert.equal(result.changes,1);
  return db.prepare(
    "SELECT revision,enabled FROM fake_worker_consent WHERE worker_id=?"
  ).get(workerId);
}
function observedRevision(db,workerId=WORKER){
  return db.prepare(
    "SELECT revision FROM fake_worker_consent WHERE worker_id=?"
  ).get(workerId)?.revision??null;
}
function fakeCandidate({
  workerAccountId=WORKER,callerAccountId=CALLER_A,
  listingId=LISTING_A,callId=CALL_A,revision=1,
}={}){
  return {
    kind:"trusted_test_fixture_only",
    workerAccountId,callerAccountId,listingId,callId,
    observedConsentRevision:revision,
  };
}
function slots(db,workerId=WORKER){
  return db.prepare(
    "SELECT slot,call_id,fence FROM fake_worker_capacity_slots "+
    "WHERE worker_id=? ORDER BY slot"
  ).all(workerId).map(row=>({...row}));
}
function reservations(db,workerId=WORKER){
  return db.prepare(
    "SELECT * FROM fake_call_reservations WHERE worker_id=? ORDER BY call_id"
  ).all(workerId);
}
function unsent(db){
  return db.prepare(
    "SELECT * FROM fake_unsent_call_intents ORDER BY call_id"
  ).all();
}
function validCandidate(value){
  return exact(value,admissionFields) &&
    value.kind==="trusted_test_fixture_only" &&
    validOpaqueId(value.callId) &&
    validOpaqueId(value.callerAccountId) &&
    validOpaqueId(value.workerAccountId) &&
    value.callerAccountId!==value.workerAccountId &&
    validOpaqueId(value.listingId) &&
    Number.isSafeInteger(value.observedConsentRevision) &&
    value.observedConsentRevision>0;
}

/** Atomic test-only slot claim + call row + UNSENT intent, no real delivery. */
function admitFakeCall(db,candidate,{
  failAfterSlot=false,failAfterCall=false,failAfterIntent=false,
}={}){
  if(!validCandidate(candidate))return denied("UNTRUSTED_TEST_CANDIDATE");
  let tx=false;
  try{
    db.exec("BEGIN IMMEDIATE");tx=true;
    const consent=db.prepare(
      "SELECT enabled,revision FROM fake_worker_consent WHERE worker_id=?"
    ).get(candidate.workerAccountId);
    if(!consent || consent.enabled!==1 ||
       consent.revision!==candidate.observedConsentRevision){
      db.exec("ROLLBACK");tx=false;
      return denied("WORKER_CONSENT_UNAVAILABLE");
    }
    const prior=db.prepare(
      "SELECT * FROM fake_call_reservations WHERE call_id=?"
    ).get(candidate.callId);
    if(prior){
      db.exec("ROLLBACK");tx=false;
      if(prior.worker_id===candidate.workerAccountId &&
         prior.caller_id===candidate.callerAccountId &&
         prior.listing_id===candidate.listingId &&
         prior.consent_revision===candidate.observedConsentRevision &&
         prior.state==="reserved_test_only")
        return {kind:"duplicate_suppressed_test_only"};
      return denied("CALL_ID_ALREADY_USED");
    }
    const slot=db.prepare(
      "SELECT slot,fence FROM fake_worker_capacity_slots "+
      "WHERE worker_id=? AND call_id IS NULL ORDER BY slot LIMIT 1"
    ).get(candidate.workerAccountId);
    if(!slot){
      db.exec("ROLLBACK");tx=false;
      return denied("CAPACITY_EXHAUSTED_TEST_ONLY");
    }
    if(slot.fence===Number.MAX_SAFE_INTEGER){
      db.exec("ROLLBACK");tx=false;
      return denied("FENCE_EXHAUSTED_TEST_ONLY");
    }
    const fence=slot.fence+1;
    const claimed=db.prepare(
      "UPDATE fake_worker_capacity_slots SET call_id=?,fence=? "+
      "WHERE worker_id=? AND slot=? AND call_id IS NULL AND fence=?"
    ).run(candidate.callId,fence,candidate.workerAccountId,slot.slot,slot.fence);
    if(claimed.changes!==1)throw Error("local fake slot CAS failure");
    if(failAfterSlot)throw Error("test crash after slot");
    db.prepare(
      "INSERT INTO fake_call_reservations VALUES(?,?,?,?,?,?,?,?)"
    ).run(candidate.callId,candidate.workerAccountId,
      candidate.callerAccountId,candidate.listingId,slot.slot,fence,
      candidate.observedConsentRevision,"reserved_test_only");
    if(failAfterCall)throw Error("test crash after call");
    db.prepare(
      "INSERT INTO fake_unsent_call_intents VALUES(?,?,?)"
    ).run(candidate.callId,"pending_test_only","incoming_audio_intent_only");
    if(failAfterIntent)throw Error("test crash after intent");
    db.exec("COMMIT");tx=false;
    return Object.freeze({kind:"reserved_test_only",slot:slot.slot,fence});
  }catch(error){
    if(tx)db.exec("ROLLBACK");
    throw error;
  }
}
function releaseFixture(callId,workerAccountId,fence){
  return {kind:"trusted_server_fixture_only",callId,workerAccountId,fence};
}

/** Trusted TEST-ONLY terminal release; fences old calls after slot reuse. */
function releaseFakeCall(db,release,{failAfterSlot=false}={}){
  if(!exact(release,releaseFields) ||
     release.kind!=="trusted_server_fixture_only" ||
     !validOpaqueId(release.callId) ||
     !validOpaqueId(release.workerAccountId) ||
     !Number.isSafeInteger(release.fence) || release.fence<=0)
    return denied("UNTRUSTED_RELEASE");
  let tx=false;
  try{
    db.exec("BEGIN IMMEDIATE");tx=true;
    const call=db.prepare(
      "SELECT * FROM fake_call_reservations WHERE call_id=?"
    ).get(release.callId);
    if(!call || call.worker_id!==release.workerAccountId ||
       call.fence!==release.fence ||
       call.state!=="reserved_test_only"){
      db.exec("ROLLBACK");tx=false;
      return denied("STALE_OR_FOREIGN_RELEASE");
    }
    const freed=db.prepare(
      "UPDATE fake_worker_capacity_slots SET call_id=NULL "+
      "WHERE worker_id=? AND slot=? AND call_id=? AND fence=?"
    ).run(call.worker_id,call.slot,call.call_id,release.fence);
    if(freed.changes!==1)throw Error("local fake release CAS failure");
    if(failAfterSlot)throw Error("test crash after release slot");
    const changed=db.prepare(
      "UPDATE fake_call_reservations SET state='released_test_only' "+
      "WHERE call_id=? AND state='reserved_test_only' AND fence=?"
    ).run(call.call_id,release.fence);
    const revoked=db.prepare(
      "UPDATE fake_unsent_call_intents SET state='revoked_test_only' "+
      "WHERE call_id=? AND state='pending_test_only'"
    ).run(call.call_id);
    if(changed.changes!==1 || revoked.changes!==1)
      throw Error("local fake release lacks state or UNSENT intent");
    db.exec("COMMIT");tx=false;
    return {kind:"released_test_only"};
  }catch(error){
    if(tx)db.exec("ROLLBACK");
    throw error;
  }
}


/**
 * OFFLINE-ONLY revocation rehearsal: one trusted test-fixture instruction
 * flips this worker's fake consent OFF, releases every *UNSENT* fake slot,
 * terminalizes its local fake reservations, and tombstones its queued intents
 * inside one SQLite write transaction. This is NOT an implemented opt-out
 * handler, an approved P02 capacity choice, a D1/DO guarantee or an external
 * Agora media/notification cancellation contract. Never call this on real
 * worker identifiers or persist its fake tables in production.
 */
const revocationFields=[
  "kind","workerAccountId","expectedConsentRevision",
];
function fakeWorkerRevocation(workerAccountId,expectedConsentRevision){
  return {
    kind:"trusted_internal_fixture_only",workerAccountId,expectedConsentRevision,
  };
}
function revokeQueuedWorkerFixtures(db,request,{
  failAfterConsent=false,failAfterFirstSlot=false,
  failAfterFirstReservation=false,failAfterFirstIntent=false,
}={}){
  if(!exact(request,revocationFields) ||
     request.kind!=="trusted_internal_fixture_only" ||
     !validOpaqueId(request.workerAccountId) ||
     !Number.isSafeInteger(request.expectedConsentRevision) ||
     request.expectedConsentRevision<1 ||
     request.expectedConsentRevision>=Number.MAX_SAFE_INTEGER)
    return denied("UNTRUSTED_TEST_REVOCATION");

  let tx=false;
  try{
    db.exec("BEGIN IMMEDIATE");tx=true;
    const preference=db.prepare(
      "UPDATE fake_worker_consent SET enabled=0,revision=revision+1 "+
      "WHERE worker_id=? AND enabled=1 AND revision=?"
    ).run(request.workerAccountId,request.expectedConsentRevision);
    if(preference.changes!==1){
      db.exec("ROLLBACK");tx=false;
      return denied("STALE_OR_OFF_CONSENT");
    }
    if(failAfterConsent)throw Error("synthetic crash after consent OFF");
    const queued=db.prepare(
      "SELECT call_id,slot,fence FROM fake_call_reservations "+
      "WHERE worker_id=? AND state='reserved_test_only' ORDER BY call_id"
    ).all(request.workerAccountId);

    for(const [index,call] of queued.entries()){
      const freed=db.prepare(
        "UPDATE fake_worker_capacity_slots SET call_id=NULL "+
        "WHERE worker_id=? AND slot=? AND call_id=? AND fence=?"
      ).run(request.workerAccountId,call.slot,call.call_id,call.fence);
      if(freed.changes!==1)throw Error("synthetic revoked slot CAS mismatch");
      if(index===0 && failAfterFirstSlot)
        throw Error("synthetic crash after first slot release");

      const changed=db.prepare(
        "UPDATE fake_call_reservations SET state='released_test_only' "+
        "WHERE worker_id=? AND call_id=? AND slot=? AND fence=? "+
        "AND state='reserved_test_only'"
      ).run(request.workerAccountId,call.call_id,call.slot,call.fence);
      if(changed.changes!==1)
        throw Error("synthetic revoked call-state mismatch");
      if(index===0 && failAfterFirstReservation)
        throw Error("synthetic crash after first reservation");

      const tombstoned=db.prepare(
        "UPDATE fake_unsent_call_intents SET state='revoked_test_only' "+
        "WHERE call_id=? AND state='pending_test_only' "+
        "AND kind='incoming_audio_intent_only'"
      ).run(call.call_id);
      if(tombstoned.changes!==1)
        throw Error("synthetic missing UNSENT alert");
      if(index===0 && failAfterFirstIntent)
        throw Error("synthetic crash after first alert tombstone");
    }

    db.exec("COMMIT");tx=false;
    return Object.freeze({kind:"revoked_test_only",count:queued.length});
  }catch(error){
    if(tx)db.exec("ROLLBACK");
    throw error;
  }
}

test("worker consent default OFF: neither P02 option admits even a synthetic call",async()=>{
  for(const capacity of [1,2]){
    await withTrial({workerSlots:capacity},async t=>{
      assert.equal(observedRevision(t.a),0);
      assert.deepEqual(admitFakeCall(t.b,fakeCandidate({revision:0})),
        denied("UNTRUSTED_TEST_CANDIDATE"));
      assert.deepEqual(admitFakeCall(t.a,fakeCandidate()),
        denied("WORKER_CONSENT_UNAVAILABLE"));
      assert.equal(reservations(t.a).length,0);
      assert.equal(unsent(t.b).length,0);
      assert.deepEqual(slots(t.a).map(s=>s.call_id),Array(capacity).fill(null));
    });
  }
});

test("P02 OPTION A one worker-wide slot serializes two callers across different listings",async()=>{
  for(const firstWriter of ["a","b"]){
    await withTrial({workerSlots:1},async t=>{
      setFixtureWorkerConsent(t.a,WORKER,true);
      const first=fakeCandidate({callerAccountId:CALLER_A,
        listingId:LISTING_A,callId:CALL_A});
      const second=fakeCandidate({callerAccountId:CALLER_B,
        listingId:LISTING_B,callId:CALL_B});
      const winning=admitFakeCall(t[firstWriter],first);
      assert.equal(winning.kind,"reserved_test_only");
      const losing=admitFakeCall(t[firstWriter==="a"?"b":"a"],second);
      assert.deepEqual(losing,denied("CAPACITY_EXHAUSTED_TEST_ONLY"));
      assert.equal(slots(t.a)[0].call_id,CALL_A);
      assert.equal(reservations(t.b).length,1);
      assert.deepEqual(unsent(t.b).map(x=>x.call_id),[CALL_A]);
      assert.equal(winning.fence,1);
    });
  }
});

test("P02 OPTION B two worker-wide slots admit two but not a third concurrent caller",async()=>{
  await withTrial({workerSlots:2},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    const a=admitFakeCall(t.a,fakeCandidate());
    const b=admitFakeCall(t.b,fakeCandidate({
      callerAccountId:CALLER_B,listingId:LISTING_B,callId:CALL_B,
    }));
    assert.deepEqual([a.kind,b.kind],["reserved_test_only","reserved_test_only"]);
    assert.deepEqual([a.slot,b.slot],[1,2]);
    assert.deepEqual(admitFakeCall(t.a,fakeCandidate({
      callerAccountId:CALLER_C,callId:CALL_C,
    })),denied("CAPACITY_EXHAUSTED_TEST_ONLY"));
    assert.equal(reservations(t.b).length,2);
    assert.equal(unsent(t.a).length,2);
    assert.deepEqual(slots(t.a).map(x=>x.call_id),[CALL_A,CALL_B]);
  });
});

test("worker-keyed slots do not serialize independent workers or leak across listings",async()=>{
  await withTrial({workerSlots:1,includeOtherWorker:true},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    setFixtureWorkerConsent(t.a,OTHER_WORKER,true);
    const a=admitFakeCall(t.a,fakeCandidate());
    const b=admitFakeCall(t.b,fakeCandidate({
      workerAccountId:OTHER_WORKER,
      callerAccountId:CALLER_B,callId:CALL_B,
    }));
    assert.equal(a.kind,"reserved_test_only");
    assert.equal(b.kind,"reserved_test_only");
    assert.equal(slots(t.a,WORKER)[0].call_id,CALL_A);
    assert.equal(slots(t.b,OTHER_WORKER)[0].call_id,CALL_B);
    assert.equal(reservations(t.a,WORKER).length,1);
    assert.equal(reservations(t.b,OTHER_WORKER).length,1);
  });
});

test("duplicated test call cannot claim another slot or create a second UNSENT intent",async()=>{
  await withTrial({workerSlots:2},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    const candidate=fakeCandidate();
    assert.equal(admitFakeCall(t.a,candidate).kind,"reserved_test_only");
    assert.deepEqual(admitFakeCall(t.b,candidate),
      {kind:"duplicate_suppressed_test_only"});
    assert.deepEqual(admitFakeCall(t.a,{
      ...candidate,callerAccountId:CALLER_B,
    }),denied("CALL_ID_ALREADY_USED"));
    assert.deepEqual(admitFakeCall(t.b,{
      ...candidate,listingId:LISTING_B,
    }),denied("CALL_ID_ALREADY_USED"));
    assert.equal(reservations(t.a).length,1);
    assert.equal(unsent(t.b).length,1);
    assert.equal(slots(t.b).filter(x=>x.call_id!==null).length,1);
  });
});

test("trusted test release frees slot and atomically tombstones the UNSENT alert",async()=>{
  await withTrial({workerSlots:1},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    const reserved=admitFakeCall(t.a,fakeCandidate());
    assert.equal(reserved.kind,"reserved_test_only");
    const release=releaseFixture(CALL_A,WORKER,reserved.fence);
    assert.deepEqual(releaseFakeCall(t.b,release),{kind:"released_test_only"});
    assert.equal(slots(t.a)[0].call_id,null);
    assert.equal(unsent(t.a)[0].state,"revoked_test_only");
    assert.equal(reservations(t.b)[0].state,"released_test_only");
    const next=admitFakeCall(t.a,fakeCandidate({
      callerAccountId:CALLER_B,callId:CALL_B,
    }));
    assert.equal(next.kind,"reserved_test_only");
    assert.equal(next.fence,reserved.fence+1);
    assert.deepEqual(releaseFakeCall(t.b,release),
      denied("STALE_OR_FOREIGN_RELEASE"));
    assert.equal(slots(t.a)[0].call_id,CALL_B);
    assert.deepEqual(unsent(t.a).map(x=>x.state),
      ["revoked_test_only","pending_test_only"]);
  });
});

test("wrong-worker, wrong-fence and client-origin release never free busy slot",async()=>{
  await withTrial({workerSlots:1,includeOtherWorker:true},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    const reserved=admitFakeCall(t.a,fakeCandidate());
    assert.equal(reserved.kind,"reserved_test_only");
    for(const release of [
      releaseFixture(CALL_A,OTHER_WORKER,reserved.fence),
      releaseFixture(CALL_A,WORKER,reserved.fence+1),
      {...releaseFixture(CALL_A,WORKER,reserved.fence),callerId:CALLER_A},
      {kind:"synthetic_client",callId:CALL_A,workerAccountId:WORKER,fence:reserved.fence},
      releaseFixture("call-unknown-test-0001",WORKER,reserved.fence),
    ]){
      const result=releaseFakeCall(t.b,release);
      assert.equal(result.kind,"denied");
    }
    assert.equal(slots(t.a)[0].call_id,CALL_A);
    assert.equal(unsent(t.b)[0].state,"pending_test_only");
    assert.equal(reservations(t.a)[0].state,"reserved_test_only");
  });
});

test("OFF to ON consent change invalidates stale prepared candidates, no resurrection",async()=>{
  await withTrial({workerSlots:2},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    const old=fakeCandidate({revision:observedRevision(t.b)});
    setFixtureWorkerConsent(t.b,WORKER,false);
    assert.deepEqual(admitFakeCall(t.a,old),
      denied("WORKER_CONSENT_UNAVAILABLE"));
    setFixtureWorkerConsent(t.b,WORKER,true);
    assert.deepEqual(admitFakeCall(t.a,old),
      denied("WORKER_CONSENT_UNAVAILABLE"));
    assert.equal(unsent(t.b).length,0);
    const fresh=fakeCandidate({revision:observedRevision(t.b)});
    assert.equal(admitFakeCall(t.b,fresh).kind,"reserved_test_only");
    setFixtureWorkerConsent(t.a,WORKER,false);
    assert.deepEqual(admitFakeCall(t.b,fakeCandidate({
      revision:observedRevision(t.b),
      callerAccountId:CALLER_B,callId:CALL_B,
    })),denied("WORKER_CONSENT_UNAVAILABLE"));
    assert.equal(reservations(t.a).length,1);
    // Real provider/media cancellation on OFF remains unimplemented and gated.
  });
});

test("two SQLite writers serialize slot admission; lock contention creates no partial alert",async()=>{
  await withTrial({workerSlots:1},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    t.a.exec("BEGIN IMMEDIATE");
    try{
      assert.throws(()=>admitFakeCall(t.b,fakeCandidate()),
        /database is locked|SQLITE_BUSY/i);
      assert.equal(unsent(t.a).length,0);
      assert.equal(reservations(t.a).length,0);
    }finally{t.a.exec("ROLLBACK");}
    const good=admitFakeCall(t.b,fakeCandidate());
    assert.equal(good.kind,"reserved_test_only");
    assert.deepEqual(admitFakeCall(t.a,fakeCandidate({
      callerAccountId:CALLER_B,callId:CALL_B,
    })),denied("CAPACITY_EXHAUSTED_TEST_ONLY"));
  });
});

test("crash after slot, call row or UNSENT intent rolls back all three and permits retry",async()=>{
  for(const failure of ["failAfterSlot","failAfterCall","failAfterIntent"]){
    await withTrial({workerSlots:1},async t=>{
      setFixtureWorkerConsent(t.a,WORKER,true);
      const candidate=fakeCandidate();
      assert.throws(()=>admitFakeCall(t.a,candidate,{[failure]:true}),
        /test crash after (slot|call|intent)/);
      assert.deepEqual(slots(t.b),[{slot:1,call_id:null,fence:0}]);
      assert.equal(reservations(t.b).length,0);
      assert.equal(unsent(t.b).length,0);
      assert.equal(admitFakeCall(t.b,candidate).kind,"reserved_test_only");
      assert.equal(unsent(t.a).length,1);
      assert.deepEqual(t.a.prepare("PRAGMA foreign_key_check").all(),[]);
    });
  }
});

test("failed release rollback cannot silently free slot while a fake alert remains pending",async()=>{
  await withTrial({workerSlots:1},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    const a=admitFakeCall(t.a,fakeCandidate());
    assert.equal(a.kind,"reserved_test_only");
    const release=releaseFixture(CALL_A,WORKER,a.fence);
    assert.throws(()=>releaseFakeCall(t.b,release,{failAfterSlot:true}),
      /test crash after release slot/);
    assert.equal(slots(t.a)[0].call_id,CALL_A);
    assert.equal(unsent(t.a)[0].state,"pending_test_only");
    assert.equal(reservations(t.b)[0].state,"reserved_test_only");
    assert.deepEqual(releaseFakeCall(t.a,release),{kind:"released_test_only"});
    assert.equal(unsent(t.b)[0].state,"revoked_test_only");
  });
});

test("unknown worker, invalid origin and malformed IDs cannot consume capacity",async()=>{
  await withTrial({workerSlots:2},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    for(const c of [
      {...fakeCandidate(),kind:"client"},
      {...fakeCandidate(),callerAccountId:WORKER},
      {...fakeCandidate(),callerAccountId:null},
      {...fakeCandidate(),callId:"not opaque id"},
      {...fakeCandidate(),observedConsentRevision:NaN},
      {...fakeCandidate(),observedConsentRevision:-1},
      {...fakeCandidate(),listingId:"bad"},
      {...fakeCandidate(),deviceToken:"unapproved"},
      fakeCandidate({workerAccountId:"worker-nonexistent-00001"}),
    ]){
      const result=admitFakeCall(t.b,c);
      assert.equal(result.kind,"denied");
    }
    assert.equal(slots(t.a).filter(x=>x.call_id).length,0);
    assert.equal(reservations(t.b).length,0);
    assert.equal(unsent(t.a).length,0);
  });
});


test("OFF revokes all queued UNSENT calls for one worker atomically, never another worker",async()=>{
  await withTrial({workerSlots:2,includeOtherWorker:true},async t=>{
    assert.deepEqual(setFixtureWorkerConsent(t.a,WORKER,true),
      {revision:1,enabled:1});
    assert.deepEqual(setFixtureWorkerConsent(t.a,OTHER_WORKER,true),
      {revision:1,enabled:1});
    const first=admitFakeCall(t.a,fakeCandidate());
    const second=admitFakeCall(t.b,fakeCandidate({
      callerAccountId:CALLER_B,listingId:LISTING_B,callId:CALL_B,
    }));
    const independent=admitFakeCall(t.a,fakeCandidate({
      workerAccountId:OTHER_WORKER,callerAccountId:CALLER_C,callId:CALL_C,
    }));
    assert.deepEqual([first.kind,second.kind,independent.kind],
      ["reserved_test_only","reserved_test_only","reserved_test_only"]);
    assert.deepEqual(slots(t.b).map(x=>x.call_id),[CALL_A,CALL_B]);
    assert.deepEqual(unsent(t.a).map(x=>x.state),
      Array(3).fill("pending_test_only"));

    const revoked=revokeQueuedWorkerFixtures(t.b,
      fakeWorkerRevocation(WORKER,1));
    assert.deepEqual(revoked,{kind:"revoked_test_only",count:2});
    assert.equal(Object.isFrozen(revoked),true);
    assert.deepEqual(t.a.prepare(
      "SELECT enabled,revision FROM fake_worker_consent WHERE worker_id=?"
    ).get(WORKER),{enabled:0,revision:2});
    assert.deepEqual(slots(t.a).map(x=>x.call_id),[null,null]);
    assert.deepEqual(reservations(t.a).map(x=>x.state),
      ["released_test_only","released_test_only"]);
    const stateByCall=Object.fromEntries(unsent(t.b).map(x=>[x.call_id,x.state]));
    assert.deepEqual(stateByCall,{
      [CALL_A]:"revoked_test_only",
      [CALL_B]:"revoked_test_only",
      [CALL_C]:"pending_test_only",
    });
    assert.equal(slots(t.a,OTHER_WORKER)[0].call_id,CALL_C);
    assert.equal(reservations(t.b,OTHER_WORKER)[0].state,
      "reserved_test_only");
    assert.deepEqual(releaseFakeCall(t.a,releaseFixture(
      CALL_A,WORKER,first.fence)),denied("STALE_OR_FOREIGN_RELEASE"));
    assert.deepEqual(revokeQueuedWorkerFixtures(t.a,
      fakeWorkerRevocation(WORKER,1)),denied("STALE_OR_OFF_CONSENT"));
    assert.deepEqual(admitFakeCall(t.b,fakeCandidate()),
      denied("WORKER_CONSENT_UNAVAILABLE"));

    // OFF -> ON is a NEW epoch: no old queued call or previous receipt revives.
    assert.deepEqual(setFixtureWorkerConsent(t.a,WORKER,true),
      {enabled:1,revision:3});
    assert.deepEqual(admitFakeCall(t.b,fakeCandidate()),
      denied("WORKER_CONSENT_UNAVAILABLE"));
    const fresh=admitFakeCall(t.a,fakeCandidate({
      callerAccountId:CALLER_A,callId:"call-capacity-new-epoch-0001",
      revision:3,
    }));
    assert.equal(fresh.kind,"reserved_test_only");
    assert.equal(fresh.slot,1);
    assert.equal(fresh.fence,first.fence+1);
    assert.equal(stateByCall[CALL_A],"revoked_test_only");
    assert.equal(unsent(t.a).find(x=>x.call_id===CALL_A).state,
      "revoked_test_only");
    assert.deepEqual(t.b.prepare("PRAGMA foreign_key_check").all(),[]);
  });
});

test("consent revocation rollbacks never leave partially freed slots or alerts",async()=>{
  for(const failure of [
    "failAfterConsent","failAfterFirstSlot",
    "failAfterFirstReservation","failAfterFirstIntent",
  ]){
    await withTrial({workerSlots:2},async t=>{
      setFixtureWorkerConsent(t.a,WORKER,true);
      assert.equal(admitFakeCall(t.a,fakeCandidate()).kind,
        "reserved_test_only");
      assert.equal(admitFakeCall(t.b,fakeCandidate({
        callerAccountId:CALLER_B,listingId:LISTING_B,callId:CALL_B,
      })).kind,"reserved_test_only");
      const snapshot=()=>({
        consent:t.a.prepare("SELECT * FROM fake_worker_consent").all(),
        slots:slots(t.a),reservations:reservations(t.a),unsent:unsent(t.a),
      });
      const before=snapshot();
      assert.throws(()=>revokeQueuedWorkerFixtures(t.b,
        fakeWorkerRevocation(WORKER,1),{[failure]:true}),
      /synthetic crash after/);
      assert.deepEqual(snapshot(),before,
        failure+" must roll back consent + both calls + unsent intents");
      assert.deepEqual(t.b.prepare("PRAGMA foreign_key_check").all(),[]);
      assert.deepEqual(revokeQueuedWorkerFixtures(t.a,
        fakeWorkerRevocation(WORKER,1)),
        {kind:"revoked_test_only",count:2});
      assert.deepEqual(unsent(t.b).map(x=>x.state),
        ["revoked_test_only","revoked_test_only"]);
    });
  }
});

test("competing local writers cannot interleave opt-out with a queued call claim",async()=>{
  await withTrial({workerSlots:2},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    const prepared=fakeCandidate();
    assert.equal(admitFakeCall(t.a,prepared).kind,"reserved_test_only");
    const before={slots:slots(t.a),unsent:unsent(t.a),
      revisions:observedRevision(t.a)};
    t.a.exec("BEGIN IMMEDIATE");
    try{
      assert.throws(()=>revokeQueuedWorkerFixtures(t.b,
        fakeWorkerRevocation(WORKER,1)),/database is locked|SQLITE_BUSY/i);
      assert.deepEqual(slots(t.a),before.slots);
      assert.deepEqual(unsent(t.a),before.unsent);
      assert.equal(observedRevision(t.a),before.revisions);
    }finally{t.a.exec("ROLLBACK");}
    assert.deepEqual(revokeQueuedWorkerFixtures(t.b,
      fakeWorkerRevocation(WORKER,1)),
      {kind:"revoked_test_only",count:1});
    assert.deepEqual(admitFakeCall(t.a,fakeCandidate({
      callerAccountId:CALLER_B,callId:CALL_B,
    })),denied("WORKER_CONSENT_UNAVAILABLE"));
    assert.equal(unsent(t.b)[0].state,"revoked_test_only");
  });
});

test("untrusted, stale or foreign revocations never alter another worker's queue",async()=>{
  await withTrial({workerSlots:1,includeOtherWorker:true},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    setFixtureWorkerConsent(t.a,OTHER_WORKER,true);
    const own=admitFakeCall(t.a,fakeCandidate());
    const other=admitFakeCall(t.b,fakeCandidate({
      workerAccountId:OTHER_WORKER,callerAccountId:CALLER_B,callId:CALL_B,
    }));
    assert.equal(own.kind,"reserved_test_only");
    assert.equal(other.kind,"reserved_test_only");
    const canonical=fakeWorkerRevocation(WORKER,1);
    for(const invalid of [
      null,{},canonical.kind, // no client / malformed instruction
      {...canonical,kind:"client_claimed"},
      {...canonical,origin:"caller"},
      {...canonical,workerAccountId:"bad id"},
      {...canonical,workerAccountId:"worker-nonexistent-00001"},
      {...canonical,expectedConsentRevision:0},
      {...canonical,expectedConsentRevision:-1},
      {...canonical,expectedConsentRevision:NaN},
      {...canonical,expectedConsentRevision:Number.MAX_SAFE_INTEGER},
      {...canonical,expectedConsentRevision:2},
    ]){
      const result=revokeQueuedWorkerFixtures(t.b,invalid);
      assert.equal(result.kind,"denied");
      assert.equal(unsent(t.a).every(x=>x.state==="pending_test_only"),true);
      assert.equal(slots(t.a)[0].call_id,CALL_A);
      assert.equal(slots(t.b,OTHER_WORKER)[0].call_id,CALL_B);
    }
    assert.deepEqual(revokeQueuedWorkerFixtures(t.b,
      fakeWorkerRevocation(WORKER,1)),
      {kind:"revoked_test_only",count:1});
    assert.equal(slots(t.a,OTHER_WORKER)[0].call_id,CALL_B);
    assert.equal(unsent(t.b).find(x=>x.call_id===CALL_B).state,
      "pending_test_only");
  });
});

test("empty fake queue can opt out without touching another worker or real schema",async()=>{
  await withTrial({workerSlots:1,includeOtherWorker:true},async t=>{
    setFixtureWorkerConsent(t.a,WORKER,true);
    setFixtureWorkerConsent(t.a,OTHER_WORKER,true);
    assert.deepEqual(revokeQueuedWorkerFixtures(t.b,
      fakeWorkerRevocation(WORKER,1)),
      {kind:"revoked_test_only",count:0});
    assert.deepEqual(slots(t.a),[{slot:1,call_id:null,fence:0}]);
    assert.deepEqual(unsent(t.b),[]);
    assert.deepEqual(reservations(t.a),[]);
    assert.equal(observedRevision(t.b),2);
    assert.equal(observedRevision(t.a,OTHER_WORKER),1);
  });
});

test("local-only fake worker slot schema is absent from production D1 migrations",()=>{
  const prod=openLocalDatabase();
  try{
    const names=prod.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table'"
    ).all().map(row=>row.name);
    for(const fake of [
      "fake_worker_consent","fake_worker_capacity_slots",
      "fake_call_reservations","fake_unsent_call_intents",
      "worker_call_slots","agora_call_sessions",
    ])assert.equal(names.includes(fake),false,fake);
  }finally{prod.db.close();}
  const t=createTrial({workerSlots:2});
  try{
    setFixtureWorkerConsent(t.a,WORKER,true);
    const result=admitFakeCall(t.a,fakeCandidate());
    assert.equal(result.kind,"reserved_test_only");
    const raw=JSON.stringify([
      ...slots(t.a),...reservations(t.a),...unsent(t.a),
    ]);
    for(const secret of [
      "phoneNumber","phone_number","tel:","rtcUid","channelName",
      "AgoraToken","deviceToken","bearer","recipientDevice",
    ])assert.equal(raw.includes(secret),false,secret);
    assert.equal(unsent(t.a)[0].state,"pending_test_only",
      "NO sender, dispatch, device delivery or live RTC permission exists");
  }finally{t.close();}
});
