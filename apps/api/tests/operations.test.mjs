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
    assert.deepEqual(data.readiness,{ready:true,configurationErrors:[]});
    assert.equal(data.licenseTest,false);
    assert.equal(data.providerAcceptance,"requires_external_evidence");
    assert.equal(data.configured.playSettlement,false);
    assert.equal(data.configured.callUsage,false);
    assert.deepEqual(data.queues,{pendingPurchases:0,licenseTestPurchases:0,pendingLicenseTestPurchases:0,
      refundReviews:0,licenseTestRefundReviews:0,pendingRefundReviews:0,licenseTestPendingRefundReviews:0,
      overduePendingRefundReviews:0,overdueLicenseTestPendingRefundReviews:0,
      queuedPendingRefundReviews:0,licenseTestQueuedPendingRefundReviews:0,
      submittingPendingRefundReviews:0,licenseTestSubmittingPendingRefundReviews:0,
      unknownPendingRefundReviews:0,licenseTestUnknownPendingRefundReviews:0,
      expiredPendingRefundReviews:0,licenseTestExpiredPendingRefundReviews:0,
      overdueCallSettlements:0,conflictingCallEvidence:0});
    assert.ok(!JSON.stringify(data).includes(KEY));
    assert.equal((await (await handleRequest(req("readiness"),{...f.env,BUILD_COMMIT_SHA:"unverified"})).json()).data.sourceCommit,null);
    assert.equal((await handleRequest(req("readiness?owner=someone"),f.env)).status,400);
    assert.equal((await handleRequest(req("readiness",{method:"POST"}),f.env)).status,400);
  }finally{f.db.close();}
});

test("readiness fails for missing forward schema, malformed flags and a changed immutable refund approval without leaking inputs",async()=>{
  const f=setup();
  try{
    const invalid={...f.env,CALL_USAGE_ENABLED:"enabled",GOOGLE_CLIENT_ID:"PRIVATE_BAD_CLIENT",
      ACCOUNT_ERASURE_RELEASE_KEY:"PRIVATE_ERASURE_SECRET"};
    const response=await handleRequest(req("readiness"),invalid);
    assert.equal(response.status,200);
    const {data}=await response.json();
    assert.equal(data.readiness.ready,false);
    assert.ok(data.readiness.configurationErrors.includes("CALL_USAGE_ENABLED_INVALID"));
    assert.ok(data.readiness.configurationErrors.includes("ACCOUNT_ERASURE_RELEASE_KEY_INVALID"));
    for(const hidden of [KEY,"PRIVATE_BAD_CLIENT","PRIVATE_ERASURE_SECRET"])assert.ok(!JSON.stringify(data).includes(hidden));
    await registerPlayRefundPolicy(f.adapter,POLICY,Date.now());
    const conflict=await (await handleRequest(req("readiness"),{...f.env,PLAY_REFUND_APPROVAL_SHA256:"2".repeat(64)})).json();
    assert.equal(conflict.data.readiness.ready,false);
    assert.equal(conflict.data.configured.refundHolds,false);
    assert.ok(conflict.data.readiness.configurationErrors.includes("PLAY_REFUND_POLICY_REGISTRATION_CONFLICT"));
    f.db.exec("DROP TRIGGER end_call_after_listing_withdrawal");
    const missing=await (await handleRequest(req("readiness"),f.env)).json();
    assert.equal(missing.data.schemaReady,false);
    assert.equal(missing.data.readiness.ready,false);
    assert.equal(missing.data.queues,null);
  }finally{f.db.close();}
});

