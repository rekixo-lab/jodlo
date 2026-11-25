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
