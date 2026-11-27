import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {SignJWT,createLocalJWKSet,exportJWK,exportPKCS8,generateKeyPair} from "jose";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession,sessionHash} from "../src/modules/identity/sessions.ts";
import {stageTrustedPlayConsumable} from "../src/modules/interactions/play-consumable-outbox.ts";
import {jodloPlayAccountBinding,jodloPlayPurchaseFingerprint} from "../src/modules/interactions/google-play-purchase-preflight.ts";
import {registerPlayRefundPolicy} from "../src/modules/interactions/play-refund-review.ts";
import {authenticateJodloPlayPubSubPush} from "../src/modules/interactions/google-play-pubsub-auth.ts";
import {handleConfiguredJodloPlayRtdn} from "../src/modules/interactions/google-play-pubsub-handler.ts";
import {listPendingPlayRefundReviews,recordPendingPlayRefundReviewOutcome,
  recordAuthenticatedPendingPlayRefundReview,queuePendingPlayRefundReviewDecision} from "../src/modules/interactions/play-pending-refund-review.ts";

const OWNER="pending-review-owner",OTHER="pending-review-other",SKU="jodlo.minutes5";
const TOKEN="synthetic.pending.review.purchase.token.00001";
const PENDING="synthetic-pending-refund-token-000001",ORDER="GPA.1234-5678-9012-34567";
const POLICY={version:"jodlo-play-refund-hold-v1",approvalSha256:"a".repeat(64)};
const PUSH={audience:"https://jodlo.example.invalid/api/v1/play/rtdn",
  email:"push@jodlo-test.iam.gserviceaccount.com",subscription:"projects/jodlo-test/subscriptions/jodlo-rtdn"};
