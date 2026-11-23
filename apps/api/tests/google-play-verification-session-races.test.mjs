import test from "node:test";
import assert from "node:assert/strict";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession, revokeSession, sessionHash, findSessionAccount} from
  "../src/modules/identity/sessions.ts";
import {jodloPlayAccountBinding} from
  "../src/modules/interactions/google-play-purchase-preflight.ts";
import {handleConfiguredJodloPlayVerification} from
  "../src/modules/interactions/google-play-verification-handler.ts";

const URL="https://api.jodlo.example/api/v1/me/play-verify";
const ALICE="play-race-alice";
const BOB="play-race-bob";
const TOKEN="synthetic.jodlo.owner.race.token.00000001";
const SKU="jodlo.minutes20";
const body=JSON.stringify({purchaseToken:TOKEN});
const headers=t=>({Authorization:"Bearer "+t});
const get=t=>new Request(URL,{headers:headers(t)});
const post=t=>new Request(URL,{
  method:"POST",headers:{...headers(t),"Content-Type":"application/json"},body,
});
const count=(db,t)=>db.prepare("SELECT COUNT(*) AS n FROM "+t).get().n;

function setup(){
  const {db,adapter}=openLocalDatabase();
  db.exec("INSERT INTO accounts(id) VALUES ('play-race-alice'),('play-race-bob')");
  const environment={
    DB:adapter,PLAY_CATALOG_ENABLED:"1",PLAY_VERIFICATION_ENABLED:"1",
    PLAY_SERVICE_ACCOUNT_EMAIL:"synthetic@jodlo-test.iam.gserviceaccount.com",
    PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:"unusable-test-key",
    PLAY_VERIFICATION_LIMITER:{limit:async()=>({success:true})},
  };
  return {db,adapter,environment};
}
const asNoPrivateEvidence=async (response, tokens)=> {
  assert.equal(response.status,401);
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  const text=await response.text();
  assert.match(text,/"UNAUTHORIZED"/);
  for(const sensitive of [...tokens,SKU,"accountBinding",
    "screened_pending_settlement","not_eligible","sourceKeyHash"])
    assert.ok(!text.includes(sensitive),"revoked response leaked private data");
};
function assertNoFinancialWrites(db){
  for(const table of ["call_credit_events","call_credit_balances",
    "play_consume_outbox","play_revocation_fences"])
    assert.equal(count(db,table),0,"a read-only verification must not write "+table);
}
async function validReceipt(){
  return {
    kind:"androidpublisher#productPurchaseV2",
    obfuscatedExternalAccountId:await jodloPlayAccountBinding(ALICE),
    acknowledgementState:"ACKNOWLEDGEMENT_STATE_PENDING",
    purchaseStateContext:{purchaseState:"PURCHASED"},
    purchaseCompletionTime:new Date(Date.now()-20000).toISOString(),
    productLineItem:[{productId:SKU,productOfferDetails:{
      quantity:1,refundableQuantity:1,
      consumptionState:"CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
    }}],
  };
}
const json=value=>new Response(JSON.stringify(value),{status:200});

test("logout during async limiter blocks both Google binding GET and purchase POST",async()=>{
  for(const method of ["GET","POST"]){
    const {db,adapter,environment}=setup();
    try{
      const token=(await issueSession(adapter,ALICE)).accessToken;
      let calls=0;
      environment.PLAY_VERIFICATION_LIMITER={
        limit:async()=>{assert.equal(await revokeSession(adapter,token),true);
          return {success:true};},
      };
      const response=await handleConfiguredJodloPlayVerification(
        method==="GET"?get(token):post(token),environment,{
          accessToken:async()=>{calls++;return "synthetic-oauth";},
          playRequest:async()=>{calls++;return json({});},
        });
      await asNoPrivateEvidence(response,[token,TOKEN,ALICE]);
      assert.equal(calls,0,"revoked session must not call Google");
      assertNoFinancialWrites(db);
    }finally{db.close();}
  }
});

test("logout during a slow POST body read prevents Google OAuth and purchase screening",async()=>{
  const {db,adapter,environment}=setup();
  try{
    const token=(await issueSession(adapter,ALICE)).accessToken;
    let sent=false;
    const stream=new ReadableStream({
      async pull(controller){
        if(sent)return;
        sent=true;
        assert.equal(await revokeSession(adapter,token),true);
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    },{highWaterMark:0});
    const request=new Request(URL,{
      method:"POST",headers:{
        ...headers(token),"Content-Type":"application/json",
      },body:stream,duplex:"half",
    });
    let calls=0;
    const result=await handleConfiguredJodloPlayVerification(
      request,environment,{
        accessToken:async()=>{calls++;return "synthetic-oauth";},
        playRequest:async()=>{calls++;return json({});},
      });
    assert.equal(sent,true,"body upload was actually processed");
    await asNoPrivateEvidence(result,[token,TOKEN,ALICE]);
    assert.equal(calls,0);
    assertNoFinancialWrites(db);
  }finally{db.close();}
});

test("logout during final voided-purchase page suppresses otherwise positive screening",async()=>{
  const {db,adapter,environment}=setup();
  try{
    const token=(await issueSession(adapter,ALICE)).accessToken;
    const other=(await issueSession(adapter,BOB)).accessToken;
    const receipt=await validReceipt();
    let calls=0;
    const response=await handleConfiguredJodloPlayVerification(post(token),
      environment,{
        now:Date.now,
        accessToken:async()=>"synthetic-oauth",
        playRequest:async(url,init)=>{
          calls++;
          assert.equal(init.method,"GET");
          if(url.includes("/productsv2/tokens/"))return json(receipt);
          assert.equal(await revokeSession(adapter,token),true);
          return json({voidedPurchases:[]});
        },
      });
    assert.equal(calls,2,"Google screening reached the final refund lookup");
    await asNoPrivateEvidence(response,[token,TOKEN,ALICE]);
    assert.equal(await findSessionAccount(adapter,other),BOB);
    assertNoFinancialWrites(db);
  }finally{db.close();}
});

test("disabled account during provider V2 read cannot receive even not_eligible result",async()=>{
  const {db,adapter,environment}=setup();
  try{
    const token=(await issueSession(adapter,ALICE)).accessToken;
    let calls=0;
    const response=await handleConfiguredJodloPlayVerification(post(token),
      environment,{
        accessToken:async()=>"synthetic-oauth",
        playRequest:async()=>{
          calls++;
          db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(ALICE);
          return json({kind:"invalid-purchase"});
        },
      });
    await asNoPrivateEvidence(response,[token,TOKEN,ALICE]);
    assert.equal(calls,1,"invalid V2 cannot trigger extra void scans");
    assertNoFinancialWrites(db);
  }finally{db.close();}
});

test("session expiry during provider lookup suppresses late status",async()=>{
  const {db,adapter,environment}=setup();
  try{
    const token=(await issueSession(adapter,ALICE)).accessToken;
    const receipt=await validReceipt();
    const response=await handleConfiguredJodloPlayVerification(post(token),
      environment,{
        accessToken:async()=>"synthetic-oauth",
        playRequest:async(url)=>{
          if(url.includes("/productsv2/tokens/"))return json(receipt);
          db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?")
            .run(await sessionHash(token));
          return json({voidedPurchases:[]});
        },
      });
    await asNoPrivateEvidence(response,[token,TOKEN,ALICE]);
    assertNoFinancialWrites(db);
  }finally{db.close();}
});
