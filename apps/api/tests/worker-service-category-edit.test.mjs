import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { publishListing } from "../src/modules/workers/listings.ts";

const origin="https://api.jodlo.rekixo.com", a="worker-category-editor-a111", b="worker-category-editor-b222";
async function fixture() {
  const { db,adapter }=openLocalDatabase();
  await ensureAccount(adapter,a);await ensureAccount(adapter,b);
  await optInAsWorker(adapter,a);await optInAsWorker(adapter,b);
  const category=db.prepare(
    "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)");
  category.run("plumber","plumber","Plumber","प्लंबर",1);
  category.run("carpenter","carpenter","Carpenter","बढ़ई",1);
  category.run("electrician","electrician","Electrician","बिजली मिस्त्री",1);
  category.run("inactive","inactive","Inactive","बंद",0);
  const own=await publishListing(adapter,a,"plumber");
  const other=await publishListing(adapter,b,"plumber");
  const tokA=(await issueSession(adapter,a)).accessToken;
  const tokB=(await issueSession(adapter,b)).accessToken;
  async function send({id=own.id,expected="plumber",next="carpenter",token=tokA,
    body,method="PATCH",path="/api/v1/me/listings",type="application/json"}={}) {
    const payload=body===undefined?JSON.stringify({
      listingId:id,expectedCategoryId:expected,nextCategoryId:next}):body;
    const res=await worker.fetch(new Request(origin+path,{
      method,headers:{...(token?{Authorization:"Bearer "+token}:{}),
        "Content-Type":type},
      ...(method==="GET"?{}:{body:payload}),
    }),{DB:adapter});
    return {status:res.status,json:await res.json(),
      headers:res.headers};
  }
  return {db,adapter,own,other,tokA,tokB,send};
}

test("existing public worker listing is edited atomically to a new approved Category",async()=>{
  const f=await fixture();try{
    const before=f.db.prepare("SELECT * FROM worker_listings WHERE id=?").get(f.own.id);
    const result=await f.send();
    assert.equal(result.status,200);
    assert.deepEqual(result.json,{ok:true,data:{listing:{
      id:f.own.id,categoryId:"carpenter"}}});
    assert.equal(result.headers.get("Cache-Control"),"no-store");
    const after=f.db.prepare("SELECT * FROM worker_listings WHERE id=?").get(f.own.id);
    assert.equal(after.worker_account_id,before.worker_account_id);
    assert.equal(after.id,before.id);
    assert.equal(after.status,before.status);
    assert.equal(after.moderation_status,before.moderation_status);
    assert.equal(after.created_at,before.created_at);
    assert.equal(after.category_id,"carpenter");
    const publicOld=await f.send({path:"/api/v1/listings?categoryId=plumber",method:"GET"});
    assert.equal(publicOld.status,200);
    assert.equal(publicOld.json.data.listings.some(x=>x.id===f.own.id),false);
    const publicNew=await f.send({path:"/api/v1/listings?categoryId=carpenter",method:"GET"});
    assert.equal(publicNew.json.data.listings.some(x=>x.id===f.own.id),true);
    const detail=await f.send({path:"/api/v1/listings?id="+f.own.id,method:"GET"});
    assert.deepEqual(detail.json.data.listing,{id:f.own.id,categoryId:"carpenter"});
    const owner=await f.send({path:"/api/v1/me/listings?limit=20",method:"GET"});
    assert.equal(owner.json.data.listings.find(x=>x.id===f.own.id).categoryId,"carpenter");
    const otherOwner=await f.send({path:"/api/v1/me/listings?limit=20",method:"GET",token:f.tokB});
    assert.equal(otherOwner.json.data.listings.some(x=>x.id===f.own.id),false);
  }finally{f.db.close()}
});

test("stale expected category, cross-owner, duplicate and inactive destination all fail closed",async()=>{
  const f=await fixture();try{
    const old=f.db.prepare("SELECT * FROM worker_listings WHERE id=?").get(f.own.id);
    await f.send();
    for (const input of [
      {expected:"plumber",next:"electrician"},
      {id:f.other.id,expected:"plumber",next:"electrician"},
      {expected:"carpenter",next:"inactive"},
      {expected:"carpenter",next:"carpenter"},
    ]) {
      const result=await f.send(input);
      assert.equal(result.status,input.next===input.expected?400:409);
      assert.equal(result.json.ok,false);
      assert.equal(JSON.stringify(result.json).includes(f.other.id),false);
    }
    // Conflict for a destination already owned by the same actor.
    const otherOwn=await publishListing(f.adapter,a,"electrician");
    assert.ok(otherOwn);
    assert.equal((await f.send({expected:"carpenter",next:"electrician"})).status,409);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.own.id);
    assert.equal((await f.send({expected:"carpenter",next:"plumber"})).status,409);
    assert.equal(f.db.prepare("SELECT category_id FROM worker_listings WHERE id=?")
      .get(f.own.id).category_id,"carpenter");
    assert.equal(old.worker_account_id,a);
  }finally{f.db.close()}
});

test("strict PATCH input, active worker, revocation, and no unapproved extra fields",async()=>{
  const f=await fixture();try{
    const baseline=JSON.stringify({listingId:f.own.id,
      expectedCategoryId:"plumber",nextCategoryId:"carpenter"});
    const cases=[
      baseline.replace('"listingId"','"ownerId":"'+b+'","listingId"'),
      baseline.replace('"listingId"','"listingId":"'+f.other.id+'","listingId"'),
      baseline.replace('"nextCategoryId"','"price":500,"nextCategoryId"'),
      baseline.replace('"nextCategoryId"','"location":"GPS","nextCategoryId"'),
      baseline.replace('"nextCategoryId"','"newCategoryId"'),
      baseline.replace('"listingId"','"\\u006cistingId"'),
      baseline.replace('"nextCategoryId":"carpenter"','"nextCategoryId":99'),
      "{}", "{", "[]", "x".repeat(513),
    ];
    for(const body of cases) {
      const res=await f.send({body});
      assert.equal(res.status,400,body.slice(0,35));
    }
    assert.equal((await f.send({type:"text/plain"})).status,400);
    assert.equal((await f.send({path:"/api/v1/me/listings?owner="+b})).status,400);
    assert.equal((await f.send({token:null})).status,401);
    assert.equal((await f.send({token:"invalid"})).status,401);
    const good=await f.send();
    assert.equal(good.status,200);
    const revoked=await f.send({path:"/api/v1/auth/logout-all",method:"POST",body:"",type:"application/json"});
    assert.equal(revoked.status,200);
    assert.equal((await f.send({expected:"carpenter",next:"plumber"})).status,401);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(b);
    assert.equal((await f.send({token:f.tokB,id:f.other.id,expected:"plumber",next:"carpenter"})).status,401);
    // Public projection remains fixed two-field allowlist after edit.
    const pub=await f.send({path:"/api/v1/listings?id="+f.own.id,method:"GET"});
    assert.deepEqual(Object.keys(pub.json.data.listing).sort(),["categoryId","id"]);
  }finally{f.db.close()}
});