const hashPending=value=>createHash("sha256").update("jodlo-play-pending-refund-v1:com.rekixo.jodlo:"+value).digest("hex");
const count=(db,table)=>db.prepare("SELECT count(*) AS n FROM "+table).get().n;
let keyPromise;
async function keys(){
  return keyPromise??=generateKeyPair("RS256",{modulusLength:2048,extractable:true}).then(async pair=>({pair,
    privateKey:await exportPKCS8(pair.privateKey),keys:createLocalJWKSet({keys:[{
      ...await exportJWK(pair.publicKey),kid:"synthetic-pending-review",alg:"RS256",use:"sig"}]}),
  }));
}
async function fixture(options={}){
  const f=openLocalDatabase(),key=await keys();
  f.clock=Date.now();f.purchasedAt=f.clock-(options.purchaseAgeMs??100_000);
  f.eventTime=f.clock-1000;f.environment=options.environment??"production";
  f.db.exec(`INSERT INTO accounts(id) VALUES('${OWNER}'),('${OTHER}')`);
  f.bearer=(await issueSession(f.adapter,OWNER)).accessToken;
  f.binding=await jodloPlayAccountBinding(OWNER);f.sourceKeyHash=await jodloPlayPurchaseFingerprint(TOKEN);
  await registerPlayRefundPolicy(f.adapter,POLICY,f.clock);
  if(!options.noGrant){
    assert.equal(await stageTrustedPlayConsumable(f.adapter,{accountId:OWNER,sourceKeyHash:f.sourceKeyHash,
      productId:SKU,seconds:300,createdAtMs:f.clock},new Map([[SKU,5]]),options.legacy?undefined:{
      sessionHash:await sessionHash(f.bearer),policyVersion:"jodlo-play-minutes-v1",approvalSha256:"b".repeat(64),
      purchasedAtMs:f.purchasedAt,purchaseEnvironment:f.environment}),"applied");
    f.db.exec("UPDATE play_consume_outbox SET status='consumed'");
  }
  f.order={orderId:ORDER,purchaseToken:TOKEN,lineItems:[{productId:SKU,oneTimePurchaseDetails:{quantity:1}}]};
  f.receipt={kind:"androidpublisher#productPurchaseV2",orderId:ORDER,obfuscatedExternalAccountId:f.binding,
    purchaseStateContext:{purchaseState:"PURCHASED"},purchaseCompletionTime:new Date(f.purchasedAt).toISOString(),
    acknowledgementState:"ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",productLineItem:[{productId:SKU,
      productOfferDetails:{quantity:1,refundableQuantity:1,consumptionState:"CONSUMPTION_STATE_CONSUMED"}}],
    ...(f.environment==="license_test"?{testPurchaseContext:{fopType:"TEST"}}:{}),
  };
  f.calls=[];f.posts=[];f.limits=0;f.oauth=0;f.hook=async()=>{};f.postReply=async()=>new Response(null,{status:204});
  f.env={DB:f.adapter,PLAY_RTDN_ENABLED:"1",PLAY_RTDN_AUDIENCE:PUSH.audience,PLAY_RTDN_PUSH_EMAIL:PUSH.email,
    PLAY_RTDN_SUBSCRIPTION:PUSH.subscription,PLAY_SERVICE_ACCOUNT_EMAIL:"billing@jodlo-test.iam.gserviceaccount.com",
    PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:key.privateKey,PLAY_REFUND_HOLDS_ENABLED:"1",
    PLAY_REFUND_POLICY_VERSION:POLICY.version,PLAY_REFUND_APPROVAL_SHA256:POLICY.approvalSha256,
    PLAY_RTDN_LIMITER:{limit:async()=>{f.limits++;return {success:true};}}};
  f.playRequest=async(url,init)=>{
    if(init.method==="POST"){
      assert.equal(url,"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.rekixo.jodlo/orders/"+ORDER+":reviewrefund");
      f.posts.push(JSON.parse(init.body));await f.hook(url,init);return f.postReply();
    }
    assert.equal(init.method,"GET","pending reviews never submit a financial provider action");
    f.calls.push(url);await f.hook(url,init);
    if(url.includes("/orders/")){
      assert.equal(new URL(url).searchParams.get("fields"),"orderId,purchaseToken,lineItems(productId,oneTimePurchaseDetails(quantity))");
      return new Response(JSON.stringify(f.order));
    }
    assert.ok(url.includes("/purchases/productsv2/tokens/"));
    return new Response(JSON.stringify(f.receipt));
  };
  f.body=(overrides={},mutate=()=>{})=>{
    const data={version:"1.0",packageName:"com.rekixo.jodlo",eventTimeMillis:String(overrides.eventTimeMs??f.eventTime),
      pendingRefundReviewNotification:{version:"1.0",pendingRefundToken:overrides.pendingToken??PENDING,
        orderId:ORDER,refundReason:7,obfuscatedAccountId:f.binding}};
    mutate(data);
    return {subscription:PUSH.subscription,message:{messageId:overrides.messageId??"100000000001",
      data:Buffer.from(JSON.stringify(data)).toString("base64")}};
  };
  f.request=async(payload=f.body(),badJwt=false)=>{
    const now=Math.floor(f.clock/1000);
    const jwt=badJwt?"bad.jwt.signature":await new SignJWT({email:PUSH.email,email_verified:true})
      .setProtectedHeader({alg:"RS256",kid:"synthetic-pending-review"}).setIssuer("https://accounts.google.com")
      .setSubject("123456789012345678").setAudience(PUSH.audience).setIssuedAt(now-5).setExpirationTime(now+300).sign(key.pair.privateKey);
    return new Request(PUSH.audience,{method:"POST",headers:{Authorization:"Bearer "+jwt,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  };
  f.call=async(payload=f.body(),badJwt=false)=>handleConfiguredJodloPlayRtdn(await f.request(payload,badJwt),f.env,{
    keys:key.keys,nowMs:f.clock,oauthRequest:async()=>{f.oauth++;return new Response(JSON.stringify({
      access_token:"synthetic-pending-oauth",token_type:"Bearer",expires_in:3600}));},playRequest:f.playRequest});
  f.authenticated=async()=>authenticateJodloPlayPubSubPush(await f.request(),PUSH,f.clock,key.keys);
  f.row=()=>f.db.prepare("SELECT * FROM play_pending_refund_reviews").get();
  f.decide=async(overrides={})=>queuePendingPlayRefundReviewDecision(f.adapter,{
    caseId:hashPending(PENDING),policy:POLICY,refundPreference:"NEUTRAL",sampleContentProvided:false,
    decisionEvidenceHash:"e".repeat(64),decidedAtMs:f.clock,...overrides});
  return f;
}

test("signed pending chargeback creates one provider-bound private inbox and preserves its original deadline on replay",async()=>{
  for(const environment of ["production","license_test"]){
    const f=await fixture({environment});
    try{
      const balance={...f.db.prepare("SELECT * FROM call_credit_balances").get()};
      const auth=await f.authenticated();
      assert.equal(auth.kind,"authenticated_pending_refund_review");
      assert.equal(auth.hint.pendingRefundToken,PENDING,"the signed event keeps its token only in request memory");
      const response=await f.call();
      assert.equal(response.status,503);assert.equal(response.headers.get("Retry-After"),"300");
      const row={...f.row()};
      assert.equal(row.case_id,hashPending(PENDING));assert.equal(row.source_key_hash,f.sourceKeyHash);
      assert.equal(row.purchase_environment,environment);assert.equal(row.account_binding,f.binding);
      assert.equal(row.response_deadline_ms,f.eventTime+86400_000);assert.equal(row.state,"open");
      assert.equal(f.calls.length,2);assert.equal(f.oauth,1);
      for(const raw of [TOKEN,PENDING,ORDER,f.bearer])assert.equal(JSON.stringify(row).includes(raw),false);
      f.clock+=30*60_000;
      assert.equal((await f.call(f.body({messageId:"100000000002"}))).status,503);
      assert.deepEqual({...f.row()},row,"redelivery cannot reset the provider response clock or original correlation message");
      assert.equal(f.calls.length,2,"a confirmed identical journal replay needs no extra provider lookups");
      const queue=await listPendingPlayRefundReviews(f.adapter,POLICY,null,f.clock);
      assert.equal(queue.cases.length,1);assert.equal(queue.cases[0].overdue,false);
      assert.equal(queue.cases[0].purchaseEnvironment,environment);
      for(const privateValue of [TOKEN,PENDING,ORDER,f.binding,"order_hash","account_binding"])
        assert.equal(JSON.stringify(queue).includes(privateValue),false);
      assert.deepEqual({...f.db.prepare("SELECT * FROM call_credit_balances").get()},balance);
      assert.equal(count(f.db,"call_credit_events"),1);
      assert.equal(count(f.db,"play_revocation_fences"),0);assert.equal(count(f.db,"play_refund_reviews"),0);
      assert.equal(f.db.prepare("SELECT status FROM play_consume_outbox").get().status,"consumed");
    }finally{f.db.close();}
  }
});

test("unsigned, wrong-package, mixed or malformed pending reviews do not use quota, call providers or create cases",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.call(f.body(),true)).status,401);
    for(const mutate of [
      d=>{d.packageName="com.foreign.app";},d=>{d.pendingRefundReviewNotification.refundReason=1;},
      d=>{d.pendingRefundReviewNotification.obfuscatedAccountId=null;},d=>{d.pendingRefundReviewNotification.version="2.0";},
      d=>{d.pendingRefundReviewNotification.pendingRefundToken="";},d=>{d.pendingRefundReviewNotification.pendingRefundToken="a".repeat(4097);},
      d=>{d.pendingRefundReviewNotification.orderId="../foreign";},d=>{d.testNotification={version:"1.0"};},
      d=>{d.eventTimeMillis=String(f.clock-8*86400_000);},d=>{d.eventTimeMillis=String(f.clock+6*60_000);},
    ])assert.equal((await f.call(f.body({},mutate))).status,401);
    assert.equal(f.limits,0);assert.equal(f.oauth,0);assert.equal(f.calls.length,0);
    assert.equal(count(f.db,"play_pending_refund_reviews"),0);
  }finally{f.db.close();}
});

