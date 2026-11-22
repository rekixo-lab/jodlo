import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { issueSession } from "../src/modules/identity/sessions.ts";
import {
  jodloPlayAccountBinding, jodloPlayPurchaseFingerprint,
} from "../src/modules/interactions/google-play-purchase-preflight.ts";
import {
  inspectJodloPlayPurchaseWithVoids,
} from "../src/modules/interactions/google-play-voided-preflight.ts";
import {
  stageTrustedPlayConsumable, claimPlayConsumeOnce,
  deliverClaimedPlayConsume, reconcileUnknownPlayConsume,
} from "../src/modules/interactions/play-consumable-outbox.ts";
import {
  recordTrustedPlayRevocation,
} from "../src/modules/interactions/google-play-rtdn-fences.ts";
import {
  readOwnCallCreditBalance,
} from "../src/modules/interactions/private-call-credits.ts";

const CUSTOMER = "play-journey-customer";
const FOREIGN = "play-journey-foreign";
const TOKEN = "synthetic.play.jodlo.lifecycle.000000001";
const SKU = "jodlo.synthetic5";
const APPROVED = new Map([[SKU, 5]]);
const count = (db, table) => db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
const status = db => db.prepare("SELECT status FROM play_consume_outbox").get()?.status;
const json = value => new Response(JSON.stringify(value), {status:200});

async function receipt(nowMs, accountId=CUSTOMER, patch={}) {
  return {
    kind:"androidpublisher#productPurchaseV2",
    obfuscatedExternalAccountId:await jodloPlayAccountBinding(accountId),
    purchaseStateContext:{purchaseState:"PURCHASED"},
    purchaseCompletionTime:new Date(nowMs-100_000).toISOString(),
    acknowledgementState:"ACKNOWLEDGEMENT_STATE_PENDING",
    productLineItem:[{
      productId:SKU,
      productOfferDetails:{
        quantity:1, refundableQuantity:1,
        consumptionState:"CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
      },
    }],
    ...patch,
  };
}

function preflight(developerResponse, voidedResponse, nowMs) {
  const requests=[];
  const deps={
    approvedProducts:APPROVED, now:()=>nowMs,
    accessToken:async()=>"synthetic-androidpublisher-token",
    request:async(url, options)=>{
      assert.equal(options.method,"GET",
        "the eligibility stage must never issue a payment POST");
      requests.push(url);
      if(url.includes("/purchases/productsv2/tokens/"))
        return json(developerResponse);
      assert.ok(url.includes("/purchases/voidedpurchases"));
      assert.equal(new URL(url).searchParams.get("includeQuantityBasedPartialRefund"),"true");
      return json(voidedResponse);
    },
  };
  return {requests,deps};
}

function grant(candidate,nowMs,accountId=CUSTOMER) {
  return {
    accountId,sourceKeyHash:candidate.sourceKeyHash,
    productId:candidate.productId,seconds:candidate.seconds,
    createdAtMs:nowMs-100_000,
  };
}

