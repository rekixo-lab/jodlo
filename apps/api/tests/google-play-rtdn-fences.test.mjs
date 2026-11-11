import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { readOwnCallCreditBalance } from "../src/modules/interactions/private-call-credits.ts";
import { jodloPlayPurchaseFingerprint } from
  "../src/modules/interactions/google-play-purchase-preflight.ts";
import {
  decodeUntrustedJodloRtdnHint, recordTrustedPlayRevocation,
  isPlayPurchaseRevoked,
} from "../src/modules/interactions/google-play-rtdn-fences.ts";
import {
  stageTrustedPlayConsumable, claimPlayConsumeOnce, deliverClaimedPlayConsume,
  reconcileUnknownPlayConsume, quarantineExpiredPlayConsume,
} from "../src/modules/interactions/play-consumable-outbox.ts";

const ACCOUNT = "rtdn-owner";
const OTHER = "rtdn-foreign";
const TOKEN = "synthetic.jodlo.play-rtdn-token-001";
const OTHER_TOKEN = "synthetic.jodlo.play-rtdn-token-002";
const PRODUCT = "jodlo.testpack5";
const APPROVED = new Map([[PRODUCT,5]]);
const NOW = Date.now();
const hash = token => jodloPlayPurchaseFingerprint(token);
const grant = (digest,accountId=ACCOUNT)=>({
  accountId,sourceKeyHash:digest,productId:PRODUCT,
  seconds:300,createdAtMs:NOW-1000,
});
const cnt = (db,table)=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
const state = (db,digest)=>db.prepare(
  "SELECT status,attempt_id,attempt_deadline_ms FROM play_consume_outbox WHERE source_key_hash=?",
).get(digest);

function wrapped(payload,messageId="765443210") {
  return {
    subscription:"projects/jodlo-2027/subscriptions/jodlo-play-rtdn-test",
    message:{messageId, data:Buffer.from(JSON.stringify(payload)).toString("base64")},
  };
}
function data(kind="cancel",token=TOKEN){
  const base={version:"1.0",packageName:"com.rekixo.jodlo",
    eventTimeMillis:String(NOW-1000)};
  if(kind==="void" || kind==="void-partial") return {...base,
    voidedPurchaseNotification:{purchaseToken:token,orderId:"GPA.1111-2222-3333",
      productType:2,refundType:kind==="void"?1:2}};
  return {...base,oneTimeProductNotification:{
    version:"1.0",purchaseToken:token,sku:PRODUCT,
    notificationType:kind==="purchase"?1:2,
  }};
}

test("an unauthenticated Google Pub/Sub body yields ONLY private, non-authoritative hints",async()=>{
  const digest=await hash(TOKEN);
  assert.match(digest,/^[a-f0-9]{64}$/);
  for(const [kind,expected] of [
    ["purchase","purchase_hint"],["cancel","canceled_hint"],
    ["void","voided_hint"],["void-partial","voided_hint"],
  ]){
    const result=await decodeUntrustedJodloRtdnHint(wrapped(data(kind)),NOW);
    assert.equal(result.kind,expected);
    assert.equal(result.sourceKeyHash,digest);
    assert.equal(result.eventTimeMs,NOW-1000);
    assert.equal(result.productId,expected==="voided_hint"?null:PRODUCT);
    assert.equal(JSON.stringify(result).includes(TOKEN),false);
    assert.equal(JSON.stringify(result).includes("GPA."),false);
    assert.equal(Object.hasOwn(result,"accountId"),false);
    assert.equal(Object.hasOwn(result,"trusted"),false);
  }
  const {db,adapter}=openLocalDatabase();
  try {
    assert.ok(await decodeUntrustedJodloRtdnHint(wrapped(data()),NOW));
    assert.equal(cnt(db,"play_revocation_fences"),0,
      "decoding an untrusted message must NEVER write a cancellation");
    assert.equal(cnt(db,"call_credit_events"),0,
      "decoding an untrusted purchase must NEVER mint credit");
    const {handleRequest}=await import("../src/http/router.ts");
    assert.equal((await handleRequest(
      new Request("https://example.invalid/api/v1/play/rtdn",{
        method:"POST",body:JSON.stringify(wrapped(data())),
      }),{DB:adapter})).status,404,"there is no publicly enabled Pub/Sub ingest route");
  } finally {db.close();}
});

