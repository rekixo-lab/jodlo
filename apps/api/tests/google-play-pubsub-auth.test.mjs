import assert from "node:assert/strict";
import test from "node:test";
import {
  SignJWT, createLocalJWKSet, exportJWK, exportPKCS8,
  generateKeyPair, decodeJwt, errors,
} from "jose";
import {
  authenticateJodloPlayPubSubPush,
  validJodloPubSubPolicy,
} from "../src/modules/interactions/google-play-pubsub-auth.ts";
import {
  handleConfiguredJodloPlayRtdn,
} from "../src/modules/interactions/google-play-pubsub-handler.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { jodloPlayPurchaseFingerprint } from
  "../src/modules/interactions/google-play-purchase-preflight.ts";
import { stageTrustedPlayConsumable } from
  "../src/modules/interactions/play-consumable-outbox.ts";

const TOKEN="synthetic.verified.rtdn.purchase.token.0001";
const ACCOUNT="rtdn-protected-owner";
const NOW=Date.now();
const POLICY={
  audience:"https://api.jodlo.rekixo.com/api/v1/play/rtdn",
  email:"jodlo-rtdn-push@jodlo-2027.iam.gserviceaccount.com",
  subscription:"projects/jodlo-2027/subscriptions/jodlo-play-rtdn",
};

async function context() {
  const pair=await generateKeyPair("RS256",{modulusLength:2048,extractable:true});
  const jwk={...await exportJWK(pair.publicKey),kid:"jodlo-synthetic-pubsub-test",
    alg:"RS256",use:"sig"};
  const keys=createLocalJWKSet({keys:[jwk]});
  const privateKey=await exportPKCS8(pair.privateKey);
  return {pair,keys,privateKey};
}
async function signed(keys,overrides={}) {
  const builder=new SignJWT({
    email:overrides.email??POLICY.email,
    email_verified:overrides.email_verified??true,
  }).setProtectedHeader({alg:"RS256",kid:"jodlo-synthetic-pubsub-test",
    typ:"JWT"}).setIssuer(overrides.iss??"https://accounts.google.com")
    .setSubject(overrides.sub??"123456789012345678")
    .setAudience(overrides.aud??POLICY.audience)
    .setIssuedAt(Math.floor(NOW/1000)-60)
    .setExpirationTime(Math.floor(NOW/1000)+300);
  return builder.sign(keys.pair.privateKey);
}
function body(kind="cancel",subscription=POLICY.subscription) {
  const base={
    packageName:"com.rekixo.jodlo",
    version:"1.0", eventTimeMillis:String(NOW-1000),
  };
  if(kind==="void")base.voidedPurchaseNotification={
    purchaseToken:TOKEN,productType:2,refundType:1,
  };
  else if(kind==="test")base.testNotification={version:"1.0"};
  else base.oneTimeProductNotification={
    version:"1.0",sku:"jodlo.testpack5",
    notificationType:kind==="purchase"?1:2,purchaseToken:TOKEN,
  };
  return {subscription,message:{
    messageId:"1234567890",
    data:Buffer.from(JSON.stringify(base)).toString("base64"),
  }};
}
function request(jwt,payload=body(),extras={}) {
  return new Request(POLICY.audience,{
    method:"POST",headers:{
      "Authorization":"Bearer "+jwt,
      "Content-Type":"application/json",
      ...extras,
    },body:JSON.stringify(payload),
  });
}
const count=(db,table)=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;

