import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { parseCatalogBrowse } from "../src/modules/catalog/catalog.ts";

const origin = "https://jodlo.rekixo.com";
const path = "/api/v1/catalog";
function setup(count=889) {
  const {db,adapter}=openLocalDatabase();
  db.exec("BEGIN");
  try {
    const stmt=db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)");
    for(let i=0;i<count;i++) {
      const id="cat-"+String(i).padStart(4,"0");
      stmt.run(id,id,"Trade "+String(i),"काम "+String(i),1,Math.floor(i/3));
    }
    db.exec("COMMIT");
  } catch(error) {db.exec("ROLLBACK");throw error;}
  async function get(params="") {
    const res=await worker.fetch(new Request(origin+path+params),{DB:adapter});
    return {status:res.status,json:await res.json()};
  }
  return {db,get};
}

test("889 synthetic active entries can be browsed in bounded stable 25-item pages",async()=>{
  const f=setup();
  try {
    const all=[];
    let cursor=null;
    let calls=0;
    do {
      const arg="?lang=hi&limit=25"+(cursor?"&after="+encodeURIComponent(cursor):"");
      const r=await f.get(arg);
      assert.equal(r.status,200,arg);
      assert.equal(r.json.data.language,"hi");
      const {categories,nextCursor}=r.json.data;
      assert.ok(categories.length>0 && categories.length<=25);
      assert.ok(categories.every(x=>Object.keys(x).sort().join(",")==="id,name,slug"));
      assert.ok(categories.every(x=>x.name.startsWith("काम ")));
      all.push(...categories.map(x=>x.id));
      cursor=nextCursor;
      calls++;
      assert.ok(calls<=36,"bounded traversal");
    } while(cursor);
    assert.equal(all.length,889);
    assert.equal(new Set(all).size,889);
    assert.equal(all[0],"cat-0000");
    assert.equal(all.at(-1),"cat-0888");
    assert.equal(calls,36);
    // Prior clients retain the previously published 100-row /catalog contract.
    const old=await f.get();
    assert.equal(old.json.data.categories.length,100);
    assert.equal(Object.hasOwn(old.json.data,"nextCursor"),false);
  } finally {f.db.close();}
});

test("cursor remains stable when previous items are disabled mid-pagination",async()=>{
  const f=setup(52);
  try {
    const first=(await f.get("?limit=25")).json.data;
    assert.equal(first.categories.length,25);
    const next=first.nextCursor;
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='cat-0002'").run();
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='cat-0009'").run();
    const second=(await f.get("?limit=25&after="+encodeURIComponent(next))).json.data;
    assert.equal(second.categories[0].id,"cat-0025");
    assert.equal(second.categories.length,25);
    assert.equal(second.nextCursor!==null,true);
    const third=(await f.get("?limit=25&after="+encodeURIComponent(second.nextCursor))).json.data;
    assert.deepEqual(third.categories.map(x=>x.id),["cat-0050","cat-0051"]);
    assert.equal(third.nextCursor,null);
  } finally {f.db.close();}
});

test("availability-only keyset can reach eligible listings beyond first 100 categories",async()=>{
  const f=setup();
  try {
    const account="account-far-category";
    f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
    f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(account);
    f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
      .run("00000000-0000-4000-8000-000000000008",account,"cat-0888");
    const r=await f.get("?availableOnly=1&limit=25&lang=en");
    assert.equal(r.status,200);
    assert.deepEqual(r.json.data.categories,[{id:"cat-0888",slug:"cat-0888",name:"Trade 888"}]);
    assert.equal(r.json.data.nextCursor,null);
    const serialized=JSON.stringify(r.json);
    assert.equal(serialized.includes(account),false);
    assert.equal(serialized.includes("sortOrder"),false);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden'").run();
    assert.deepEqual((await f.get("?availableOnly=1&limit=25")).json.data.categories,[]);
    assert.equal((await f.get("?limit=25")).json.data.categories.length,25);
  } finally {f.db.close();}
});

test("cursor parser is bounded, refuses aliases and malformed/duplicated input",async()=>{
  const f=setup(3);
  try {
    const bad=[
      "?after=0:cat-0000", "?limit=0", "?limit=26", "?limit=01",
      "?limit=25&after=00:cat-0000", "?limit=25&after=-1:cat-0000",
      "?limit=25&after=1000001:cat-0000", "?limit=25&after=1:",
      "?limit=25&after=1:cat%3A0000", "?limit=25&after=1:"+ "x".repeat(200),
      "?limit=25&after=1:cat-0000&after=1:cat-0001",
      "?limit=25&limit=25", "?limit=25&lang=hi&lang=en",
      "?limit=25&availableOnly=0","?limit=25&availableOnly=1&availableOnly=1",
      "?limit=25&debug=1", "?limit=25&offset=1",
    ];
    for(const item of bad){
      const r=await f.get(item);
      assert.equal(r.status,400,item);
    }
    const opts=parseCatalogBrowse(new URLSearchParams("limit=25&after=0:cat-0000&availableOnly=1"));
    assert.deepEqual(opts,{language:"en",availableOnly:true,limit:25,
      after:{sortOrder:0,id:"cat-0000"}});
    assert.deepEqual((await f.get("?limit=2&after=1:cat-0003")).json.data.categories,[]);
  } finally {f.db.close();}
});

