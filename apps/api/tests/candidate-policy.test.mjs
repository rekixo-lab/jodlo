import assert from "node:assert/strict";
import test from "node:test";
import { selectCandidateIds } from "../src/modules/discovery/candidate-policy.ts";

const context={requesterAccountId:"account-owner1",categoryId:"category1"};
const candidate=(id,categories=["category1"],extras={})=>({
  workerAccountId:id,categoryIds:categories,...extras,
});

test("candidate selection requires an injected trusted policy and has no public default",()=>{
  const candidates=[candidate("worker-aaaa1")];
  assert.throws(()=>selectCandidateIds(context,candidates),/trusted policy/);
  assert.deepEqual(selectCandidateIds(context,candidates,()=>false),[]);
});

test("selects only category-qualified, approved, non-self opaque IDs in stable order",()=>{
  const rows=[
    candidate("account-owner1"), candidate("worker-aaaa1"),
    candidate("worker-bbbb2",["other-category"]), candidate("worker-aaaa1"),
    candidate("worker-cccc3"), candidate("worker-dddd4"),
  ];
  const eligible = new Set(["worker-aaaa1","worker-dddd4"]);
  assert.deepEqual(selectCandidateIds(context,rows,c=>eligible.has(c.workerAccountId)),
    ["worker-aaaa1","worker-dddd4"]);
  assert.deepEqual(rows[0].categoryIds,["category1"]);
});

test("draft, disabled, blocked or unapproved candidates remain invisible",()=>{
  const rows=[
    candidate("worker-draft1",["category1"],{internalStatus:"draft"}),
    candidate("worker-block2",["category1"],{blocked:true}),
    candidate("worker-ready3",["category1"],{internalStatus:"ready"}),
  ];
  const approved=c=>c.internalStatus==="ready" && c.blocked!==true;
  assert.deepEqual(selectCandidateIds(context,rows,approved),["worker-ready3"]);
  assert.deepEqual(selectCandidateIds(context,rows,()=>false),[]);
});

test("bounded selection never returns private fields, duplicates or invented ranks",()=>{
  const rows=Array.from({length:30},(_,i)=>candidate("worker-"+String(i).padStart(6,"0"),
    ["category1"],{phone:"+91-PRIVATE",lat:99.999,verification:"none"}));
  const ids=selectCandidateIds(context,rows,()=>true,7);
  assert.equal(ids.length,7);
  assert.equal(new Set(ids).size,7);
  for(const id of ids){assert.match(id,/^worker-[0-9]{6}$/);}
  const serialized=JSON.stringify(ids);
  for(const privateField of ["phone","lat","verification","+91"]){
    assert.equal(serialized.includes(privateField),false);
  }
});

test("invalid inputs, excessive batch sizes or policy errors fail closed",()=>{
  const rows=[candidate("worker-aaaa1")];
  for(const badContext of [
    {...context,requesterAccountId:"bad"}, {...context,categoryId:"../../private"}
  ]){
    assert.throws(()=>selectCandidateIds(badContext,rows,()=>true),/Invalid/);
  }
  for(const n of [0,-1,26,1.5,10000]){
    assert.throws(()=>selectCandidateIds(context,rows,()=>true,n),/Invalid/);
  }
  assert.throws(()=>selectCandidateIds(context,Array.from({length:101},()=>rows[0]),()=>true),/Invalid/);
  assert.throws(()=>selectCandidateIds(context,[candidate("worker-aaaa1",["unsafe category"])],()=>true),/candidate/);
  assert.throws(()=>selectCandidateIds(context,[candidate("short")],()=>true),/candidate/);
  assert.throws(()=>selectCandidateIds(context,rows,()=>{throw Error("policy unavailable")}),/policy unavailable/);
});

test("selection never opens worker-discovery APIs or requires any database bindings",async()=>{
  const worker=(await import("../src/index.ts")).default;
  for(const path of ["/api/v1/workers","/api/v1/matching","/api/v1/requests"]){
    const res=await worker.fetch(new Request("https://jodlo.rekixo.com"+path));
    assert.equal(res.status,404);
  }
});