test("Google-signed Pub/Sub push validates signature, exact audience/email, issuer and subscription",async()=>{
  const c=await context();
  assert.equal(validJodloPubSubPolicy(POLICY),true);
  const jwt=await signed(c);
  const valid=await authenticateJodloPlayPubSubPush(
    request(jwt),POLICY,NOW,c.keys);
  assert.equal(valid.kind,"authenticated");
  assert.equal(valid.purchaseToken,TOKEN);
  assert.equal(valid.hint.kind,"canceled_hint");
  assert.equal(valid.hint.sourceKeyHash,
    await jodloPlayPurchaseFingerprint(TOKEN));
  assert.equal(JSON.stringify(valid.hint).includes(TOKEN),false,
    "untrusted hint never leaks full raw token");

  const failures=[
    [await signed(c,{aud:"https://wrong.example.com/api/v1/play/rtdn"}),body()],
    [await signed(c,{email:"other@jodlo-2027.iam.gserviceaccount.com"}),body()],
    [await signed(c,{email_verified:false}),body()],
    [await signed(c,{iss:"https://evil.example.com"}),body()],
    [await signed(c,{sub:"not-numeric"}),body()],
    [await signed(c,{aud:[POLICY.audience,"https://wrong.example.com"]}),body()],
    [jwt,body("cancel","projects/jodlo-2027/subscriptions/other-sub")],
    [jwt,body("cancel","projects/other/subscriptions/jodlo-play-rtdn")],
  ];
  for(const [token,payload] of failures)
    assert.equal((await authenticateJodloPlayPubSubPush(
      request(token,payload),POLICY,NOW,c.keys)).kind,
      "rejected","unauthorized JWT/audience/email/subscription must reject");
  const c2=await context();
  assert.equal((await authenticateJodloPlayPubSubPush(
    request(await signed(c2)),POLICY,NOW,c.keys)).kind,
    "rejected","unknown signing key cannot masquerade as Google");
  assert.equal((await authenticateJodloPlayPubSubPush(
    request(jwt,body("cancel"),{"Content-Type":"text/plain"}),POLICY,NOW,c.keys)
    ).kind,"rejected");
  assert.equal((await authenticateJodloPlayPubSubPush(
    request("bad.jwt.signature"),POLICY,NOW,c.keys)).kind,"rejected");
  assert.equal((await authenticateJodloPlayPubSubPush(
    request(jwt,body("purchase")),POLICY,NOW,c.keys)).hint.kind,"purchase_hint");
});

test("a temporary Google signing-key timeout stays retryable instead of becoming a rejected notification",async()=>{
  const c=await context();
  const result=await authenticateJodloPlayPubSubPush(request(await signed(c)),POLICY,NOW,
    async()=>{throw new errors.JWKSTimeout();});
  assert.deepEqual(result,{kind:"unavailable"});
});

test("RTDN is 404 by default and never makes auth or provider calls without complete config",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    const response=await (await import("../src/http/router.ts")).handleRequest(
      new Request(POLICY.audience,{method:"POST",body:JSON.stringify(body())}),
      {DB:adapter});
    assert.equal(response.status,404);
    const off=await handleConfiguredJodloPlayRtdn(
      new Request(POLICY.audience,{method:"POST"}),{DB:adapter});
    assert.equal(off.status,404);
    const incomplete=await handleConfiguredJodloPlayRtdn(
      new Request(POLICY.audience,{method:"POST"}),{
        DB:adapter,PLAY_RTDN_ENABLED:"1",
      });
    assert.equal(incomplete.status,503);
    assert.equal(count(db,"play_revocation_fences"),0);
    assert.equal(count(db,"call_credit_events"),0);
  } finally {db.close();}
});

