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

test("cursor refuses competing literal trade hidden beyond first page of an active curated alias",async()=>{
  const f=fixture(32);
  const phrase="I need tap repair";
  const q="q="+encodeURIComponent(phrase);
  try{
    const add=f.db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)");
    add.run("plumber","plumber","Tap Repair Plumber","प्लंबर",1,0);
    // No historical IDs or service names are activated: these are disposable
    // synthetic rows, including a competing later-sorted Category.
    assert.deepEqual((await get(f.adapter,q+"&cursor=1&limit=1")).body.data.categories
      .map(c=>c.id),["plumber"]);
    add.run("tap-repair-team","tap-repair-team","Tap Repair Team","नल मरम्मत टीम",1,999);
    for(const suffix of [
      "&cursor=1&limit=1",
      "&cursor=1&limit=25",
      "&cursor=1&limit=1&after=0:work-0000",
    ]){
      const response=await get(f.adapter,q+suffix);
      assert.equal(response.status,200);
      assert.deepEqual(response.body.data.categories,[],suffix);
      assert.equal(response.body.data.nextCursor,null,suffix);
      assert.equal(Object.hasOwn(response.body.data,"needsChoice"),false);
    }
    // Existing explicit-choice flow remains an option for the same conflict.
    const choice=(await get(f.adapter,q+"&includeChoices=1")).body.data;
    assert.equal(choice.needsChoice,true);
    assert.deepEqual(choice.choices.map(c=>c.id),["plumber","tap-repair-team"]);

    // Also guard the case where only a fallback curated alias matches the
    // user's phrase and the literal match belongs to another active trade.
    f.db.prepare("UPDATE categories SET name_en='Plumber' WHERE id='plumber'").run();
    assert.deepEqual((await get(f.adapter,q+"&cursor=1&limit=1")).body.data.categories,[]);

    // Inactive competing Categories do not suppress approved active aliases.
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='tap-repair-team'").run();
    assert.deepEqual((await get(f.adapter,q+"&cursor=1")).body.data.categories
      .map(c=>c.id),["plumber"]);
    f.db.prepare("UPDATE categories SET is_active=1 WHERE id='tap-repair-team'").run();

    // Availability is independently checked for BOTH sides. An ineligible
    // competing listing must not veto an eligible curated suggestion.
    const addListing=(id,account,listId)=>{
      f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
      f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(account);
      f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
        .run(listId,account,id);
    };
    addListing("plumber","worker-alias-1","11111111-1111-4111-8111-111111111111");
    assert.deepEqual((await get(f.adapter,q+"&cursor=1&availableOnly=1")).body.data
      .categories.map(c=>c.id),["plumber"]);
    addListing("tap-repair-team","worker-alias-2","22222222-2222-4222-8222-222222222222");
    assert.deepEqual((await get(f.adapter,q+"&cursor=1&availableOnly=1")).body.data
      .categories,[]);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE category_id='tap-repair-team'").run();
    assert.deepEqual((await get(f.adapter,q+"&cursor=1&availableOnly=1")).body.data
      .categories.map(c=>c.id),["plumber"]);

    // Without an independently active curated ID, ordinary literal discovery
    // continues to cover all independently approved public Categories.
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='plumber'").run();
    assert.deepEqual((await get(f.adapter,q+"&cursor=1")).body.data.categories
      .map(c=>c.id),["tap-repair-team"]);
  }finally{f.db.close();}
});

test("Search continuation requires a current live anchor in this same matching query",async()=>{
  const f=fixture(9);
  try{
    const one=(await get(f.adapter,"q=Service&cursor=1&limit=2")).body.data;
    assert.deepEqual(one.categories.map(x=>x.id),["work-0000","work-0001"]);
    const suffix="&cursor=1&limit=2&after="+encodeURIComponent(one.nextCursor);
    const next=async(q="Service")=>(await get(f.adapter,"q="+encodeURIComponent(q)+suffix)).body.data;
    assert.deepEqual((await next()).categories.map(x=>x.id),["work-0002","work-0003"]);
    for(const bad of ["0:work-not-found","1:work-0001","0:work-0008"]){
      const d=(await get(f.adapter,"q=Service&cursor=1&after="+encodeURIComponent(bad))).body.data;
      assert.deepEqual(d.categories,[]);
      assert.equal(d.nextCursor,null);
    }
    // A previously valid Category ID is not evidence it matched a NEW query.
    const otherQuery=await next("Trade 5");
    assert.deepEqual(otherQuery.categories,[]);
    assert.equal(otherQuery.nextCursor,null);
    assert.deepEqual((await get(f.adapter,"q="+encodeURIComponent("Trade 5")+"&cursor=1"))
      .body.data.categories.map(x=>x.id),["work-0005"]);
    // Renaming the source so it no longer matches the original query makes
    // the prior cursor stale even when its ID and sort order still exist.
    f.db.prepare("UPDATE categories SET name_en='Other Work' WHERE id='work-0001'").run();
    assert.deepEqual((await next()).categories,[]);
    f.db.prepare("UPDATE categories SET name_en='Community Service Trade 1' WHERE id='work-0001'").run();
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='work-0001'").run();
    assert.deepEqual((await next()).categories,[]);
    f.db.prepare("UPDATE categories SET is_active=1,sort_order=999 WHERE id='work-0001'").run();
    assert.deepEqual((await next()).categories,[]);
    f.db.prepare("UPDATE categories SET sort_order=0 WHERE id='work-0001'").run();
    assert.deepEqual((await next()).categories.map(x=>x.id),["work-0002","work-0003"]);
    f.db.prepare("DELETE FROM categories WHERE id='work-0001'").run();
    assert.deepEqual((await next()).categories,[]);
    const restart=(await get(f.adapter,"q=Service&cursor=1&limit=2")).body.data;
    assert.deepEqual(restart.categories.map(x=>x.id),["work-0000","work-0002"]);
  }finally{f.db.close();}
});