test("paginated catalog returns 503 rather than exposing SQL/DB messages",async()=>{
  const noDb=await worker.fetch(new Request(origin+path+"?limit=25"));
  assert.equal(noDb.status,503);
  const bad=await worker.fetch(new Request(origin+path+"?limit=25"),{
    DB:{prepare(){throw new Error("DO_NOT_LEAK_INTERNAL_DATABASE_DETAILS");}},
  });
  assert.equal(bad.status,503);
  assert.equal((await bad.text()).includes("DO_NOT_LEAK_INTERNAL_DATABASE_DETAILS"),false);
});

test("browse continuation checks live anchor status, sort and source membership",async()=>{
  const f=setup(9);
  try{
    const first=(await f.get("?limit=2")).json.data;
    assert.deepEqual(first.categories.map(x=>x.id),["cat-0000","cat-0001"]);
    const after=encodeURIComponent(first.nextCursor);
    const next=()=>f.get("?limit=2&after="+after);
    assert.deepEqual((await next()).json.data.categories.map(x=>x.id),[
      "cat-0002","cat-0003",
    ]);
    // Correctly-shaped but invented anchors must not let clients skip rows.
    for(const fabricated of ["0:cat-does-not-exist","1:cat-0001","0:cat-0008"]){
      const page=await f.get("?limit=2&after="+encodeURIComponent(fabricated));
      assert.equal(page.status,200);
      assert.deepEqual(page.json.data.categories,[]);
      assert.equal(page.json.data.nextCursor,null);
    }
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='cat-0001'").run();
    assert.deepEqual((await next()).json.data,{language:"en",categories:[],nextCursor:null});
    f.db.prepare("UPDATE categories SET is_active=1,sort_order=777 WHERE id='cat-0001'").run();
    assert.deepEqual((await next()).json.data.categories,[]);
    f.db.prepare("UPDATE categories SET sort_order=0 WHERE id='cat-0001'").run();
    assert.deepEqual((await next()).json.data.categories.map(x=>x.id),[
      "cat-0002","cat-0003",
    ]);
    // Deleting the original page anchor is distinct from deactivating it.
    f.db.prepare("DELETE FROM categories WHERE id='cat-0001'").run();
    assert.deepEqual((await next()).json.data.categories,[]);
    assert.deepEqual((await f.get("?limit=2")).json.data.categories.map(x=>x.id),[
      "cat-0000","cat-0002",
    ]);
  }finally{f.db.close();}
});

test("availability-only browse refuses an anchor after its public listing is hidden",async()=>{
  const f=setup(9);
  try{
    const enroll=(id,owner,listId)=>{
      f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(owner);
      f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(owner);
      f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
        .run(listId,owner,id);
    };
    enroll("cat-0001","browse-worker-1","11111111-1111-4111-8111-111111111111");
    enroll("cat-0005","browse-worker-5","55555555-5555-4555-8555-555555555555");
    const first=(await f.get("?availableOnly=1&limit=1")).json.data;
    assert.deepEqual(first.categories.map(x=>x.id),["cat-0001"]);
    assert.ok(first.nextCursor);
    const continuation="?availableOnly=1&limit=1&after="+encodeURIComponent(first.nextCursor);
    assert.deepEqual((await f.get(continuation)).json.data.categories.map(x=>x.id),["cat-0005"]);
    assert.deepEqual((await f.get("?availableOnly=1&limit=1&after=0:cat-0000"))
      .json.data.categories,[],"inactive listing is not an eligible source anchor");
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE category_id='cat-0001'").run();
    const stale=(await f.get(continuation)).json.data;
    assert.deepEqual(stale.categories,[]);
    assert.equal(stale.nextCursor,null);
    assert.deepEqual((await f.get("?availableOnly=1&limit=1")).json.data.categories
      .map(x=>x.id),["cat-0005"]);
    const leak=JSON.stringify(stale);
    for(const privateValue of ["browse-worker-1","browse-worker-5","worker_account_id","latitude","phone"]){
      assert.equal(leak.includes(privateValue),false);
    }
  }finally{f.db.close();}
});
