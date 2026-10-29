import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {
  PAGED_MY_LISTINGS_QUERY, CONTINUED_MY_LISTINGS_QUERY,
  parseOwnListingsPage,
} from "../src/modules/workers/listings.ts";

const base="https://jodlo.rekixo.com/api/v1/me/listings";
const owner="owner-all-trades", other="another-worker";
const idFor=i=>"00000000-0000-4000-8000-"+String(i).padStart(12,"0");
const categoryFor=i=>"work-"+String(i).padStart(4,"0");

function fixture(count=889){
  const {db,adapter}=openLocalDatabase();
  for(const account of [owner,other]){
    db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
    db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(account);
  }
  db.exec("BEGIN");
  try{
    const category=db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,1,?)");
    const listing=db.prepare(
      "INSERT INTO worker_listings(id,worker_account_id,category_id,created_at) VALUES(?,?,?,?)");
    for(let i=0;i<count;i++){
      const cat=categoryFor(i);
      category.run(cat,cat,"Synthetic trade "+i,"परीक्षण सेवा "+i,Math.floor(i/3));
      // Deliberately equal timestamps on most rows to test id tie-breaking.
      listing.run(idFor(i),owner,cat,
        i<850?"2026-10-29T00:00:00.000Z":"2026-10-29T00:00:01.000Z");
    }
    if(count)listing.run(idFor(990),other,categoryFor(0),"2026-10-29T00:00:00.000Z");
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");db.close();throw error;}
  const AUTH={async verify(token){
    if(token==="token-owner")return {accountId:owner};
    if(token==="token-other")return {accountId:other};
    return null;
  }};
  const get=async(query="",token="token-owner")=>{
    const response=await worker.fetch(new Request(base+query,{
      headers:token?{Authorization:"Bearer "+token}:{},
    }),{DB:adapter,AUTH});
    return {status:response.status,body:await response.json()};
  };
  return {db,adapter,AUTH,get};
}

test("owner may explicitly traverse all 889 synthetic active work listings without a 100-item product cap",async()=>{
  const f=fixture();
  try{
    const old=await f.get();
    assert.equal(old.status,200);
    assert.deepEqual(Object.keys(old.body.data),["listings"]);
    assert.equal(old.body.data.listings.length,100);
    assert.deepEqual(old.body.data.listings.map(x=>x.id),
      Array.from({length:100},(_,i)=>idFor(i)));

    const seen=[];
    let after=null,pages=0;
    do{
      const query="?limit=25"+(after===null?"":"&after="+encodeURIComponent(after));
      const response=await f.get(query);
      assert.equal(response.status,200,query);
      const page=response.body.data;
      assert.deepEqual(Object.keys(page),["listings","nextCursor"]);
      assert.ok(page.listings.length>=1&&page.listings.length<=25);
      assert.ok(page.listings.every(x=>
        Object.keys(x).sort().join(",")==="categoryId,id,visible"&&x.visible===true));
      seen.push(...page.listings);
      if(page.nextCursor!==null)assert.equal(page.nextCursor,page.listings.at(-1).id);
      after=page.nextCursor;
      pages++;
      assert.ok(pages<=36,"bounded, user-driven continuation");
    }while(after!==null);
    assert.equal(pages,36);
    assert.equal(seen.length,889);
    assert.equal(new Set(seen.map(x=>x.id)).size,889);
    assert.deepEqual(seen.map(x=>x.categoryId),
      Array.from({length:889},(_,i)=>categoryFor(i)));
    const exposed=JSON.stringify(seen);
    for(const privateField of [owner,other,"worker_account_id","created_at",
      "moderation_status","latitude","longitude","phone","verified"]){
      assert.equal(exposed.includes(privateField),false,privateField);
    }
    const otherWorker=await f.get("?limit=25","token-other");
    assert.deepEqual(otherWorker.body.data.listings,[
      {id:idFor(990),categoryId:categoryFor(0),visible:true},
    ]);
    assert.equal(otherWorker.body.data.nextCursor,null);
  }finally{f.db.close();}
});

