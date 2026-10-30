import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../src/index.ts";
import { decideRequestTransition } from "../src/modules/interactions/request-contract.ts";

/**
 * LOCAL-ONLY, DISPOSABLE synthetic SQLite rehearsal.
 * This is NOT a migration, D1 production transaction implementation or
 * approval of the invented test states. Temporary files are always deleted.
 */
const policy=Object.freeze({
  prepared: Object.freeze(["submitted"]),
  submitted: Object.freeze(["reviewed", "cancelled"]),
  reviewed: Object.freeze([]),
  cancelled: Object.freeze([]),
});
const owner="account-owner1", secondOwner="account-other2";
const requestId="request-00001", secondRequestId="request-00002";
const key1="retrykey-00000001", key2="retrykey-00000002", key3="retrykey-00000003";
const command=(idempotencyKey=key1, expectedRevision=0, toState="submitted", actorAccountId=owner)=>
  ({actorAccountId,expectedRevision,idempotencyKey,toState});

function openTrial() {
  const dir=mkdtempSync(join(tmpdir(),"jodlo-contract-only-"));
  const filename=join(dir,"disposable.sqlite");
  const a=new DatabaseSync(filename), b=new DatabaseSync(filename);
  try {
    a.exec("PRAGMA journal_mode=WAL");
    a.exec("PRAGMA busy_timeout=0");
    b.exec("PRAGMA busy_timeout=0");
    a.exec(`
      CREATE TABLE synthetic_request (
        request_id TEXT PRIMARY KEY,
        owner_account_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        state TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 0)
      );
      CREATE TABLE synthetic_receipt (
        request_id TEXT NOT NULL,
        retry_key TEXT NOT NULL,
        actor_account_id TEXT NOT NULL,
        expected_revision INTEGER NOT NULL,
        to_state TEXT NOT NULL,
        result_state TEXT NOT NULL,
        result_revision INTEGER NOT NULL,
        owner_account_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        PRIMARY KEY(request_id,retry_key),
        FOREIGN KEY(request_id) REFERENCES synthetic_request(request_id)
      );
    `);
    a.exec("PRAGMA foreign_keys=ON");
    b.exec("PRAGMA foreign_keys=ON");
    const insert=a.prepare(
      "INSERT INTO synthetic_request VALUES (?,?,?,?,?)");
    insert.run(requestId,owner,"category1","prepared",0);
    insert.run(secondRequestId,secondOwner,"category1","prepared",0);
  } catch(e) {
    a.close();b.close();rmSync(dir,{recursive:true,force:true});
    throw e;
  }
  function close() {
    a.close();b.close();
    rmSync(dir,{recursive:true,force:true});
  }
  return {a,b,close};
}

const row=(db,id=requestId)=>db.prepare(
  "SELECT request_id,owner_account_id,category_id,state,revision FROM synthetic_request WHERE request_id=?")
  .get(id);

const receipts=(db,id=requestId)=>db.prepare(
  "SELECT * FROM synthetic_receipt WHERE request_id=? ORDER BY retry_key").all(id);

