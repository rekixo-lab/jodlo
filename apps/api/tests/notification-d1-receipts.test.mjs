import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localD1Adapter, openLocalDatabase } from "./helpers/local-db.mjs";
import {
  makeD1NotificationReceiptStore, NOTIFICATION_CLAIM_LEASE_MS,
} from "../src/modules/notifications/d1-receipts.ts";
import { deliverNotificationMessage } from "../src/modules/notifications/delivery.ts";

const NOW = 1_800_000_000_000;
const EVENT = "synthetic-notification-event-0001";
const OTHER = "synthetic-notification-event-0002";

function fileFixture() {
  const dir = mkdtempSync(join(tmpdir(), "jodlo-notification-claims-"));
  const path = join(dir, "claims.sqlite");
  const dbA = new DatabaseSync(path);
  // The actual new migration, no copy/paste or remote Cloudflare database.
  dbA.exec(readFileSync(
    new URL("../../../infra/migrations/0005_notification_delivery_receipts.sql", import.meta.url),
    "utf8",
  ));
  dbA.exec("PRAGMA busy_timeout = 1000");
  const dbB = new DatabaseSync(path);
  dbB.exec("PRAGMA busy_timeout = 1000");
  let now = NOW;
  const clock = () => now;
  const a = makeD1NotificationReceiptStore(localD1Adapter(dbA), clock);
  const b = makeD1NotificationReceiptStore(localD1Adapter(dbB), clock);
  return {
    a, b, dbA, dbB, path,
    advance(ms){now += ms;},
    close(){dbB.close();dbA.close();rmSync(dir,{recursive:true,force:true});},
    row(event=EVENT){const x=dbA.prepare(
      "SELECT event_id,state,claim_token,lease_until_ms,completed_at_ms " +
      "FROM notification_delivery_receipts WHERE event_id=?"
    ).get(event);return x?{...x}:null;},
  };
}

