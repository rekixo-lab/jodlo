import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

const origin="https://jodlo.rekixo.com";
const route="/api/v1/catalog/search";
function makeFixture(){
  const {db,adapter}=openLocalDatabase();
  const insert=db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)");
  insert.run("plumber","plumbing","Plumber","प्लंबर",1,10);
  insert.run("carpenter","carpentry","Carpenter","बढ़ई",1,20);
  // This category name matches the user's phrase literally, even though the
  // explicit curated trade intent is 'plumber'. Never pick it automatically.
  insert.run("unrelated-work","tap-repair","Tap Repair","नल का काम",1,30);
  insert.run("blocked-work","wall-repair","Wall Repair","दीवार मरम्मत",0,40);
  db.prepare("INSERT INTO accounts(id) VALUES(?)").run("account-guided-worker");
  const AUTH={async verify(token){
    return token==="signed-guided-worker"?{accountId:"account-guided-worker"}:null;
  }};
  const env={DB:adapter,AUTH};
  const search=async(q,extras="")=>{
    const res=await worker.fetch(new Request(origin+route+"?q="+encodeURIComponent(q)+extras),env);
    return {status:res.status,body:await res.json()};
  };
  const call=(path,method,token,body)=>worker.fetch(new Request(origin+path,{
    method,headers:{...(token?{Authorization:"Bearer "+token}:{}),
      ...(body!==undefined?{"Content-Type":"application/json"}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  }),env);
  return {db,search,call};
}

test("literal text/name conflicts with curated work meaning => explicit options, not auto-selection",async()=>{
  const f=makeFixture();
  try {
    const old=await f.search("I need tap repair");
    assert.equal(old.status,200);
    assert.deepEqual(old.body.data.categories.map(x=>x.id),["unrelated-work"]);
    assert.equal(Object.hasOwn(old.body.data,"needsChoice"),false);
    const result=await f.search("I need tap repair","&includeChoices=1&lang=hi");
    assert.equal(result.status,200);
    assert.deepEqual(result.body.data.categories,[]);
    assert.equal(result.body.data.needsChoice,true);
    assert.deepEqual(result.body.data.choices.map(x=>x.id),["plumber","unrelated-work"]);
    assert.deepEqual(result.body.data.choices.map(x=>x.name),["प्लंबर","नल का काम"]);
    assert.ok(result.body.data.choices.every(x=>Object.keys(x).sort().join(",")==="id,name,slug"));
    // Old catalog remains searchable even if no worker published.
    assert.deepEqual((await f.search("plumber")).body.data.categories.map(x=>x.id),["plumber"]);
  } finally {f.db.close();}
});
test("unapproved/disabled category and available-only never become implicit confirmed trade",async()=>{
  const f=makeFixture();
  try{
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='plumber'").run();
    const first=(await f.search("I need tap repair","&includeChoices=1")).body.data;
    assert.deepEqual(first.choices.map(x=>x.id),["unrelated-work"]);
    assert.equal(first.needsChoice,true);
    f.db.prepare("UPDATE categories SET is_active=1 WHERE id='plumber'").run();
    // Even with two active Categories, a user sees no worker availability yet.
    const second=(await f.search("I need tap repair","&includeChoices=1&availableOnly=1")).body.data;
    assert.deepEqual(second.categories,[]);
    // If the literal name is not publicly available, the curated phrase maps
    // to no available worker either. No fabricated nearby or verified listing.
    assert.deepEqual(second.choices??[],[]);
  }finally{f.db.close();}
});
test("search -> deliberate category ID selection -> authenticated owner publication -> real availableOnly",async()=>{
  const f=makeFixture();
  try{
    let r=await f.search("I need tap repair and wooden furniture","&includeChoices=1");
    assert.equal(r.status,200);
    assert.equal(r.body.data.needsChoice,true);
    assert.deepEqual(r.body.data.choices.map(x=>x.id),["plumber","carpenter"]);
    // The chosen Category ID, not the raw query/alias or an automatic guess,
    // is the ONLY value accepted by the existing secure publication route.
    const token="signed-guided-worker";
    assert.equal((await f.call("/api/v1/me/listings","POST",token,{categoryId:"carpenter"})).status,403);
    f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run("account-guided-worker");
    for(const body of [
      {categoryId:"wooden furniture"},{categoryId:"carpenter",selectedByAI:true},
      {categoryId:"blocked-work"},
    ]) {
      const res=await f.call("/api/v1/me/listings","POST",token,body);
      assert.ok([400,403].includes(res.status),JSON.stringify(body));
    }
    const unauth=await f.call("/api/v1/me/listings","POST",undefined,{categoryId:"carpenter"});
    assert.equal(unauth.status,401);
    const published=await f.call("/api/v1/me/listings","POST",token,{categoryId:"carpenter"});
    assert.equal(published.status,200);
    const selected=(await published.json()).data.listing;
    assert.deepEqual(Object.keys(selected),["id","categoryId"]);
    assert.equal(selected.categoryId,"carpenter");
    const retry=await f.call("/api/v1/me/listings","POST",token,{categoryId:"carpenter"});
    assert.equal((await retry.json()).data.listing.id,selected.id);
    assert.deepEqual((await f.search("plumber","&availableOnly=1")).body.data.categories,[]);
    assert.deepEqual((await f.search("carpenter","&availableOnly=1")).body.data.categories
      .map(x=>x.id),["carpenter"]);
    r=await f.search("I need tap repair and wooden furniture",
      "&includeChoices=1&availableOnly=1");
    assert.deepEqual(r.body.data.choices.map(x=>x.id),["carpenter"]);
    assert.equal(r.body.data.needsChoice,true);
    const listing=await f.call("/api/v1/listings?categoryId=carpenter","GET");
    assert.deepEqual((await listing.json()).data.listings,[selected]);
    const n=f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings WHERE category_id='plumber'").get().n;
    assert.equal(n,0,"Search suggestions never auto-post other trades");
    const removed=await f.call("/api/v1/me/listings?id="+selected.id,"DELETE",token);
    assert.equal(removed.status,200);
    assert.deepEqual((await f.search("carpenter","&availableOnly=1")).body.data.categories,[]);
    assert.deepEqual((await f.search("carpenter")).body.data.categories.map(x=>x.id),["carpenter"]);
  }finally{f.db.close();}
});
test("conflicting matching names greater than safe choice cap yield confirmation required, not partial choices",async()=>{
  const f=makeFixture();
  try{
    const insert=f.db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)");
    for(let i=0;i<12;i++){
      insert.run("other-tap-"+i,"other-tap-"+i,"Tap Repair "+i,"नल सुधार "+i);
    }
    const r=await f.search("I need tap repair","&includeChoices=1&limit=1");
    assert.equal(r.status,200);
    assert.equal(r.body.data.needsChoice,true);
    assert.deepEqual(r.body.data.categories,[]);
    assert.deepEqual(r.body.data.choices,[]);
    assert.equal(r.body.data.nextOffset,null);
  }finally{f.db.close();}
});
