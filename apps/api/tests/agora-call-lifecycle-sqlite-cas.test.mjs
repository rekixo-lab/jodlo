import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessSyntheticAgoraSignalingIntent } from
  "../src/modules/interactions/agora-signaling-intent.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { validOpaqueId } from "../src/modules/shared/identifiers.ts";

/**
 * OFFLINE / DISPOSABLE TWO-CONNECTION SQLite CAS rehearsal ONLY.
 *
 * No call/receipt/outbox table below exists in production migrations.
 * No real caller/worker sessions, M-003 retained call metadata, M-005
 * presence/busy/block/rate rules, provider signaling, RTC or phone number.
 * The test "sessionActor" is injected by a TRUSTED TEST FIXTURE, never
 * verified against a real bearer. Client JSON cannot choose the actor or
 * masquerade as a trusted server event in this test adapter.
 *
 * This rehearses atomic state + unique receipt + UNSENT logical intent.
 * It does NOT approve a real call, exactly-once provider delivery, Cloudflare
 * D1/DO distributed coordination, an approved timeout or media integration.
 */
const CALLER="account-local-cas-caller-001";
const WORKER="account-local-cas-worker-001";
const OTHER="account-local-cas-other-0001";
const LISTING="listing-local-cas-voice-001";
const CATEGORY="agora-cas-test-category";
const CALL_ID="call-local-cas-test-00001";
const NEXT_ID="call-local-cas-test-00002";
const NOW=1_800_000_000_000;
const DEADLINE=NOW+40_000;
const INITIAL=Object.freeze({
  callId:CALL_ID,listingId:LISTING,categoryId:CATEGORY,
  callerAccountId:CALLER,workerAccountId:WORKER,
  phase:"ringing",revision:0,createdAtMs:NOW,ringDeadlineMs:DEADLINE,
});

const command=(event,revision=0,key="cas-command-key-00001",nowMs=NOW+1000)=>({
  event,expectedRevision:revision,idempotencyKey:key,nowMs,
});
const client=(actor,wire)=>({kind:"synthetic_session",sessionActor:actor,wire});
const server=wire=>({kind:"trusted_server_fixture",wire});
const denied=reason=>({kind:"denied",reason});