function dispatch(db,cmd,{id=requestId,failAfterUpdate=false}={}) {
  // BEGIN IMMEDIATE serializes the write attempt with a second SQLite
  // connection and prevents a stale read-before-write TOCTOU window locally.
  db.exec("BEGIN IMMEDIATE");
  try {
    const currentRow=row(db,id);
    assert.ok(currentRow);
    const current={
      requestId:currentRow.request_id,
      ownerAccountId:currentRow.owner_account_id,
      categoryId:currentRow.category_id,
      state:currentRow.state,
      revision:currentRow.revision,
    };
    const saved=db.prepare(
      "SELECT * FROM synthetic_receipt WHERE request_id=? AND retry_key=?")
      .get(id,cmd.idempotencyKey);
    const priorReceipt=saved ? {
      requestId:saved.request_id,
      actorAccountId:saved.actor_account_id,
      idempotencyKey:saved.retry_key,
      expectedRevision:saved.expected_revision,
      toState:saved.to_state,
      result:{
        requestId:saved.request_id,ownerAccountId:saved.owner_account_id,
        categoryId:saved.category_id,state:saved.result_state,
        revision:saved.result_revision,
      },
    } : null;
    const decision=decideRequestTransition(current,cmd,policy,priorReceipt);
    if (decision.kind==="apply") {
      const changed=db.prepare(
        "UPDATE synthetic_request SET state=?,revision=? " +
        "WHERE request_id=? AND owner_account_id=? AND revision=?")
        .run(decision.result.state,decision.result.revision,
          current.requestId,cmd.actorAccountId,cmd.expectedRevision);
      assert.equal(changed.changes,1,"atomic compare-and-swap must update exactly one row");
      if(failAfterUpdate) throw Error("synthetic failure before receipt commit");
      db.prepare(
        "INSERT INTO synthetic_receipt VALUES (?,?,?,?,?,?,?,?,?)")
        .run(current.requestId,cmd.idempotencyKey,cmd.actorAccountId,
          cmd.expectedRevision,cmd.toState,decision.result.state,
          decision.result.revision,current.ownerAccountId,current.categoryId);
    }
    db.exec("COMMIT");
    return decision;
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("SQLite CAS and unique receipt: retry replays without duplicate row",()=>{
  const t=openTrial();
  try {
    const applied=dispatch(t.a,command());
    assert.equal(applied.kind,"apply");
    assert.equal(row(t.b).revision,1);
    assert.equal(receipts(t.b).length,1);
    const replay=dispatch(t.b,command());
    assert.equal(replay.kind,"replay");
    assert.deepEqual(replay.receipt,applied.receipt);
    assert.equal(receipts(t.a).length,1);
    assert.equal(row(t.a).revision,1);
    assert.deepEqual(t.a.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally {t.close();}
});

test("different retry keys with stale revision cannot double-apply",()=>{
  const t=openTrial();
  try {
    assert.equal(dispatch(t.a,command()).kind,"apply");
    assert.deepEqual(dispatch(t.b,command(key2)),
      {kind:"reject",code:"STALE_REVISION"});
    assert.equal(row(t.b).revision,1);
    assert.equal(receipts(t.b).length,1);
    assert.equal(dispatch(t.b,command(key3,1,"reviewed")).kind,"apply");
    assert.equal(row(t.a).revision,2);
    assert.equal(dispatch(t.a,command()).kind,"replay");
    assert.equal(receipts(t.a).length,2);
  } finally {t.close();}
});

test("composite retry-key scope isolates separate customer requests",()=>{
  const t=openTrial();
  try {
    assert.equal(dispatch(t.a,command()).kind,"apply");
    assert.equal(dispatch(t.b,command(key1,0,"submitted",secondOwner),
      {id:secondRequestId}).kind,"apply");
    assert.equal(row(t.a).revision,1);
    assert.equal(row(t.b,secondRequestId).revision,1);
    assert.equal(receipts(t.a).length,1);
    assert.equal(receipts(t.b,secondRequestId).length,1);
    assert.deepEqual(dispatch(t.a,command(key1,0,"cancelled")),
      {kind:"reject",code:"KEY_CONFLICT"});
    assert.equal(receipts(t.a).length,1);
  } finally {t.close();}
});

test("failed receipt insert rolls back update; genuine retry later succeeds",()=>{
  const t=openTrial();
  try {
    assert.throws(()=>dispatch(t.a,command(),{failAfterUpdate:true}),
      /synthetic failure/);
    assert.equal(row(t.b).state,"prepared");
    assert.equal(row(t.b).revision,0);
    assert.deepEqual(receipts(t.b),[]);
    assert.equal(dispatch(t.b,command()).kind,"apply");
    assert.equal(row(t.a).revision,1);
    assert.equal(receipts(t.a).length,1);
  } finally {t.close();}
});

test("distinct SQLite connections: concurrent competing writer is locked out, then stale",()=>{
  const t=openTrial();
  try {
    t.a.exec("BEGIN IMMEDIATE");
    try {
      // A second independent connection can't read-then-commit an
      // interleaving write while A holds the reserved write transaction.
      assert.throws(()=>dispatch(t.b,command(key2)),/database is locked|SQLITE_BUSY/i);
      const changed=t.a.prepare(
        "UPDATE synthetic_request SET revision=revision+1,state='submitted' "+
        "WHERE request_id=? AND revision=0").run(requestId);
      assert.equal(changed.changes,1);
      t.a.exec("COMMIT");
    } catch(e) {
      t.a.exec("ROLLBACK");
      throw e;
    }
    // A different retry key from a stale client must now be denied.
    assert.deepEqual(dispatch(t.b,command(key2)),
      {kind:"reject",code:"STALE_REVISION"});
    assert.equal(row(t.a).revision,1);
    assert.equal(receipts(t.a).length,0);
  } finally {t.close();}
});

test("fresh server-owner state takes precedence over old preview and prior retry",()=>{
  const t=openTrial();
  try {
    const initial={...row(t.a)};
    assert.equal(initial.owner_account_id,owner);
    const first=dispatch(t.a,command());
    assert.equal(first.kind,"apply");
    t.a.prepare("UPDATE synthetic_request SET owner_account_id=? WHERE request_id=?")
      .run(secondOwner,requestId);
    assert.deepEqual(dispatch(t.b,command()),{kind:"reject",code:"NOT_OWNER"});
    assert.equal(row(t.a).owner_account_id,secondOwner);
    assert.equal(row(t.a).revision,1);
    assert.equal(receipts(t.a).length,1);
  } finally {t.close();}
});

test("corrupt future receipt cannot replay against an earlier revision",()=>{
  const t=openTrial();
  try {
    assert.equal(dispatch(t.a,command()).kind,"apply");
    // Disposable database simulates a broken restore ordering/partial rollback.
    t.a.prepare("UPDATE synthetic_request SET revision=0,state='prepared' WHERE request_id=?")
      .run(requestId);
    assert.deepEqual(dispatch(t.b,command()),
      {kind:"reject",code:"KEY_CONFLICT"});
    assert.equal(row(t.a).revision,0);
    assert.equal(receipts(t.a).length,1);
  } finally {t.close();}
});

test("test journal creates no public request, worker, location or calling API",async()=>{
  const t=openTrial();
  try {
    const response=await worker.fetch(new Request(
      "https://jodlo.rekixo.com/api/v1/requests",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({idempotencyKey:key1,accountId:owner}),
      }));
    assert.equal(response.status,404);
    for(const path of ["/api/v1/workers","/api/v1/areas","/api/v1/calls"]) {
      const result=await worker.fetch(new Request("https://jodlo.rekixo.com"+path));
      assert.equal(result.status,404);
    }
    assert.equal(receipts(t.a).length,0);
  } finally {t.close();}
});

test("same-revision state divergence rejects persisted retry without mutating journal",()=>{
  const t=openTrial();
  try {
    assert.equal(dispatch(t.a,command()).kind,"apply");
    // Simulate a non-CAS repair/import that changed state without incrementing
    // the version. The older successful receipt must not be reused as-is.
    t.a.prepare("UPDATE synthetic_request SET state='cancelled' WHERE request_id=?")
      .run(requestId);
    const previous=receipts(t.a);
    assert.deepEqual(dispatch(t.b,command()),
      {kind:"reject",code:"KEY_CONFLICT"});
    assert.equal(row(t.a).state,"cancelled");
    assert.equal(row(t.a).revision,1);
    assert.deepEqual(receipts(t.b),previous);
  } finally {t.close();}
});

test("malformed stored receipt state cannot replay or add a new journal row",()=>{
  const t=openTrial();
  try {
    assert.equal(dispatch(t.a,command()).kind,"apply");
    t.a.prepare("UPDATE synthetic_receipt SET result_state='__invalid__' "+
      "WHERE request_id=? AND retry_key=?").run(requestId,key1);
    const before=receipts(t.b);
    assert.deepEqual(dispatch(t.b,command()),
      {kind:"reject",code:"KEY_CONFLICT"});
    assert.equal(row(t.a).revision,1);
    assert.equal(row(t.b).state,"submitted");
    assert.deepEqual(receipts(t.a),before);
  } finally {t.close();}
});