test("authenticated cancellation with fresh matching Google V2 read records durable fence exactly once",async()=>{
  const c=await context();
  const jwt=await signed(c);
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('rtdn-protected-owner')");
    const calls=[];
    const env={
      DB:adapter,PLAY_RTDN_ENABLED:"1",
      PLAY_RTDN_AUDIENCE:POLICY.audience,
      PLAY_RTDN_PUSH_EMAIL:POLICY.email,
      PLAY_RTDN_SUBSCRIPTION:POLICY.subscription,
      PLAY_SERVICE_ACCOUNT_EMAIL:"jodlo-androidpublisher@jodlo-2027.iam.gserviceaccount.com",
      PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:c.privateKey,
      PLAY_RTDN_LIMITER:{limit:async()=>({success:true})},
    };
    const deps={
      keys:c.keys,nowMs:NOW,
      oauthRequest:async(url,init)=>{
        assert.equal(url,"https://oauth2.googleapis.com/token");
        assert.equal(init.method,"POST");
        assert.equal(init.body.get("grant_type"),
          "urn:ietf:params:oauth:grant-type:jwt-bearer");
        // The service account signs Google's fixed androidpublisher scope.
        const claims=decodeJwt(init.body.get("assertion"));
        assert.equal(claims.scope,"https://www.googleapis.com/auth/androidpublisher");
        return new Response(JSON.stringify({
          access_token:"synthetic-androidpublisher-token",
          expires_in:3600,token_type:"Bearer",
        }),{status:200});
      },
      playRequest:async(url,init)=>{
        calls.push({url,init});
        assert.equal(init.method,"GET","reconciliation is read-only");
        assert.equal(init.headers.Authorization,
          "Bearer synthetic-androidpublisher-token");
        assert.equal(url,
          "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"+
          "com.rekixo.jodlo/purchases/productsv2/tokens/"+TOKEN);
        return new Response(JSON.stringify({
          kind:"androidpublisher#productPurchaseV2",
          purchaseStateContext:{purchaseState:"CANCELLED"},
          productLineItem:[{productId:"jodlo.testpack5"}],
        }));
      },
    };
    const result=await handleConfiguredJodloPlayRtdn(request(jwt),env,deps);
    assert.equal(result.status,204);
    assert.equal(calls.length,1);
    assert.equal(count(db,"play_revocation_fences"),1);
    assert.equal(count(db,"call_credit_events"),0);
    const digest=await jodloPlayPurchaseFingerprint(TOKEN);
    assert.equal(db.prepare("SELECT reason FROM play_revocation_fences")
      .get().reason,"one_time_canceled");
    assert.equal(await stageTrustedPlayConsumable(adapter,{
      accountId:ACCOUNT,sourceKeyHash:digest,
      productId:"jodlo.testpack5",seconds:300,createdAtMs:NOW,
    },new Map([["jodlo.testpack5",5]])),"void_hold",
      "cancel before payment processing cannot lead to later accidental credit");
    assert.equal(count(db,"call_credit_events"),0);
    assert.equal((await handleConfiguredJodloPlayRtdn(
      request(jwt),env,deps)).status,204,"duplicate Pub/Sub push remains idempotent");
    assert.equal(count(db,"play_revocation_fences"),1);
  } finally {db.close();}
});

test("valid voided purchase requires Google Voided Purchases API token match; no false refund",async()=>{
  const c=await context();
  const jwt=await signed(c);
  const {db,adapter}=openLocalDatabase();
  try{
    const env={
      DB:adapter,PLAY_RTDN_ENABLED:"1",
      PLAY_RTDN_AUDIENCE:POLICY.audience,
      PLAY_RTDN_PUSH_EMAIL:POLICY.email,
      PLAY_RTDN_SUBSCRIPTION:POLICY.subscription,
      PLAY_SERVICE_ACCOUNT_EMAIL:"jodlo-androidpublisher@jodlo-2027.iam.gserviceaccount.com",
      PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:c.privateKey,
      PLAY_RTDN_LIMITER:{limit:async()=>({success:true})},
    };
    const validVoided={kind:"androidpublisher#voidedPurchase",
      purchaseToken:TOKEN,voidedQuantity:1};
    const deps=(voided)=>({
      keys:c.keys,nowMs:NOW,
      oauthRequest:async()=>new Response(JSON.stringify({
        access_token:"synthetic-androidpublisher-token",
        expires_in:3600,token_type:"Bearer",
      })),
      playRequest:async(url,init)=>{
        assert.equal(init.method,"GET");
        assert.equal(new URL(url).searchParams.get("type"),"0");
        assert.equal(new URL(url).searchParams.get("includeQuantityBasedPartialRefund"),"true");
        return new Response(JSON.stringify({voidedPurchases:voided?[
          validVoided]:[{...validVoided,purchaseToken:"other.synthetic.token"}]}));
      },
    });
    assert.equal((await handleConfiguredJodloPlayRtdn(
      request(jwt,body("void")),env,deps(false))).status,503);
    assert.equal(count(db,"play_revocation_fences"),0,
      "unconfirmed refund must not make a permanent revocation");
    assert.equal((await handleConfiguredJodloPlayRtdn(
      request(jwt,body("void")),env,deps(true))).status,204);
    assert.equal(count(db,"play_revocation_fences"),1);
    assert.equal(db.prepare("SELECT reason FROM play_revocation_fences")
      .get().reason,"voided_purchase");
    assert.equal(count(db,"call_credit_events"),0);
  }finally{db.close();}
});