async function seedPendingReviews(f,{overdue=true}={}){
  const now=Date.now(),created=now-(overdue?2*86400000:60000);
  await registerPlayRefundPolicy(f.adapter,POLICY,created);
  const rows=[];
  for(const [index,environment] of ["production","license_test"].entries()){
    const account="pending-refund-owner-"+index,source=(index?"4":"5").repeat(64),caseId=(index?"6":"7").repeat(64);
    f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
    const bearer=(await issueSession(f.adapter,account)).accessToken;
    assert.equal(await stageTrustedPlayConsumable(f.adapter,{accountId:account,sourceKeyHash:source,
      productId:"jodlo.minutes5",seconds:300,createdAtMs:created},new Map([["jodlo.minutes5",5]]),
      {sessionHash:await sessionHash(bearer),policyVersion:"jodlo-play-minutes-v1",approvalSha256:"8".repeat(64),
        purchasedAtMs:created-1000,purchaseEnvironment:environment}),"applied");
    f.db.prepare("INSERT INTO play_pending_refund_reviews(case_id,source_key_hash,account_id,account_binding,order_hash,"+
      "purchase_environment,provider_message_id,event_time_ms,response_deadline_ms,received_at_ms,policy_version,approval_hash) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(caseId,source,account,"9".repeat(64),"0".repeat(63)+"1",environment,
      String(100+index),created,created+86400000,created+1000,POLICY.version,POLICY.approvalSha256);
    rows.push({source,caseId,account,bearer,environment});
  }
  return rows;
}

test("pending refund inbox exposes bounded operator cases and records external review without refunding or changing minute credit",async()=>{
  const f=setup();
  try{
    const rows=await seedPendingReviews(f),before=f.db.prepare("SELECT total_changes() AS n").get().n;
    const read=await (await handleRequest(req("pending-refund-reviews"),f.env)).json();
    assert.equal(read.data.cases.length,2);assert.equal(read.data.nextCursor,null);
    assert.ok(read.data.cases.every(row=>row.overdue===true));
    assert.deepEqual(new Set(read.data.cases.map(row=>row.purchaseEnvironment)),new Set(["production","license_test"]));
    for(const forbidden of ["account_binding","order_hash","pendingRefundToken","orderId","purchaseToken",...rows.map(x=>x.bearer)])
      assert.ok(!JSON.stringify(read).includes(forbidden));
    const ready=await (await handleRequest(req("readiness"),f.env)).json();
    assert.equal(ready.data.queues.pendingPurchases,1);
    assert.equal(ready.data.queues.pendingLicenseTestPurchases,1);
    assert.equal(ready.data.queues.licenseTestPurchases,1);
    assert.equal(ready.data.queues.pendingRefundReviews,1);
    assert.equal(ready.data.queues.licenseTestPendingRefundReviews,1);
    assert.equal(ready.data.queues.overduePendingRefundReviews,1);
    assert.equal(ready.data.queues.overdueLicenseTestPendingRefundReviews,1);
    assert.equal(f.db.prepare("SELECT total_changes() AS n").get().n,before,"list and readiness stay read-only");
    const financialBefore=JSON.stringify(f.db.prepare("SELECT * FROM call_credit_balances ORDER BY account_id").all());
    const evidence=JSON.stringify({caseKey:rows[0].caseId,evidenceSha256:EVIDENCE});
    const record=body=>handleRequest(req("pending-refund-reviews",{method:"POST",headers:{"Content-Type":"application/json"},body}),f.env);
    assert.deepEqual((await (await record(evidence)).json()).data,{status:"applied",providerAction:"recorded_external_review_only"});
    assert.equal((await (await record(evidence)).json()).data.status,"replay");
    assert.equal((await (await record(JSON.stringify({caseKey:rows[0].caseId,evidenceSha256:"3".repeat(64)}))).json()).data.status,"denied");
    assert.equal(JSON.stringify(f.db.prepare("SELECT * FROM call_credit_balances ORDER BY account_id").all()),financialBefore);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM play_revocation_fences").get().n,0);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM play_refund_reviews").get().n,0);
    assert.equal((await (await handleRequest(req("pending-refund-reviews"),f.env)).json()).data.cases.length,1);
  }finally{f.db.close();}
});

