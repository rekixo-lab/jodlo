import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import {
  AVAILABLE_PUBLIC_CATEGORIES_QUERY, SEARCH_AVAILABLE_PUBLIC_CATEGORIES_QUERY,
} from "../src/modules/catalog/catalog.ts";

const origin = "https://jodlo.rekixo.com";
const account = "account-service-availability";
function setup() {
  const { db, adapter } = openLocalDatabase();
  const put = db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)");
  put.run("cat-plumb","plumbing","Plumbing","प्लंबर",1,10);
  put.run("cat-carp","carpentry","Carpentry","बढ़ई",1,20);
  put.run("cat-off","painting","Painting","पेंटर",0,5);
  db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
  db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(account);
  const env = { DB: adapter };
  const get = async (url) => {
    const response = await worker.fetch(new Request(origin + url), env);
    return { status: response.status, body: await response.json() };
  };
  const publish = (categoryId, id = "11111111-1111-4111-8111-111111111111") =>
    db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
      .run(id,account,categoryId);
  return { db, env, get, publish };
}
const list = "/api/v1/catalog?availableOnly=1";
const find = "/api/v1/catalog/search?q=plumb&availableOnly=1";

// An empty yet approved category stays searchable for the FIRST worker while
// customer/Home availability is correctly empty and never leaks a worker.
test("worker can discover an empty category, but customer available-only facet excludes it", async () => {
  const f=setup();
  try {
    assert.deepEqual((await f.get(list)).body.data.categories,[]);
    assert.deepEqual((await f.get(find)).body.data.categories,[]);
    assert.deepEqual((await f.get("/api/v1/catalog")).body.data.categories.map(c=>c.id),["cat-plumb","cat-carp"]);
    assert.deepEqual((await f.get("/api/v1/catalog/search?q=plumb")).body.data.categories.map(c=>c.id),["cat-plumb"]);
    assert.deepEqual((await f.get("/api/v1/catalog/search?q=paint")).body.data.categories,[]);
    f.publish("cat-plumb");
    assert.deepEqual((await f.get(list)).body.data.categories,[{id:"cat-plumb",slug:"plumbing",name:"Plumbing"}]);
    assert.deepEqual((await f.get(find)).body.data.categories,[{id:"cat-plumb",slug:"plumbing",name:"Plumbing"}]);
    assert.deepEqual((await f.get("/api/v1/catalog?availableOnly=1&lang=hi")).body.data.categories,
      [{id:"cat-plumb",slug:"plumbing",name:"प्लंबर"}]);
    assert.deepEqual((await f.get("/api/v1/catalog/search?availableOnly=1&lang=hi&q="+encodeURIComponent("मुझे प्लंबर चाहिए"))).body.data.categories,
      [{id:"cat-plumb",slug:"plumbing",name:"प्लंबर"}]);
  } finally { f.db.close(); }
});

test("availability tracks current publication, moderation and owner authorization, not cached counts",async()=>{
  const f=setup();
  try {
    f.publish("cat-plumb");
    const ids=async()=> (await f.get(list)).body.data.categories.map(c=>c.id);
    assert.deepEqual(await ids(),["cat-plumb"]);
    f.db.prepare("UPDATE worker_listings SET status='unpublished'").run();
    assert.deepEqual(await ids(),[]);
    f.db.prepare("UPDATE worker_listings SET status='published',moderation_status='hidden'").run();
    assert.deepEqual(await ids(),[]);
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed'").run();
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(account);
    assert.deepEqual(await ids(),[]);
    f.db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(account);
    assert.deepEqual(await ids(),["cat-plumb"]);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='cat-plumb'").run();
    assert.deepEqual(await ids(),[]);
    f.db.prepare("UPDATE categories SET is_active=1 WHERE id='cat-plumb'").run();
    assert.deepEqual(await ids(),["cat-plumb"]);
    f.db.prepare("DELETE FROM worker_profiles WHERE account_id=?").run(account);
    assert.deepEqual(await ids(),[]);
    assert.deepEqual((await f.get("/api/v1/catalog/search?q=plumb")).body.data.categories.map(c=>c.id),["cat-plumb"]);
  } finally { f.db.close(); }
});