function openTrial(){
  const dir=mkdtempSync(join(tmpdir(),"jodlo-agora-call-cas-"));
  const path=join(dir,"disposable.sqlite");
  const a=new DatabaseSync(path);
  const b=new DatabaseSync(path);
  try{
    a.exec("PRAGMA journal_mode=WAL");
    a.exec("PRAGMA foreign_keys=ON");
    b.exec("PRAGMA foreign_keys=ON");
    a.exec("PRAGMA busy_timeout=0");
    b.exec("PRAGMA busy_timeout=0");
    a.exec(
      "CREATE TABLE synthetic_lifecycle_calls (" +
      "call_id TEXT PRIMARY KEY,revision INTEGER NOT NULL," +
      "snapshot_json TEXT NOT NULL);" +
      "CREATE TABLE synthetic_lifecycle_receipts (" +
      "call_id TEXT NOT NULL REFERENCES synthetic_lifecycle_calls(call_id)," +
      "retry_key TEXT NOT NULL,receipt_json TEXT NOT NULL," +
      "PRIMARY KEY(call_id,retry_key));" +
      "CREATE TABLE synthetic_lifecycle_outbox (" +
      "call_id TEXT NOT NULL REFERENCES synthetic_lifecycle_calls(call_id)," +
      "revision INTEGER NOT NULL,signal_json TEXT NOT NULL," +
      "PRIMARY KEY(call_id,revision));"
    );
    a.prepare(
      "INSERT INTO synthetic_lifecycle_calls VALUES(?,?,?)"
    ).run(CALL_ID,INITIAL.revision,JSON.stringify(INITIAL));
    return {
      a,b,
      close(){
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
function snapshot(db,callId=CALL_ID){
  const row=db.prepare(
    "SELECT snapshot_json FROM synthetic_lifecycle_calls WHERE call_id=?"
  ).get(callId);
  return row?JSON.parse(row.snapshot_json):null;
}
function receipts(db,callId=CALL_ID){
  return db.prepare(
    "SELECT * FROM synthetic_lifecycle_receipts WHERE call_id=? ORDER BY retry_key"
  ).all(callId);
}
function intents(db,callId=CALL_ID){
  return db.prepare(
    "SELECT * FROM synthetic_lifecycle_outbox WHERE call_id=? ORDER BY revision"
  ).all(callId).map(row=>({
    revision:row.revision,signal:JSON.parse(row.signal_json),
  }));
}

/**
 * Synthetic identity boundary: the fixture can inject a trusted session
 * actor, but a wire command never supplies account identity. A separate
 * trusted-server-only fixture path constructs the null actor for timeout and
 * media adapter events. This is NOT actual D1 session authentication.
 */
function safeCommand(origin){
  if(!origin || typeof origin!=="object" ||
     !origin.wire || typeof origin.wire!=="object" ||
     Array.isArray(origin.wire))return null;
  const wire=origin.wire;
  if(Object.keys(wire).length!==4 ||
     !["event","expectedRevision","idempotencyKey","nowMs"]
       .every(field=>Object.hasOwn(wire,field)))return null;
  const reserved=["ring_timeout","media_ready","media_failed"];
  if(origin.kind==="synthetic_session"){
    if(![CALLER,WORKER,OTHER].includes(origin.sessionActor) ||
       reserved.includes(wire.event))return null;
    return {...wire,actorAccountId:origin.sessionActor};
  }
  if(origin.kind==="trusted_server_fixture"){
    if(!reserved.includes(wire.event) ||
       Object.hasOwn(origin,"sessionActor"))return null;
    return {...wire,actorAccountId:null};
  }
  return null;
}

/**
 * Full local BEGIN IMMEDIATE transaction around a single reducer outcome,
 * exact call revision CAS, committed unique idempotency receipt and one UNSENT
 * logical signal intent. Not a production service or sender. The reducer
 * validates actor transitions but cannot attest authentic M-005 policy facts.
 */
function stageSyntheticTransition(db,{
  callId=CALL_ID,origin,failAfterState=false,failAfterReceipt=false,
}){
  const trustedCommand=safeCommand(origin);
  if(!trustedCommand)return denied("UNTRUSTED_COMMAND");
  let inTransaction=false;
  try{
    db.exec("BEGIN IMMEDIATE");
    inTransaction=true;
    const row=db.prepare(
      "SELECT revision,snapshot_json FROM synthetic_lifecycle_calls WHERE call_id=?"
    ).get(callId);
    if(!row){
      db.exec("ROLLBACK");inTransaction=false;
      return denied("UNKNOWN_CALL");
    }
    let current;
    let priorReceipt=null;
    try{
      current=JSON.parse(row.snapshot_json);
      const prior=db.prepare(
        "SELECT receipt_json FROM synthetic_lifecycle_receipts " +
        "WHERE call_id=? AND retry_key=?"
      ).get(callId,trustedCommand.idempotencyKey);
      if(prior)priorReceipt=JSON.parse(prior.receipt_json);
    }catch{
      db.exec("ROLLBACK");inTransaction=false;
      return denied("CORRUPT_LOCAL_FIXTURE");
    }
    if(row.revision!==current.revision || current.callId!==callId){
      db.exec("ROLLBACK");inTransaction=false;
      return denied("CORRUPT_LOCAL_FIXTURE");
    }
    const decision=assessSyntheticAgoraSignalingIntent(
      current,trustedCommand,priorReceipt,
    );
    if(decision.kind!=="transition_only"){
      db.exec("ROLLBACK");inTransaction=false;
      return decision;
    }
    const changed=db.prepare(
      "UPDATE synthetic_lifecycle_calls SET revision=?,snapshot_json=? " +
      "WHERE call_id=? AND revision=?"
    ).run(decision.next.revision,JSON.stringify(decision.next),
      callId,current.revision);
    if(changed.changes!==1)throw Error("synthetic state CAS lost");
    if(failAfterState)throw Error("synthetic crash before receipt commit");
    db.prepare(
      "INSERT INTO synthetic_lifecycle_receipts VALUES(?,?,?)"
    ).run(callId,trustedCommand.idempotencyKey,
      JSON.stringify(decision.receipt));
    if(failAfterReceipt)throw Error("synthetic crash before outbox commit");
    db.prepare(
      "INSERT INTO synthetic_lifecycle_outbox VALUES(?,?,?)"
    ).run(callId,decision.next.revision,JSON.stringify(decision.signal));
    db.exec("COMMIT");inTransaction=false;
    return Object.freeze({
      kind:"transition_only",next:decision.next,signal:decision.signal,
    });
  }catch(error){
    if(inTransaction)db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * READ-ONLY LOCAL CONSISTENCY REHEARSAL, NEVER a provider-send grant.
 * Replays each disposable committed receipt with the existing pure reducer
 * from a TRUSTED, hardcoded synthetic initial snapshot. Requires exact
 * agreement across:
 *   - persisted call ID / current revision / full snapshot;
 *   - contiguous authorized state transitions and receipt bodies;
 *   - one matching UNSENT outbox intent for EACH resulting revision;
 *   - no missing, extra, changed or duplicate test-only ledger entries.
 *
 * This test snapshot is NOT an authenticated history, cryptographic proof,
 * authorized delivery, approved call metadata retention, or real D1 audit.
 * A coordinated attacker could rewrite all fake rows, and a read-only check
 * cannot fence any future provider send after it returns.
 */
function inspectSyntheticUnsentLifecycleLedger(db,{callId=CALL_ID}={}){
  const withheld=Object.freeze({kind:"withheld"});
  if(!validOpaqueId(callId))return withheld;
  let inTransaction=false;
  try{
    db.exec("BEGIN");
    inTransaction=true;
    const callRow=db.prepare(
      "SELECT revision,snapshot_json FROM synthetic_lifecycle_calls " +
      "WHERE call_id=?"
    ).get(callId);
    if(!callRow)throw Error("unknown synthetic call");
    const snapshotNow=JSON.parse(callRow.snapshot_json);
    const receiptRows=db.prepare(
      "SELECT call_id,retry_key,receipt_json FROM " +
      "synthetic_lifecycle_receipts WHERE call_id=?"
    ).all(callId).map(row=>({
      ...row,receipt:JSON.parse(row.receipt_json),
    }));
    const outboxRows=db.prepare(
      "SELECT call_id,revision,signal_json FROM " +
      "synthetic_lifecycle_outbox WHERE call_id=?"
    ).all(callId).map(row=>({
      ...row,signal:JSON.parse(row.signal_json),
    }));
    if(!Number.isSafeInteger(callRow.revision) ||
       callRow.revision<0 ||
       receiptRows.length!==callRow.revision ||
       outboxRows.length!==callRow.revision)throw Error("broken synthetic counts");
    receiptRows.sort((x,y)=>
      Number(x.receipt?.result?.revision)-Number(y.receipt?.result?.revision));
    outboxRows.sort((x,y)=>x.revision-y.revision);
    let expected={...INITIAL,callId};
    for(let i=0;i<receiptRows.length;i++){
      const row=receiptRows[i],item=row.receipt;
      if(!item || typeof item!=="object" || Array.isArray(item))
        throw Error("malformed test receipt");
      assert.equal(row.call_id,callId);
      assert.equal(item.callId,callId);
      assert.equal(row.retry_key,item.idempotencyKey);
      assert.equal(item.expectedRevision,expected.revision);
      const replayed=assessSyntheticAgoraSignalingIntent(expected,{
        actorAccountId:item.actorAccountId,
        expectedRevision:item.expectedRevision,
        idempotencyKey:item.idempotencyKey,
        event:item.event,
        nowMs:item.nowMs,
      });
      assert.equal(replayed.kind,"transition_only",
        "stored entry must be an authorized synthetic state transition");
      assert.deepEqual(item,replayed.receipt,
        "full receipt, owner, timestamp and result must match the reducer");
      const outbox=outboxRows[i];
      assert.equal(outbox.call_id,callId);
      assert.equal(outbox.revision,expected.revision+1);
      assert.deepEqual(outbox.signal,replayed.signal,
        "one exact UNSENT logical signal matches the receipt");
      expected=replayed.next;
    }
    assert.equal(callRow.revision,expected.revision);
    assert.deepEqual(snapshotNow,expected,
      "stored snapshot must match entire validated transition history");
    db.exec("COMMIT");inTransaction=false;
    return Object.freeze({kind:"consistent_test_only"});
  }catch{
    if(inTransaction)db.exec("ROLLBACK");
    return withheld;
  }
}

async function withTrial(fn){
  const t=openTrial();
  try{await fn(t);}finally{t.close();}
}

test("worker accept wins local CAS against customer's concurrent cancel",async()=>{
  await withTrial(async t=>{
    const accepted=stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"cas-accept-first-0001")),
    });
    assert.equal(accepted.kind,"transition_only");
    assert.equal(accepted.next.phase,"accepted");
    assert.deepEqual(accepted.signal,{
      kind:"intent_only",signal:"call_answered",recipientRole:"caller",revision:1,
    });
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:client(CALLER,command("cancel",0,"cas-cancel-after-0001")),
    }),denied("STALE_REVISION"));
    assert.equal(snapshot(t.b).phase,"accepted");
    assert.equal(snapshot(t.b).revision,1);
    assert.equal(receipts(t.a).length,1);
    assert.equal(intents(t.b).length,1);
    assert.equal(intents(t.a)[0].signal.signal,"call_answered");
  });
});

