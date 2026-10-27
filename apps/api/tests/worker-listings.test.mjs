import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

const origin="https://jodlo.rekixo.com";
const own="/api/v1/me/listings", publicPath="/api/v1/listings";
const a="account-owner1",b="account-other2";
function setup(){
  const {db,adapter}=openLocalDatabase();
  for(const id of [a,b]) db.prepare("INSERT INTO accounts(id) VALUES(?)").run(id);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)")
    .run("cat1","plumbing","Plumbing","प्लंबिंग",1);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)")
    .run("cat2","painting","Painting","पेंटिंग",0);
  const AUTH={async verify(token){
    if(token==="signed-owner")return {accountId:a};
    if(token==="signed-other")return {accountId:b};
    return null;
  }};
  const env={DB:adapter,AUTH};
  const call=(path,method="GET",token,body)=>worker.fetch(new Request(origin+path,{
    method,headers:{...(token?{Authorization:"Bearer "+token}:{}),
      ...(body!==undefined?{"Content-Type":"application/json"}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  }),env);
  const opt=id=>db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(id);
  return {db,env,call,opt};
}
const publish=(f,categoryId="cat1",token="signed-owner")=>
  f.call(own,"POST",token,{categoryId});
const list=(f,categoryId="cat1")=>
  f.call(publicPath+"?categoryId="+encodeURIComponent(categoryId));

test("instant publication from opted-in worker, without public identity or badge",async()=>{
  const f=setup();
  try {
    f.opt(a);
    assert.equal((await list(f)).status,200);
    assert.deepEqual((await (await list(f)).json()).data.listings,[]);
    const response=await publish(f);
    assert.equal(response.status,200);
    const listing=(await response.json()).data.listing;
    assert.match(listing.id,/^[a-z0-9-]{36}$/);
    assert.deepEqual(Object.keys(listing),["id","categoryId"]);
    assert.equal(listing.categoryId,"cat1");
    assert.equal(f.db.prepare("SELECT status FROM worker_profiles WHERE account_id=?").get(a).status,"draft");
    assert.equal(f.db.prepare("SELECT status FROM worker_listings").get().status,"published");
    assert.equal(f.db.prepare("SELECT moderation_status FROM worker_listings").get().moderation_status,"allowed");
    const responsePublic=await list(f);
    assert.deepEqual((await responsePublic.json()).data.listings,[listing]);
    assert.equal(responsePublic.headers.get("Cache-Control"),"no-store");
    for(const secret of [a,"phone","verified","location","price","moderation","contact"]){
      assert.equal(JSON.stringify(listing).includes(secret),false);
    }
    const mine=await f.call(own,"GET","signed-owner");
    assert.deepEqual((await mine.json()).data.listings,[{...listing,visible:true}]);
    assert.deepEqual((await (await f.call(own,"GET","signed-other")).json()).data.listings,[]);
  } finally {f.db.close();}
});

test("publish requires active worker opt-in AND already active curated category",async()=>{
  const f=setup();
  try {
    assert.equal((await publish(f)).status,403);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n,0);
    f.opt(a);
    assert.equal((await publish(f,"cat2")).status,403);
    assert.equal((await publish(f,"cat999")).status,403);
    assert.equal((await publish(f,"cat1","signed-other")).status,403);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n,0);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(a);
    assert.equal((await publish(f)).status,403);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n,0);
  } finally {f.db.close();}
});

test("same-category retries, even parallel requests, reuse one server-generated ID",async()=>{
  const f=setup();
  try {
    f.opt(a);
    const responses=await Promise.all(Array.from({length:6},()=>publish(f)));
    assert.ok(responses.every(r=>r.status===200));
    const items=await Promise.all(responses.map(async r=>(await r.json()).data.listing));
    assert.equal(new Set(items.map(x=>x.id)).size,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n,1);
    assert.throws(()=>f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
      .run("11111111-1111-1111-1111-111111111111",a,"cat1"),/UNIQUE/);
  } finally {f.db.close();}
});

test("owner alone can unpublish, and approved owner can republish same ID",async()=>{
  const f=setup();
  try {
    f.opt(a);f.opt(b);
    const id=(await (await publish(f)).json()).data.listing.id;
    assert.equal((await f.call(own+"?id="+id,"DELETE","signed-other")).status,404);
    assert.equal((await (await list(f)).json()).data.listings.length,1);
    assert.equal((await f.call(own+"?id="+id,"DELETE","signed-owner")).status,200);
    assert.deepEqual((await (await list(f)).json()).data.listings,[]);
    assert.equal((await f.call(own+"?id="+id,"DELETE","signed-owner")).status,404);
    const again=(await (await publish(f)).json()).data.listing;
    assert.equal(again.id,id);
    assert.deepEqual((await (await list(f)).json()).data.listings,[again]);
  } finally {f.db.close();}
});

