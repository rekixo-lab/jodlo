import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localD1Adapter, openLocalDatabase } from "./helpers/local-db.mjs";
import { makeD1NotificationDeadLetters } from "../src/modules/notifications/d1-dead-letters.ts";
import { deliverNotificationMessage, MAX_NOTIFICATION_ATTEMPTS } from "../src/modules/notifications/delivery.ts";

const NOW = 1_800_000_000_000;
const EVENT = "synthetic-deadletter-event-0001";
function row(db,eventId=EVENT) {
  const r=db.prepare("SELECT event_id,reason,recorded_at_ms FROM notification_delivery_dead_letters WHERE event_id=?").get(eventId);
  return r ? {...r} : null;
}
function fileFixture(){
  const dir=mkdtempSync(join(tmpdir(),"jodlo-deadletters-"));
  const path=join(dir,"letters.sqlite");
  const aDb=new DatabaseSync(path);
  aDb.exec(readFileSync(new URL("../../../infra/migrations/0006_notification_dead_letters.sql",import.meta.url),"utf8"));
  aDb.exec("PRAGMA busy_timeout=1000");
  const bDb=new DatabaseSync(path);
  bDb.exec("PRAGMA busy_timeout=1000");
  return {aDb,bDb,path,
    a:makeD1NotificationDeadLetters(localD1Adapter(aDb),()=>NOW),
    b:makeD1NotificationDeadLetters(localD1Adapter(bDb),()=>NOW+1000),
    close(){bDb.close();aDb.close();rmSync(dir,{recursive:true,force:true});}};
}

test("0006 is a migrated machine-only dead-letter schema with bounded reason and timestamp",()=>{
  const {db}=openLocalDatabase();
  try {
    const names=db.prepare("PRAGMA table_info(notification_delivery_dead_letters)").all().map(x=>x.name);
    assert.deepEqual(names,["event_id","reason","recorded_at_ms"]);
    for(const sensitive of ["recipient_account_id","device_token","payload","body","phone","google_sub","location"]) {
      assert.equal(names.includes(sensitive),false,sensitive);
    }
    assert.throws(()=>db.prepare(
      "INSERT INTO notification_delivery_dead_letters(event_id,reason,recorded_at_ms) VALUES(?,?,?)"
    ).run(EVENT,"FAILED_PRIVATE",NOW),/CHECK constraint/);
    assert.throws(()=>db.prepare(
      "INSERT INTO notification_delivery_dead_letters(event_id,reason,recorded_at_ms) VALUES(?,?,?)"
    ).run(EVENT,"PERMANENT_FAILURE",-1),/CHECK constraint/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notification_delivery_dead_letters").get().n,0);
  }finally{db.close();}
});

test("independent file-backed D1 writers agree on first immutable dead-letter record",async()=>{
  const f=fileFixture();
  try{
    await Promise.all([
      f.a.record(EVENT,"PERMANENT_FAILURE"),
      f.b.record(EVENT,"RETRIES_EXHAUSTED"),
    ]);
    const first=row(f.aDb);
    assert.equal(first.event_id,EVENT);
    assert.ok(["PERMANENT_FAILURE","RETRIES_EXHAUSTED"].includes(first.reason));
    assert.ok([NOW,NOW+1000].includes(first.recorded_at_ms));
    assert.equal(f.aDb.prepare("SELECT COUNT(*) n FROM notification_delivery_dead_letters").get().n,1);
    await f.b.record(EVENT,"RETRIES_EXHAUSTED");
    await f.a.record(EVENT,"PERMANENT_FAILURE");
    assert.deepEqual(row(f.bDb),first,"retry cannot overwrite original reason/timestamp");
  }finally{f.close();}
});

test("record persists across independent file database reopen and isolates other events",async()=>{
  const f=fileFixture();
  try{
    await f.a.record(EVENT,"PERMANENT_FAILURE");
    await f.b.record("synthetic-deadletter-event-0002","RETRIES_EXHAUSTED");
    const reopened=new DatabaseSync(f.path);
    try{
      assert.deepEqual(row(reopened),{event_id:EVENT,reason:"PERMANENT_FAILURE",recorded_at_ms:NOW});
      assert.equal(reopened.prepare("SELECT COUNT(*) n FROM notification_delivery_dead_letters").get().n,2);
    }finally{reopened.close();}
  }finally{f.close();}
});

test("invalid event, invalid reason, broken clock and unconfirmed write never pass",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    const store=makeD1NotificationDeadLetters(adapter,()=>NOW);
    await assert.rejects(()=>store.record("bad id","PERMANENT_FAILURE"),/Invalid notification dead letter/);
    await assert.rejects(()=>store.record(EVENT,"OTHER_FAILURE"),/Invalid notification dead letter/);
    await assert.rejects(()=>makeD1NotificationDeadLetters(adapter,()=>Number.NaN)
      .record(EVENT,"PERMANENT_FAILURE"),/Invalid notification dead-letter clock/);
    await assert.rejects(()=>makeD1NotificationDeadLetters(adapter,()=>-1)
      .record(EVENT,"PERMANENT_FAILURE"),/Invalid notification dead-letter clock/);
    const fake={prepare(){return{bind(){return this;},async run(){return{meta:{changes:2}};}}}};
    await assert.rejects(()=>makeD1NotificationDeadLetters(fake,()=>NOW)
      .record(EVENT,"PERMANENT_FAILURE"),/write unconfirmed/);
    assert.equal(row(db),null);
  }finally{db.close();}
});

