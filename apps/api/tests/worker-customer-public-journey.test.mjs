import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

const origin = "https://jodlo.rekixo.com";
const category = "cat-plumbing";
const owner = "account-public-journey-owner";
const stranger = "account-public-journey-other";
const ownerToken = "fixture-owner-session";
const otherToken = "fixture-other-session";

/** Actual Worker router + migrated D1 facade, with ONLY external Google
 * session verification substituted by a local identity fixture. No real
 * credential, OAuth, Cloudflare deployment or human Worker record.
 */
function setup() {
  const { db, adapter } = openLocalDatabase();
  for (const account of [owner, stranger]) {
    db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
  }
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)")
    .run(category, "plumbing", "Plumbing", "प्लंबिंग", 1, 10);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)")
    .run("cat-disabled", "inactive", "Inactive", "निष्क्रिय", 0, 20);
  const AUTH = { async verify(token) {
    return token === ownerToken ? {accountId:owner} :
      token === otherToken ? {accountId:stranger} : null;
  } };
  const env = {DB:adapter, AUTH};
  async function request(path, method = "GET", token = null, input) {
    const result = await worker.fetch(new Request(origin + path, {
      method,
      headers:{
        ...(token === null ? {} : {Authorization:"Bearer " + token}),
        ...(input === undefined ? {} : {"Content-Type":"application/json"}),
      },
      ...(input === undefined ? {} : {body:JSON.stringify(input)}),
    }), env);
    return {status:result.status, body:await result.json(),
      cacheControl:result.headers.get("Cache-Control")};
  }
  return {db,request};
}

const browse = "/api/v1/catalog?lang=hi&availableOnly=1&limit=20";
const search = "/api/v1/catalog/search?lang=en&q=plumb&cursor=1&limit=20&availableOnly=1";
const publicPage = "/api/v1/listings?categoryId=" + category + "&limit=20";

test("Worker self-onboarding -> publish -> anonymous Customer browse, search and fresh detail -> unpublish", async () => {
  const f = setup();
  try {
    // Before any Worker opts in, browsing all approved Categories is possible,
    // but a Customer's published-only view is correctly empty.
    assert.deepEqual((await f.request("/api/v1/catalog?lang=en&limit=20"))
      .body.data.categories.map(c=>c.id), [category]);
    assert.deepEqual((await f.request(browse)).body.data.categories, []);
    assert.deepEqual((await f.request(search)).body.data.categories, []);
    assert.deepEqual((await f.request(publicPage)).body.data.listings, []);

    const unauthorized = await f.request("/api/v1/me/worker-profile", "POST");
    assert.equal(unauthorized.status,401);
    const opted = await f.request("/api/v1/me/worker-profile", "POST", ownerToken);
    assert.equal(opted.status,200);
    assert.deepEqual(opted.body.data.profile,{status:"draft"});

    // A Category is published by an authenticated owner write, NOT by Search.
    const created = await f.request("/api/v1/me/listings", "POST", ownerToken,
      {categoryId:category});
    assert.equal(created.status,200);
    const listing = created.body.data.listing;
    assert.deepEqual(Object.keys(listing),["id","categoryId"]);
    assert.equal(listing.categoryId,category);
    assert.equal((await f.request("/api/v1/me/listings", "GET", otherToken))
      .body.data.listings.length,0);
    assert.deepEqual((await f.request("/api/v1/me/listings", "GET", ownerToken))
      .body.data.listings,[{...listing, visible:true}]);

    const available = await f.request(browse);
    assert.equal(available.status,200);
    assert.deepEqual(available.body.data.categories,
      [{id:category,slug:"plumbing",name:"प्लंबिंग"}]);
    assert.deepEqual((await f.request(search)).body.data.categories,
      [{id:category,slug:"plumbing",name:"Plumbing"}]);
    assert.deepEqual((await f.request(publicPage)).body.data.listings,[listing]);

    // This is EXACTLY the anonymous GET the native Worker "Customer view
    // check" performs: no bearer or Worker identity is supplied.
    const publicDetail="/api/v1/listings?id="+encodeURIComponent(listing.id);
    const visible = await f.request(publicDetail);
    assert.equal(visible.status,200);
    assert.equal(visible.cacheControl,"no-store");
    assert.deepEqual(visible.body,{ok:true,data:{listing}});
    for(const forbidden of [owner,stranger,ownerToken,"phone","verified","location",
        "moderation","contact","workerId","callPermission"]){
      assert.equal(JSON.stringify(visible.body).includes(forbidden),false,forbidden);
    }

    // Another session cannot unpublish, nor infer the owner's private Listing.
    const remove="/api/v1/me/listings?id="+encodeURIComponent(listing.id);
    assert.equal((await f.request(remove,"DELETE",otherToken)).status,404);
    assert.equal((await f.request(publicDetail)).status,200);

    const removed=await f.request(remove,"DELETE",ownerToken);
    assert.equal(removed.status,200);
    assert.deepEqual(removed.body.data,{unpublished:true});
    assert.equal((await f.request(publicDetail)).status,404);
    assert.deepEqual((await f.request(publicPage)).body.data.listings,[]);
    assert.deepEqual((await f.request(browse)).body.data.categories,[]);
    assert.deepEqual((await f.request(search)).body.data.categories,[]);
    assert.deepEqual((await f.request("/api/v1/me/listings","GET",ownerToken))
      .body.data.listings,[{...listing,visible:false}]);

    // Explicit re-publication uses the stable server-owned Listing ID.
    const republished=await f.request("/api/v1/me/listings","POST",ownerToken,
      {categoryId:category});
    assert.equal(republished.status,200);
    assert.deepEqual(republished.body.data.listing,listing);
    assert.deepEqual((await f.request(publicDetail)).body.data,{listing});
  } finally {f.db.close();}
});

