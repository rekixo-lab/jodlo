import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
const request = (path,method="GET") => new Request("https://jodlo.rekixo.com"+path,{method});
test("health responds with typed public JSON envelope",async()=>{
  const r=worker.fetch(request("/api/v1/health"));
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,data:{service:"jodlo-api",status:"ok"}});
  assert.match(r.headers.get("Content-Type"),/application\/json/);
});
test("response is uncached with minimal security headers",()=>{
  const r=worker.fetch(request("/api/v1/health"));
  assert.equal(r.headers.get("Cache-Control"),"no-store");
  assert.equal(r.headers.get("X-Content-Type-Options"),"nosniff");
  assert.equal(r.headers.get("X-Frame-Options"),"DENY");
  assert.equal(r.headers.get("Referrer-Policy"),"no-referrer");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"),null);
});
test("does not expose private bindings",async()=>{
  const s=await worker.fetch(request("/api/v1/health")).text();
  for(const k of ["database_id","secret","versionCode","firebase","cloudflare_token"])assert.equal(s.includes(k),false);
});
test("unknown APIs and root return sanitized 404",async()=>{
  for(const path of ["/","/api/v1","/api/v1/users","/api/v2/health","/api/v1/health/"]){
    const r=worker.fetch(request(path));assert.equal(r.status,404);
    assert.deepEqual(await r.json(),{ok:false,error:{code:"NOT_FOUND",message:"Endpoint not found"}});
  }
});
test("writes and unsupported methods return 405",async()=>{
  for(const method of ["POST","PUT","DELETE","PATCH"]){
    const r=worker.fetch(request("/api/v1/health",method));assert.equal(r.status,405);
    assert.equal(r.headers.get("Allow"),"GET");
    assert.deepEqual(await r.json(),{ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}});
  }
});
