import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { readOwnCallCreditBalance, recordTrustedCallCreditEvent } from
  "../src/modules/interactions/private-call-credits.ts";
import { jodloPlayPurchaseFingerprint, jodloPlayAccountBinding } from
  "../src/modules/interactions/google-play-purchase-preflight.ts";
import {
  PLAY_CONSUME_LEASE_MS, stageTrustedPlayConsumable,
  claimPlayConsumeOnce, deliverClaimedPlayConsume,
  quarantineExpiredPlayConsume, releaseUnsentPlayConsumeClaim,
  holdVoidedPlayConsume, reconcileUnknownPlayConsume,
} from "../src/modules/interactions/play-consumable-outbox.ts";

const TOKEN = "synthetic.jodlo.play-token-000000001";
const ACCOUNT = "play-consumer-one";
const OTHER = "play-consumer-two";
const PRODUCT = "jodlo.testpack5";
const APPROVED = new Map([[PRODUCT,5]]);
const fingerprint = token => createHash("sha256").update(
  "jodlo-play-product-v2:com.rekixo.jodlo:"+token).digest("hex");

function grant(sourceKeyHash=fingerprint(TOKEN),accountId=ACCOUNT) {
  return {sourceKeyHash,accountId,productId:PRODUCT,seconds:300,createdAtMs:Date.now()-3000};
}
const getState = (db,digest=fingerprint(TOKEN))=>
  db.prepare("SELECT status,product_id,seconds,attempt_id,attempt_deadline_ms FROM play_consume_outbox WHERE source_key_hash=?").get(digest);
const rows = (db,table)=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;

test("atomic Play grant/outbox insert prevents duplication, cross-account claiming and orphaned erasure",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-consumer-one'),('play-consumer-two')");
    const now=Date.now();
    const bearer=(await issueSession(adapter,ACCOUNT)).accessToken;
    const first=grant();
    assert.equal(await jodloPlayPurchaseFingerprint(TOKEN),first.sourceKeyHash);
    assert.equal(await stageTrustedPlayConsumable(adapter,first,new Map()),"denied",
      "no approved product IDs means no gift or purchase ledger activity");
    assert.equal(rows(db,"call_credit_events"),0);
    const [one,two]=await Promise.all([
      stageTrustedPlayConsumable(adapter,first,APPROVED),
      stageTrustedPlayConsumable(adapter,first,APPROVED),
    ]);
    assert.deepEqual([one,two].sort(),["applied","replay"]);
    assert.equal(getState(db).status,"ready");
    assert.equal(rows(db,"play_consume_outbox"),1);
    assert.equal(rows(db,"call_credit_events"),1);
    assert.deepEqual(await readOwnCallCreditBalance(adapter,bearer,now),
      {availableSeconds:300,revision:1});
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(undefined,OTHER),APPROVED),
      "denied","a globally unique Play token cannot be reassigned");
    assert.equal(await stageTrustedPlayConsumable(adapter,{...first,seconds:1200},APPROVED),
      "denied","changed amount is rejected");
    assert.equal(await stageTrustedPlayConsumable(adapter,first,new Map([[PRODUCT,20]])),
      "denied","SKU/minute mapping cannot silently change");
    const foreign=await claimPlayConsumeOnce(adapter,OTHER,first.sourceKeyHash,now+1);
    assert.equal(foreign,null,"foreign account cannot consume");
    assert.equal(await claimPlayConsumeOnce(adapter,ACCOUNT,"bad-hash",now+1),null);
    assert.equal(rows(db,"call_credit_events"),1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM play_consume_outbox WHERE product_id=?")
      .get(PRODUCT).n,1);
    const {handleRequest}=await import("../src/http/router.ts");
    for(const route of ["/api/v1/me/billing","/api/v1/me/play-consume","/api/v1/me/credit-grant"]) {
      const response=await handleRequest(new Request("https://example.invalid"+route,{
        method:"POST",headers:{Authorization:"Bearer "+bearer},
      }),{DB:adapter});
      assert.equal(response.status,404,"there is no public purchase or consume API");
    }
    db.prepare("DELETE FROM accounts WHERE id=?").run(ACCOUNT);
    assert.equal(rows(db,"play_consume_outbox"),0);
    assert.equal(rows(db,"call_credit_events"),0);
    assert.equal(rows(db,"call_credit_balances"),0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally {db.close();}
});