test("pending reviews require matching Google order, original authorized owner, SKU, purchase time and environment",async()=>{
  const mutations=[
    f=>{f.order.orderId="GPA.9999-9999-9999-99999";},f=>{f.order.purchaseToken=TOKEN+"unknown";},
    f=>{f.order.lineItems=[];},f=>{f.order.lineItems[0].oneTimePurchaseDetails.quantity=2;},
    f=>{delete f.order.lineItems[0].oneTimePurchaseDetails;},f=>{f.order.lineItems[0].productId="jodlo.minutes20";},
    f=>{f.receipt.orderId="GPA.9999-9999-9999-99999";},f=>{f.receipt.obfuscatedExternalAccountId="c".repeat(64);},
    f=>{f.receipt.productLineItem[0].productId="jodlo.minutes20";},f=>{f.receipt.purchaseCompletionTime=new Date(f.purchasedAt-1000).toISOString();},
    f=>{f.receipt.purchaseStateContext.purchaseState="PENDING";},f=>{f.receipt.testPurchaseContext={fopType:"TEST"};},
    f=>{f.receipt.productLineItem[0].productOfferDetails.quantity=2;},
  ];
  for(const mutate of mutations){
    const f=await fixture();
    try{mutate(f);assert.equal((await f.call()).status,503);assert.equal(count(f.db,"play_pending_refund_reviews"),0);
      assert.equal(count(f.db,"call_credit_events"),1);assert.equal(count(f.db,"play_refund_reviews"),0);
    }finally{f.db.close();}
  }
  for(const option of [{noGrant:true},{legacy:true}]){
    const f=await fixture(option);
    try{assert.equal((await f.call()).status,503);assert.equal(count(f.db,"play_pending_refund_reviews"),0);}
    finally{f.db.close();}
  }
});