test("wrong package, stale/unclear events, multi-category, non-Play notifications and forged envelopes fail closed",async()=>{
  const base=data("void");
  const invalid=[
    wrapped({...base,packageName:"com.other.app"}),
    wrapped({...base,eventTimeMillis:String(NOW+10*60*1000)}),
    wrapped({...base,eventTimeMillis:String(NOW-8*24*60*60*1000)}),
    wrapped({...base,eventTimeMillis:"0"}),
    wrapped({...base,version:"2.0"}),
    wrapped({...base,subscriptionNotification:{version:"1.0",notificationType:4}}),
    wrapped({...base,testNotification:{version:"1.0"}}),
    wrapped({...base,voidedPurchaseNotification:{...base.voidedPurchaseNotification,productType:1}}),
    wrapped({...base,voidedPurchaseNotification:{...base.voidedPurchaseNotification,refundType:17}}),
    wrapped({...base,voidedPurchaseNotification:{...base.voidedPurchaseNotification,purchaseToken:"short"}}),
    wrapped({...base,voidedPurchaseNotification:{...base.voidedPurchaseNotification,purchaseToken:null}}),
    wrapped({...data("cancel"),oneTimeProductNotification:{
      ...data("cancel").oneTimeProductNotification,sku:"unknown sku",
    }}),
    wrapped({...data("cancel"),oneTimeProductNotification:{
      ...data("cancel").oneTimeProductNotification,notificationType:9,
    }}),
    {message:{messageId:"123",data:Buffer.from(JSON.stringify(base)).toString("base64")}},
    {...wrapped(base),subscription:"projects/other/subscriptions"},
    {...wrapped(base),message:{...wrapped(base).message,messageId:"not-decimal"}},
    {...wrapped(base),message:{...wrapped(base).message,data:"not base64!"}},
    {...wrapped(base),message:{...wrapped(base).message,data:Buffer.from([255,254]).toString("base64")}},
    {...wrapped(base),message:{...wrapped(base).message,data:"x".repeat(9000)}},
    {},
    null,
  ];
  for(const entry of invalid)
    assert.equal(await decodeUntrustedJodloRtdnHint(entry,NOW),null);
  assert.equal(await decodeUntrustedJodloRtdnHint(wrapped(data()),0),null);
});

test("trusted cancellation before purchase permanently fences all later grants, across accounts",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    db.exec("INSERT INTO accounts(id) VALUES ('rtdn-owner'),('rtdn-foreign')");
    const digest=await hash(TOKEN);
    assert.equal(await isPlayPurchaseRevoked(adapter,digest),false);
    assert.equal(await isPlayPurchaseRevoked(adapter,"not a hash"),true);
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:digest,reason:"one_time_canceled",recordedAtMs:NOW,
    }),"applied");
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:digest,reason:"one_time_canceled",recordedAtMs:NOW+1,
    }),"replay","duplicate RTDN delivery must not create another fence");
    assert.equal(await isPlayPurchaseRevoked(adapter,digest),true);
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(digest),APPROVED),
      "void_hold");
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(digest,OTHER),APPROVED),
      "void_hold","revoked purchase token cannot be re-claimed by another user");
    assert.equal(cnt(db,"play_consume_outbox"),0);
    assert.equal(cnt(db,"call_credit_events"),0);
    assert.equal(cnt(db,"call_credit_balances"),0);
    assert.throws(()=>db.prepare(
      "INSERT INTO play_consume_outbox(source_key_hash,account_id,product_id,seconds,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?)",
    ).run(digest,ACCOUNT,PRODUCT,300,NOW,NOW),/PLAY_REVOKED_TOKEN/,
    "a direct SQL insert must also be prevented before credit trigger");
    assert.equal(cnt(db,"call_credit_events"),0);
    const otherDigest=await hash(OTHER_TOKEN);
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(otherDigest),APPROVED),
      "applied","another non-revoked purchase must remain independent");
    assert.equal(cnt(db,"call_credit_events"),1);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  } finally {db.close();}
});

