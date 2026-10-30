import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  deliverNotificationMessage, MAX_NOTIFICATION_ATTEMPTS,
  notificationRetryDelaySeconds, NOTIFICATION_PROVIDER_TIMEOUT_MS,
} from "../src/modules/notifications/delivery.ts";

const NOW = 1_800_000_000_000;
const job = {
  kind:"notification_delivery_v1",
  eventId:"event-synthetic-0001",
  recipientAccountId:"account-synthetic-0001",
  eventType:"synthetic_notice",
  createdAtMs:NOW-1000,
  expiresAtMs:NOW+60_000,
};
function queue(body=job,attempts=1) {
  const calls=[];
  return {body,attempts,calls,
    ack(){calls.push(["ack"]);},
    retry(options){calls.push(["retry",options.delaySeconds]);},
  };
}
function fixture(options={}) {
  // This is a disposable, actual SQLite atomic receipt ledger for TESTS ONLY.
  // No new production migration or identity/PII data is authorized here.
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE receipts(event_id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  let sends=0,checks=0;
  const dead=[];
  let currentEligibility=()=>{
    return {recipientActive:true,consentGranted:true,
      eventApprovedByPolicy:true,destinationApproved:true};
  };
  const deps={
    async eligibility(event){checks++;return currentEligibility(event);},
    receipts:{
      async acquire(id){
        const inserted=db.prepare("INSERT OR IGNORE INTO receipts VALUES(?,'claimed')").run(id);
        if(inserted.changes===1)return "acquired";
        const state=db.prepare("SELECT status FROM receipts WHERE event_id=?").get(id);
        return state.status==="completed"?"completed":"busy";
      },
      async markCompleted(id){
        db.prepare("UPDATE receipts SET status='completed' WHERE event_id=?").run(id);
      },
      async release(id){
        db.prepare("DELETE FROM receipts WHERE event_id=? AND status='claimed'").run(id);
      },
    },
    provider:{
      async send(event){sends++;return options.send?options.send(event):"accepted";},
    },
    deadLetters:{
      async record(id,reason){dead.push({id,reason});if(options.deadError)throw Error("PRIVATE_DLQ_ERROR");},
    },
  };
  return {db,deps,dead, get sends(){return sends;},
    get checks(){return checks;},
    setEligibility(fn){currentEligibility=fn;},
    rows(){return db.prepare("SELECT event_id AS id, status FROM receipts ORDER BY event_id")
      .all().map(row=>({...row}));},
  };
}

test("a consented approved synthetic message is sent once and a later replay is a no-op",async()=>{
  const f=fixture();
  try{
    const first=queue();
    assert.equal(await deliverNotificationMessage(first,f.deps,NOW),"delivered");
    assert.deepEqual(first.calls,[["ack"]]);
    assert.deepEqual(f.rows(),[{id:job.eventId,status:"completed"}]);
    const duplicate=queue();
    assert.equal(await deliverNotificationMessage(duplicate,f.deps,NOW),"duplicate");
    assert.deepEqual(duplicate.calls,[["ack"]]);
    assert.equal(f.sends,1);
    assert.equal(f.checks,2,"re-read current consent even on a completed receipt");
    assert.deepEqual(f.dead,[]);
  }finally{f.db.close();}
});

test("missing, revoked or nonboolean approval never calls provider or acquires receipts",async()=>{
  const f=fixture();
  try{
    for(const denied of [
      null, {}, {recipientActive:1,consentGranted:true,
        eventApprovedByPolicy:true,destinationApproved:true},
      {recipientActive:true,consentGranted:false,
        eventApprovedByPolicy:true,destinationApproved:true},
      {recipientActive:true,consentGranted:true,
        eventApprovedByPolicy:false,destinationApproved:true},
      {recipientActive:true,consentGranted:true,
        eventApprovedByPolicy:true,destinationApproved:false},
      {recipientActive:false,consentGranted:true,
        eventApprovedByPolicy:true,destinationApproved:true},
    ]) {
      f.setEligibility(()=>denied);
      const q=queue();
      assert.equal(await deliverNotificationMessage(q,f.deps,NOW),"rejected");
      assert.deepEqual(q.calls,[["ack"]]);
      assert.deepEqual(f.rows(),[]);
    }
    assert.equal(f.sends,0);
  }finally{f.db.close();}
});

test("malformed envelopes, forbidden private payload and expired jobs fail closed",async()=>{
  const f=fixture();
  try{
    const invalid=[
      null,false,[],{}, {...job,extra:"private-phone"},
      {...job,deviceToken:"sensitive"},
      {...job,recipientAccountId:"+91-0000000000"},
      {...job,kind:"unapproved"}, {...job,eventType:"other value"},
      {...job,eventId:"x"}, {...job,expiresAtMs:NOW-1},
      {...job,expiresAtMs:job.createdAtMs+24*3600*1000+1},
      {...job,createdAtMs:NOW+61_000},
      {...job,createdAtMs:1.5},
    ];
    for(const body of invalid){
      const q=queue(body);
      assert.equal(await deliverNotificationMessage(q,f.deps,NOW),"rejected");
      assert.deepEqual(q.calls,[["ack"]]);
    }
    for(const attempts of [-1,0,1.2,Number.POSITIVE_INFINITY]){
      const q=queue(job,attempts);
      assert.equal(await deliverNotificationMessage(q,f.deps,NOW),"rejected");
      assert.deepEqual(q.calls,[["ack"]]);
    }
    assert.equal(f.checks,0);
    assert.equal(f.sends,0);
    assert.deepEqual(f.rows(),[]);
  }finally{f.db.close();}
});

test("transient policy-source failure retries; source denial does not",async()=>{
  const f=fixture();
  try{
    f.setEligibility(()=>{throw Error("PRIVATE_POLICY_QUERY_ERROR");});
    const q=queue(job,2);
    assert.equal(await deliverNotificationMessage(q,f.deps,NOW),"retry");
    assert.deepEqual(q.calls,[["retry",10]]);
    f.setEligibility(()=>null);
    const p=queue();
    assert.equal(await deliverNotificationMessage(p,f.deps,NOW),"rejected");
    assert.deepEqual(p.calls,[["ack"]]);
    assert.equal(f.sends,0);
  }finally{f.db.close();}
});

test("provider transient and unknown results retry without marking a receipt",async()=>{
  for(const result of ["transient","unknown"]){
    const f=fixture({send:async()=>result});
    try{
      const q=queue();
      assert.equal(await deliverNotificationMessage(q,f.deps,NOW),"retry");
      assert.deepEqual(q.calls,[["retry",5]]);
      assert.deepEqual(f.rows(),[]);
      assert.equal(f.sends,1);
    }finally{f.db.close();}
  }
});

test("permanent provider refusal is dead-lettered before queue acknowledgement",async()=>{
  const f=fixture({send:async()=>"permanent"});
  try{
    const q=queue();
    assert.equal(await deliverNotificationMessage(q,f.deps,NOW),"dead_lettered");
    assert.deepEqual(f.dead,[{id:job.eventId,reason:"PERMANENT_FAILURE"}]);
    assert.deepEqual(q.calls,[["ack"]]);
    assert.deepEqual(f.rows(),[]);
  }finally{f.db.close();}
});

test("exhausted failures require a durable dead-letter write; audit outage retries",async()=>{
  for(const deadError of [false,true]){
    const f=fixture({send:async()=>"transient",deadError});
    try{
      const q=queue(job,MAX_NOTIFICATION_ATTEMPTS);
      const outcome=await deliverNotificationMessage(q,f.deps,NOW);
      assert.equal(outcome,deadError?"retry":"dead_lettered");
      assert.deepEqual(q.calls,deadError?[["retry",80]]:[["ack"]]);
      assert.deepEqual(f.dead,[{id:job.eventId,reason:"RETRIES_EXHAUSTED"}]);
      assert.deepEqual(f.rows(),[]);
    }finally{f.db.close();}
  }
});

test("concurrent queue duplicates cannot acquire same atomic SQLite claim",async()=>{
  const f=fixture({send:async()=>new Promise(resolve=>setTimeout(()=>resolve("accepted"),10))});
  try{
    const a=queue(),b=queue();
    const results=await Promise.all([
      deliverNotificationMessage(a,f.deps,NOW),
      deliverNotificationMessage(b,f.deps,NOW),
    ]);
    assert.deepEqual(results.sort(),["delivered","retry"]);
    assert.equal(f.sends,1);
    assert.deepEqual(f.rows(),[{id:job.eventId,status:"completed"}]);
    assert.equal(await deliverNotificationMessage(queue(),f.deps,NOW),"duplicate");
  }finally{f.db.close();}
});

test("a stalled sender is bounded, released and retried; no false success",async()=>{
  const f=fixture({send:async()=>new Promise(()=>{})});
  try{
    const q=queue();
    assert.equal(await deliverNotificationMessage(q,f.deps,NOW,10),"retry");
    assert.deepEqual(q.calls,[["retry",5]]);
    assert.deepEqual(f.rows(),[]);
    assert.equal(f.sends,1);
    assert.equal(NOTIFICATION_PROVIDER_TIMEOUT_MS,5000);
  }finally{f.db.close();}
});

test("expired-before-next-retry is acknowledged rather than keeping a stale job",async()=>{
  const f=fixture({send:async()=>"transient"});
  try {
    const expiring=queue({...job,expiresAtMs:NOW+2000});
    assert.equal(await deliverNotificationMessage(expiring,f.deps,NOW),"rejected");
    assert.deepEqual(expiring.calls,[["ack"]]);
    assert.deepEqual(f.rows(),[]);
    assert.equal(f.sends,1);
    assert.deepEqual(f.dead,[]);
  }finally{f.db.close();}
});

test("bounded retry backoff is deterministic and never trusts a payload counter",()=>{
  assert.equal(notificationRetryDelaySeconds(1),5);
  assert.equal(notificationRetryDelaySeconds(2),10);
  assert.equal(notificationRetryDelaySeconds(3),20);
  assert.equal(notificationRetryDelaySeconds(4),40);
  assert.equal(notificationRetryDelaySeconds(5),80);
  assert.equal(notificationRetryDelaySeconds(100000),300);
  assert.equal(notificationRetryDelaySeconds(-1),5);
});
