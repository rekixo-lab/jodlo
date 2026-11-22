import test from "node:test";
import assert from "node:assert/strict";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession, revokeSession} from "../src/modules/identity/sessions.ts";
import {jodloPlayAccountBinding} from
  "../src/modules/interactions/google-play-purchase-preflight.ts";
import {handleConfiguredJodloPlayVerification} from
  "../src/modules/interactions/google-play-verification-handler.ts";
import {handleRequest} from "../src/http/router.ts";

const URL="https://api.jodlo.example/api/v1/me/play-verify";
const ALICE="play-verify-alice";
const BOB="play-verify-bob";
const TOKEN="synthetic.jodlo.googleplay.token.123456";
const NOW=Date.now();
const priceFree="jodlo.minutes20";
const json = value=>new Response(JSON.stringify(value),{status:200});
const get = bearer=>new Request(URL,{headers:bearer?{Authorization:"Bearer "+bearer}:{}});
const post = (bearer,body=JSON.stringify({purchaseToken:TOKEN}),extra={})=>
  new Request(URL,{method:"POST",headers:{
    Authorization:"Bearer "+bearer,"Content-Type":"application/json",
    ...extra,
  },body});
const count=(db,table)=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
const baseEnv=(adapter,overrides={})=>({
  DB:adapter,PLAY_CATALOG_ENABLED:"1",PLAY_VERIFICATION_ENABLED:"1",
  PLAY_SERVICE_ACCOUNT_EMAIL:"ci-play@jodlo-ci.iam.gserviceaccount.com",
  PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:"-----BEGIN PRIVATE KEY-----not-real",
  PLAY_VERIFICATION_LIMITER:{limit:async()=>({success:true})},
  ...overrides,
});

async function receipt(accountId=ALICE,change={}) {
  return {
    kind:"androidpublisher#productPurchaseV2",
    obfuscatedExternalAccountId:await jodloPlayAccountBinding(accountId),
    acknowledgementState:"ACKNOWLEDGEMENT_STATE_PENDING",
    purchaseStateContext:{purchaseState:"PURCHASED"},
    purchaseCompletionTime:new Date(NOW-20_000).toISOString(),
    productLineItem:[{productId:priceFree,
      productOfferDetails:{quantity:1,refundableQuantity:1,
        consumptionState:"CONSUMPTION_STATE_YET_TO_BE_CONSUMED"},
    }],
    ...change,
  };
}
function mockProvider(purchase,voids={voidedPurchases:[]}) {
  const calls=[];
  return {
    calls,
    deps:{
      now:()=>NOW,accessToken:async()=>"synthetic-play-oauth",
      playRequest:async(url,init)=>{
        calls.push({url,method:init.method});
        assert.equal(init.method,"GET");
        assert.equal(init.headers.Authorization,"Bearer synthetic-play-oauth");
        return json(url.includes("/productsv2/tokens/")?purchase:voids);
      },
    },
  };
}

test("read-only handshake binds Play user and Google V2 purchase to one live signed-in account",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    db.exec("INSERT INTO accounts(id) VALUES ('play-verify-alice'),('play-verify-bob')");
    const alice=(await issueSession(adapter,ALICE)).accessToken;
    const bob=(await issueSession(adapter,BOB)).accessToken;
    const keys=[];
    const env=baseEnv(adapter,{PLAY_VERIFICATION_LIMITER:{
      limit:async({key})=>{keys.push(key);return {success:true};},
    }});
    let r=await handleRequest(get(alice),env);
    assert.equal(r.status,200);
    const identity=(await r.json()).data;
    assert.deepEqual(identity,{accountBinding:await jodloPlayAccountBinding(ALICE),
      verificationOnly:true});
    assert.match(identity.accountBinding,/^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(identity).includes(ALICE),false);
    r=await handleRequest(get(bob),env);
    assert.equal(r.status,200);
    assert.notEqual((await r.json()).data.accountBinding,identity.accountBinding);

    const mocked=mockProvider(await receipt());
    // Only the internal test-only seam injects synthetic Google responses.
    r=await handleConfiguredJodloPlayVerification(post(alice),env,mocked.deps);
    assert.equal(r.status,200);
    assert.equal(r.headers.get("Cache-Control"),"no-store");
    const response=await r.json();
    assert.deepEqual(response,{ok:true,data:{
      status:"screened_pending_settlement",productId:priceFree,minutes:20,
    }});
    assert.ok(!JSON.stringify(response).includes(TOKEN));
    assert.ok(!JSON.stringify(response).includes("sourceKeyHash"));
    assert.equal(mocked.calls.length,2,"must read both Google V2 and full recent void window");

    r=await handleConfiguredJodloPlayVerification(post(bob),env,mocked.deps);
    assert.deepEqual((await r.json()).data,{status:"not_eligible"},
      "a foreign account cannot submit somebody else's purchase");
    assert.equal(mocked.calls.length,3,"owner mismatch stops refund history scan");
    assert.equal(keys.length,4);
    assert.ok(keys.every(key=>/^play-check-[a-f0-9]{32}$/.test(key)));
    assert.notEqual(keys[0],keys[1]);
    for(const table of ["call_credit_events","call_credit_balances",
      "play_consume_outbox","play_revocation_fences"])
      assert.equal(count(db,table),0,"read-only verification may not write "+table);
    assert.equal(await revokeSession(adapter,alice),true);
    assert.equal((await handleRequest(get(alice),env)).status,401);
  }finally{db.close();}
});

