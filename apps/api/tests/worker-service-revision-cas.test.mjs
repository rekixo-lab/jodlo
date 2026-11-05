import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import {openLocalDatabase} from "./helpers/local-db.mjs";

const origin="https://api.jodlo.rekixo.com";
const owner="worker-revision-owner", stranger="worker-revision-other";
const listing=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");

function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const actor of [owner,stranger]){
    db.prepare("INSERT INTO accounts(id) VALUES(?)").run(actor);
    db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(actor);
  }
  const insert=db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)");
  for(const name of ["plumber","carpenter","painter","electrician","other"]) {
    insert.run(name,name,name,name);
  }
  db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
    .run(listing(1),owner,"plumber");
  db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
    .run(listing(2),stranger,"plumber");
  const AUTH={async verify(token){
    if(token==="owner-proof")return {accountId:owner};
    if(token==="other-proof")return {accountId:stranger};
    return null;
  }};
  const send=async({path="/api/v1/me/listings",method="GET",token="owner-proof",
                    body,env={DB:adapter,AUTH}}={})=>{
    const response=await worker.fetch(new Request(origin+path,{
      method,headers:{...(token?{Authorization:"Bearer "+token}:{}),
        ...(body!==undefined?{"Content-Type":"application/json"}:{})},
      ...(body!==undefined?{body}:{}),
    }),env);
    return {status:response.status,data:await response.json(),
      cache:response.headers.get("Cache-Control")};
  };
  const snapshot=(id=listing(1),view="revision",token="owner-proof")=>
    send({path:"/api/v1/me/listings?id="+id+"&view="+view,token});
  const edit=(expectedRevision,expectedCategoryId="plumber",
    nextCategoryId="carpenter",id=listing(1),token="owner-proof")=>
    send({path:"/api/v1/me/listings?revision=1",method:"PUT",token,
      body:JSON.stringify({listingId:id,expectedCategoryId,
        nextCategoryId,expectedRevision})});
  const legacyEdit=(expectedCategoryId,nextCategoryId)=>
    send({method:"PUT",body:JSON.stringify({listingId:listing(1),
      expectedCategoryId,nextCategoryId})});
  return {db,adapter,AUTH,send,snapshot,edit,legacyEdit};
}

test("revision snapshot is private and old exact/legacy/public wire shapes stay unchanged",async()=>{
 const f=fixture();try{
   const current=await f.snapshot();
   assert.equal(current.status,200);
   assert.equal(current.cache,"no-store");
   assert.deepEqual(current.data,{ok:true,data:{listing:{
     id:listing(1),categoryId:"plumber",visible:true,
     publicationStatus:"published",revision:0
   }}});
   const old=await f.snapshot(listing(1),"management");
   assert.equal(old.status,200);
   assert.deepEqual(Object.keys(old.data.data.listing).sort(),
     ["categoryId","id","publicationStatus","visible"]);
   const list=await f.send();
   assert.deepEqual(Object.keys(list.data.data.listings[0]).sort(),
     ["categoryId","id","visible"]);
   const pub=await f.send({path:"/api/v1/listings?categoryId=plumber",token:null});
   assert.equal(pub.status,200);
   assert.deepEqual(Object.keys(pub.data.data.listings[0]).sort(),["categoryId","id"]);
   const serialized=JSON.stringify(current.data);
   for(const forbidden of [owner,stranger,"phone","GPS","workerId","verified",
       "moderation_status","email","created_at","ownerId"]){
     assert.equal(serialized.includes(forbidden),false,forbidden);
   }
 }finally{f.db.close();}
});

test("revision CAS defeats two-device ABA even when original Category returns",async()=>{
 const f=fixture();try{
   const old=(await f.snapshot()).data.data.listing;
   assert.equal(old.revision,0);
   assert.equal((await f.legacyEdit("plumber","carpenter")).status,200);
   assert.equal((await f.snapshot()).data.data.listing.revision,1);
   assert.equal((await f.legacyEdit("carpenter","plumber")).status,200);
   const restored=(await f.snapshot()).data.data.listing;
   assert.equal(restored.categoryId,"plumber");
   assert.equal(restored.revision,2);
   const stale=await f.edit(old.revision,"plumber","painter");
   assert.equal(stale.status,409);
   assert.equal(stale.data.error.code,"CONFLICT");
   assert.equal((await f.snapshot()).data.data.listing.categoryId,"plumber");
   const valid=await f.edit(restored.revision,"plumber","painter");
   assert.equal(valid.status,200);
   assert.deepEqual(valid.data,{ok:true,data:{listing:{
     id:listing(1),categoryId:"painter",revision:3
   }}});
   assert.equal((await f.snapshot()).data.data.listing.revision,3);
   assert.equal((await f.edit(2,"painter","electrician")).status,409);
   assert.equal((await f.snapshot()).data.data.listing.categoryId,"painter");
 }finally{f.db.close();}
});