test("availableOnly Search cursor rejects a source whose listing loses public eligibility",async()=>{
  const f=fixture(9);
  try{
    const add=(id,owner,listId)=>{
      f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(owner);
      f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(owner);
      f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
        .run(listId,owner,id);
    };
    add("work-0001","search-owner-1","11111111-1111-4111-8111-111111111111");
    add("work-0005","search-owner-5","55555555-5555-4555-8555-555555555555");
    const root="q=Service&cursor=1&availableOnly=1&limit=1";
    const first=(await get(f.adapter,root)).body.data;
    assert.deepEqual(first.categories.map(x=>x.id),["work-0001"]);
    const forward=root+"&after="+encodeURIComponent(first.nextCursor);
    assert.deepEqual((await get(f.adapter,forward)).body.data.categories.map(x=>x.id),["work-0005"]);
    const invented=await get(f.adapter,root+"&after=0:work-0000");
    assert.deepEqual(invented.body.data.categories,[]);
    assert.equal(invented.body.data.nextCursor,null);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE category_id='work-0001'").run();
    const stale=(await get(f.adapter,forward)).body.data;
    assert.deepEqual(stale.categories,[]);
    assert.equal(stale.nextCursor,null);
    assert.deepEqual((await get(f.adapter,root)).body.data.categories.map(x=>x.id),["work-0005"]);
    const redacted=JSON.stringify(stale);
    for(const hidden of ["search-owner-1","worker_account_id","phone","latitude","longitude"]){
      assert.equal(redacted.includes(hidden),false,hidden);
    }
  }finally{f.db.close();}
});


test("continued Search checks its live matching anchor in the same SQL as the returned page",async()=>{
  const f=fixture(7);
  try {
    const base="q=Service&cursor=1&limit=1";
    const first=(await get(f.adapter,base)).body.data;
    assert.deepEqual(first.categories.map(x=>x.id),["work-0000"]);
    const continuation=base+"&after="+encodeURIComponent(first.nextCursor);
    let readQueries=[];
    const observed={...f.adapter,prepare(query){
      readQueries.push(query);
      return f.adapter.prepare(query);
    }};
    async function next(){
      readQueries=[];
      const r=await get(observed,continuation);
      assert.equal(r.status,200);
      return r.body.data;
    }
    assert.deepEqual((await next()).categories.map(x=>x.id),["work-0001"]);
    assert.equal(readQueries.length,1,"anchor and page must be one D1 read");
    assert.match(readQueries[0],/EXISTS \(SELECT 1 FROM categories AS anchor/);
    // The cursor's Category still exists, but its prior search membership is gone.
    f.db.prepare("UPDATE categories SET name_en='Another Occupation',name_hi='अन्य कार्य',slug='renamed' WHERE id='work-0000'").run();
    assert.deepEqual(await next(),{language:"en",query:"Service",categories:[],nextCursor:null});
    assert.equal(readQueries.length,1);
    f.db.prepare("UPDATE categories SET name_en='Community Service Trade 0',slug='work-0000' WHERE id='work-0000'").run();
    assert.deepEqual((await next()).categories.map(x=>x.id),["work-0001"]);
  }finally{f.db.close();}
});

test("available-only Search cursor checks anchor listing, not the NEXT Category's listing",async()=>{
  const f=fixture(6);
  try {
    const add=(category,account,id)=>{
      f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
      f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(account);
      f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
        .run(id,account,category);
    };
    add("work-0001","atomic-search-owner1","11111111-1111-4111-8111-111111111111");
    add("work-0004","atomic-search-owner4","44444444-4444-4444-8444-444444444444");
    const base="q=Service&cursor=1&limit=1&availableOnly=1";
    const first=(await get(f.adapter,base)).body.data;
    assert.deepEqual(first.categories.map(x=>x.id),["work-0001"]);
    const next=base+"&after="+encodeURIComponent(first.nextCursor);
    let sql="";
    const observed={...f.adapter,prepare(query){sql=query;return f.adapter.prepare(query);}};
    const follow=async()=>(await get(observed,next)).body.data;
    assert.deepEqual((await follow()).categories.map(x=>x.id),["work-0004"]);
    assert.match(sql,/wl\.category_id=anchor\.id/);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE category_id='work-0001'").run();
    assert.deepEqual(await follow(),{language:"en",query:"Service",categories:[],nextCursor:null});
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed' WHERE category_id='work-0001'").run();
    assert.deepEqual((await follow()).categories.map(x=>x.id),["work-0004"]);
  }finally{f.db.close();}
});