test("customer cancel wins local CAS against worker accept; cannot ring a cancelled call",async()=>{
  await withTrial(async t=>{
    assert.equal(stageSyntheticTransition(t.b,{
      origin:client(CALLER,command("cancel",0,"cas-cancel-first-0001")),
    }).next.phase,"cancelled");
    assert.deepEqual(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"cas-accept-after-0001")),
    }),denied("STALE_REVISION"));
    assert.deepEqual(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",1,"cas-accept-retry-0001")),
    }),denied("TRANSITION_DENIED"));
    assert.equal(snapshot(t.a).phase,"cancelled");
    assert.deepEqual(intents(t.b).map(x=>x.signal.signal),["call_cancelled"]);
    assert.equal(receipts(t.b).length,1);
  });
});

test("trusted synthetic timeout vs worker accept is serialized at ring boundary",async()=>{
  await withTrial(async t=>{
    assert.deepEqual(stageSyntheticTransition(t.a,{
      origin:server(command("ring_timeout",0,"cas-too-early-0001",DEADLINE-1)),
    }),denied("TOO_EARLY"));
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:client(WORKER,command("accept",0,"cas-too-late-0001",DEADLINE)),
    }),denied("RING_EXPIRED"));
    assert.equal(stageSyntheticTransition(t.a,{
      origin:server(command("ring_timeout",0,"cas-timeout-first-0001",DEADLINE)),
    }).next.phase,"missed");
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:client(WORKER,command("accept",0,"cas-after-timeout-0001",DEADLINE-1)),
    }),denied("STALE_REVISION"));
    assert.equal(intents(t.b)[0].signal.signal,"call_missed");
    assert.equal(receipts(t.a).length,1);
  });
  await withTrial(async t=>{
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"cas-before-deadline-001",DEADLINE-1)),
    }).next.phase,"accepted");
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:server(command("ring_timeout",0,"cas-after-accept-00001",DEADLINE)),
    }),denied("STALE_REVISION"));
    assert.deepEqual(intents(t.b).map(x=>x.signal.signal),["call_answered"]);
  });
});

