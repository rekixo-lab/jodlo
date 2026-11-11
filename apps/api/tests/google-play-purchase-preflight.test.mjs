import assert from "node:assert/strict";
import test from "node:test";
import {
  JODLO_PLAY_PACKAGE, PLAY_PREFLIGHT_TIMEOUT_MS,
  inspectJodloPlayOneTimePurchase, jodloPlayAccountBinding,
  validatePlayProductPurchaseV2,
} from "../src/modules/interactions/google-play-purchase-preflight.ts";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession} from "../src/modules/identity/sessions.ts";
import {readOwnCallCreditBalance} from "../src/modules/interactions/private-call-credits.ts";

const NOW = 1794390000000;
const ACCOUNT = "play-billing-alice";
const OTHER = "play-billing-bob";
const PURCHASE_TOKEN = "synthetic.test-only.PURCHASE_TOKEN_001";
const PRODUCTS = new Map([["jodlo.testpack5",5],["jodlo.testpack20",20]]);

async function receipt(overrides = {}) {
  const accountBinding = await jodloPlayAccountBinding(ACCOUNT);
  return {
    kind:"androidpublisher#productPurchaseV2",
    obfuscatedExternalAccountId:accountBinding,
    purchaseStateContext:{purchaseState:"PURCHASED"},
    purchaseCompletionTime:new Date(NOW-90_000).toISOString(),
    orderId:"GPA.1234-5678-9012-34567",
    acknowledgementState:"ACKNOWLEDGEMENT_STATE_PENDING",
    productLineItem:[{
      productId:"jodlo.testpack5",
      productOfferDetails:{
        quantity:1,refundableQuantity:1,
        consumptionState:"CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
      },
    }],
    ...overrides,
  };
}

function deps(response, overrides={}) {
  const calls=[];
  return {
    calls,
    config:{
      approvedProducts:PRODUCTS, now:()=>NOW,
      accessToken:async()=>"synthetic-oauth-access",
      request:async(url,init)=>{
        calls.push({url,init});
        return new Response(JSON.stringify(response),{
          status:200,headers:{"Content-Type":"application/json"},
        });
      },
      ...overrides,
    },
  };
}

test("Play ProductPurchaseV2 preflight is owner-bound but never credits or exposes a purchase route",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-billing-alice'),('play-billing-bob')");
    const bearer=(await issueSession(adapter,ACCOUNT)).accessToken;
    const input=await receipt();
    const f=deps(input);
    const result=await inspectJodloPlayOneTimePurchase(ACCOUNT,PURCHASE_TOKEN,f.config);
    assert.equal(result.kind,"candidate");
    assert.equal(result.productId,"jodlo.testpack5");
    assert.equal(result.seconds,300);
    assert.match(result.sourceKeyHash,/^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(result).includes(PURCHASE_TOKEN),false,"no raw Play purchase token");
    assert.deepEqual(await readOwnCallCreditBalance(adapter,bearer,NOW),{
      availableSeconds:0,revision:0,
    },"positive verification preflight must NEVER mint credit");
    assert.equal(db.prepare("SELECT count(*) AS n FROM call_credit_events").get().n,0);
    assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].url,"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"+
      JODLO_PLAY_PACKAGE+"/purchases/productsv2/tokens/"+PURCHASE_TOKEN);
    assert.equal(f.calls[0].init.method,"GET");
    assert.equal(f.calls[0].init.headers.Authorization,"Bearer synthetic-oauth-access");
    assert.equal(f.calls[0].init.body,undefined);
    assert.equal((await inspectJodloPlayOneTimePurchase(OTHER,PURCHASE_TOKEN,f.config)).kind,
      "not_eligible","the same actual Play receipt cannot be claimed by another JODLO account");
    assert.equal((await inspectJodloPlayOneTimePurchase(ACCOUNT,PURCHASE_TOKEN,f.config))
      .sourceKeyHash,result.sourceKeyHash,"same token has exactly one canonical event fingerprint");
    const {handleRequest}=await import("../src/http/router.ts");
    const claim=await handleRequest(new Request("https://example.invalid/api/v1/me/play-purchase",{
      method:"POST",headers:{Authorization:"Bearer "+bearer},
      body:JSON.stringify({purchaseToken:PURCHASE_TOKEN}),
    }),{DB:adapter});
    assert.equal(claim.status,404,"no public verification/grant path");
  }finally{db.close();}
});