test("failed OAuth, mismatched Google purchase state, rate limits and purchase hint never mint or fence",async()=>{
  const c=await context();
  const jwt=await signed(c);
  const {db,adapter}=openLocalDatabase();
  try{
    let oauthCalls=0,playCalls=0;
    const env={
      DB:adapter,PLAY_RTDN_ENABLED:"1",
      PLAY_RTDN_AUDIENCE:POLICY.audience,
      PLAY_RTDN_PUSH_EMAIL:POLICY.email,
      PLAY_RTDN_SUBSCRIPTION:POLICY.subscription,
      PLAY_SERVICE_ACCOUNT_EMAIL:"jodlo-androidpublisher@jodlo-2027.iam.gserviceaccount.com",
      PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:c.privateKey,
      PLAY_RTDN_LIMITER:{limit:async()=>({success:true})},
    };
    const deps={
      keys:c.keys,nowMs:NOW,
      oauthRequest:async()=>{
        oauthCalls++;return new Response(JSON.stringify({
          access_token:"synthetic-androidpublisher-token",
          expires_in:3600,token_type:"Bearer",
        }));
      },
      playRequest:async()=>{
        playCalls++;
        return new Response(JSON.stringify({
          kind:"androidpublisher#productPurchaseV2",
          purchaseStateContext:{purchaseState:"PURCHASED"},
          productLineItem:[{productId:"jodlo.testpack5"}],
        }));
      },
    };
    assert.equal((await handleConfiguredJodloPlayRtdn(
      request(jwt),env,deps)).status,503,
      "PURCHASED is NOT a cancellation proof");
    assert.equal(count(db,"play_revocation_fences"),0);
    assert.equal((await handleConfiguredJodloPlayRtdn(
      request(jwt,body("purchase")),env,deps)).status,204,
      "notification acknowledgement does not settle a purchase");
    assert.equal(count(db,"call_credit_events"),0);
    assert.equal((await handleConfiguredJodloPlayRtdn(
      request(jwt),{...env,PLAY_RTDN_LIMITER:{limit:async()=>({success:false})}},deps)
    ).status,429);
    assert.equal((await handleConfiguredJodloPlayRtdn(
      request(jwt),{...env,PLAY_RTDN_PUSH_EMAIL:"wrong@jodlo-2027.iam.gserviceaccount.com"},deps)
    ).status,401);
    assert.equal(count(db,"play_revocation_fences"),0);
    assert.equal(count(db,"call_credit_events"),0);
    assert.ok(oauthCalls>0);
    assert.ok(playCalls>0);
  }finally{db.close();}
});