test("receipt verification never activates without every independent owner-controlled protection",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    db.exec("INSERT INTO accounts(id) VALUES ('play-verify-alice')");
    const token=(await issueSession(adapter,ALICE)).accessToken;
    const full=baseEnv(adapter);
    assert.equal((await handleRequest(get(token),{DB:adapter})).status,404);
    for(const broken of [
      {PLAY_CATALOG_ENABLED:"0"},{PLAY_VERIFICATION_LIMITER:undefined},
      {DB:undefined},{PLAY_SERVICE_ACCOUNT_EMAIL:undefined},
      {PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:undefined},
    ]){
      assert.equal((await handleRequest(get(token),{...full,...broken})).status,503);
    }
    assert.equal((await handleRequest(get())).status,404);
    assert.equal((await handleRequest(get(),full)).status,401);
    assert.equal((await handleRequest(get("x".repeat(43)),full)).status,401);
    assert.equal((await handleRequest(new Request(URL,{method:"DELETE"}),full)).status,405);
    assert.equal((await handleRequest(new Request(URL+"?accountId=alice",{
      headers:{Authorization:"Bearer "+token},
    }),full)).status,400);
    assert.equal((await handleRequest(post(token,
      JSON.stringify({purchaseToken:TOKEN}),{"Content-Type":"text/plain"}),full)).status,400);
    assert.equal((await handleRequest(post(token,
      '{"purchaseToken":"'+TOKEN+'","purchaseToken":"'+TOKEN+'"}'),full)).status,400);
    assert.equal((await handleRequest(post(token,
      JSON.stringify({purchaseToken:TOKEN,accountId:ALICE})),full)).status,400);
    assert.equal((await handleRequest(post(token,
      JSON.stringify({purchaseToken:"short"})),full)).status,400);
    assert.equal((await handleRequest(post(token,
      JSON.stringify({purchaseToken:"z".repeat(5000)})),full)).status,400);
    const throttled=baseEnv(adapter,{PLAY_VERIFICATION_LIMITER:{
      limit:async()=>({success:false}),
    }});
    const r=await handleRequest(post(token),throttled);
    assert.equal(r.status,429);
    assert.equal(r.headers.get("Retry-After"),"60");
    assert.equal(count(db,"call_credit_events"),0);
  }finally{db.close();}
});

test("pending, consumed, test and refunded Play purchase proofs do not award anything",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    db.exec("INSERT INTO accounts(id) VALUES ('play-verify-alice')");
    const owner=(await issueSession(adapter,ALICE)).accessToken;
    const env=baseEnv(adapter);
    const good=await receipt();
    const cases=[
      [await receipt(ALICE,{purchaseStateContext:{purchaseState:"PENDING"}}),
        {voidedPurchases:[]}],
      [await receipt(ALICE,{testPurchaseContext:{fopType:"TEST_PURCHASE"}}),
        {voidedPurchases:[]}],
      [await receipt(ALICE,{acknowledgementState:"ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"}),
        {voidedPurchases:[]}],
      [await receipt(ALICE,{productLineItem:[{productId:priceFree,
        productOfferDetails:{quantity:2,refundableQuantity:2,
        consumptionState:"CONSUMPTION_STATE_YET_TO_BE_CONSUMED"}}]}),
        {voidedPurchases:[]}],
      [good,{voidedPurchases:[{kind:"androidpublisher#voidedPurchase",
        purchaseToken:TOKEN}]}],
      [good,{voidedPurchases:[],tokenPagination:{nextPageToken:"unproven-tail"}}],
    ];
    for(const [purchase,voids] of cases){
      const fake=mockProvider(purchase,voids);
      const result=await handleConfiguredJodloPlayVerification(post(owner),env,fake.deps);
      assert.equal(result.status,200===result.status?200:503);
      if(voids.tokenPagination){
        assert.equal(result.status,503,"cannot assume completion when void history is partial");
      }else{
        assert.deepEqual((await result.json()).data,{status:"not_eligible"});
      }
      assert.equal(count(db,"call_credit_events"),0);
      assert.equal(count(db,"play_consume_outbox"),0);
    }
  }finally{db.close();}
});