test("pending inbox race, changed delivery evidence and account erasure cannot fabricate or duplicate a case",async()=>{
  const f=await fixture();
  try{
    const results=await Promise.all([f.call(),f.call(),f.call()]);
    assert.ok(results.every(r=>r.status===503));assert.equal(count(f.db,"play_pending_refund_reviews"),1);
    const original={...f.row()};
    assert.equal((await f.call(f.body({eventTimeMs:f.eventTime+1}))).status,503);
    assert.equal((await f.call(f.body({},d=>{d.pendingRefundReviewNotification.obfuscatedAccountId="d".repeat(64);}))).status,503);
    assert.deepEqual({...f.row()},original);
    assert.throws(()=>f.db.exec("UPDATE play_pending_refund_reviews SET response_deadline_ms=response_deadline_ms+1000"),/IMMUTABLE/);
    f.db.prepare("DELETE FROM accounts WHERE id=?").run(OWNER);
    assert.equal(count(f.db,"play_pending_refund_reviews"),0);
    assert.equal((await f.call()).status,503);assert.equal(count(f.db,"play_pending_refund_reviews"),0);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{f.db.close();}
  const raced=await fixture();
  try{
    raced.hook=async url=>{if(url.includes("productsv2"))raced.db.prepare("DELETE FROM accounts WHERE id=?").run(OWNER);};
    assert.equal((await raced.call()).status,503);assert.equal(count(raced.db,"play_pending_refund_reviews"),0);
    assert.deepEqual(raced.db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{raced.db.close();}
});

test("operator inbox is deadline-ordered, bounded, overdue-aware and only records immutable evidence of manual handling",async()=>{
  const f=await fixture({purchaseAgeMs:3*86400_000});
  try{
    const payloads=[];
    for(let n=0;n<27;n++){
      const payload=f.body({pendingToken:PENDING+"-"+n,messageId:String(100000000100+n),eventTimeMs:f.clock-26*3600_000+n*1000});
      payloads.push(payload);assert.equal((await f.call(payload)).status,204);
    }
    const first=await listPendingPlayRefundReviews(f.adapter,POLICY,null,f.clock);
    assert.equal(first.cases.length,25);assert.ok(first.cases.every(c=>c.overdue));assert.ok(first.nextCursor);
    const second=await listPendingPlayRefundReviews(f.adapter,POLICY,first.nextCursor,f.clock);
    assert.equal(second.cases.length,2);assert.equal(second.nextCursor,null);
    assert.equal(new Set([...first.cases,...second.cases].map(c=>c.caseId)).size,27);
    assert.ok(first.cases.every((c,i)=>i===0||c.responseDeadlineMs>=first.cases[i-1].responseDeadlineMs));
    const row=first.cases[0],evidence="e".repeat(64);
    const input={caseId:row.caseId,policy:POLICY,resolutionEvidenceHash:evidence,reviewedAtMs:f.clock};
    assert.equal(await recordPendingPlayRefundReviewOutcome(f.adapter,{...input,resolutionEvidenceHash:"0".repeat(64)}),"denied");
    assert.equal(await recordPendingPlayRefundReviewOutcome(f.adapter,{...input,policy:{...POLICY,approvalSha256:"f".repeat(64)}}),"denied");
    assert.equal(await recordPendingPlayRefundReviewOutcome(f.adapter,input),"applied");
    assert.equal(await recordPendingPlayRefundReviewOutcome(f.adapter,input),"replay");
    assert.equal(await recordPendingPlayRefundReviewOutcome(f.adapter,{...input,resolutionEvidenceHash:"f".repeat(64)}),"denied");
    assert.equal((await f.call(payloads[0])).status,204,"redelivery cannot reopen a manually reviewed case");
    assert.equal(f.db.prepare("SELECT state FROM play_pending_refund_reviews WHERE case_id=?").get(row.caseId).state,"reviewed");
    assert.throws(()=>f.db.prepare("UPDATE play_pending_refund_reviews SET state='open' WHERE case_id=?").run(row.caseId),/IMMUTABLE/);
    const afterReviewed=await listPendingPlayRefundReviews(f.adapter,POLICY,row.caseId,f.clock);
    assert.equal(afterReviewed.cases.length,25,"a cursor remains valid after its case has been reviewed");
    assert.equal(count(f.db,"call_credit_events"),1);assert.equal(count(f.db,"play_refund_reviews"),0);
    assert.equal(count(f.db,"play_revocation_fences"),0);
  }finally{f.db.close();}
});

test("pending review provider outages, oversized bodies and timeouts cannot create an inbox without proof",async()=>{
  for(const kind of ["oauth","order-error","oversize","stalled"]){
    const f=await fixture();
    try{
      const authenticated=await f.authenticated();
      const result=await recordAuthenticatedPendingPlayRefundReview(f.adapter,authenticated,{
        refundPolicy:POLICY,now:()=>f.clock,timeoutMs:45,
        accessToken:async()=>kind==="oauth"?new Promise(()=>{}):"synthetic-oauth",
        request:async()=>kind==="order-error"?new Response(null,{status:503}):kind==="oversize"?
          new Response("x".repeat(16385)):new Response(new ReadableStream({start(){}})),
      });
      assert.equal(result,"retry",kind);assert.equal(count(f.db,"play_pending_refund_reviews"),0,kind);
    }finally{f.db.close();}
  }
});

test("an explicit immutable operator preference is sent once on signed redelivery with transient token and no inferred usage",async()=>{
  for(const environment of ["production","license_test"]){
    for(const refundPreference of ["APPROVE","DECLINE","NEUTRAL"]){
      const f=await fixture({environment});
      try{
        assert.equal((await f.call()).status,503);
        assert.equal(f.posts.length,0,"receiving a chargeback never chooses a recommendation");
        const initial={...f.db.prepare("SELECT * FROM call_credit_balances").get()};
        const decision={refundPreference,sampleContentProvided:refundPreference==="DECLINE"};
        assert.equal(await f.decide(decision),"applied");
        assert.equal(await f.decide({...decision,decidedAtMs:f.clock+1}),"replay");
        assert.equal(await f.decide({...decision,sampleContentProvided:!decision.sampleContentProvided}),"denied");
        assert.equal(await f.decide({...decision,decisionEvidenceHash:"f".repeat(64)}),"denied");
        assert.equal(f.posts.length,0,"operator queue writes do not contact Google");
        const queued=await listPendingPlayRefundReviews(f.adapter,POLICY,null,f.clock);
        assert.equal(queued.cases[0].state,"queued");
        assert.equal(queued.cases[0].refundPreference,refundPreference);
        assert.equal(queued.cases[0].sampleContentProvided,decision.sampleContentProvided);
        assert.throws(()=>f.db.exec("UPDATE play_pending_refund_reviews SET refund_preference='APPROVE'"),/IMMUTABLE/);
        assert.equal((await f.call()).status,204);
        assert.equal(f.calls.length,4,"submission re-verifies both the Google order and original V2 receipt");
        assert.deepEqual(f.posts,[{pendingRefundToken:PENDING,...decision}]);
        assert.equal(f.row().state,"submitted");
        assert.equal((await f.call(f.body({messageId:"100000000099"}))).status,204);
        assert.equal(f.posts.length,1);
        assert.equal(f.calls.length,4);
        assert.equal((await listPendingPlayRefundReviews(f.adapter,POLICY,null,f.clock)).cases.length,0);
        assert.deepEqual({...f.db.prepare("SELECT * FROM call_credit_balances").get()},initial);
        assert.equal(count(f.db,"call_credit_events"),1);
        assert.equal(count(f.db,"play_revocation_fences"),0);
        assert.equal(count(f.db,"play_refund_reviews"),0);
        assert.equal(f.db.prepare("SELECT status FROM play_consume_outbox").get().status,"consumed");
        for(const raw of [TOKEN,PENDING,ORDER,f.bearer])assert.equal(JSON.stringify(f.row()).includes(raw),false);
      }finally{f.db.close();}
    }
  }
});

test("queued recommendations reject invalid inputs and external receipts can resolve an unsent decision without a provider action",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.call()).status,503);
    for(const bad of [
      {caseId:"9".repeat(64)},{refundPreference:"REFUND_PREFERENCE_UNSPECIFIED"},{refundPreference:"approve"},
      {sampleContentProvided:1},{sampleContentProvided:"true"},{decisionEvidenceHash:"0".repeat(64)},
      {decidedAtMs:0},{policy:{...POLICY,approvalSha256:"f".repeat(64)}},
    ])assert.equal(await f.decide(bad),"denied");
    assert.equal(f.row().state,"open");
    assert.equal(await f.decide(),"applied");
    assert.equal(await recordPendingPlayRefundReviewOutcome(f.adapter,{caseId:hashPending(PENDING),policy:POLICY,
      resolutionEvidenceHash:"f".repeat(64),reviewedAtMs:f.clock}),"applied");
    assert.equal((await f.call()).status,204);
    assert.equal(f.row().state,"reviewed");assert.equal(f.posts.length,0);
  }finally{f.db.close();}
});