test("one confirmed Google consume POST follows atomic grant and is never replayed",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-consumer-one'),('play-consumer-two')");
    const first=grant();
    assert.equal(await stageTrustedPlayConsumable(adapter,first,APPROVED),"applied");
    const now=Date.now();
    const claim=await claimPlayConsumeOnce(adapter,ACCOUNT,first.sourceKeyHash,now);
    assert.ok(claim);
    assert.equal(claim.deadlineMs-now,PLAY_CONSUME_LEASE_MS);
    assert.equal(getState(db).status,"sending");
    assert.equal(await claimPlayConsumeOnce(adapter,ACCOUNT,first.sourceKeyHash,now+1),null);
    const outbound=[];
    const result=await deliverClaimedPlayConsume(adapter,claim,TOKEN,{
      now:()=>now+20,
      accessToken:async()=>"synthetic-access-bearer",
      request:async(url,options)=>{
        outbound.push({url,options});
        return new Response(null,{status:204});
      },
    });
    assert.equal(result,"consumed");
    assert.equal(getState(db).status,"consumed");
    assert.equal(getState(db).attempt_id,null);
    assert.equal(outbound.length,1);
    assert.equal(outbound[0].url,
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"+
      "com.rekixo.jodlo/purchases/products/jodlo.testpack5/tokens/"+
      TOKEN+":consume");
    assert.equal(outbound[0].options.method,"POST");
    assert.equal(outbound[0].options.body,undefined);
    assert.equal(outbound[0].options.headers.Authorization,"Bearer synthetic-access-bearer");
    assert.equal(await claimPlayConsumeOnce(adapter,ACCOUNT,first.sourceKeyHash,now+100),null);
    assert.equal(await stageTrustedPlayConsumable(adapter,first,APPROVED),"replay");
    assert.equal(rows(db,"call_credit_events"),1);
    assert.equal(rows(db,"play_consume_outbox"),1);
  } finally {db.close();}
});

test("provider ambiguity permanently quarantines the send and refuses automatic retry",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-consumer-one')");
    const first=grant();await stageTrustedPlayConsumable(adapter,first,APPROVED);
    const now=Date.now();
    const claim=await claimPlayConsumeOnce(adapter,ACCOUNT,first.sourceKeyHash,now);
    assert.ok(claim);
    let sends=0;
    const result=await deliverClaimedPlayConsume(adapter,claim,TOKEN,{
      now:()=>now+10,timeoutMs:45,
      accessToken:async()=>"synthetic-access-bearer",
      request:async()=>{sends++;return new Promise(()=>{});},
    });
    assert.equal(result,"unknown");
    assert.equal(sends,1);
    assert.equal(getState(db).status,"unknown");
    assert.equal(await claimPlayConsumeOnce(adapter,ACCOUNT,first.sourceKeyHash,now+200),null);
    assert.equal(await quarantineExpiredPlayConsume(adapter,ACCOUNT,first.sourceKeyHash,
      claim.deadlineMs+1),false,"unknown cannot be re-claimed or lost");
    assert.equal(await releaseUnsentPlayConsumeClaim(adapter,claim,now+200),false,
      "once a POST may have reached Play, never re-open the send lease");
    assert.equal(await stageTrustedPlayConsumable(adapter,first,APPROVED),"replay");
    assert.equal(rows(db,"call_credit_events"),1);
    const binding=await jodloPlayAccountBinding(ACCOUNT);
    const consumed={
      kind:"androidpublisher#productPurchaseV2",
      obfuscatedExternalAccountId:binding,
      purchaseStateContext:{purchaseState:"PURCHASED"},
      acknowledgementState:"ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      productLineItem:[{productId:PRODUCT,productOfferDetails:{
        quantity:1,refundableQuantity:1,consumptionState:"CONSUMPTION_STATE_CONSUMED",
      }}],
    };
    const reconcileDeps=(value)=>({
      now:()=>now+250,accessToken:async()=>"synthetic-access-bearer",
      request:async(url,options)=>{
        assert.equal(options.method,"GET","reconciliation never resends consume POST");
        assert.match(url,/\\/purchases\\/productsv2\\/tokens\\//);
        return new Response(JSON.stringify(value),{status:200});
      },
    });
    assert.equal(await reconcileUnknownPlayConsume(adapter,claim,TOKEN+".wrong",
      reconcileDeps(consumed)),"denied","wrong token cannot reconcile someone else's claim");
    assert.equal(await reconcileUnknownPlayConsume(adapter,claim,TOKEN,
      reconcileDeps({...consumed,obfuscatedExternalAccountId:"0".repeat(64)})),"unknown",
      "account mismatch cannot clear unknown state");
    assert.equal(getState(db).status,"unknown");
    assert.equal(await reconcileUnknownPlayConsume(adapter,claim,TOKEN,
      reconcileDeps(consumed)),"consumed","fresh Play V2 proof closes the unknown claim");
    assert.equal(getState(db).status,"consumed");
    assert.equal(await reconcileUnknownPlayConsume(adapter,claim,TOKEN,
      reconcileDeps(consumed)),"denied","cannot replay reconciliation");
    assert.equal(rows(db,"call_credit_events"),1);
  }finally{db.close();}
});

