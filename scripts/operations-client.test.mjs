import test from "node:test";
import assert from "node:assert/strict";
import {runOperations} from "./operations-client.mjs";
const key="a".repeat(64),sha="b".repeat(40),env={JODLO_OPERATIONS_KEY:key};
test("operator readiness verifies exact deployed source and never follows redirects",async()=>{
  let call;
  const request=async(url,init)=>{call={url,init};return Response.json({ok:true,data:{sourceCommit:sha,schemaReady:true}});};
  assert.equal((await runOperations(["readiness","--expected-sha",sha],env,{request})).schemaReady,true);
  assert.equal(call.url,"https://api.jodlo.rekixo.com/api/v1/operations/readiness");
  assert.equal(call.init.redirect,"error");assert.equal(call.init.method,"GET");
  assert.equal(call.init.headers.Authorization,"Bearer "+key);
  await assert.rejects(runOperations(["readiness","--expected-sha","c".repeat(40)],env,{request}),/differs/);
});
test("refund review release requires explicit apply and content-bound evidence",async()=>{
  const args=["refund-resolve","--case","c".repeat(64),"--evidence","review.txt"];
  let calls=0,payload;
  const request=async(_url,init)=>{calls++;payload=JSON.parse(init.body);return Response.json({ok:true,data:{status:"applied"}});};
  const readEvidence=async()=>Buffer.from("Reviewed confirmed provider dispute and approved customer release.");
  await assert.rejects(runOperations(args,env,{request,readEvidence}),/--apply/);assert.equal(calls,0);
  assert.equal((await runOperations([...args,"--apply"],env,{request,readEvidence})).status,"applied");
  assert.equal(payload.caseKey,"c".repeat(64));assert.match(payload.evidenceSha256,/^[a-f0-9]{64}$/);
  assert.equal(Object.keys(payload).length,2);
});
test("operator client refuses credential argv, foreign flags and unauthenticated requests",async()=>{
  await assert.rejects(runOperations(["refund-list"],{}),/environment|JODLO_OPERATIONS_KEY/);
  await assert.rejects(runOperations(["refund-list","--origin","https://foreign.invalid"],env),/Invalid option/);
  await assert.rejects(runOperations(["refund-list","--key",key],env),/Invalid option/);
});

test("pending refund commands use the separate inbox and record only explicitly supplied external review evidence",async()=>{
  const calls=[],evidence=Buffer.from("Synthetic externally completed provider review evidence for tests only.");
  const request=async(url,init)=>{calls.push({url,init});return Response.json({ok:true,data:init.method==="GET"?
    {cases:[],nextCursor:null}:{status:"applied",providerAction:"recorded_external_review_only"}});};
  const deps={request,readEvidence:async()=>evidence};
  await runOperations(["pending-refund-list","--after","c".repeat(64)],env,deps);
  assert.equal(calls[0].url,"https://api.jodlo.rekixo.com/api/v1/operations/pending-refund-reviews?after="+"c".repeat(64));
  assert.equal(calls[0].init.method,"GET");
  const args=["pending-refund-record","--case","c".repeat(64),"--evidence","review.txt"];
  await assert.rejects(runOperations(args,env,deps),/--apply/);assert.equal(calls.length,1);
  const data=await runOperations([...args,"--apply"],env,deps);
  assert.equal(data.providerAction,"recorded_external_review_only");
  assert.equal(calls[1].url,"https://api.jodlo.rekixo.com/api/v1/operations/pending-refund-reviews");
  assert.equal(calls[1].init.method,"POST");
  assert.deepEqual(Object.keys(JSON.parse(calls[1].init.body)),["caseKey","evidenceSha256"]);
  assert.ok(!calls[1].init.body.includes(evidence.toString()));
});