test("offline Play lifecycle: screened receipt, one atomic credit, one consume, replay, refund hold",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-journey-customer'),('play-journey-foreign')");
    const nowMs=Date.now();
    const bearer=(await issueSession(adapter,CUSTOMER)).accessToken;
    const fake=preflight(await receipt(nowMs),{voidedPurchases:[]},nowMs);
    const candidate=await inspectJodloPlayPurchaseWithVoids(CUSTOMER,TOKEN,fake.deps);
    assert.equal(candidate.kind,"screened_candidate");
    assert.equal(candidate.seconds,300);
    assert.equal(candidate.productId,SKU);
    assert.equal(candidate.sourceKeyHash,await jodloPlayPurchaseFingerprint(TOKEN));
    assert.equal(fake.requests.length,2,"must check both ownership and refund records");
    assert.equal(JSON.stringify(candidate).includes(TOKEN),false);
    assert.equal(count(db,"call_credit_events"),0,
      "read-only Google screening never itself approves a financial credit");
    assert.deepEqual(await readOwnCallCreditBalance(adapter,bearer,nowMs),
      {availableSeconds:0,revision:0});

    // This test explicitly models a separate trusted operator approval.
    // Production must NOT connect screened_candidate to this write seam
    // until Play Console, refund policy and entitlement requirements are met.
    const trusted=grant(candidate,nowMs);
    const results=await Promise.all([
      stageTrustedPlayConsumable(adapter,trusted,APPROVED),
      stageTrustedPlayConsumable(adapter,trusted,APPROVED),
    ]);
    assert.deepEqual(results.sort(),["applied","replay"]);
    assert.equal(count(db,"play_consume_outbox"),1);
    assert.equal(count(db,"call_credit_events"),1);
    assert.equal(count(db,"call_credit_balances"),1);
    assert.equal(status(db),"ready");
    assert.deepEqual(await readOwnCallCreditBalance(adapter,bearer,nowMs),
      {availableSeconds:300,revision:1});
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(candidate,nowMs,FOREIGN),APPROVED),
      "denied","a different customer cannot reuse the same Play purchase token");
    assert.equal(await claimPlayConsumeOnce(adapter,FOREIGN,candidate.sourceKeyHash,nowMs),
      null,"another account cannot send the consume request");

    const claim=await claimPlayConsumeOnce(adapter,CUSTOMER,candidate.sourceKeyHash,nowMs);
    assert.ok(claim);
    let sends=0;
    assert.equal(await deliverClaimedPlayConsume(adapter,claim,TOKEN,{
      now:()=>nowMs+100,
      accessToken:async()=>"synthetic-androidpublisher-token",
      request:async(url,init)=>{
        sends++;
        assert.equal(init.method,"POST");
        assert.ok(url.endsWith("/tokens/"+TOKEN+":consume"));
        return new Response(null,{status:204});
      },
    }),"consumed");
    assert.equal(sends,1);
    assert.equal(status(db),"consumed");
    assert.equal(await claimPlayConsumeOnce(adapter,CUSTOMER,candidate.sourceKeyHash,nowMs+200),
      null,"successful consumption cannot be sent twice");
    assert.equal(count(db,"call_credit_events"),1);

    // A synthetic, independently confirmed refund AFTER credit preserves
    // the audit event but freezes future provider sends. Refund clawback
    // of spent call time requires an owner-approved policy, not an auto debit.
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:candidate.sourceKeyHash,reason:"voided_purchase",
      recordedAtMs:nowMs+300,
    }),"applied");
    assert.equal(status(db),"void_hold");
    assert.equal(await stageTrustedPlayConsumable(adapter,trusted,APPROVED),"void_hold");
    assert.equal(await claimPlayConsumeOnce(adapter,CUSTOMER,candidate.sourceKeyHash,nowMs+400),
      null);
    assert.equal(count(db,"call_credit_events"),1);
    assert.deepEqual(await readOwnCallCreditBalance(adapter,bearer,nowMs),
      {availableSeconds:300,revision:1},
      "refund handling cannot silently deduct already spent or existing seconds");
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:candidate.sourceKeyHash,reason:"voided_purchase",
      recordedAtMs:nowMs+500,
    }),"replay");
    assert.equal(count(db,"play_revocation_fences"),1);
  } finally {db.close();}
});