test("explicit pending refund decisions queue one immutable recommendation and never submit from the operator handler",async()=>{
  const f=setup();
  try{
    const rows=await seedPendingReviews(f,{overdue:false});
    const before=JSON.stringify(f.db.prepare("SELECT * FROM call_credit_balances ORDER BY account_id").all());
    const decision={caseKey:rows[0].caseId,evidenceSha256:EVIDENCE,refundPreference:"DECLINE",sampleContentProvided:false};
    const send=(body,env=f.env)=>handleRequest(req("pending-refund-reviews",{method:"POST",headers:{"Content-Type":"application/json"},body}),env);
    assert.equal((await send(JSON.stringify(decision))).status,503,"queuing provider work requires the existing RTDN activation flag");
    f.env.PLAY_RTDN_ENABLED="1";
    const first=await (await send(JSON.stringify(decision))).json();
    assert.deepEqual(first.data,{status:"applied",providerAction:"queued_single_recommendation_on_authenticated_rtdn_redelivery"});
    assert.deepEqual((await (await send(JSON.stringify(decision))).json()).data,
      {status:"replay",providerAction:"existing_decision_kept_no_new_submission"});
    const reordered=JSON.stringify({sampleContentProvided:false,refundPreference:"DECLINE",evidenceSha256:EVIDENCE,caseKey:rows[0].caseId});
    assert.equal((await (await send(reordered)).json()).data.status,"replay");
    for(const changed of [{...decision,refundPreference:"APPROVE"},{...decision,sampleContentProvided:true},{...decision,evidenceSha256:"2".repeat(64)}]){
      const result=await (await send(JSON.stringify(changed))).json();
      assert.deepEqual(result.data,{status:"denied",providerAction:"not_queued"});
    }
    const listed=await (await handleRequest(req("pending-refund-reviews"),f.env)).json();
    const queued=listed.data.cases.find(row=>row.caseId===rows[0].caseId);
    assert.equal(queued.state,"queued");assert.equal(queued.refundPreference,"DECLINE");
    assert.equal(queued.sampleContentProvided,false);assert.equal(queued.submissionStartedAtMs,null);
    const ready=await (await handleRequest(req("readiness"),f.env)).json();
    assert.equal(ready.data.queues.pendingRefundReviews,1);
    assert.equal(ready.data.queues.queuedPendingRefundReviews,1);
    assert.equal(ready.data.queues.licenseTestQueuedPendingRefundReviews,0);
    assert.equal(ready.data.queues.submittingPendingRefundReviews,0);
    assert.equal(JSON.stringify(f.db.prepare("SELECT * FROM call_credit_balances ORDER BY account_id").all()),before);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM play_revocation_fences").get().n,0);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM play_refund_reviews").get().n,0);
    // External handling has a separate exact body and may complete a queued
    // case without ever making this operator route submit to the provider.
    const recorded=await (await send(JSON.stringify({caseKey:rows[0].caseId,evidenceSha256:"3".repeat(64)}))).json();
    assert.deepEqual(recorded.data,{status:"applied",providerAction:"recorded_external_review_only"});
  }finally{f.db.close();}
});

test("pending decision parser rejects duplicate fields, coerced booleans, escaped names and incomplete or foreign modes",async()=>{
  const f=setup();
  try{
    f.env.PLAY_RTDN_ENABLED="1";
    const valid={caseKey:HASH,evidenceSha256:EVIDENCE,refundPreference:"NEUTRAL",sampleContentProvided:true};
    const bodies=[
      JSON.stringify({...valid,sampleContentProvided:"true"}),JSON.stringify({...valid,sampleContentProvided:1}),
      JSON.stringify({...valid,refundPreference:"approve"}),JSON.stringify({...valid,consumed:true}),
      JSON.stringify({...valid,refundPreference:undefined}),JSON.stringify({...valid,sampleContentProvided:undefined}),
      JSON.stringify(valid).replace('"sampleContentProvided":true','"sampleContentProvided":true,"sampleContentProvided":false'),
      JSON.stringify(valid).replace('"caseKey"','"case\\u004bey"'),
      JSON.stringify(valid).replace('"evidenceSha256"','"caseKey"'),
    ];
    const before=f.db.prepare("SELECT total_changes() AS n").get().n;
    for(const body of bodies)
      assert.equal((await handleRequest(req("pending-refund-reviews",{method:"POST",headers:{"Content-Type":"application/json"},body}),f.env)).status,400,body);
    assert.equal((await handleRequest(req("refund-reviews",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(valid)}),f.env)).status,400,
      "the existing confirmed-hold resolution route must not accept the new provider decision mode");
    assert.equal(f.db.prepare("SELECT total_changes() AS n").get().n,before);
  }finally{f.db.close();}
});