test("Customer preview has no privileged bypass of current moderation/Category/account eligibility", async () => {
  const f=setup();
  try {
    assert.equal((await f.request("/api/v1/me/worker-profile","POST",ownerToken)).status,200);
    const created=await f.request("/api/v1/me/listings","POST",ownerToken,{categoryId:category});
    assert.equal(created.status,200);
    const id=created.body.data.listing.id;
    const detail="/api/v1/listings?id="+id;
    const checks=[
      ["UPDATE worker_listings SET moderation_status='hidden' WHERE id=?",id,
       "UPDATE worker_listings SET moderation_status='allowed' WHERE id=?"],
      ["UPDATE categories SET is_active=0 WHERE id=?",category,
       "UPDATE categories SET is_active=1 WHERE id=?"],
      ["UPDATE accounts SET status='disabled' WHERE id=?",owner,
       "UPDATE accounts SET status='active' WHERE id=?"],
    ];
    for(const [deny,value,allow] of checks){
      f.db.prepare(deny).run(value);
      assert.equal((await f.request(detail)).status,404);
      assert.deepEqual((await f.request(browse)).body.data.categories,[]);
      f.db.prepare(allow).run(value);
      assert.equal((await f.request(detail)).status,200);
    }
    // A network/DB failure is 503 rather than "not public", which the
    // Android Worker screen must keep visibly distinct from a 404.
    const missing=await worker.fetch(new Request(origin+detail),{});
    assert.equal(missing.status,503);
  }finally{f.db.close();}
});