test("Google V2 preflight refuses pending, cancelled, refunded, consumed, acknowledged, test or missing account claims",async()=>{
  const positive=await receipt();
  const binding=await jodloPlayAccountBinding(ACCOUNT);
  const changed=[
    {purchaseStateContext:{purchaseState:"PENDING"}},
    {purchaseStateContext:{purchaseState:"CANCELLED"}},
    {purchaseStateContext:{purchaseState:"PURCHASE_STATE_UNSPECIFIED"}},
    {acknowledgementState:"ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"},
    {testPurchaseContext:{fopType:"TEST"}},
    {obfuscatedExternalAccountId:null},
    {obfuscatedExternalAccountId:"0".repeat(64)},
    {orderId:""},
    {purchaseCompletionTime:"never"},
    {purchaseCompletionTime:new Date(NOW+3600_000).toISOString()},
    {productLineItem:[]},
    {productLineItem:[...positive.productLineItem,...positive.productLineItem]},
    {productLineItem:[{...positive.productLineItem[0],productId:"unapproved.pack"}]},
    {productLineItem:[{...positive.productLineItem[0],productOfferDetails:{
      quantity:2,refundableQuantity:2,
      consumptionState:"CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
    }}]},
    {productLineItem:[{...positive.productLineItem[0],productOfferDetails:{
      quantity:1,refundableQuantity:0,
      consumptionState:"CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
    }}]},
    {productLineItem:[{...positive.productLineItem[0],productOfferDetails:{
      quantity:1,refundableQuantity:1,
      consumptionState:"CONSUMPTION_STATE_CONSUMED",
    }}]},
    {productLineItem:[{...positive.productLineItem[0],productOfferDetails:{
      quantity:1,refundableQuantity:1,
      consumptionState:"CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
      rentOfferDetails:{},
    }}]},
    {kind:"androidpublisher#productPurchase"},
  ];
  assert.deepEqual(validatePlayProductPurchaseV2(positive,binding,PRODUCTS,NOW),{
    productId:"jodlo.testpack5",seconds:300,
  });
  for (const bad of changed) {
    assert.equal(validatePlayProductPurchaseV2({...positive,...bad},binding,PRODUCTS,NOW),null,
      "refuse unsafe Play response: "+Object.keys(bad)[0]);
  }
  assert.equal(validatePlayProductPurchaseV2({...positive,productLineItem:
    [{...positive.productLineItem[0],productOfferDetails:{
      ...positive.productLineItem[0].productOfferDetails,quantity:undefined,
    }}]},binding,PRODUCTS,NOW),null,"missing quantity must not be inferred");
  assert.equal(validatePlayProductPurchaseV2(positive,binding,new Map(),NOW),null);
  assert.equal(validatePlayProductPurchaseV2(positive,binding,PRODUCTS,0),null);
});

test("no configured real SKUs, bad token, missing OAuth or provider rejection never grants",async()=>{
  const data=await receipt();
  let remote=0,auth=0;
  const config={
    approvedProducts:new Map(),now:()=>NOW,
    accessToken:async()=>{auth++; return "synthetic-oauth-access";},
    request:async()=>{remote++;return new Response(JSON.stringify(data));},
  };
  assert.deepEqual(await inspectJodloPlayOneTimePurchase(ACCOUNT,PURCHASE_TOKEN,config),
    {kind:"unconfigured"});
  assert.equal(auth,0);assert.equal(remote,0);
  for(const approvedProducts of [
    new Map([["invalid product id",5]]),
    new Map([["jodlo.testpack5",0]]),
    new Map([["jodlo.testpack5",501]]),
  ]) {
    assert.equal((await inspectJodloPlayOneTimePurchase(ACCOUNT,PURCHASE_TOKEN,{
      ...config,approvedProducts,
    })).kind,"unconfigured");
  }
  const configured={...config,approvedProducts:PRODUCTS};
  for(const token of ["", "short", "token with spaces","-".repeat(4097)]) {
    assert.equal((await inspectJodloPlayOneTimePurchase(ACCOUNT,token,configured)).kind,
      "not_eligible");
  }
  assert.equal((await inspectJodloPlayOneTimePurchase("x",PURCHASE_TOKEN,configured)).kind,
    "not_eligible");
  assert.equal(remote,0);assert.equal(auth,0);
  const mock=deps(data,{accessToken:async()=>null});
  assert.equal((await inspectJodloPlayOneTimePurchase(ACCOUNT,PURCHASE_TOKEN,mock.config)).kind,
    "unavailable");
  assert.equal(mock.calls.length,0);
  for(const status of [400,404,401,403,408,429,500,503]) {
    const w=deps(data,{request:async()=>new Response("{}",{status})});
    const got=await inspectJodloPlayOneTimePurchase(ACCOUNT,PURCHASE_TOKEN,w.config);
    assert.equal(got.kind,[401,403,408,429,500,503].includes(status)?"unavailable":"not_eligible");
  }
});

test("provider fetch, stalled OAuth, streamed JSON, oversized body and timeout fail closed",async()=>{
  const data=await receipt();
  const never=new Promise(()=>{});
  for(const which of ["oauth","fetch","body"]) {
    const f=deps(data,{
      timeoutMs:65,
      accessToken:async()=>which==="oauth"?await never:"synthetic-oauth-access",
      request:async()=>which==="fetch"?await never:which==="body"?
        new Response(new ReadableStream({start(){}}),{status:200}):
        new Response(JSON.stringify(data),{status:200}),
    });
    const start=performance.now();
    assert.equal((await inspectJodloPlayOneTimePurchase(ACCOUNT,PURCHASE_TOKEN,f.config)).kind,
      "unavailable");
    assert.ok(performance.now()-start<2000,"one shared timeout limits all stages");
  }
  for(const response of [
    new Response("x".repeat(17000),{status:200}),
    new Response("{oops}",{status:200}),
    new Response("{}",{status:200,headers:{"Content-Length":"999999"}}),
  ]) {
    const f=deps(data,{request:async()=>response});
    assert.notEqual((await inspectJodloPlayOneTimePurchase(ACCOUNT,PURCHASE_TOKEN,f.config)).kind,
      "candidate");
  }
  assert.equal((await inspectJodloPlayOneTimePurchase(ACCOUNT,PURCHASE_TOKEN, {
    ...deps(data).config,timeoutMs:PLAY_PREFLIGHT_TIMEOUT_MS+1,
  })).kind,"unconfigured");
});
