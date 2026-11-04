import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import {openLocalDatabase} from "./helpers/local-db.mjs";

const origin="https://api.jodlo.rekixo.com";
const path="/api/v1/me/listings";
const owner="account-resume-one",other="account-resume-two";
const category="repair";
const sendJSON=(body)=>JSON.stringify(body);
function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const id of [owner,other]){
    db.prepare("INSERT INTO accounts(id) VALUES(?)").run(id);
    db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(id);
  }
  for(const [id,active] of [[category,1],["other-category",1],["inactive",0]]){
    db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)")
      .run(id,id,id,"परीक्षण",active);
  }
  const AUTH={async verify(token){
    if(token==="token-owner")return {accountId:owner};
    if(token==="token-other")return {accountId:other};
    return null;
  }};
  const env={DB:adapter,AUTH};
  async function request(uri,method="GET",token="token-owner",raw){
    const init={method,headers:{
      ...(token?{Authorization:"Bearer "+token}:{}),
      ...(raw!==undefined?{"Content-Type":"application/json"}:{}),
    },...(raw!==undefined?{body:raw}:{})};
    const res=await worker.fetch(new Request(origin+uri,init),env);
    return {status:res.status,body:await res.json()};
  }
  const publish=async (cat=category)=>request(path,"POST","token-owner",sendJSON({categoryId:cat}));
  const pause=(id)=>request(path+"?id="+id,"DELETE");
  const resume=(id,cat=category)=>request(path+"?resume=1","POST","token-owner",sendJSON({
    listingId:id,expectedCategoryId:cat,
  }));
  return {db,request,publish,pause,resume};
}
test("explicit resume reactivates exactly the old paused Listing; public remains two-field and no new row",async()=>{
  const f=fixture();
  try{
    const post=await f.publish();assert.equal(post.status,200);
    const listing=post.body.data.listing;
    assert.equal((await f.resume(listing.id)).status,409,"published is not paused");
    assert.equal((await f.pause(listing.id)).status,200);
    assert.deepEqual((await f.request("/api/v1/listings?categoryId=repair")).body.data.listings,[]);
    const pausedOwner=(await f.request(path)).body.data.listings;
    assert.deepEqual(pausedOwner,[{...listing,visible:false}]);
    const resumed=await f.resume(listing.id);
    assert.equal(resumed.status,200);
    assert.deepEqual(resumed.body.data,{listing});
    assert.deepEqual((await f.request("/api/v1/listings?categoryId=repair")).body.data.listings,[listing]);
    assert.deepEqual((await f.request(path)).body.data.listings,[{...listing,visible:true}]);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n,1);
    assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(listing.id).status,"published");
    assert.equal((await f.resume(listing.id)).status,409,"resume cannot be repeated");
  }finally{f.db.close();}
});
test("resume never bypasses owner, paused state, moderation, approved Category or worker status",async()=>{
  const f=fixture();
  try {
    const listing=(await f.publish()).body.data.listing;
    assert.equal((await f.pause(listing.id)).status,200);
    const verify=async ()=>assert.equal((await f.resume(listing.id)).status,409);
    assert.equal((await f.request(path+"?resume=1","POST","token-other",
      sendJSON({listingId:listing.id,expectedCategoryId:category}))).status,409);
    assert.equal((await f.resume(listing.id,"other-category")).status,409);
    assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(listing.id).status,"unpublished");
  }catch(e){
    // The first non-owner and stale-Category reads above must not change state.
    throw e;
  }finally{f.db.close();}
});
test("hidden, inactive, account-disabled and removed worker prevent owner resume atomically",async()=>{
  const f=fixture();
  try{
    const listing=(await f.publish()).body.data.listing;
    assert.equal((await f.pause(listing.id)).status,200);
    const checks=[
      ["UPDATE worker_listings SET moderation_status='hidden' WHERE id=?",
       "UPDATE worker_listings SET moderation_status='allowed' WHERE id=?",listing.id],
      ["UPDATE categories SET is_active=0 WHERE id=?",
       "UPDATE categories SET is_active=1 WHERE id=?",category],
      ["UPDATE accounts SET status='disabled' WHERE id=?",
       "UPDATE accounts SET status='active' WHERE id=?",owner],
    ];
    for(const [change,undo,id] of checks){
      f.db.prepare(change).run(id);
      const bad=await f.resume(listing.id);
      assert.equal(bad.status,409);
      assert.equal(bad.body.error.code,"CONFLICT");
      assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(listing.id).status,"unpublished");
      f.db.prepare(undo).run(id);
    }
    f.db.prepare("UPDATE worker_profiles SET status='draft' WHERE account_id=?").run(owner);
    assert.equal((await f.resume(listing.id)).status,200);
    assert.equal((await f.pause(listing.id)).status,200);
    f.db.prepare("DELETE FROM worker_profiles WHERE account_id=?").run(owner);
    assert.equal((await f.resume(listing.id)).status,409);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n,0,
      "FK cascade prevents reactivation of deleted worker's Listing");
  }finally{f.db.close();}
});
test("resume rejects forged query, body, unauthenticated request, duplicate keys and client identity",async()=>{
  const f=fixture();
  try{
    const listing=(await f.publish()).body.data.listing;
    await f.pause(listing.id);
    const id=listing.id;
    for(const uri of [path+"?resume=0",path+"?resume=true",path+"?resume=1&resume=1",
      path+"?resume=1&id="+id,path+"?resume=1&owner="+owner,path+"?resume=1&limit=1"]){
      assert.equal((await f.request(uri,"POST","token-owner",
        sendJSON({listingId:id,expectedCategoryId:category}))).status,400,uri);
    }
    const raws=[
      sendJSON({listingId:id,expectedCategoryId:category,ownerAccountId:owner}),
      sendJSON({listingId:id,expectedCategoryId:category,moderation_status:"allowed"}),
      sendJSON({listingId:id,expectedCategoryId:category,verified:true}),
      sendJSON({listingId:id,expectedCategoryId:category,phone:"+91"}),
      sendJSON({listingId:"../private",expectedCategoryId:category}),
      sendJSON({listingId:id,expectedCategoryId:"bad category"}),
      '{"listingId":"'+id+'","listingId":"'+id+'","expectedCategoryId":"repair"}',
      '{"listingId":"'+id+'","expectedCategoryId":"repair","expectedCategoryId":"repair"}',
      '{"expectedCategoryId":"repair","listingId":"'+id+'"}',
      '{"listingId":"'+id+'","expectedCategoryId":"repair","price":1}',
    ];
    for(const raw of raws){
      const result=await f.request(path+"?resume=1","POST","token-owner",raw);
      assert.equal(result.status,400,raw);
    }
    assert.equal((await f.request(path+"?resume=1","POST",null,
      sendJSON({listingId:id,expectedCategoryId:category}))).status,401);
    assert.equal((await f.request(path+"?resume=1","POST","forged",
      sendJSON({listingId:id,expectedCategoryId:category}))).status,401);
    assert.deepEqual((await f.request("/api/v1/listings?categoryId=repair")).body.data.listings,[]);
    assert.equal((await f.resume(id)).status,200);
  }finally{f.db.close();}
});