test("queued signed redelivery must still match the original owner, order, purchase environment and current journal",async()=>{
  for(const change of ["order","binding","environment","missing-account"]){
    const f=await fixture();
    try{
      assert.equal((await f.call()).status,503);assert.equal(await f.decide(),"applied");
      if(change==="order")f.order.orderId="GPA.9999-9999-9999-99999";
      if(change==="binding")f.receipt.obfuscatedExternalAccountId="c".repeat(64);
      if(change==="environment")f.receipt.testPurchaseContext={fopType:"TEST"};
      if(change==="missing-account")f.hook=async url=>{if(url.includes("productsv2"))f.db.prepare("DELETE FROM accounts WHERE id=?").run(OWNER);};
      assert.equal((await f.call()).status,503,change);assert.equal(f.posts.length,0,change);
      if(change!=="missing-account")assert.equal(f.row().state,"queued",change);
      else assert.equal(count(f.db,"play_pending_refund_reviews"),0);
    }finally{f.db.close();}
  }
});

test("the original 24-hour deadline rejects late decisions and late submission claims at database execution time",async()=>{
  for(const phase of ["decision","claim","claimed"]){
    const f=await fixture();
    try{
      assert.equal((await f.call()).status,503);
      const deadline=f.row().response_deadline_ms;
      if(phase==="decision"){
        f.db.function("unixepoch",()=>Math.ceil(deadline/1000));
        assert.equal(await f.decide(),"denied");
      }else{
        assert.equal(await f.decide(),"applied");
        f.env.DB={...f.adapter,prepare(sql){
          const statement=f.adapter.prepare(sql),all=statement.all.bind(statement);
          statement.all=async()=>{
            const claim=sql.includes("SET state='submitting'");
            if(claim&&phase==="claim")f.db.function("unixepoch",()=>Math.ceil(deadline/1000));
            const result=await all();
            if(claim&&phase==="claimed")f.db.function("unixepoch",()=>Math.ceil(deadline/1000));
            return result;
          };
          return statement;
        }};
      }
      assert.equal((await f.call()).status,204,phase);
      assert.equal(f.row().state,phase==="claimed"?"unknown":"expired",phase);
      assert.equal(f.row().response_deadline_ms,deadline);
      assert.equal(f.posts.length,0,phase);
      assert.equal((await f.call(f.body({messageId:"100000000098"}))).status,204);
      assert.equal(f.posts.length,0);
      const queue=await listPendingPlayRefundReviews(f.adapter,POLICY,null,deadline+1000);
      assert.equal(queue.cases[0].overdue,true);
      assert.equal(queue.cases[0].state,phase==="claimed"?"unknown":"expired");
    }finally{f.db.close();}
  }
});

