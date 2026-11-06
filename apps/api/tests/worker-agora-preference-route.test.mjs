import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { issueSession, revokeSession } from "../src/modules/identity/sessions.ts";

const host="https://api.jodlo.rekixo.com";
async function fixture() {
  const {db,adapter}=openLocalDatabase();
  await ensureAccount(adapter,"callpref-worker-0001");
  await ensureAccount(adapter,"callpref-guest-0002");
  await optInAsWorker(adapter,"callpref-worker-0001");
  const mine=(await issueSession(adapter,"callpref-worker-0001"))?.accessToken;
  const guest=(await issueSession(adapter,"callpref-guest-0002"))?.accessToken;
  assert.ok(mine&&guest);
  async function request(method="GET",token=mine,body=undefined,path="/api/v1/me/agora-call-preference"){
    const response=await worker.fetch(new Request(host+path,{
      method,headers:{
        ...(token?{Authorization:"Bearer "+token}:{}),
        ...(body===undefined?{}:{"Content-Type":"application/json"}),
      },
      ...(body===undefined?{}:{body:typeof body==="string"?body:JSON.stringify(body)}),
    }),{DB:adapter});
    assert.equal(response.headers.get("Cache-Control"),"no-store");
    return {status:response.status,json:await response.json(),allow:response.headers.get("Allow")};
  }
  return {db,adapter,mine,guest,request};
}

test("private worker voice preference: default OFF, explicit opt-in and CAS opt-out",async()=>{
  const f=await fixture();
  try {
    assert.deepEqual((await f.request()).json,{ok:true,data:{preference:{enabled:false,revision:0}}});
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_agora_call_preferences").get().n,0);
    const on=await f.request("PUT",f.mine,{enabled:true,expectedRevision:0});
    assert.equal(on.status,200);
    assert.deepEqual(on.json,{ok:true,data:{preference:{enabled:true,revision:1}}});
    assert.equal((await f.request()).json.data.preference.enabled,true);
    assert.equal((await f.request("PUT",f.mine,{enabled:true,expectedRevision:0})).status,409);
    assert.deepEqual((await f.request("PUT",f.mine,{enabled:false,expectedRevision:1})).json.data.preference,
      {enabled:false,revision:2});
    assert.equal((await f.request("PUT",f.mine,{enabled:false,expectedRevision:1})).status,409);
    assert.equal((await f.request()).json.data.preference.enabled,false);
  } finally {f.db.close();}
});

test("private worker voice preference: no guest, revoked session or malformed mutation",async()=>{
  const f=await fixture();
  try {
    assert.equal((await f.request("GET",null)).status,401);
    assert.equal((await f.request("GET",f.guest)).status,403);
    assert.equal((await f.request("PUT",f.guest,{enabled:true,expectedRevision:0})).status,409);
    const denied=await f.request("POST",f.mine,{enabled:true,expectedRevision:0});
    assert.equal(denied.status,405);
    assert.equal(denied.allow,"GET, PUT");
    const badBodies=[
      '{"enabled":1,"expectedRevision":0}',
      '{"enabled":"true","expectedRevision":0}',
      '{"enabled":true,"expectedRevision":"0"}',
      '{"enabled":true,"expectedRevision":-1}',
      '{"enabled":true,"expectedRevision":2147483647}',
      '{"enabled":true,"expectedRevision":0,"phone":"private"}',
      '{"enabled":true,"enabled":false,"expectedRevision":0}',
      '{"\\u0065nabled":true,"expectedRevision":0}',
      '{"expectedRevision":0,"enabled":true}',
      '{"enabled":true,"expectedRevision":01}',
    ];
    for(const b of badBodies)assert.equal((await f.request("PUT",f.mine,b)).status,400,b);
    assert.equal((await f.request("GET",f.mine,"not empty")).status,400);
    assert.equal((await f.request("GET",f.mine,undefined,
      "/api/v1/me/agora-call-preference?owner=other")).status,400);
    assert.equal((await f.request()).json.data.preference.enabled,false);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_agora_call_preferences").get().n,0);
    assert.equal(await revokeSession(f.adapter,f.mine),true);
    assert.equal((await f.request()).status,401);
    assert.equal((await f.request("PUT",f.mine,{enabled:true,expectedRevision:0})).status,401);
  }finally{f.db.close();}
});