test("media ready and participant hangup cannot both commit the same accepted revision",async()=>{
  await withTrial(async t=>{
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"cas-accept-for-media-0001")),
    }).next.phase,"accepted");
    assert.equal(stageSyntheticTransition(t.b,{
      origin:server(command("media_ready",1,"cas-media-ready-first-01",NOW+2000)),
    }).next.phase,"connected");
    assert.deepEqual(stageSyntheticTransition(t.a,{
      origin:client(CALLER,command("hangup",1,"cas-hangup-lost-000001",NOW+2000)),
    }),denied("STALE_REVISION"));
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(CALLER,command("hangup",2,"cas-hangup-next-000001",NOW+3000)),
    }).next.phase,"ended");
    assert.deepEqual(intents(t.b).map(x=>x.signal.signal),[
      "call_answered","call_connected","call_ended",
    ]);
    assert.deepEqual(intents(t.a).map(x=>x.revision),[1,2,3]);
    assert.equal(receipts(t.a).length,3);
  });
  await withTrial(async t=>{
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"cas-accept-for-end-00001")),
    }).next.phase,"accepted");
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("hangup",1,"cas-hangup-first-00001")),
    }).next.phase,"ended");
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:server(command("media_ready",1,"cas-media-ready-late-001")),
    }),denied("STALE_REVISION"));
    assert.equal(snapshot(t.b).phase,"ended");
    assert.deepEqual(intents(t.b).map(x=>x.signal.signal),[
      "call_answered","call_ended",
    ]);
  });
});