test("owner cursor stays owned, and hidden/unpublished/inactive items remain privately manageable",async()=>{
  const f=fixture(8);
  try{
    const first=await f.get("?limit=2");
    assert.deepEqual(first.body.data.listings.map(x=>x.id),[idFor(0),idFor(1)]);
    const next="?limit=2&after="+encodeURIComponent(first.body.data.nextCursor);
    assert.deepEqual((await f.get(next)).body.data.listings.map(x=>x.id),[idFor(2),idFor(3)]);
    // Foreign owner cursor is not a valid search anchor for this actor.
    assert.deepEqual((await f.get("?limit=2&after="+idFor(990))).body.data,
      {listings:[],nextCursor:null});
    assert.deepEqual((await f.get("?limit=2&after="+idFor(1),"token-other")).body.data,
      {listings:[],nextCursor:null});
    assert.deepEqual((await f.get("?limit=2&after="+idFor(400))).body.data,
      {listings:[],nextCursor:null});

    f.db.prepare("UPDATE worker_listings SET status='unpublished' WHERE id=?").run(idFor(1));
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?").run(idFor(2));
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(categoryFor(3));
    // Owner can page forward from OWN unpublished items, but cannot treat
    // hidden or inactive listings as PUBLIC eligible.
    const updated=await f.get(next);
    assert.deepEqual(updated.body.data.listings,[
      {id:idFor(2),categoryId:categoryFor(2),visible:false},
      {id:idFor(3),categoryId:categoryFor(3),visible:false},
    ]);
    assert.equal((await f.get("?limit=2")).body.data.listings[1].visible,false);
    assert.equal(updated.body.data.nextCursor,idFor(3));
    f.db.prepare("DELETE FROM worker_listings WHERE id=?").run(idFor(1));
    assert.deepEqual((await f.get(next)).body.data,{listings:[],nextCursor:null});
    assert.deepEqual((await f.get("?limit=2")).body.data.listings.map(x=>x.id),
      [idFor(0),idFor(2)]);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(owner);
    assert.deepEqual((await f.get("?limit=2")).body.data,{listings:[],nextCursor:null});
    assert.equal((await f.get("?limit=2","token-other")).body.data.listings.length,1);
  }finally{f.db.close();}
});

test("strict optional owner pagination leaves old GET/POST/DELETE query contracts intact",async()=>{
  const f=fixture(3);
  try{
    const badQueries=[
      "?after="+idFor(0),"?limit=0","?limit=26","?limit=01","?limit=-1",
      "?limit=2&after=../outside","?limit=1&after=","?limit=2&after=foo%3Abar",
      "?limit=2&after="+idFor(0)+"&after="+idFor(1),
      "?limit=2&limit=2","?limit=2&extra=1","?id="+idFor(0),
    ];
    for(const query of badQueries){
      const response=await f.get(query);
      assert.equal(response.status,400,query);
      assert.equal(response.body.error.code,"INVALID_QUERY");
    }
    assert.deepEqual(parseOwnListingsPage(new URLSearchParams("limit=25&after="+idFor(1))),
      {limit:25,after:idFor(1)});
    assert.deepEqual(parseOwnListingsPage(new URLSearchParams("")),{limit:null,after:null});
    assert.equal(parseOwnListingsPage(new URLSearchParams("after="+idFor(0))),null);
    assert.equal((await f.get("?limit=1",undefined)).status,200);
    assert.equal((await f.get("?limit=1","invalid")).status,401);
    assert.equal((await f.get("?limit=1","")).status,401);
    const post=await worker.fetch(new Request(base+"?limit=2",{
      method:"POST",headers:{Authorization:"Bearer token-owner",
        "Content-Type":"application/json"},body:JSON.stringify({categoryId:categoryFor(0)}),
    }),{DB:f.adapter,AUTH:f.AUTH});
    assert.equal(post.status,400);
    const del=await worker.fetch(new Request(base+"?limit=2",{
      method:"DELETE",headers:{Authorization:"Bearer token-owner"},
    }),{DB:f.adapter,AUTH:f.AUTH});
    assert.equal(del.status,400);
    assert.deepEqual((await f.get()).body.data.listings.map(x=>x.id),
      [idFor(0),idFor(1),idFor(2)]);
  }finally{f.db.close();}
});

test("missing D1 and SQL outage fail closed without private data leakage",async()=>{
  const request=new Request(base+"?limit=25",{headers:{Authorization:"Bearer token-owner"}});
  const AUTH={async verify(){return {accountId:owner};}};
  const missing=await worker.fetch(request,{AUTH});
  assert.equal(missing.status,503);
  const fail=await worker.fetch(request,{AUTH,
    DB:{prepare(){throw new Error("PRIVATE_OWNER_DB_SECRET");}},
  });
  assert.equal(fail.status,503);
  const body=await fail.text();
  assert.equal(body.includes("PRIVATE_OWNER_DB_SECRET"),false);
  assert.equal(body.includes(owner),false);
});

test("owner page SQL constrains both row and cursor to actor, no unbounded offset",()=>{
  const f=fixture(3);
  try{
    assert.ok(PAGED_MY_LISTINGS_QUERY.includes("wl.worker_account_id=?"));
    assert.ok(CONTINUED_MY_LISTINGS_QUERY.includes("prior.worker_account_id=?"));
    assert.equal(CONTINUED_MY_LISTINGS_QUERY.includes("OFFSET"),false);
    for(const [sql,args]of[
      [PAGED_MY_LISTINGS_QUERY,[owner,3]],
      [CONTINUED_MY_LISTINGS_QUERY,[owner,owner,idFor(0),3]],
    ]){
      const plan=f.db.prepare("EXPLAIN QUERY PLAN "+sql).all(...args);
      assert.ok(plan.some(x=>String(x.detail).includes("worker_listings")),
        JSON.stringify(plan));
    }
  }finally{f.db.close();}
});