test("opt-in approved bilingual Service detail is one current-public + Category read, with legacy parity",async()=>{
  const f=setup();
  try{
    await f.request("/api/v1/me/worker-profile","POST",ownerToken);
    const created=await f.request("/api/v1/me/listings","POST",ownerToken,
      {categoryId:category});
    assert.equal(created.status,200);
    const listing=created.body.data.listing;
    const url="/api/v1/listings?id="+listing.id;
    for(const [lang,name] of [["hi","प्लंबिंग"],["en","Plumbing"]]){
      const result=await f.request(url+"&view=service&lang="+lang);
      assert.equal(result.status,200);
      assert.equal(result.cacheControl,"no-store");
      assert.deepEqual(result.body,{ok:true,data:{
        language:lang,listing,category:{id:category,slug:"plumbing",name},
      }});
      const serialized=JSON.stringify(result.body);
      for(const forbidden of [owner,stranger,ownerToken,"workerId","googleSub",
        "phone","location","latitude","longitude","price","rating",
        "verified","moderation","contact","profile","availability"]){
        assert.equal(serialized.includes(forbidden),false,forbidden);
      }
    }
    assert.deepEqual((await f.request(url)).body,{ok:true,data:{listing}},
      "legacy public detail never changes response DTO");
    assert.deepEqual((await f.request("/api/v1/listings?categoryId="+category)).body.data,
      {listings:[listing]},"public Category read never adds fields");

    // No content from Worker-owned unapproved fields can be displayed:
    // current Category label comes only from c.name_hi/name_en in the same
    // public eligibility SQL (no separate stale public lookup).
    f.db.prepare("UPDATE categories SET name_hi=NULL,name_en='Approved name' WHERE id=?")
      .run(category);
    assert.equal((await f.request(url+"&view=service&lang=hi")).body.data.category.name,
      "Approved name","missing Hindi translation uses approved English");
    f.db.prepare("UPDATE categories SET name_hi='नया स्वीकृत नाम' WHERE id=?").run(category);
    assert.equal((await f.request(url+"&view=service&lang=hi")).body.data.category.name,
      "नया स्वीकृत नाम","no stale label cache");

    const restrictions=[
      ["UPDATE worker_listings SET status='unpublished' WHERE id=?",
       "UPDATE worker_listings SET status='published' WHERE id=?",listing.id],
      ["UPDATE worker_listings SET moderation_status='hidden' WHERE id=?",
       "UPDATE worker_listings SET moderation_status='allowed' WHERE id=?",listing.id],
      ["UPDATE categories SET is_active=0 WHERE id=?",
       "UPDATE categories SET is_active=1 WHERE id=?",category],
      ["UPDATE accounts SET status='disabled' WHERE id=?",
       "UPDATE accounts SET status='active' WHERE id=?",owner],
    ];
    for(const [deny,restore,value] of restrictions){
      f.db.prepare(deny).run(value);
      assert.equal((await f.request(url+"&view=service&lang=hi")).status,404,
        "revocation must make new service detail inaccessible");
      f.db.prepare(restore).run(value);
      assert.equal((await f.request(url+"&view=service&lang=hi")).status,200);
    }
    assert.equal((await f.request("/api/v1/listings?id=22222222-2222-4222-8222-222222222222&view=service&lang=hi")).status,404);
  }finally{f.db.close();}
});

test("approved Service detail query is strictly opt-in and never accepts arbitrary Worker fields",async()=>{
  const f=setup();
  try{
    const uri="/api/v1/listings?id=11111111-1111-4111-8111-111111111111";
    for(const query of [
      "&view=service","&lang=hi","&view=worker&lang=hi",
      "&view=service&lang=fr","&view=service&lang=",
      "&view=service&lang=HI",
      "&view=service&lang=hi&lang=hi",
      "&view=service&view=service&lang=hi",
      "&view=service&lang=hi&categoryId="+category,
      "&view=service&lang=hi&workerId=foreign",
      "&view=service&lang=hi&phone=1",
      "&view=service&lang=hi&price=100",
      "&view=service&lang=hi&verified=1",
      "&view=service&lang=hi&after=foo",
    ]){
      const r=await f.request(uri+query);
      assert.equal(r.status,400,query);
      assert.equal(r.body.error.code,"INVALID_QUERY");
    }
    assert.equal((await f.request(uri+"&view=service&lang=hi","POST")).status,405);
    const missing=await worker.fetch(
      new Request(origin+uri+"&view=service&lang=hi"),{});
    assert.equal(missing.status,503,"no production DB cannot disclose metadata");
  }finally{f.db.close();}
});