test("exact replay after later state change suppresses duplicate intent and receipt",async()=>{
  await withTrial(async t=>{
    const initial=command("accept",0,"cas-stable-replay-00001",NOW+1000);
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,initial),
    }).next.phase,"accepted");
    assert.equal(stageSyntheticTransition(t.b,{
      origin:server(command("media_ready",1,"cas-media-replay-00001",NOW+2000)),
    }).next.phase,"connected");
    assert.deepEqual(stageSyntheticTransition(t.a,{
      origin:client(WORKER,initial),
    }),{kind:"replay_suppressed"},"committed key is idempotent at newer revision");
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:client(WORKER,{...initial,event:"decline"}),
    }),denied("KEY_CONFLICT"),"changed event cannot hijack existing key");
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:client(WORKER,{...initial,nowMs:NOW+1001}),
    }),denied("KEY_CONFLICT"),"changed event timestamp cannot hijack key");
    assert.deepEqual(intents(t.a).map(x=>x.revision),[1,2]);
    assert.equal(receipts(t.b).length,2);
  });
});

test("client JSON cannot choose actor or forge trusted server timeout/media events",async()=>{
  await withTrial(async t=>{
    const base=command("accept",0,"cas-identity-guard-0001");
    for(const origin of [
      client(OTHER,base),
      client(CALLER,base),
    ]){
      assert.deepEqual(stageSyntheticTransition(t.a,{origin}),
        denied("NOT_PARTICIPANT"));
    }
    for(const origin of [
      client(WORKER,{...base,actorAccountId:WORKER}),
      client(WORKER,{...base,actorAccountId:null}),
      client(WORKER,command("ring_timeout",0,"cas-client-server-0001",DEADLINE)),
      client(CALLER,command("media_ready",0,"cas-client-media-00001")),
      client(null,base),
      server({...command("ring_timeout",0,"cas-server-forged-0001",DEADLINE),
        actorAccountId:null}),
      server(command("accept",0,"cas-server-accept-0001")),
    ]){
      assert.deepEqual(stageSyntheticTransition(t.b,{origin}),
        denied("UNTRUSTED_COMMAND"));
    }
    assert.equal(snapshot(t.a).revision,0);
    assert.deepEqual(intents(t.b),[]);
    assert.deepEqual(receipts(t.a),[]);
  });
});

test("SQLite write-lock serializes two local writers before the CAS and outbox",async()=>{
  await withTrial(async t=>{
    t.a.exec("BEGIN IMMEDIATE");
    try{
      assert.throws(()=>stageSyntheticTransition(t.b,{
        origin:client(CALLER,command("cancel",0,"cas-locked-cancel-001")),
      }),/database is locked|SQLITE_BUSY/i);
      assert.equal(snapshot(t.a).revision,0);
      assert.deepEqual(intents(t.a),[]);
    }finally{t.a.exec("ROLLBACK");}
    assert.equal(stageSyntheticTransition(t.b,{
      origin:client(WORKER,command("accept",0,"cas-after-unlock-001")),
    }).next.phase,"accepted");
    assert.deepEqual(stageSyntheticTransition(t.a,{
      origin:client(CALLER,command("cancel",0,"cas-after-commit-001")),
    }),denied("STALE_REVISION"));
    assert.equal(intents(t.a).length,1);
  });
});

test("crash after snapshot or receipt but before outbox rolls back all three rows",async()=>{
  for(const failure of ["failAfterState","failAfterReceipt"]){
    await withTrial(async t=>{
      const origin=client(WORKER,command("accept",0,"cas-injected-crash-001"));
      assert.throws(()=>stageSyntheticTransition(t.a,{
        origin,[failure]:true,
      }),/synthetic crash before (receipt|outbox) commit/);
      assert.equal(snapshot(t.b).phase,"ringing",failure);
      assert.equal(snapshot(t.b).revision,0,failure);
      assert.equal(receipts(t.b).length,0,failure);
      assert.equal(intents(t.b).length,0,failure);
      assert.equal(stageSyntheticTransition(t.b,{origin}).next.phase,"accepted");
      assert.equal(intents(t.a).length,1);
      assert.deepEqual(t.a.prepare("PRAGMA foreign_key_check").all(),[]);
    });
  }
});