test("server-owned moderator hide overrides publish and blocks self-republication",async()=>{
  const f=setup();
  try {
    f.opt(a);
    const listing=(await (await publish(f)).json()).data.listing;
    // Trusted moderation emulated only via local DB; no public admin route.
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?").run(listing.id);
    assert.deepEqual((await (await list(f)).json()).data.listings,[]);
    assert.equal((await publish(f)).status,403);
    assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(listing.id).status,"published");
    assert.equal((await (await f.call(own,"GET","signed-owner")).json()).data.listings[0].visible,false);
    assert.equal((await f.call("/api/v1/admin/listings","POST","signed-owner",{})).status,404);
  } finally {f.db.close();}
});

test("public visibility rechecks disabled account, category, opt-in, and listing status",async()=>{
  const f=setup();
  try {
    f.opt(a);
    const listing=(await (await publish(f)).json()).data.listing;
    const check=async()=>assert.deepEqual((await (await list(f)).json()).data.listings,[]);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='cat1'").run();
    await check();
    assert.equal((await publish(f)).status,403);
    f.db.prepare("UPDATE categories SET is_active=1 WHERE id='cat1'").run();
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(a);
    await check();
    assert.equal((await publish(f)).status,403);
    f.db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(a);
    f.db.prepare("DELETE FROM worker_profiles WHERE account_id=?").run(a);
    await check();
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n,0);
    assert.ok(listing.id);
  } finally {f.db.close();}
});

test("reject client supplied owner, verification, location, media, text and SQL-like query",async()=>{
  const f=setup();
  try {
    f.opt(a);
    const payloads=[
      {categoryId:"cat1",verified:true},
      {categoryId:"cat1",ownerAccountId:b},
      {categoryId:"cat1",latitude:22.7},
      {categoryId:"cat1",description:"Call +91"},
      {categoryId:"cat1",price:100},
      {categoryId:"cat1",moderation_status:"allowed"},
      {categoryId:"cat1",image:"x"},
      {categoryId:"cat1",status:"verified"},
      {categoryId:"../cat1"},
      {categoryId:"cat1' OR 1=1"},
    ];
    for(const body of payloads){
      const r=await f.call(own,"POST","signed-owner",body);
      assert.equal(r.status,400,JSON.stringify(body));
    }
    const oversized=await f.call(own,"POST","signed-owner",{categoryId:"x".repeat(260)});
    assert.equal(oversized.status,400);
    assert.equal((await f.call(publicPath+"?categoryId=cat1&extra=1")).status,400);
    assert.equal((await f.call(publicPath+"?categoryId=cat1&categoryId=cat2")).status,400);
    assert.equal((await f.call(own+"?id=../bad","DELETE","signed-owner")).status,400);
    assert.equal((await f.call(own+"?id=foo&id=bar","DELETE","signed-owner")).status,400);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n,0);
  } finally {f.db.close();}
});

test("session is required; method/query validation and DB outages fail closed",async()=>{
  const f=setup();
  try {
    f.opt(a);
    assert.equal((await f.call(own,"POST",undefined,{categoryId:"cat1"})).status,401);
    assert.equal((await f.call(own,"POST","forged",{categoryId:"cat1"})).status,401);
    assert.equal((await f.call(own,"PUT","signed-owner")).status,405);
    assert.equal((await f.call(publicPath,"POST","signed-owner",{categoryId:"cat1"})).status,405);
    assert.equal((await f.call(own+"?status=verified","POST","signed-owner",{categoryId:"cat1"})).status,400);
    const noDb=await worker.fetch(new Request(origin+own,{
      method:"POST",headers:{Authorization:"Bearer signed-owner","Content-Type":"application/json"},
      body:JSON.stringify({categoryId:"cat1"})
    }));
    assert.equal(noDb.status,503);
    assert.equal((await noDb.text()).includes("signed-owner"),false);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n,0);
  } finally {f.db.close();}
});

test("public lookup capped at 25, preserves opaque IDs only and uses partial index",async()=>{
  const f=setup();
  try {
    for(let i=0;i<27;i++){
      const owner="account-lookup"+String(i).padStart(3,"0");
      f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(owner);
      f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(owner);
      const id="00000000-0000-4000-8000-"+String(i).padStart(12,"0");
      f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
        .run(id,owner,"cat1");
    }
    const data=(await (await list(f)).json()).data.listings;
    assert.equal(data.length,25);
    assert.ok(data.every(x=>Object.keys(x).sort().join(",")==="categoryId,id"));
    assert.equal(new Set(data.map(x=>x.id)).size,25);
    assert.ok(!JSON.stringify(data).includes("account-lookup"));
    const plan=f.db.prepare("EXPLAIN QUERY PLAN "+
      (await import("../src/modules/workers/listings.ts")).PUBLIC_LISTINGS_QUERY).all("cat1");
    assert.ok(plan.some(x=>String(x.detail).includes("idx_worker_listings_public")),
      JSON.stringify(plan));
  } finally {f.db.close();}
});