test("revocation AFTER credited purchase freezes new consumes but never invents a balance reversal",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    db.exec("INSERT INTO accounts(id) VALUES ('rtdn-owner')");
    const bearer=(await issueSession(adapter,ACCOUNT)).accessToken;
    const digest=await hash(TOKEN);
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(digest),APPROVED),"applied");
    assert.deepEqual(await readOwnCallCreditBalance(adapter,bearer,NOW),
      {availableSeconds:300,revision:1});
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:digest,reason:"voided_purchase",recordedAtMs:NOW+1,
    }),"applied");
    assert.deepEqual(state(db,digest),{
      status:"void_hold",attempt_id:null,attempt_deadline_ms:null,
    });
    assert.equal(await claimPlayConsumeOnce(adapter,ACCOUNT,digest,NOW+2),null);
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(digest),APPROVED),
      "void_hold");
    assert.deepEqual(await readOwnCallCreditBalance(adapter,bearer,NOW),
      {availableSeconds:300,revision:1},
      "refund/debt policy cannot be guessed or silently debit paid credit");
    assert.equal(cnt(db,"play_revocation_fences"),1);
    assert.equal(cnt(db,"call_credit_events"),1);
    assert.throws(()=>db.prepare(
      "UPDATE play_consume_outbox SET status='ready' WHERE source_key_hash=?",
    ).run(digest),/PLAY_REVOKED_TOKEN/,"frozen purchase cannot be reopened by stale code");
    db.prepare("DELETE FROM accounts WHERE id=?").run(ACCOUNT);
    assert.equal(cnt(db,"play_consume_outbox"),0);
    assert.equal(cnt(db,"call_credit_events"),0);
    assert.equal(cnt(db,"call_credit_balances"),0);
    assert.equal(cnt(db,"play_revocation_fences"),1,
      "global token fence intentionally survives account deletion until retention policy is defined");
  } finally {db.close();}
});

test("revocation while sending defeats pending callback, lease expiry and unknown recovery",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    db.exec("INSERT INTO accounts(id) VALUES ('rtdn-owner')");
    const digest=await hash(TOKEN);
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(digest),APPROVED),"applied");
    const claim=await claimPlayConsumeOnce(adapter,ACCOUNT,digest,NOW+1);
    assert.ok(claim);
    assert.equal(state(db,digest).status,"sending");
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:digest,reason:"voided_purchase",recordedAtMs:NOW+2,
    }),"applied");
    assert.deepEqual(state(db,digest),{
      status:"void_hold",attempt_id:null,attempt_deadline_ms:null,
    });
    let outbound=0;
    assert.equal(await deliverClaimedPlayConsume(adapter,claim,TOKEN,{
      now:()=>NOW+3,accessToken:async()=>"synthetic-bearer",
      request:async()=>{outbound++;return new Response(null,{status:204});},
    }),"denied","revocation must win before provider consume");
    assert.equal(outbound,0);
    assert.equal(await quarantineExpiredPlayConsume(adapter,ACCOUNT,digest,
      claim.deadlineMs+20),false);
    assert.equal(await reconcileUnknownPlayConsume(adapter,claim,TOKEN,{
      now:()=>claim.deadlineMs+30,accessToken:async()=>"synthetic-bearer",
      request:async()=>{outbound++;return new Response("{}");},
    }),"denied");
    assert.equal(outbound,0);
    assert.equal(await claimPlayConsumeOnce(adapter,ACCOUNT,digest,
      claim.deadlineMs+100),null);
    assert.equal(cnt(db,"call_credit_events"),1);
  } finally{db.close();}
});

test("trusted revocation validates reason, digest and time before any durable write",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    const digest=await hash(TOKEN);
    for(const invalid of [
      {sourceKeyHash:digest,reason:"pending",recordedAtMs:NOW},
      {sourceKeyHash:"not-a-digest",reason:"voided_purchase",recordedAtMs:NOW},
      {sourceKeyHash:digest,reason:"voided_purchase",recordedAtMs:0},
      {sourceKeyHash:digest,reason:"voided_purchase",recordedAtMs:NaN},
      null,
    ]){
      assert.equal(await recordTrustedPlayRevocation(adapter,invalid),"denied");
    }
    assert.equal(cnt(db,"play_revocation_fences"),0);
  } finally{db.close();}
});