test("readiness retains unknown and expired review cases in separate production and license-test queues",async()=>{
  const f=setup();
  try{
    const rows=await seedPendingReviews(f,{overdue:false});
    f.env.PLAY_RTDN_ENABLED="1";
    const body=JSON.stringify({caseKey:rows[1].caseId,evidenceSha256:EVIDENCE,
      refundPreference:"NEUTRAL",sampleContentProvided:false});
    assert.equal((await (await handleRequest(req("pending-refund-reviews",{method:"POST",
      headers:{"Content-Type":"application/json"},body}),f.env)).json()).data.status,"applied");
    // Model the existing provider sender's durable transitions without any
    // provider transport. The monitoring query must retain an uncertain send.
    f.db.prepare("UPDATE play_pending_refund_reviews SET state='submitting',submission_started_at_ms=decision_at_ms WHERE case_id=?").run(rows[1].caseId);
    f.db.prepare("UPDATE play_pending_refund_reviews SET state='unknown',submission_finished_at_ms=submission_started_at_ms WHERE case_id=?").run(rows[1].caseId);
    f.db.prepare("UPDATE play_pending_refund_reviews SET state='expired' WHERE case_id=?").run(rows[0].caseId);
    const before=f.db.prepare("SELECT total_changes() AS n").get().n;
    const {data}=await (await handleRequest(req("readiness"),f.env)).json();
    assert.equal(data.queues.pendingRefundReviews,1);
    assert.equal(data.queues.licenseTestPendingRefundReviews,1);
    assert.equal(data.queues.expiredPendingRefundReviews,1);
    assert.equal(data.queues.licenseTestExpiredPendingRefundReviews,0);
    assert.equal(data.queues.unknownPendingRefundReviews,0);
    assert.equal(data.queues.licenseTestUnknownPendingRefundReviews,1);
    assert.equal(data.queues.licenseTestSubmittingPendingRefundReviews,0);
    assert.equal(f.db.prepare("SELECT total_changes() AS n").get().n,before);
    const listed=await (await handleRequest(req("pending-refund-reviews"),f.env)).json();
    assert.deepEqual(new Set(listed.data.cases.map(row=>row.state)),new Set(["expired","unknown"]));
  }finally{f.db.close();}
});

test("pending refund operator routes reject app tokens, query duplication and body ambiguity",async()=>{
  const f=setup();
  try{
    assert.equal((await handleRequest(req("pending-refund-reviews"),{DB:f.adapter})).status,404);
    assert.equal((await handleRequest(req("pending-refund-reviews",{headers:{Authorization:"Bearer "+"p".repeat(43)}}),f.env)).status,401);
    for(const suffix of ["?after=bad","?after="+HASH+"&after="+HASH,"?owner=someone"])
      assert.equal((await handleRequest(req("pending-refund-reviews"+suffix),f.env)).status,400);
    for(const body of [`{"caseKey":"${HASH}","caseKey":"${EVIDENCE}"}`,
      JSON.stringify({caseKey:HASH,evidenceSha256:EVIDENCE,refund:true})])
      assert.equal((await handleRequest(req("pending-refund-reviews",{method:"POST",headers:{"Content-Type":"application/json"},body}),f.env)).status,400);
    assert.equal((await handleRequest(req("pending-refund-reviews"),{...f.env,PLAY_REFUND_HOLDS_ENABLED:"0"})).status,503);
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
