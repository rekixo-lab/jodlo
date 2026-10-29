import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {parseCatalogSearch} from "../src/modules/catalog/catalog.ts";

const path="https://jodlo.rekixo.com/api/v1/catalog/search";
const get=async(adapter,params)=>{
  const response=await worker.fetch(new Request(path+"?"+params),{DB:adapter});
  return {status:response.status,body:await response.json()};
};
function fixture(count=889){
  const {db,adapter}=openLocalDatabase();
  db.exec("BEGIN");
  try {
    const stmt=db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)");
    for(let i=0;i<count;i++){
      const id="work-"+String(i).padStart(4,"0");
      stmt.run(id,id,"Community Service Trade "+i,"सामुदायिक सेवा "+i,1,Math.floor(i/3));
    }
    db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e;}
  return {db,adapter};
}
test("opt-in Search keyset can reach every one of 889 synthetic approved work Categories",async()=>{
  const f=fixture();
  try{
    const old=await get(f.adapter,"q=Service&offset=100&limit=25");
    assert.equal(old.status,200);
    assert.equal(old.body.data.categories.length,25);
    assert.equal(old.body.data.nextOffset,null);
    assert.equal(Object.hasOwn(old.body.data,"nextCursor"),false);
    const traversed=[];
    let after=null,calls=0;
    do{
      const params="q=Service&lang=hi&cursor=1&limit=25"+
        (after?"&after="+encodeURIComponent(after):"");
      const page=await get(f.adapter,params);
      assert.equal(page.status,200,params);
      const d=page.body.data;
      assert.equal(d.query,"Service");
      assert.equal(d.language,"hi");
      assert.equal(Object.hasOwn(d,"nextOffset"),false);
      assert.ok(Object.hasOwn(d,"nextCursor"));
      assert.ok(d.categories.length>0&&d.categories.length<=25);
      assert.ok(d.categories.every(c=>Object.keys(c).sort().join(",")==="id,name,slug"));
      assert.ok(d.categories.every(c=>c.name.startsWith("सामुदायिक सेवा ")));
      traversed.push(...d.categories.map(c=>c.id));
      after=d.nextCursor;
      calls++;
      assert.ok(calls<=36);
    }while(after);
    assert.equal(calls,36);
    assert.equal(traversed.length,889);
    assert.equal(new Set(traversed).size,889);
    assert.equal(traversed[0],"work-0000");
    assert.equal(traversed.at(-1),"work-0888");
    // All old clients still have exactly the former DTO, not nextCursor.
    const legacy=await get(f.adapter,"q=Service&limit=1");
    assert.deepEqual(Object.keys(legacy.body.data).sort(),[
      "categories","language","nextOffset","query",
    ]);
    assert.equal(legacy.body.data.nextOffset,1);
  }finally{f.db.close();}
});
test("keyset remains deterministic when earlier categories turn inactive",async()=>{
  const f=fixture(58);
  try{
    const one=(await get(f.adapter,"q=Service&cursor=1&limit=25")).body.data;
    assert.equal(one.categories.length,25);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id IN ('work-0002','work-0011')").run();
    const two=(await get(f.adapter,"q=Service&cursor=1&limit=25&after="+
      encodeURIComponent(one.nextCursor))).body.data;
    assert.equal(two.categories[0].id,"work-0025");
    assert.equal(two.categories.length,25);
    const three=(await get(f.adapter,"q=Service&cursor=1&limit=25&after="+
      encodeURIComponent(two.nextCursor))).body.data;
    assert.deepEqual(three.categories.map(x=>x.id),[
      "work-0050","work-0051","work-0052","work-0053",
      "work-0054","work-0055","work-0056","work-0057",
    ]);
    assert.equal(three.nextCursor,null);
  }finally{f.db.close();}
});
test("cursor availableOnly never emits inactive, hidden or unqualified worker categories",async()=>{
  const f=fixture();
  try{
    for(const n of [130,760,888]){
      const account="acct-"+n,id="work-"+String(n).padStart(4,"0");
      f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
      f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(account);
      f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
        .run("00000000-0000-4000-8000-"+String(n).padStart(12,"0"),account,id);
    }
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='work-0130'").run();
    const first=await get(f.adapter,"q=Service&cursor=1&limit=1&availableOnly=1");
    assert.equal(first.status,200);
    assert.deepEqual(first.body.data.categories.map(c=>c.id),["work-0760"]);
    assert.ok(first.body.data.nextCursor);
    const second=await get(f.adapter,"q=Service&cursor=1&limit=1&availableOnly=1&after="+
      encodeURIComponent(first.body.data.nextCursor));
    assert.deepEqual(second.body.data.categories.map(c=>c.id),["work-0888"]);
    assert.equal(second.body.data.nextCursor,null);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE category_id='work-0888'").run();
    assert.deepEqual((await get(f.adapter,"q=Service&cursor=1&availableOnly=1")).body.data
      .categories.map(c=>c.id),["work-0760"]);
    const response=JSON.stringify(first.body)+JSON.stringify(second.body);
    for(const secret of ["acct-760","acct-888","worker_account_id","phone","latitude","longitude","verified"]){
      assert.equal(response.includes(secret),false,secret);
    }
  }finally{f.db.close();}
});
test("cursor parser rejects mixed modes, forged cursors, unsupported languages and choices",async()=>{
  const f=fixture(3);
  try{
    for(const query of [
      "q=Service&after=0:work-0000",
      "q=Service&cursor=0","q=Service&cursor=true",
      "q=Service&cursor=1&offset=0",
      "q=Service&cursor=1&includeChoices=1",
      "q=Service&cursor=1&after=00:work-0000",
      "q=Service&cursor=1&after=-1:work-0000",
      "q=Service&cursor=1&after=1000001:work-0000",
      "q=Service&cursor=1&after=1:",
      "q=Service&cursor=1&after=1:work:0000",
      "q=Service&cursor=1&after=1:"+ "x".repeat(100),
      "q=Service&cursor=1&after=1:work-0000&after=2:work-0001",
      "q=Service&cursor=1&cursor=1",
      "q=Service&cursor=1&limit=26",
      "q=Service&cursor=1&lang=hin",
      "q=Service&cursor=1&debug=1",
    ]){
      const response=await get(f.adapter,query);
      assert.equal(response.status,400,query);
      assert.equal(response.body.error.code,"INVALID_QUERY");
    }
    const opts=parseCatalogSearch(new URLSearchParams("q=Service&cursor=1&after=0:work-0000"));
    assert.deepEqual(opts.after,{sortOrder:0,id:"work-0000"});
    assert.equal(opts.cursor,true);
  }finally{f.db.close();}
});
test("new cursor mode fails closed for ambiguous intents, generic filler and unknown aliases",async()=>{
  const f=fixture(3);
  try{
    for(const phrase of ["काम चाहिए","mujhe service chahiye","I need सेवा"]){
      const d=(await get(f.adapter,"q="+encodeURIComponent(phrase)+"&cursor=1")).body.data;
      assert.deepEqual(d.categories,[]);
      assert.equal(d.nextCursor,null);
      assert.equal(Object.hasOwn(d,"nextOffset"),false);
    }
    const out=await get(f.adapter,"q="+encodeURIComponent("I need glass repair")+"&cursor=1");
    assert.equal(out.status,200);
    assert.equal(out.body.data.nextCursor,null);
    assert.deepEqual(out.body.data.categories,[]);
  }finally{f.db.close();}
});
test("cursor SQL errors return 503 without disclosing internal exception",async()=>{
  const res=await worker.fetch(new Request(path+"?q=Service&cursor=1&limit=25"),{
    DB:{prepare(){throw new Error("PRIVATE_SQL_SECRET_EXAMPLE");}},
  });
  assert.equal(res.status,503);
  assert.equal((await res.text()).includes("PRIVATE_SQL_SECRET_EXAMPLE"),false);
});
