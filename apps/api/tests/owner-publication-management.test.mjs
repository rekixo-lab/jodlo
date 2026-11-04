import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {parseOwnListingsPage} from "../src/modules/workers/listings.ts";

const origin="https://api.jodlo.rekixo.com";
const route="/api/v1/me/listings";
const owner="owner-management",other="owner-different";
const id=i=>"00000000-0000-4000-8000-"+String(i).padStart(12,"0");
const cat=i=>"trade-"+String(i).padStart(3,"0");
function fixture(){
  const {db,adapter}=openLocalDatabase();
  const AUTH={async verify(token){
    if(token==="owner-proof")return {accountId:owner};
    if(token==="other-proof")return {accountId:other};
    return null;
  }};
  for(const account of [owner,other]){
    db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
    db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(account);
  }
  for(let i=0;i<7;i++){
    const cid=cat(i);
    db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)")
      .run(cid,cid,"Trade "+i,"काम "+i,1);
    db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id,created_at) VALUES(?,?,?,?)")
      .run(id(i),i===6?other:owner,cid,"2026-11-01T00:00:00.000Z");
  }
  db.prepare("UPDATE worker_listings SET status='unpublished' WHERE id=?").run(id(1));
  db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?").run(id(2));
  db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(cat(3));
  const get=async(query="",token="owner-proof",path=route)=>{
    const res=await worker.fetch(new Request(origin+path+query,{
      headers:token?{Authorization:"Bearer "+token}:{},
    }),{DB:adapter,AUTH});
    return {status:res.status,body:await res.json()};
  };
  return {db,get};
}

test("owner management differentiates paused from published-but-hidden without exposing reasons",async()=>{
  const f=fixture();
  try{
    const management=await f.get("?limit=5&view=management");
    assert.equal(management.status,200);
    const rows=management.body.data.listings;
    assert.deepEqual(rows,Array.from({length:5},(_,i)=>({
      id:id(i),categoryId:cat(i),
      visible:i===0||i===4,
      publicationStatus:i===1?"unpublished":"published",
    })));
    assert.equal(management.body.data.nextCursor,id(4));
    const page2=await f.get("?limit=5&view=management&after="+id(4));
    assert.deepEqual(page2.body.data,{listings:[{
      id:id(5),categoryId:cat(5),visible:true,publicationStatus:"published",
    }],nextCursor:null});
    const privateText=JSON.stringify(management.body);
    for(const field of [owner,other,"worker_account_id","moderation_status",
      "hidden","verified","phone","latitude","longitude","created_at"]){
      assert.equal(privateText.includes(field),false,field);
    }
    // Legacy bounded pages, legacy 100-cap and public lookup have the
    // exact old field allowlists, never publicationStatus.
    const legacy=(await f.get("?limit=5")).body.data;
    assert.deepEqual(legacy.listings,rows.map(({id,categoryId,visible})=>
      ({id,categoryId,visible})));
    assert.ok(legacy.listings.every(x=>Object.keys(x).sort().join(",")==="categoryId,id,visible"));
    const old=(await f.get()).body.data;
    assert.deepEqual(Object.keys(old),["listings"]);
    assert.ok(old.listings.every(x=>Object.keys(x).length===3));
    const publicRead=await f.get("?categoryId="+cat(0),"", "/api/v1/listings");
    assert.equal(publicRead.status,200);
    assert.deepEqual(publicRead.body.data.listings,[{id:id(0),categoryId:cat(0)}]);
    assert.equal(JSON.stringify(publicRead.body).includes("publicationStatus"),false);
  }finally{f.db.close();}
});

test("management is authenticated and owner-scoped, foreign anchors do not reveal other owners",async()=>{
  const f=fixture();
  try{
    assert.equal((await f.get("?limit=2&view=management",null)).status,401);
    assert.equal((await f.get("?limit=2&view=management","wrong")).status,401);
    const another=await f.get("?limit=2&view=management","other-proof");
    assert.deepEqual(another.body.data,{listings:[{
      id:id(6),categoryId:cat(6),visible:true,publicationStatus:"published",
    }],nextCursor:null});
    assert.deepEqual((await f.get("?limit=2&view=management&after="+id(6))).body.data,
      {listings:[],nextCursor:null});
    assert.deepEqual((await f.get("?limit=2&view=management&after="+id(0),"other-proof")).body.data,
      {listings:[],nextCursor:null});
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(owner);
    assert.deepEqual((await f.get("?limit=2&view=management")).body.data,
      {listings:[],nextCursor:null});
  }finally{f.db.close();}
});

test("management is opt-in: invalid/duplicate/ambiguous query input fails rather than downgrade",async()=>{
  const f=fixture();
  try{
    for(const query of [
      "?view=management","?limit=2&view","?limit=2&view=",
      "?limit=2&view=legacy","?limit=2&view=management&view=management",
      "?view=management&limit=2&limit=2","?limit=0&view=management",
      "?limit=26&view=management","?limit=02&view=management",
      "?after="+id(0)+"&view=management",
      "?limit=2&view=management&after=../owner",
      "?limit=2&view=management&after="+id(0)+"&after="+id(1),
      "?limit=2&view=management&owner="+other,
      "?limit=2&view=management&status=published",
    ]){
      const res=await f.get(query);
      assert.equal(res.status,400,query);
      assert.equal(res.body.error.code,"INVALID_QUERY");
    }
    assert.deepEqual(parseOwnListingsPage(
      new URLSearchParams("limit=25&view=management&after="+id(0))),
      {limit:25,after:id(0),management:true});
    assert.deepEqual(parseOwnListingsPage(new URLSearchParams("limit=25")),
      {limit:25,after:null});
    assert.deepEqual(parseOwnListingsPage(new URLSearchParams("")),
      {limit:null,after:null});
  }finally{f.db.close();}
});

test("changing own publication and moderation state is reflected on fresh owner read, never cached",async()=>{
  const f=fixture();
  try{
    assert.deepEqual((await f.get("?limit=2&view=management")).body.data.listings[0],
      {id:id(0),categoryId:cat(0),visible:true,publicationStatus:"published"});
    f.db.prepare("UPDATE worker_listings SET status='unpublished' WHERE id=?").run(id(0));
    let read=(await f.get("?limit=2&view=management")).body.data.listings[0];
    assert.equal(read.publicationStatus,"unpublished");
    assert.equal(read.visible,false);
    f.db.prepare("UPDATE worker_listings SET status='published' WHERE id=?").run(id(0));
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?").run(id(0));
    read=(await f.get("?limit=2&view=management")).body.data.listings[0];
    assert.equal(read.publicationStatus,"published");
    assert.equal(read.visible,false);
    // No moderator reason/approval or account identity is returned to the owner.
    assert.deepEqual(Object.keys(read).sort(),["categoryId","id","publicationStatus","visible"]);
  }finally{f.db.close();}
});