test("idempotency is scoped to one call ID; no worker busy slot is invented",async()=>{
  await withTrial(async t=>{
    t.a.prepare(
      "INSERT INTO synthetic_lifecycle_calls VALUES(?,?,?)"
    ).run(NEXT_ID,0,JSON.stringify({...INITIAL,callId:NEXT_ID}));
    const first=stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"cas-shared-key-test-01")),
    });
    const second=stageSyntheticTransition(t.b,{
      callId:NEXT_ID,
      origin:client(WORKER,command("accept",0,"cas-shared-key-test-01")),
    });
    assert.equal(first.kind,"transition_only");
    assert.equal(second.kind,"transition_only");
    assert.equal(snapshot(t.a).phase,"accepted");
    assert.equal(snapshot(t.b,NEXT_ID).phase,"accepted");
    assert.equal(receipts(t.a).length,1);
    assert.equal(receipts(t.b,NEXT_ID).length,1);
    assert.equal(intents(t.a).length,1);
    assert.equal(intents(t.b,NEXT_ID).length,1);
    // This is deliberate evidence that a real M-005 worker busy lock
    // is NOT implemented, even with per-call atomic state transitions.
  });
});

test("corrupt local snapshot or receipt fails closed; no synthetic intent emitted",async()=>{
  await withTrial(async t=>{
    t.a.prepare(
      "UPDATE synthetic_lifecycle_calls SET snapshot_json=? WHERE call_id=?"
    ).run("{not-json",CALL_ID);
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:client(WORKER,command("accept")),
    }),denied("CORRUPT_LOCAL_FIXTURE"));
    assert.deepEqual(intents(t.a),[]);
    assert.equal(receipts(t.b).length,0);
  });
  await withTrial(async t=>{
    const cmd=command("accept",0,"cas-corrupt-receipt-01");
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,cmd),
    }).kind,"transition_only");
    t.a.prepare(
      "UPDATE synthetic_lifecycle_receipts SET receipt_json=? WHERE call_id=?"
    ).run("{not-json",CALL_ID);
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:client(WORKER,cmd),
    }),denied("CORRUPT_LOCAL_FIXTURE"));
    assert.deepEqual(intents(t.b).map(x=>x.revision),[1]);
  });
});

test("read-only local audit verifies exact contiguous UNSENT signal trace after races",async()=>{
  await withTrial(async t=>{
    const consistent={kind:"consistent_test_only"};
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.a),consistent,
      "empty ringing test fixture is internally consistent");
    const accept=command("accept",0,"audit-accept-key-000001",NOW+1000);
    const media=command("media_ready",1,"audit-media-key-000001",NOW+2000);
    const hangup=command("hangup",2,"audit-hangup-key-000001",NOW+3000);
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,accept),
    }).next.phase,"accepted");
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),consistent);
    assert.equal(stageSyntheticTransition(t.b,{
      origin:server(media),
    }).next.phase,"connected");
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.a),consistent);
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(CALLER,hangup),
    }).next.phase,"ended");
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),consistent);
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:client(WORKER,accept),
    }),{kind:"replay_suppressed"});
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.a),consistent);
    assert.deepEqual(intents(t.b).map(x=>x.revision),[1,2,3]);
  });
});

test("deleted UNSENT update causes fail-closed audit even when retry is suppressed",async()=>{
  await withTrial(async t=>{
    const accept=command("accept",0,"audit-missing-intent-001");
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,accept),
    }).kind,"transition_only");
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
      {kind:"consistent_test_only"});
    t.a.prepare(
      "DELETE FROM synthetic_lifecycle_outbox WHERE call_id=? AND revision=1"
    ).run(CALL_ID);
    assert.deepEqual(stageSyntheticTransition(t.b,{
      origin:client(WORKER,accept),
    }),{kind:"replay_suppressed"},
      "a prior idempotency receipt alone cannot reconstruct missing outbox");
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
      {kind:"withheld"},"no safe preview of incomplete signaling ledger");
    assert.equal(receipts(t.a).length,1);
    assert.equal(intents(t.a).length,0);
  });
});

