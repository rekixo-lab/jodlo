import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { parseHierarchy } from "../src/modules/catalog/hierarchy.ts";

const origin="https://api.jodlo.rekixo.com";
const route="/api/v1/catalog/hierarchy";
async function get(adapter,query="",method="GET") {
  const response=await worker.fetch(new Request(origin+route+query,{method}),{DB:adapter});
  return {status:response.status,body:await response.json()};
}
function setup() {
  const {db,adapter}=openLocalDatabase();
  const group=db.prepare("INSERT INTO catalog_groups(id,name_en,name_hi,is_active,is_approved) VALUES(?,?,?,?,?)");
  const family=db.prepare("INSERT INTO catalog_families(id,group_id,name_en,name_hi,is_active,is_approved) VALUES(?,?,?,?,?,?)");
  const category=db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)");
  const mapping=db.prepare("INSERT INTO catalog_family_categories(family_id,category_id,is_approved) VALUES(?,?,?)");
  return {db,adapter,group,family,category,mapping};
}

test("empty/dormant hierarchy never fabricates approved Groups or Categories",async()=>{
  const f=setup();
  try{
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM catalog_groups").get().n,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM catalog_families").get().n,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM catalog_family_categories").get().n,0);
    f.group.run("home","Home","घर",1,0);
    f.family.run("repair","home","Repair","मरम्मत",1,0);
    f.category.run("ac","ac","AC repair","एसी मरम्मत",1);
    f.mapping.run("repair","ac",0);
    assert.deepEqual((await get(f.adapter,"?level=groups&lang=hi&limit=10")).body.data,
      {level:"groups",language:"hi",parentId:null,items:[],nextCursor:null});
    f.db.prepare("UPDATE catalog_groups SET is_approved=1").run();
    assert.equal((await get(f.adapter,"?level=groups&lang=hi&limit=10")).body.data.items.length,0);
    f.db.prepare("UPDATE catalog_families SET is_approved=1").run();
    assert.equal((await get(f.adapter,"?level=groups&lang=hi&limit=10")).body.data.items.length,0);
    f.db.prepare("UPDATE catalog_family_categories SET is_approved=1").run();
    assert.deepEqual((await get(f.adapter,"?level=groups&lang=hi&limit=10")).body.data.items,
      [{id:"home",name:"घर"}]);
    assert.deepEqual((await get(f.adapter,"?level=families&parentId=home&lang=en&limit=10")).body.data.items,
      [{id:"repair",name:"Repair"}]);
    assert.deepEqual((await get(f.adapter,"?level=categories&parentId=repair&lang=hi&limit=10")).body.data.items,
      [{id:"ac",slug:"ac",name:"एसी मरम्मत"}]);
    assert.equal((await get(f.adapter,"?level=categories&parentId=home&lang=en&limit=10")).body.data.items.length,0);
    f.db.prepare("UPDATE categories SET is_active=0").run();
    for(const query of ["?level=groups&lang=hi&limit=10",
      "?level=families&parentId=home&lang=en&limit=10",
      "?level=categories&parentId=repair&lang=hi&limit=10"]){
      assert.deepEqual((await get(f.adapter,query)).body.data.items,[]);
    }
  }finally{f.db.close();}
});

test("availableOnly reuses current published/moderated/owner Category constraints",async()=>{
  const f=setup();
  try{
    f.group.run("work","Work",null,1,1);
    f.family.run("electric","work","Electrical",null,1,1);
    f.category.run("plumber","plumber","Plumbing",null,1);
    f.mapping.run("electric","plumber",1);
    const base="?level=groups&lang=en&availableOnly=1&limit=10";
    assert.deepEqual((await get(f.adapter,base)).body.data.items,[]);
    f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run("worker-hierarchy");
    f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run("worker-hierarchy");
    const listing="11111111-1111-4111-8111-111111111111";
    f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
      .run(listing,"worker-hierarchy","plumber");
    assert.deepEqual((await get(f.adapter,base)).body.data.items,[{id:"work",name:"Work"}]);
    assert.deepEqual((await get(f.adapter,"?level=families&parentId=work&lang=en&availableOnly=1&limit=10")).body.data.items,
      [{id:"electric",name:"Electrical"}]);
    assert.deepEqual((await get(f.adapter,"?level=categories&parentId=electric&lang=en&availableOnly=1&limit=10")).body.data.items,
      [{id:"plumber",slug:"plumber",name:"Plumbing"}]);
    const serialized=JSON.stringify((await get(f.adapter,base)).body);
    for(const forbidden of ["worker-hierarchy","worker_account_id","phone","location","availableCount"])
      assert.equal(serialized.includes(forbidden),false);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden'").run();
    assert.deepEqual((await get(f.adapter,base)).body.data.items,[]);
    assert.equal((await get(f.adapter,"?level=groups&lang=en&limit=10")).body.data.items.length,1);
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed',status='unpublished'").run();
    assert.deepEqual((await get(f.adapter,base)).body.data.items,[]);
    f.db.prepare("UPDATE worker_listings SET status='published'").run();
    f.db.prepare("UPDATE accounts SET status='disabled'").run();
    assert.deepEqual((await get(f.adapter,base)).body.data.items,[]);
  }finally{f.db.close();}
});