test("versioned 0005 migration is in normal disposable local D1 and stores no recipient/token/content",()=>{
  const {db}=openLocalDatabase();
  try {
    const columns=db.prepare("PRAGMA table_info(notification_delivery_receipts)").all()
      .map(x=>x.name);
    assert.deepEqual(columns,[
      "event_id","state","claim_token","lease_until_ms","completed_at_ms",
    ]);
    for(const field of ["recipient_account_id","device_token","body","phone","gps","category_id"]) {
      assert.equal(columns.includes(field),false,field);
    }
    assert.throws(()=>db.prepare(
      "INSERT INTO notification_delivery_receipts(event_id,state,claim_token,lease_until_ms)" +
      "VALUES(?,'sent',?,?)"
    ).run(EVENT,"claim-12345678",NOW),/CHECK constraint failed/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notification_delivery_receipts").get().n,0);
  }finally{db.close();}
});

test("two independent file-backed D1 handles atomically race for a single lease",async()=>{
  const f=fileFixture();
  try{
    const results=await Promise.all([f.a.acquire(EVENT),f.b.acquire(EVENT)]);
    const winner=results.find(x=>x.state==="acquired");
    assert.ok(winner);
    assert.equal(results.filter(x=>x.state==="acquired").length,1);
    assert.equal(results.filter(x=>x.state==="busy").length,1);
    assert.match(winner.claimToken,/^[0-9a-f-]{36}$/);
    assert.equal(f.row().state,"claimed");
    assert.equal(f.row().lease_until_ms,NOW+NOTIFICATION_CLAIM_LEASE_MS);
    assert.equal(f.row().claim_token,winner.claimToken);
    const owner=results[0].state==="acquired"?f.a:f.b;
    await owner.markCompleted(EVENT,winner.claimToken);
    assert.deepEqual(await f.a.acquire(EVENT),{state:"completed"});
    assert.deepEqual(await f.b.acquire(EVENT),{state:"completed"});
    assert.equal(f.row().claim_token,null);
    assert.equal(f.row().lease_until_ms,null);
    assert.equal(f.row().completed_at_ms,NOW);
  }finally{f.close();}
});

test("expired crashed claim is reclaimed; old owner cannot complete or release new claim",async()=>{
  const f=fileFixture();
  try{
    const old=await f.a.acquire(EVENT);
    assert.equal(old.state,"acquired");
    f.advance(NOTIFICATION_CLAIM_LEASE_MS);
    const fresh=await f.b.acquire(EVENT);
    assert.equal(fresh.state,"acquired");
    assert.notEqual(fresh.claimToken,old.claimToken);
    assert.equal(f.row().claim_token,fresh.claimToken);
    await assert.rejects(()=>f.a.markCompleted(EVENT,old.claimToken),/expired or reassigned/);
    await f.a.release(EVENT,old.claimToken);
    assert.equal(f.row().claim_token,fresh.claimToken);
    assert.deepEqual(await f.a.acquire(EVENT),{state:"busy"});
    await f.b.markCompleted(EVENT,fresh.claimToken);
    assert.equal(f.row().state,"completed");
    await f.a.release(EVENT,old.claimToken);
    assert.equal(f.row().state,"completed");
    assert.deepEqual(await f.a.acquire(EVENT),{state:"completed"});
  }finally{f.close();}
});

test("an expired lease cannot complete even before takeover and its release allows recovery",async()=>{
  const f=fileFixture();
  try{
    const claim=await f.a.acquire(EVENT);
    assert.equal(claim.state,"acquired");
    f.advance(NOTIFICATION_CLAIM_LEASE_MS);
    await assert.rejects(()=>f.a.markCompleted(EVENT,claim.claimToken),/expired or reassigned/);
    await f.a.release(EVENT,claim.claimToken);
    assert.equal(f.row(),null);
    const next=await f.b.acquire(EVENT);
    assert.equal(next.state,"acquired");
    await f.b.markCompleted(EVENT,next.claimToken);
    assert.equal(f.row().state,"completed");
  }finally{f.close();}
});

test("stale or forged release cannot delete another live claim and events are isolated",async()=>{
  const f=fileFixture();
  try{
    const first=await f.a.acquire(EVENT);
    const other=await f.b.acquire(OTHER);
    assert.equal(first.state,"acquired");
    assert.equal(other.state,"acquired");
    await f.a.release(EVENT,"incorrect-claim-token-0000");
    assert.equal(f.row().claim_token,first.claimToken);
    await f.a.release(OTHER,first.claimToken);
    assert.equal(f.row(OTHER).claim_token,other.claimToken);
    await f.a.release(EVENT,first.claimToken);
    assert.equal(f.row(),null);
    assert.equal(f.row(OTHER).state,"claimed");
    await f.b.markCompleted(OTHER,other.claimToken);
    assert.deepEqual(await f.a.acquire(OTHER),{state:"completed"});
    assert.equal((await f.a.acquire(EVENT)).state,"acquired");
  }finally{f.close();}
});

test("completed receipt survives close/reopen and cannot be claimed after arbitrary time",async()=>{
  const f=fileFixture();
  try{
    const claim=await f.a.acquire(EVENT);
    await f.a.markCompleted(EVENT,claim.claimToken);
    f.advance(60*60*1000);
    f.dbB.close();
    const reopened = new DatabaseSync(f.path);
    try{
      const store = makeD1NotificationReceiptStore(localD1Adapter(reopened),()=>NOW+60*60*1000);
      assert.deepEqual(await store.acquire(EVENT),{state:"completed"});
      assert.equal(f.row().state,"completed");
    }finally{reopened.close();}
    // Mark closed already, avoid closing the handle a second time.
    f.dbB=new DatabaseSync(f.path);
  }finally{f.close();}
});

test("delivery engine cannot acknowledge old provider success after lease was stolen",async()=>{
  const f=fileFixture();
  try{
    let sends=0;
    let newClaim=null;
    const q={body:{
      kind:"notification_delivery_v1",eventId:EVENT,
      recipientAccountId:"synthetic-receiver-0001",eventType:"synthetic_notice",
      createdAtMs:NOW-1000,expiresAtMs:NOW+60_000,
    },attempts:1,calls:[],ack(){this.calls.push("ack");},
    retry({delaySeconds}){this.calls.push("retry:"+delaySeconds);}};
    const deps={
      receipts:f.a,
      eligibility:async()=>({recipientActive:true,consentGranted:true,
        eventApprovedByPolicy:true,destinationApproved:true}),
      provider:{async send(){
        sends++;
        // Pretend the first worker is stalled while another takes its expired
        // lease. The original provider may have accepted; we must not ack.
        f.advance(NOTIFICATION_CLAIM_LEASE_MS);
        newClaim=await f.b.acquire(EVENT);
        return "accepted";
      }},
      deadLetters:{async record(){throw Error("should never dead letter");}},
    };
    assert.equal(await deliverNotificationMessage(q,deps,NOW),"retry");
    assert.deepEqual(q.calls,["retry:5"]);
    assert.equal(sends,1);
    assert.equal(newClaim.state,"acquired");
    assert.equal(f.row().claim_token,newClaim.claimToken);
    await f.b.markCompleted(EVENT,newClaim.claimToken);
    const replay={...q,calls:[],ack(){this.calls.push("ack");},
      retry({delaySeconds}){this.calls.push("retry:"+delaySeconds);}};
    assert.equal(await deliverNotificationMessage(replay,deps,NOW),"duplicate");
    assert.deepEqual(replay.calls,["ack"]);
    assert.equal(sends,1);
  }finally{f.close();}
});

test("invalid ID or broken clock cannot acquire or modify D1 rows",async()=>{
  const f=fileFixture();
  try {
    await assert.rejects(()=>f.a.acquire("x"),/Invalid event ID/);
    await assert.rejects(()=>f.a.release(EVENT,""),/Invalid notification claim/);
    await assert.rejects(()=>f.a.markCompleted(EVENT,""),/Invalid notification claim/);
    const invalid=makeD1NotificationReceiptStore(localD1Adapter(f.dbA),()=>Number.NaN);
    await assert.rejects(()=>invalid.acquire(EVENT),/Invalid notification lease clock/);
    assert.equal(f.row(),null);
  }finally{f.close();}
});