test("offline Play lifecycle: wrong owner, pending purchase and matching void never grant",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-journey-customer'),('play-journey-foreign')");
    const nowMs=Date.now();
    const valid=await receipt(nowMs);
    const variants=[
      [FOREIGN,valid,{voidedPurchases:[]},"not_eligible"],
      [CUSTOMER,{...valid,purchaseStateContext:{purchaseState:"PENDING"}},
        {voidedPurchases:[]},"not_eligible"],
      [CUSTOMER,valid,{voidedPurchases:[{
        kind:"androidpublisher#voidedPurchase",purchaseToken:TOKEN,
      }]},"not_eligible"],
      [CUSTOMER,valid,{voidedPurchases:[],tokenPagination:{
        nextPageToken:"cannot-prove-a-complete-scan",
      }},"unavailable"],
    ];
    for(const [owner,purchase,voids,expected] of variants){
      const fake=preflight(purchase,voids,nowMs);
      const result=await inspectJodloPlayPurchaseWithVoids(owner,TOKEN,fake.deps);
      assert.equal(result.kind,expected);
      assert.equal(count(db,"play_consume_outbox"),0);
      assert.equal(count(db,"call_credit_events"),0);
    }
    const bearer=(await issueSession(adapter,CUSTOMER)).accessToken;
    const {handleRequest}=await import("../src/http/router.ts");
    for(const path of ["/api/v1/me/play-purchase","/api/v1/me/play-consume",
      "/api/v1/me/credit-grant","/api/v1/me/billing"]){
      const response=await handleRequest(new Request("https://example.invalid"+path,{
        method:"POST",headers:{Authorization:"Bearer "+bearer},
        body:JSON.stringify({purchaseToken:TOKEN}),
      }),{DB:adapter});
      assert.equal(response.status,404,"no live checkout or grant endpoint: "+path);
    }
  } finally {db.close();}
});

test("offline Play lifecycle: independent revocation arriving between screening and grant wins",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-journey-customer')");
    const nowMs=Date.now();
    const provider=preflight(await receipt(nowMs),{voidedPurchases:[]},nowMs);
    const checked=await inspectJodloPlayPurchaseWithVoids(CUSTOMER,TOKEN,provider.deps);
    assert.equal(checked.kind,"screened_candidate");
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:checked.sourceKeyHash, reason:"one_time_canceled",
      recordedAtMs:nowMs+1,
    }),"applied");
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(checked,nowMs),APPROVED),
      "void_hold","database revocation fence must reject the stale verification result");
    assert.equal(count(db,"call_credit_events"),0);
    assert.equal(count(db,"play_consume_outbox"),0);
    assert.equal(count(db,"play_revocation_fences"),1);
  }finally{db.close();}
});

test("offline Play lifecycle: ambiguous consume POST is never retried; verified GET may reconcile",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-journey-customer')");
    const nowMs=Date.now();
    const input=preflight(await receipt(nowMs),{voidedPurchases:[]},nowMs);
    const checked=await inspectJodloPlayPurchaseWithVoids(CUSTOMER,TOKEN,input.deps);
    assert.equal(checked.kind,"screened_candidate");
    assert.equal(await stageTrustedPlayConsumable(adapter,grant(checked,nowMs),APPROVED),
      "applied");
    const claim=await claimPlayConsumeOnce(adapter,CUSTOMER,checked.sourceKeyHash,nowMs);
    assert.ok(claim);
    let posts=0,gets=0;
    assert.equal(await deliverClaimedPlayConsume(adapter,claim,TOKEN,{
      now:()=>nowMs+10,timeoutMs:45,
      accessToken:async()=>"synthetic-androidpublisher-token",
      request:async(_url,init)=>{
        assert.equal(init.method,"POST");
        posts++;
        return new Promise(()=>{});
      },
    }),"unknown");
    assert.equal(status(db),"unknown");
    assert.equal(await claimPlayConsumeOnce(adapter,CUSTOMER,checked.sourceKeyHash,nowMs+60),
      null);
    const consumedReceipt={
      ...await receipt(nowMs),
      acknowledgementState:"ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      productLineItem:[{
        productId:SKU,
        productOfferDetails:{
          quantity:1,refundableQuantity:1,
          consumptionState:"CONSUMPTION_STATE_CONSUMED",
        },
      }],
    };
    assert.equal(await reconcileUnknownPlayConsume(adapter,claim,TOKEN,{
      now:()=>nowMs+100,
      accessToken:async()=>"synthetic-androidpublisher-token",
      request:async(url,init)=>{
        gets++;
        assert.equal(init.method,"GET","recovery may NEVER resend the POST");
        assert.ok(url.includes("/purchases/productsv2/tokens/"));
        return json(consumedReceipt);
      },
    }),"consumed");
    assert.equal(posts,1);
    assert.equal(gets,1);
    assert.equal(status(db),"consumed");
    assert.equal(count(db,"call_credit_events"),1);
    assert.equal(count(db,"play_consume_outbox"),1);
  }finally{db.close();}
});