test("pending refund decision requires every explicit recommendation field and describes its delayed provider effect",async()=>{
  const calls=[],evidence=Buffer.from("Synthetic decision evidence; no actual provider request is sent by this test.");
  const request=async(url,init)=>{calls.push({url,init});return Response.json({ok:true,data:{status:"applied",
    providerAction:"queued_single_recommendation_on_authenticated_rtdn_redelivery"}});};
  const deps={request,readEvidence:async()=>evidence};
  const args=["pending-refund-decide","--case","c".repeat(64),"--preference","DECLINE",
    "--sample-content-provided","false","--evidence","review.txt","--apply"];
  for(const missing of ["--case","--preference","--sample-content-provided","--evidence","--apply"]){
    const bad=args.slice(),index=bad.indexOf(missing);bad.splice(index,missing==="--apply"?1:2);
    await assert.rejects(runOperations(bad,env,deps),/queues one provider recommendation on authenticated RTDN redelivery/);
  }
  for(const [field,value] of [["--preference","approve"],["--preference","REFUND"],["--sample-content-provided","1"],["--sample-content-provided",""]]){
    const bad=args.slice();bad[bad.indexOf(field)+1]=value;
    await assert.rejects(runOperations(bad,env,deps),/requires/);
  }
  await assert.rejects(runOperations([...args,"--sample-content-provided","true"],env,deps),/Invalid option/);
  assert.equal(calls.length,0,"invalid or incomplete instructions must not reach the operator endpoint");
  for(const preference of ["APPROVE","DECLINE","NEUTRAL"])for(const sample of ["true","false"]){
    const chosen=args.slice();chosen[chosen.indexOf("--preference")+1]=preference;
    chosen[chosen.indexOf("--sample-content-provided")+1]=sample;
    const result=await runOperations(chosen,env,deps);
    assert.equal(result.providerAction,"queued_single_recommendation_on_authenticated_rtdn_redelivery");
    const {url,init}=calls.at(-1),body=JSON.parse(init.body);
    assert.equal(url,"https://api.jodlo.rekixo.com/api/v1/operations/pending-refund-reviews");
    assert.equal(init.method,"POST");
    assert.deepEqual(Object.keys(body),["caseKey","evidenceSha256","refundPreference","sampleContentProvided"]);
    assert.equal(body.refundPreference,preference);assert.equal(body.sampleContentProvided,sample==="true");
    assert.ok(!init.body.includes(evidence.toString()));
  }
  const external=["pending-refund-record","--case","c".repeat(64),"--evidence","review.txt","--apply","--preference","APPROVE"];
  await assert.rejects(runOperations(external,env,deps),/requires/);
});

test("operator response rejects oversized streaming bodies before reading the remainder",async()=>{
  let pulls=0,cancelled=false;
  const body=new ReadableStream({
    pull(controller){pulls++;controller.enqueue(new Uint8Array(128*1024));},
    cancel(){cancelled=true;},
  },{highWaterMark:0});
  await assert.rejects(runOperations(["refund-list"],env,{request:async()=>new Response(body)}),/response too large/);
  assert.equal(pulls,3);assert.equal(cancelled,true);
  let declaredReads=0;
  const declared=new ReadableStream({pull(){declaredReads++;}},{highWaterMark:0});
  await assert.rejects(runOperations(["refund-list"],env,{request:async()=>new Response(declared,{headers:{"Content-Length":"262145"}})}),/response too large/);
  assert.equal(declaredReads,0);
});

test("malformed and invalid UTF-8 operator responses never echo private body contents",async()=>{
  for(const bytes of ["PRIVATE_CASE_TOKEN not valid JSON",new Uint8Array([0xff]),"null",'{"ok":true,"data":[]}', '{"ok":true,"data":"private"}']){
    await assert.rejects(runOperations(["refund-list"],env,{request:async()=>new Response(bytes)}),error=>{
      assert.equal(error.message,"Invalid operator response");return true;
    });
  }
});

test("readiness --check enforces current schema/configuration without requiring disabled features",async()=>{
  const healthy={sourceCommit:sha,schemaReady:true,readiness:{ready:true,configurationErrors:[]},
    configured:{calling:false,callUsage:false,playSettlement:false},providerAcceptance:"requires_external_evidence"};
  const args=["readiness","--expected-sha",sha,"--check"];
  assert.deepEqual(await runOperations(args,env,{request:async()=>Response.json({ok:true,data:healthy})}),healthy);
  for(const change of [
    data=>{data.schemaReady=false;},data=>{data.readiness.ready=false;},
    data=>{data.readiness.configurationErrors=["enabled-feature-incomplete"];},
    data=>{delete data.readiness;},data=>{data.readiness.configurationErrors=null;},
  ]){
    const data=structuredClone(healthy);change(data);
    const request=async()=>Response.json({ok:true,data});
    await assert.rejects(runOperations(args,env,{request}),/configuration\/schema readiness check failed/);
    assert.deepEqual(await runOperations(args.slice(0,-1),env,{request}),data,"diagnostic mode remains available");
  }
  await assert.rejects(runOperations([...args,"--check"],env),/Duplicate/);
  await assert.rejects(runOperations(["refund-list","--check"],env),/only --after/);
});