test("many valid worker listings yield one available category; no contact, badge or identity exposed",async()=>{
  const f=setup();
  try {
    f.publish("cat-plumb");
    for(let i=0;i<4;i++){
      const person="other-valid-account-"+i;
      f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(person);
      f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(person);
      f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
        .run("00000000-0000-4000-8000-"+String(i).padStart(12,"0"),person,"cat-plumb");
    }
    const browse=await f.get(list);
    assert.equal(browse.status,200);
    assert.equal(browse.body.data.categories.length,1);
    const output=JSON.stringify(browse.body);
    for(const privateValue of [account,"other-valid-account","workerId","phone","latitude","longitude","verified","moderation_status","worker_profiles"]){
      assert.equal(output.includes(privateValue),false,privateValue);
    }
    const plan=f.db.prepare("EXPLAIN QUERY PLAN "+AVAILABLE_PUBLIC_CATEGORIES_QUERY).all("en");
    assert.ok(plan.some(x=>String(x.detail).includes("idx_worker_listings_public")),JSON.stringify(plan));
    const searchPlan=f.db.prepare("EXPLAIN QUERY PLAN "+SEARCH_AVAILABLE_PUBLIC_CATEGORIES_QUERY)
      .all("en","plumb","plumb","plumb",21,0);
    assert.ok(searchPlan.some(x=>String(x.detail).includes("idx_worker_listings_public")),JSON.stringify(searchPlan));
  } finally { f.db.close(); }
});

test("available-only modes validate query parameters strictly and keep existing modes unchanged",async()=>{
  const f=setup();
  try {
    f.publish("cat-plumb");
    for(const bad of [
      "/api/v1/catalog?availableOnly=0",
      "/api/v1/catalog?availableOnly=true",
      "/api/v1/catalog?availableOnly=1&availableOnly=1",
      "/api/v1/catalog?availableOnly=1&debug=1",
      "/api/v1/catalog/search?q=plumb&availableOnly=0",
      "/api/v1/catalog/search?q=plumb&availableOnly=true",
      "/api/v1/catalog/search?q=plumb&availableOnly=1&availableOnly=1",
      "/api/v1/catalog/search?q=plumb&availableOnly=1&extra=1",
    ]) {
      const response=await f.get(bad);
      assert.equal(response.status,400,bad);
      assert.equal(response.body.error.code,"INVALID_QUERY",bad);
    }
    for(const query of ["%_","' OR 1=1 --","plumb%"]){
      assert.deepEqual((await f.get("/api/v1/catalog/search?availableOnly=1&q="+encodeURIComponent(query))).body.data.categories,[]);
    }
    assert.equal((await f.get("/api/v1/catalog/search?availableOnly=1&q=plumb&limit=1")).body.data.nextOffset,null);
    assert.deepEqual((await f.get("/api/v1/catalog/search?availableOnly=1&q=plumb&offset=100")).body.data.categories,[]);
    const r=await worker.fetch(new Request(origin+"/api/v1/catalog?availableOnly=1",{method:"POST"}),f.env);
    assert.equal(r.status,405);
    assert.equal((await f.get("/api/v1/catalog")).body.data.categories.length,2);
  } finally {f.db.close();}
});

test("available-only requires a healthy D1 binding and never reveals server exceptions",async()=>{
  const r=await worker.fetch(new Request(origin+list));
  assert.equal(r.status,503);
  const failure=await worker.fetch(new Request(origin+find),{
    DB:{prepare(){throw new Error("SECRET_OWNER_SQL_KEY");}}
  });
  assert.equal(failure.status,503);
  assert.equal((await failure.text()).includes("SECRET_OWNER_SQL_KEY"),false);
});