test("known pre-POST failure releases only matching claim and permits deliberate retry",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-consumer-one')");
    const first=grant(); await stageTrustedPlayConsumable(adapter,first,APPROVED);
    const now=Date.now();
    const claim=await claimPlayConsumeOnce(adapter,ACCOUNT,first.sourceKeyHash,now);
    assert.ok(claim);
    let sends=0;
    assert.equal(await deliverClaimedPlayConsume(adapter,claim,TOKEN+".wrong",{
      now:()=>now+20,accessToken:async()=>"synthetic-access-bearer",
      request:async()=>{sends++;return new Response(null,{status:204});},
    }),"unsent");
    assert.equal(sends,0,"bad token must not reach Google API");
    assert.equal(getState(db).status,"ready");
    const next=await claimPlayConsumeOnce(adapter,ACCOUNT,first.sourceKeyHash,now+50);
    assert.ok(next);
    assert.notEqual(next.attemptId,claim.attemptId);
    assert.equal(await releaseUnsentPlayConsumeClaim(adapter,claim,now+60),false,
      "stale attempt cannot free the new claim");
    assert.equal(await deliverClaimedPlayConsume(adapter,next,TOKEN,{
      now:()=>now+70,accessToken:async()=>null,
      request:async()=>{sends++;return new Response(null,{status:204});},
    }),"unsent","no OAuth means no provider POST");
    assert.equal(sends,0);
    assert.equal(getState(db).status,"ready");
    assert.equal(rows(db,"call_credit_events"),1);
  } finally {db.close();}
});

test("expired in-flight claims and proven voids never auto-send, even after late callbacks",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-consumer-one')");
    const first=grant();await stageTrustedPlayConsumable(adapter,first,APPROVED);
    const now=Date.now();
    const claim=await claimPlayConsumeOnce(adapter,ACCOUNT,first.sourceKeyHash,now);
    assert.ok(claim);
    assert.equal(await quarantineExpiredPlayConsume(adapter,ACCOUNT,first.sourceKeyHash,
      claim.deadlineMs-1),false);
    assert.equal(await quarantineExpiredPlayConsume(adapter,ACCOUNT,first.sourceKeyHash,
      claim.deadlineMs+1),true);
    assert.equal(getState(db).status,"unknown");
    assert.equal(await claimPlayConsumeOnce(adapter,ACCOUNT,first.sourceKeyHash,
      claim.deadlineMs+2),null);
    assert.equal(await holdVoidedPlayConsume(adapter,ACCOUNT,first.sourceKeyHash,
      claim.deadlineMs+3),true);
    assert.equal(getState(db).status,"void_hold");
    assert.equal(await reconcileUnknownPlayConsume(adapter,claim,TOKEN,{
      now:()=>claim.deadlineMs+4,accessToken:async()=>"synthetic-access-bearer",
      request:async()=>{throw Error("must not contact Play after void hold");},
    }),"denied","void hold prevents any provider recovery request");
    assert.equal(await holdVoidedPlayConsume(adapter,ACCOUNT,first.sourceKeyHash,
      claim.deadlineMs+5),false);
    assert.equal(await stageTrustedPlayConsumable(adapter,first,APPROVED),"void_hold");
    assert.equal(rows(db,"call_credit_events"),1,
      "refund debt/clawback policy is separate; never silently adjust spent balance");
  }finally{db.close();}
});

test("existing credit event digest collision aborts both outbox and balance writes",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-consumer-one')");
    const first=grant();
    assert.equal(await recordTrustedCallCreditEvent(adapter,{
      accountId:ACCOUNT,sourceKeyHash:first.sourceKeyHash,
      seconds:300,kind:"purchase_grant",createdAtMs:Date.now(),
    }),"applied");
    await assert.rejects(
      stageTrustedPlayConsumable(adapter,first,APPROVED),
      /UNIQUE constraint failed/,
    );
    assert.equal(rows(db,"play_consume_outbox"),0);
    assert.equal(rows(db,"call_credit_events"),1);
    assert.equal(db.prepare("SELECT available_seconds FROM call_credit_balances").get().available_seconds,300);
  } finally {db.close();}
});