test("keyset traversal is bounded and a revoked anchor fails closed",async()=>{
  const f=setup();
  try{
    f.category.run("cat","cat","Category",null,1);
    for(let i=0;i<29;i++){
      const id="g"+String(i).padStart(2,"0");
      const family="f"+String(i).padStart(2,"0");
      f.group.run(id,"Group "+i,null,1,1);
      f.family.run(family,id,"Family "+i,null,1,1);
      f.mapping.run(family,"cat",1);
    }
    const first=(await get(f.adapter,"?level=groups&lang=en&limit=25")).body.data;
    assert.equal(first.items.length,25);
    assert.equal(first.nextCursor,"g24");
    const next=await get(f.adapter,"?level=groups&lang=en&limit=25&after=g24");
    assert.deepEqual(next.body.data.items.map(x=>x.id),["g25","g26","g27","g28"]);
    assert.equal(next.body.data.nextCursor,null);
    // Changes in live approval must invalidate a now-stale page anchor.
    f.db.prepare("UPDATE catalog_groups SET is_active=0 WHERE id='g24'").run();
    assert.deepEqual((await get(f.adapter,"?level=groups&lang=en&limit=25&after=g24")).body.data.items,[]);
    const firstAgain=(await get(f.adapter,"?level=groups&lang=en&limit=25")).body.data;
    assert.equal(firstAgain.items.length,25);
    assert.equal(firstAgain.nextCursor,"g25");
    const duplicate=(await get(f.adapter,"?level=groups&lang=en&limit=25&after=g25")).body.data.items;
    assert.deepEqual(duplicate.map(x=>x.id),["g26","g27","g28"]);
  }finally{f.db.close();}
});

test("strict hierarchy query: no aliases, PII, guessed parents or fake cursors",async()=>{
  const f=setup();
  try{
    const good=parseHierarchy(new URLSearchParams(
      "level=categories&parentId=abc&lang=hi&limit=10&availableOnly=1"));
    assert.deepEqual(good,{level:"categories",parentId:"abc",language:"hi",
      limit:10,availableOnly:true,after:null});
    for(const query of [
      "", "?level=groups&lang=en", "?level=groups&lang=en&limit=0",
      "?level=groups&lang=en&limit=26", "?level=groups&lang=en&limit=01",
      "?level=groups&lang=en&limit=10&parentId=abc",
      "?level=families&lang=hi&limit=10",
      "?level=categories&lang=en&limit=10&parentId=../secret",
      "?level=categories&lang=en&limit=10&parentId=x%0A",
      "?level=groups&lang=fr&limit=10",
      "?level=groups&lang=en&lang=hi&limit=10",
      "?level=groups&lang=en&limit=10&level=families",
      "?level=groups&lang=en&limit=10&debug=1",
      "?level=groups&lang=en&limit=10&availableOnly=0",
      "?level=groups&lang=en&limit=10&after=bad%2Fid",
      "?level=groups&lang=en&limit=10&after=",
    ]){
      assert.equal((await get(f.adapter,query)).status,400,query);
    }
    assert.equal((await get(f.adapter,"?level=groups&lang=en&limit=10","POST")).status,405);
    const noDb=await worker.fetch(new Request(origin+route+"?level=groups&lang=en&limit=10"));
    assert.equal(noDb.status,503);
    const broken=await worker.fetch(
      new Request(origin+route+"?level=groups&lang=en&limit=10"),
      {DB:{prepare(){throw Error("SECRET_SQL_ERROR");}}});
    assert.equal(broken.status,503);
    assert.equal((await broken.text()).includes("SECRET_SQL_ERROR"),false);
    const existing=await worker.fetch(new Request(origin+"/api/v1/catalog?lang=en&limit=10"),{DB:f.adapter});
    assert.equal(existing.status,200);
    assert.deepEqual(Object.keys((await existing.json()).data).sort(),
      ["categories","language","nextCursor"]);
  }finally{f.db.close();}
});