test("legacy and private moderator/publication updates bump revisions, no-op does not",async()=>{
 const f=fixture();try{
   // Also enable recursive triggers: updating only revision must not recurse.
   f.db.exec("PRAGMA recursive_triggers=ON");
   const put=(sql,args)=>f.db.prepare(sql).run(...args);
   put("UPDATE worker_listings SET status='unpublished' WHERE id=?",[listing(1)]);
   let s=(await f.snapshot()).data.data.listing;
   assert.equal(s.revision,1);
   assert.equal(s.publicationStatus,"unpublished");
   assert.equal(s.visible,false);
   assert.equal((await f.edit(0)).status,409);
   put("UPDATE worker_listings SET status='unpublished' WHERE id=?",[listing(1)]);
   assert.equal((await f.snapshot()).data.data.listing.revision,1);
   put("UPDATE worker_listings SET status='published' WHERE id=?",[listing(1)]);
   put("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?",[listing(1)]);
   s=(await f.snapshot()).data.data.listing;
   assert.equal(s.revision,3);
   assert.equal(s.visible,false);
   assert.equal(s.publicationStatus,"published");
   assert.equal((await f.edit(3)).status,409);
   put("UPDATE worker_listings SET moderation_status='allowed' WHERE id=?",[listing(1)]);
   assert.equal((await f.snapshot()).data.data.listing.revision,4);
   f.db.prepare("UPDATE categories SET is_active=0 WHERE id='painter'").run();
   assert.equal((await f.edit(4,"plumber","painter")).status,409);
   f.db.prepare("UPDATE categories SET is_active=1 WHERE id='painter'").run();
   assert.equal((await f.edit(4,"plumber","painter")).status,200);
   assert.equal((await f.snapshot()).data.data.listing.revision,5);
 }finally{f.db.close();}
});

test("revision endpoint gives generic 401/404, malformed edits 400, and 503 without leakage",async()=>{
 const f=fixture();try{
   assert.equal((await f.snapshot(listing(2))).status,404);
   assert.equal((await f.snapshot(listing(1),"revision","other-proof")).status,404);
   assert.equal((await f.snapshot(listing(200))).status,404);
   assert.equal((await f.snapshot(listing(1),"revision",null)).status,401);
   assert.equal((await f.snapshot(listing(1),"revision","wrong")).status,401);
   const wrong=(await f.edit(0,"plumber","painter",listing(2)));
   assert.equal(wrong.status,409);
   const invalidPaths=[
     "/api/v1/me/listings?id="+listing(1)+"&view=revision&limit=1",
     "/api/v1/me/listings?id="+listing(1)+"&view=revision&view=revision",
     "/api/v1/me/listings?id="+listing(1)+"&view=revision&id="+listing(2),
     "/api/v1/me/listings?id="+listing(1)+"&view=unknown",
     "/api/v1/me/listings?view=revision",
     "/api/v1/me/listings?id=../private&view=revision",
   ];
   for(const path of invalidPaths)
     assert.equal((await f.send({path})).status,400,path);
   const good='{"listingId":"'+listing(1)+'","expectedCategoryId":"plumber","nextCategoryId":"carpenter","expectedRevision":0}';
   for(const body of [
      good.replace('"expectedRevision":0','"expectedRevision":-1'),
      good.replace('"expectedRevision":0','"expectedRevision":01'),
      good.replace('"expectedRevision":0','"expectedRevision":1.0'),
      good.replace('"expectedRevision":0','"expectedRevision":"0"'),
      good.replace('"expectedRevision":0','"expectedRevision":2147483647'),
      good.replace('"expectedRevision":0','"expectedRevision":99999999999'),
      good.replace('"expectedRevision":0','"expectedRevision":0,"price":100'),
      good.replace('"expectedRevision":0','"expectedRevision":0,"expectedRevision":0'),
      good.replace('"expectedRevision":0','"\\u0065xpectedRevision":0'),
      good.replace('"listingId"','"ownerId":"'+stranger+'","listingId"'),
      good.replace('"nextCategoryId":"carpenter"','"nextCategoryId":"plumber"'),
   ]) {
      assert.equal((await f.send({path:"/api/v1/me/listings?revision=1",
        method:"PUT",body})).status,400,body.slice(-70));
   }
   for(const path of [
      "/api/v1/me/listings?revision=2",
      "/api/v1/me/listings?revision=1&revision=1",
      "/api/v1/me/listings?revision=1&owner="+stranger,
   ])assert.equal((await f.send({path,method:"PUT",body:good})).status,400,path);
   assert.equal((await f.send({path:"/api/v1/me/listings?revision=1",
     method:"PUT",body:good,token:null})).status,401);
   assert.equal((await f.snapshot()).data.data.listing.revision,0);
   f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(owner);
   assert.equal((await f.snapshot()).status,404);
   assert.equal((await f.edit(0)).status,409);
   // SQL/binding failures do not return D1 errors or an unversioned fallback.
   const broken=await f.send({path:"/api/v1/me/listings?id="+listing(1)+
     "&view=revision",env:{DB:{prepare(){throw Error("PRIVATE_SQL_TOKEN");}},AUTH:f.AUTH}});
   assert.equal(broken.status,503);
   assert.equal(JSON.stringify(broken.data).includes("PRIVATE_SQL_TOKEN"),false);
 }finally{f.db.close();}
});