test("concurrent authenticated redeliveries cannot send the same explicit recommendation twice",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.call()).status,503);assert.equal(await f.decide(),"applied");
    const responses=await Promise.all([f.call(),f.call(),f.call(),f.call()]);
    assert.ok(responses.every(response=>[204,503].includes(response.status)));
    assert.equal(f.posts.length,1);assert.equal(f.row().state,"submitted");
    assert.equal((await f.call()).status,204);assert.equal(f.posts.length,1);
    assert.throws(()=>f.db.exec("UPDATE play_pending_refund_reviews SET state='queued'"),/IMMUTABLE/);
    assert.throws(()=>f.db.exec("UPDATE play_pending_refund_reviews SET submission_started_at_ms=NULL"),/IMMUTABLE/);
  }finally{f.db.close();}
});

test("ambiguous provider replies and timed-out sends remain unknown and never retry the POST",async()=>{
  for(const responseKind of ["throw","server-error","redirect","timeout"]){
    const f=await fixture();
    try{
      assert.equal((await f.call()).status,503);assert.equal(await f.decide(),"applied");
      f.postReply=async()=>{
        if(responseKind==="throw")throw Error("Synthetic lost provider response");
        if(responseKind==="timeout")return new Promise(()=>{});
        return new Response(null,{status:responseKind==="redirect"?302:503});
      };
      const result=await recordAuthenticatedPendingPlayRefundReview(f.adapter,await f.authenticated(),{
        refundPolicy:POLICY,now:()=>f.clock,timeoutMs:75,accessToken:async()=>"synthetic-oauth",request:f.playRequest,
      });
      assert.ok(["applied","replay","retry"].includes(result));assert.equal(f.posts.length,1,responseKind);
      if(f.row().state==="submitting")f.clock+=11_000;
      assert.equal((await f.call()).status,204,responseKind);
      assert.equal(f.row().state,"unknown",responseKind);
      assert.equal((await f.call()).status,204);assert.equal(f.posts.length,1);
      assert.equal(await f.decide(),"replay","repeating a decision does not reset its one-attempt fence");
      assert.equal(await recordPendingPlayRefundReviewOutcome(f.adapter,{caseId:hashPending(PENDING),policy:POLICY,
        resolutionEvidenceHash:"f".repeat(64),reviewedAtMs:f.clock}),"applied");
      assert.equal(f.row().state,"reviewed");assert.equal((await f.call()).status,204);assert.equal(f.posts.length,1);
    }finally{f.db.close();}
  }
});