test("signed Play Console probes and purchase hints acknowledge without grants, provider requests or refund quota",async()=>{
  const c=await context();
  const jwt=await signed(c);
  const {db,adapter}=openLocalDatabase();
  try{
    let limits=0,oauth=0,provider=0;
    const env={
      DB:adapter,PLAY_RTDN_ENABLED:"1",
      PLAY_RTDN_AUDIENCE:POLICY.audience,PLAY_RTDN_PUSH_EMAIL:POLICY.email,
      PLAY_RTDN_SUBSCRIPTION:POLICY.subscription,
      PLAY_SERVICE_ACCOUNT_EMAIL:"jodlo-androidpublisher@jodlo-2027.iam.gserviceaccount.com",
      PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:c.privateKey,
      PLAY_RTDN_LIMITER:{limit:async()=>{limits++;return {success:false};}},
    };
    const deps={keys:c.keys,nowMs:NOW,
      oauthRequest:async()=>{oauth++;throw Error("no OAuth for no-op");},
      playRequest:async()=>{provider++;throw Error("no provider for no-op");}};
    assert.deepEqual(await authenticateJodloPlayPubSubPush(
      request(jwt,body("test")),POLICY,NOW,c.keys),{kind:"authenticated_noop",event:"test"});
    for(const kind of ["test","purchase"]){
      for(let attempt=0;attempt<2;attempt++)
        assert.equal((await handleConfiguredJodloPlayRtdn(
          request(jwt,body(kind)),env,deps)).status,204);
      assert.equal((await handleConfiguredJodloPlayRtdn(
        request("bad.jwt.signature",body(kind)),env,deps)).status,401);
      assert.equal((await handleConfiguredJodloPlayRtdn(
        request(jwt,body(kind,"projects/jodlo-2027/subscriptions/foreign-sub")),env,deps)).status,401);
    }
    for(const mutate of [
      data=>{data.packageName="com.other.app";},
      data=>{data.eventTimeMillis=String(NOW-8*24*60*60*1000);},
      data=>{data.testNotification={version:"2.0"};},
      data=>{data.testNotification={version:"1.0",purchaseToken:TOKEN};},
      data=>{data.voidedPurchaseNotification={productType:2,refundType:1,purchaseToken:TOKEN};},
    ]){
      const payload=body("test");
      const data=JSON.parse(Buffer.from(payload.message.data,"base64").toString());
      mutate(data);payload.message.data=Buffer.from(JSON.stringify(data)).toString("base64");
      assert.equal((await handleConfiguredJodloPlayRtdn(request(jwt,payload),env,deps)).status,401);
    }
    assert.equal(limits,0);assert.equal(oauth,0);assert.equal(provider,0);
    for(const table of ["play_revocation_fences","call_credit_events","play_consume_outbox"])
      assert.equal(count(db,table),0);
  }finally{db.close();}
});


test("unsigned or foreign RTDN traffic cannot drain legitimate Pub/Sub shared quota", async()=>{
  const c=await context();
  const validJwt=await signed(c);
  const otherEmailJwt=await signed(c,{
    email:"attacker@jodlo-2027.iam.gserviceaccount.com",
  });
  const {db,adapter}=openLocalDatabase();
  try{
    let limits=0,oauth=0,playGets=0;
    const env={
      DB:adapter,PLAY_RTDN_ENABLED:"1",
      PLAY_RTDN_AUDIENCE:POLICY.audience,
      PLAY_RTDN_PUSH_EMAIL:POLICY.email,
      PLAY_RTDN_SUBSCRIPTION:POLICY.subscription,
      PLAY_SERVICE_ACCOUNT_EMAIL:"jodlo-androidpublisher@jodlo-2027.iam.gserviceaccount.com",
      PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:c.privateKey,
      PLAY_RTDN_LIMITER:{limit:async({key})=>{
        assert.equal(key,"google-play-rtdn");
        limits++;
        return {success:false};
      }},
    };
    const deps={
      keys:c.keys,nowMs:NOW,
      oauthRequest:async()=>{oauth++;throw Error("provider must not be called");},
      playRequest:async()=>{playGets++;throw Error("provider must not be called");},
    };
    for(const malformed of [
      request("bad.jwt.signature"),
      request(otherEmailJwt),
      request(validJwt,body("cancel",
        "projects/jodlo-2027/subscriptions/foreign-sub")),
    ]){
      const result=await handleConfiguredJodloPlayRtdn(malformed,env,deps);
      assert.equal(result.status,401,"unauthenticated push must not be throttled as Google");
      assert.equal(limits,0,"foreign/unsigned messages may not spend shared retry quota");
    }
    const throttled=await handleConfiguredJodloPlayRtdn(
      request(validJwt),env,deps);
    assert.equal(throttled.status,429,
      "fully Google-authenticated push still obeys configured limit");
    assert.equal(throttled.headers.get("Retry-After"),"60");
    assert.equal(limits,1);
    assert.equal(oauth,0);
    assert.equal(playGets,0);
    assert.equal(count(db,"play_revocation_fences"),0);
    assert.equal(count(db,"call_credit_events"),0);
    assert.equal(count(db,"play_consume_outbox"),0);
  }finally{db.close();}
});