test("tampered UNSENT signal contents, recipient role or revision withhold audit",async()=>{
  for(const mutate of [
    db=>db.prepare(
      "UPDATE synthetic_lifecycle_outbox SET signal_json=? WHERE call_id=?"
    ).run(JSON.stringify({
      kind:"intent_only",signal:"call_cancelled",
      recipientRole:"worker",revision:1,
    }),CALL_ID),
    db=>db.prepare(
      "UPDATE synthetic_lifecycle_outbox SET signal_json=? WHERE call_id=?"
    ).run(JSON.stringify({
      kind:"intent_only",signal:"call_answered",
      recipientRole:"both",revision:1,
    }),CALL_ID),
    db=>db.prepare(
      "UPDATE synthetic_lifecycle_outbox SET revision=2 WHERE call_id=?"
    ).run(CALL_ID),
    db=>db.prepare(
      "UPDATE synthetic_lifecycle_outbox SET signal_json=? WHERE call_id=?"
    ).run("{not-json",CALL_ID),
  ]){
    await withTrial(async t=>{
      assert.equal(stageSyntheticTransition(t.a,{
        origin:client(WORKER,command("accept",0,"audit-corrupt-signal-01")),
      }).kind,"transition_only");
      mutate(t.a);
      assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
        {kind:"withheld"});
    });
  }
});

test("receipt tampering is detected even when local snapshot and outbox look valid",async()=>{
  const mutations=[
    receipt=>({...receipt,actorAccountId:OTHER}),
    receipt=>({...receipt,event:"cancel"}),
    receipt=>({...receipt,nowMs:DEADLINE}),
    receipt=>({...receipt,result:{...receipt.result,callerAccountId:OTHER}}),
    receipt=>({...receipt,expectedRevision:2}),
  ];
  for(const alter of mutations){
    await withTrial(async t=>{
      assert.equal(stageSyntheticTransition(t.a,{
        origin:client(WORKER,command("accept",0,"audit-corrupt-receipt-01")),
      }).kind,"transition_only");
      const row=receipts(t.a)[0];
      t.a.prepare(
        "UPDATE synthetic_lifecycle_receipts SET receipt_json=? " +
        "WHERE call_id=? AND retry_key=?"
      ).run(JSON.stringify(alter(JSON.parse(row.receipt_json))),
        CALL_ID,row.retry_key);
      assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
        {kind:"withheld"});
    });
  }
  await withTrial(async t=>{
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"audit-different-key-01")),
    }).kind,"transition_only");
    t.a.prepare(
      "UPDATE synthetic_lifecycle_receipts SET retry_key=? WHERE call_id=?"
    ).run("audit-different-key-02",CALL_ID);
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
      {kind:"withheld"},"index key and receipt key must match");
  });
});

test("snapshot revision, phase and participant tampering are detected by replay",async()=>{
  for(const change of [
    {revision:0},
    {revision:2},
    {phase:"cancelled"},
    {workerAccountId:OTHER},
    {ringDeadlineMs:DEADLINE+1},
  ]){
    await withTrial(async t=>{
      assert.equal(stageSyntheticTransition(t.a,{
        origin:client(WORKER,command("accept",0,"audit-corrupt-state-01")),
      }).kind,"transition_only");
      const current=snapshot(t.a);
      t.a.prepare(
        "UPDATE synthetic_lifecycle_calls SET snapshot_json=? " +
        "WHERE call_id=?"
      ).run(JSON.stringify({...current,...change}),CALL_ID);
      assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
        {kind:"withheld"},JSON.stringify(change));
    });
  }
  await withTrial(async t=>{
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"audit-state-db-rev-01")),
    }).kind,"transition_only");
    t.a.prepare(
      "UPDATE synthetic_lifecycle_calls SET revision=2 WHERE call_id=?"
    ).run(CALL_ID);
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
      {kind:"withheld"},"stored CAS column disagrees with actual receipt chain");
  });
});

