import assert from "node:assert/strict";
import test from "node:test";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {handleRequest} from "../src/http/router.ts";
import {issueSession,sessionHash} from "../src/modules/identity/sessions.ts";
import {stageTrustedPlayConsumable} from "../src/modules/interactions/play-consumable-outbox.ts";
import {recordTrustedPlayRevocation} from "../src/modules/interactions/google-play-rtdn-fences.ts";
import {registerPlayRefundPolicy} from "../src/modules/interactions/play-refund-review.ts";

const KEY="a".repeat(64), HASH="b".repeat(64), EVIDENCE="c".repeat(64);
const POLICY={version:"jodlo-play-refund-hold-v1",approvalSha256:"d".repeat(64)};
const ROOT="https://api.jodlo.example/api/v1/operations/";
const req=(path,options={})=>new Request(ROOT+path,{...options,
  headers:{Authorization:"Bearer "+KEY,...options.headers}});
const setup=()=>{
  const f=openLocalDatabase();
  f.limits=0;
  f.env={DB:f.adapter,OPERATIONS_ENABLED:"1",OPERATIONS_KEY:KEY,
    OPERATIONS_LIMITER:{limit:async()=>{f.limits++;return {success:true};}},
    BUILD_COMMIT_SHA:"e".repeat(40),PLAY_REFUND_HOLDS_ENABLED:"1",
    PLAY_REFUND_POLICY_VERSION:POLICY.version,PLAY_REFUND_APPROVAL_SHA256:POLICY.approvalSha256};
  return f;
};

test("operator routes remain off by default; app bearer and invalid secret spend no operator quota",async()=>{
  const f=setup();
  try{
    assert.equal((await handleRequest(req("readiness"),{DB:f.adapter})).status,404);
    f.db.exec("INSERT INTO accounts(id) VALUES('operator-test-account')");
    const bearer=(await issueSession(f.adapter,"operator-test-account")).accessToken;
    for(const authorization of [undefined,"Bearer "+bearer,"Bearer "+"f".repeat(64),"Bearer "+KEY+", Bearer "+KEY]){
      const request=new Request(ROOT+"readiness",{headers:authorization?{Authorization:authorization}:{}});
      const response=await handleRequest(request,f.env);
      assert.equal(response.status,401);
      assert.equal(response.headers.get("Cache-Control"),"no-store");
      const body=await response.text();
      for(const secret of [KEY,bearer,"operator-test-account"])assert.ok(!body.includes(secret));
    }
    assert.equal(f.limits,0);
    assert.equal((await handleRequest(req("readiness"),{...f.env,OPERATIONS_LIMITER:{limit:async()=>({success:false})}})).status,429);
    const outage=await handleRequest(req("readiness"),{...f.env,OPERATIONS_LIMITER:{limit:async()=>{throw Error("private limiter error");}}});
    assert.equal(outage.status,503);
    assert.ok(!(await outage.text()).includes("private limiter error"));
  }finally{f.db.close();}
});

test("readiness exposes deployed commit and bounded aggregate health, never claims provider acceptance",async()=>{
  const f=setup();
  try{
    const response=await handleRequest(req("readiness"),f.env);
    assert.equal(response.status,200);
    const {data}=await response.json();
    assert.equal(data.sourceCommit,f.env.BUILD_COMMIT_SHA);
    assert.equal(data.schemaReady,true);
    assert.equal(data.providerAcceptance,"requires_external_evidence");
    assert.equal(data.configured.playSettlement,false);
    assert.equal(data.configured.callUsage,false);
    assert.deepEqual(data.queues,{pendingPurchases:0,refundReviews:0,overdueCallSettlements:0,conflictingCallEvidence:0});
    assert.ok(!JSON.stringify(data).includes(KEY));
    assert.equal((await (await handleRequest(req("readiness"),{...f.env,BUILD_COMMIT_SHA:"unverified"})).json()).data.sourceCommit,null);
    assert.equal((await handleRequest(req("readiness?owner=someone"),f.env)).status,400);
    assert.equal((await handleRequest(req("readiness",{method:"POST"}),f.env)).status,400);
  }finally{f.db.close();}
});

test("operator review resolves only a verified owner-bound hold, with immutable evidence and safe replay",async()=>{
  const f=setup();
  try{
    const now=Date.now()-10000;
    f.db.exec("INSERT INTO accounts(id) VALUES('refund-owner')");
    const bearer=(await issueSession(f.adapter,"refund-owner")).accessToken;
    await registerPlayRefundPolicy(f.adapter,POLICY,now);
    assert.equal(await stageTrustedPlayConsumable(f.adapter,{
      accountId:"refund-owner",sourceKeyHash:HASH,productId:"jodlo.minutes5",seconds:300,createdAtMs:now,
    },new Map([["jodlo.minutes5",5]]),{sessionHash:await sessionHash(bearer),policyVersion:"jodlo-play-minutes-v1",
      approvalSha256:"f".repeat(64),purchasedAtMs:now-1000}),"applied");
    await recordTrustedPlayRevocation(f.adapter,{sourceKeyHash:HASH,reason:"voided_purchase",recordedAtMs:now+1});
    const queued=await (await handleRequest(req("refund-reviews"),f.env)).json();
    assert.equal(queued.data.cases.length,1);
    assert.equal(queued.data.cases[0].caseId,HASH);
    assert.ok(!JSON.stringify(queued).includes(bearer));
    const before=f.db.prepare("SELECT count(*) AS n FROM call_credit_events").get().n;
    const resolve=body=>handleRequest(req("refund-reviews",{method:"POST",headers:{"Content-Type":"application/json"},body}),f.env);
    const body=JSON.stringify({caseKey:HASH,evidenceSha256:EVIDENCE});
    assert.equal((await (await resolve(body)).json()).data.status,"applied");
    assert.equal((await (await resolve(body)).json()).data.status,"replay");
    assert.equal((await (await resolve(JSON.stringify({caseKey:HASH,evidenceSha256:"1".repeat(64)}))).json()).data.status,"denied");
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM call_credit_events").get().n,before);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM play_revocation_fences").get().n,1);
    assert.equal((await (await handleRequest(req("refund-reviews"),f.env)).json()).data.cases.length,0);
  }finally{f.db.close();}
});

test("review command rejects duplicate keys, injected fields, query/body ambiguity and unconfigured policies",async()=>{
  const f=setup();
  try{
    for(const body of [
      `{"caseKey":"${HASH}","caseKey":"${EVIDENCE}"}`,
      JSON.stringify({caseKey:HASH,evidenceSha256:EVIDENCE,accountId:"foreign"}),
      `{"caseKey":"${HASH}","evidenceSha256":"${EVIDENCE}","evidenceSha256":"${EVIDENCE}"}`,
      `{"caseKey":"${HASH}","evidenceSha256":"bad"}`,
      " ".repeat(513),
    ]){
      assert.equal((await handleRequest(req("refund-reviews",{method:"POST",headers:{"Content-Type":"application/json"},body}),f.env)).status,400);
    }
    for(const query of ["?after=bad","?after="+HASH+"&after="+HASH,"?accountId=foreign"])
      assert.equal((await handleRequest(req("refund-reviews"+query),f.env)).status,400);
    assert.equal((await handleRequest(req("refund-reviews"),{...f.env,PLAY_REFUND_HOLDS_ENABLED:"0"})).status,503);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM play_refund_reviews").get().n,0);
  }finally{f.db.close();}
});