test("real delivery core persists a permanent failure before acknowledging, including duplicate retry",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    let sends=0;
    const q=()=>({body:{
      kind:"notification_delivery_v1",eventId:EVENT,recipientAccountId:"synthetic-account-0001",
      eventType:"synthetic_notice",createdAtMs:NOW-1000,expiresAtMs:NOW+60_000,
    },attempts:MAX_NOTIFICATION_ATTEMPTS,calls:[],
    ack(){this.calls.push("ack");},retry(){this.calls.push("retry");}});
    const deps={
      eligibility:async()=>({recipientActive:true,consentGranted:true,eventApprovedByPolicy:true,destinationApproved:true}),
      receipts:{async acquire(){return{state:"acquired",claimToken:"synthetic-claim-token"};},
        async release(){},async markCompleted(){throw Error("not delivered");}},
      provider:{async send(){sends++;return"permanent";}},
      deadLetters:makeD1NotificationDeadLetters(adapter,()=>NOW),
    };
    for(let i=0;i<2;i++){
      const msg=q();
      assert.equal(await deliverNotificationMessage(msg,deps,NOW),"dead_lettered");
      assert.deepEqual(msg.calls,["ack"]);
    }
    assert.equal(sends,2);
    assert.deepEqual(row(db),{event_id:EVENT,reason:"PERMANENT_FAILURE",recorded_at_ms:NOW});
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notification_delivery_dead_letters").get().n,1);
  }finally{db.close();}
});

test("dead-letter D1 failure retries and never acknowledges the exhausted message",async()=>{
  const {db}=openLocalDatabase();
  try{
    db.exec("DROP TABLE notification_delivery_dead_letters");
    const msg={body:{
      kind:"notification_delivery_v1",eventId:EVENT,recipientAccountId:"synthetic-account-0001",
      eventType:"synthetic_notice",createdAtMs:NOW-1000,expiresAtMs:NOW+60_000,
    },attempts:MAX_NOTIFICATION_ATTEMPTS,calls:[],
    ack(){this.calls.push("ack");},retry({delaySeconds}){this.calls.push("retry:"+delaySeconds);}};
    const deps={
      eligibility:async()=>{throw Error("synthetic unavailable source");},
      receipts:{async acquire(){throw Error("should not acquire");},
        async release(){},async markCompleted(){}},
      provider:{async send(){throw Error("should not send");}},
      deadLetters:makeD1NotificationDeadLetters(localD1Adapter(db),()=>NOW),
    };
    assert.equal(await deliverNotificationMessage(msg,deps,NOW),"retry");
    assert.deepEqual(msg.calls,["retry:80"]);
  }finally{db.close();}
});