test("a crash after the durable attempt fence cannot authorize any later provider send",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.call()).status,503);assert.equal(await f.decide(),"applied");
    const crashing={...f.adapter,prepare(sql){
      const statement=f.adapter.prepare(sql),all=statement.all.bind(statement);
      statement.all=async()=>{
        const value=await all();
        return sql.includes("SET state='submitting'")?new Promise(()=>{}):value;
      };
      return statement;
    }};
    assert.equal(await recordAuthenticatedPendingPlayRefundReview(crashing,await f.authenticated(),{
      refundPolicy:POLICY,now:()=>f.clock,timeoutMs:50,accessToken:async()=>"synthetic-oauth",request:f.playRequest,
    }),"retry");
    assert.equal(f.row().state,"submitting");assert.equal(f.posts.length,0);
    assert.equal((await f.call()).status,503,"an active request keeps its bounded one-attempt fence");
    assert.equal(await recordPendingPlayRefundReviewOutcome(f.adapter,{caseId:hashPending(PENDING),policy:POLICY,
      resolutionEvidenceHash:"f".repeat(64),reviewedAtMs:f.clock}),"denied");
    f.clock+=11_000;
    assert.equal((await f.call()).status,204);assert.equal(f.row().state,"unknown");
    assert.equal((await f.call()).status,204);assert.equal(f.posts.length,0);
  }finally{f.db.close();}
});