test("extra or missing local receipt/signal row fails closed without repair or send",async()=>{
  await withTrial(async t=>{
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"audit-extra-outbox-001")),
    }).kind,"transition_only");
    t.a.prepare(
      "INSERT INTO synthetic_lifecycle_outbox VALUES(?,?,?)"
    ).run(CALL_ID,2,JSON.stringify({
      kind:"intent_only",signal:"call_ended",recipientRole:"both",revision:2,
    }));
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
      {kind:"withheld"});
    assert.equal(intents(t.a).length,2,"audit must not delete, resend or repair");
  });
  await withTrial(async t=>{
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"audit-missing-receipt-01")),
    }).kind,"transition_only");
    t.a.prepare(
      "DELETE FROM synthetic_lifecycle_receipts WHERE call_id=?"
    ).run(CALL_ID);
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
      {kind:"withheld"});
    assert.equal(intents(t.a).length,1);
  });
});

test("ledger audit is scoped per call ID; another call's corruption stays isolated",async()=>{
  await withTrial(async t=>{
    t.a.prepare(
      "INSERT INTO synthetic_lifecycle_calls VALUES(?,?,?)"
    ).run(NEXT_ID,0,JSON.stringify({...INITIAL,callId:NEXT_ID}));
    const cmd=command("accept",0,"audit-same-key-both-001");
    assert.equal(stageSyntheticTransition(t.a,{
      origin:client(WORKER,cmd),
    }).kind,"transition_only");
    assert.equal(stageSyntheticTransition(t.b,{
      callId:NEXT_ID,origin:client(WORKER,cmd),
    }).kind,"transition_only");
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.a),
      {kind:"consistent_test_only"});
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b,{
      callId:NEXT_ID,
    }),{kind:"consistent_test_only"});
    t.a.prepare(
      "DELETE FROM synthetic_lifecycle_outbox WHERE call_id=?"
    ).run(NEXT_ID);
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.a),
      {kind:"consistent_test_only"});
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b,{
      callId:NEXT_ID,
    }),{kind:"withheld"});
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b,{
      callId:"call-local-unknown-00001",
    }),{kind:"withheld"});
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b,{
      callId:"wrong id",
    }),{kind:"withheld"});
  });
});

test("rollback leaves consistent journal; audit never creates or sends a signal",async()=>{
  await withTrial(async t=>{
    assert.throws(()=>stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept",0,"audit-failed-commit-001")),
      failAfterReceipt:true,
    }),/synthetic crash before outbox commit/);
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.b),
      {kind:"consistent_test_only"});
    assert.equal(snapshot(t.b).revision,0);
    assert.deepEqual(intents(t.b),[]);
    assert.deepEqual(receipts(t.b),[]);
    assert.equal(stageSyntheticTransition(t.b,{
      origin:client(WORKER,command("accept",0,"audit-failed-commit-001")),
    }).kind,"transition_only");
    assert.deepEqual(inspectSyntheticUnsentLifecycleLedger(t.a),
      {kind:"consistent_test_only"});
    assert.equal(intents(t.a).length,1);
    assert.deepEqual(t.a.prepare("PRAGMA foreign_key_check").all(),[]);
  });
});

test("fake transition journal never changes production D1 schema or stores phone/token fields",()=>{
  const production=openLocalDatabase();
  try{
    const names=production.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table'"
    ).all().map(row=>row.name);
    for(const fake of [
      "synthetic_lifecycle_calls","synthetic_lifecycle_receipts",
      "synthetic_lifecycle_outbox","agora_calls","rtc_channels","call_sessions",
    ])assert.equal(names.includes(fake),false,fake);
  }finally{production.db.close();}
  const t=openTrial();
  try{
    stageSyntheticTransition(t.a,{
      origin:client(WORKER,command("accept")),
    });
    const stored=JSON.stringify([
      ...t.a.prepare("SELECT * FROM synthetic_lifecycle_calls").all(),
      ...receipts(t.a),...intents(t.b),
    ]);
    for(const prohibited of [
      "phoneNumber","phone_number","tel:","providerToken",
      "agoraToken","deviceToken","channelName","rtcUid","recipientDevice",
    ])assert.equal(stored.includes(prohibited),false,prohibited);
    assert.equal(t.a.prepare(
      "SELECT COUNT(*) AS n FROM synthetic_lifecycle_outbox"
    ).get().n,1,"UNSENT logical intent only");
  }finally{t.close();}
});