test("a successful provider reply whose D1 receipt cannot commit remains fenced across retries",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.call()).status,503);assert.equal(await f.decide(),"applied");
    f.env.DB={...f.adapter,prepare(sql){
      const statement=f.adapter.prepare(sql);
      if(sql.startsWith("UPDATE play_pending_refund_reviews SET state=?,submission_finished"))
        statement.all=async()=>{throw Error("Synthetic post-reply database outage");};
      return statement;
    }};
    assert.equal((await f.call()).status,503);assert.equal(f.posts.length,1);assert.equal(f.row().state,"submitting");
    f.env.DB=f.adapter;f.clock+=11_000;
    assert.equal((await f.call()).status,204);assert.equal(f.row().state,"unknown");assert.equal(f.posts.length,1);
  }finally{f.db.close();}
});

test("an absent optional RTDN account hint derives its owner from the authorized Google order and V2 receipt",async()=>{
  const f=await fixture();
  try{
    const withoutHint=f.body({},data=>{delete data.pendingRefundReviewNotification.obfuscatedAccountId;});
    assert.equal((await f.call(withoutHint)).status,503);
    assert.equal(f.row().account_binding,f.binding);
    assert.equal(f.row().source_key_hash,f.sourceKeyHash);
    assert.equal(await f.decide({refundPreference:"DECLINE",sampleContentProvided:true}),"applied");
    assert.equal((await f.call(f.body({},data=>{data.pendingRefundReviewNotification.obfuscatedAccountId="c".repeat(64);}))).status,503);
    assert.equal(f.posts.length,0,"a mismatching present hint cannot override the derived owner");
    assert.equal((await f.call(withoutHint)).status,204);
    assert.deepEqual(f.posts,[{pendingRefundToken:PENDING,refundPreference:"DECLINE",sampleContentProvided:true}]);
    assert.equal(f.row().state,"submitted");
    assert.equal(f.row().account_binding,f.binding);
    assert.equal((await f.call()).status,204,"later delivery with the matching optional hint remains the same case");
    assert.equal(f.posts.length,1);
  }finally{f.db.close();}
});
