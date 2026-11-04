import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {
  PAGED_ALL_PUBLIC_LISTINGS_QUERY,CONTINUED_ALL_PUBLIC_LISTINGS_QUERY,
} from "../src/modules/workers/listings.ts";

const origin="https://api.jodlo.rekixo.com";
const route="/api/v1/listings?feed=all&limit=7";

function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const id of ["ac","tutor","closed"]){
    db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)")
      .run(id,id,id,"परीक्षण",id==="closed"?0:1);
  }
  const create=(i,categoryId=i%2?"tutor":"ac",status="published",
    moderation="allowed")=>{
    const id="00000000-0000-4000-8000-"+String(i).padStart(12,"0");
    const owner="feed-account-"+String(i).padStart(3,"0");
    db.prepare("INSERT INTO accounts(id) VALUES(?)").run(owner);
    db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(owner);
    db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id,status,moderation_status,created_at) VALUES(?,?,?,?,?,?)")
      .run(id,owner,categoryId,status,moderation,
        i<=20?"2026-11-04T00:00:00.000Z":"2026-11-04T00:00:01.000Z");
    return {id,categoryId};
  };
  const expected=Array.from({length:32},(_,i)=>create(i));
  const hidden=create(32,"ac","published","hidden");
  const unpublished=create(33,"tutor","unpublished");
  const inactive=create(34,"closed");
  const req=async (url,init)=>{
    const res=await worker.fetch(new Request(origin+url,init),{DB:adapter});
    return {status:res.status,headers:res.headers,body:await res.json()};
  };
  return {db,req,expected,hidden,unpublished,inactive};
}
test("anonymous feed spans all active Categories with bounded keyset and exactly two public fields",async()=>{
  const f=fixture();
  try{
    const seen=[];let cursor=null;
    for(let i=0;i<6;i++){
      const result=await f.req(route+(cursor?"&after="+cursor:""));
      assert.equal(result.status,200);
      assert.deepEqual(Object.keys(result.body.data),["listings","nextCursor"]);
      const page=result.body.data;
      assert.ok(page.listings.length<=7);
      assert.ok(page.listings.every(x=>
        Object.keys(x).sort().join(",")==="categoryId,id"));
      seen.push(...page.listings);
      cursor=page.nextCursor;
      if(cursor!==null){
        assert.equal(cursor,page.listings.at(-1).id);
        assert.equal(seen.length%7,0);
      }else break;
    }
    assert.deepEqual(seen,f.expected);
    assert.equal(new Set(seen.map(x=>x.id)).size,32);
    assert.equal(seen.some(x=>x.id===f.hidden.id||
      x.id===f.unpublished.id||x.id===f.inactive.id),false);
    assert.equal(JSON.stringify(seen).includes("feed-account"),false);
    assert.equal(JSON.stringify(seen).includes("moderation"),false);
    assert.equal(JSON.stringify(seen).includes("created_at"),false);
  } finally {f.db.close();}
});

test("feed anchor loses eligibility on moderation, unpublish, owner disable or Category deactivation",async()=>{
  const f=fixture();
  try{
    const anchor=f.expected[4],next=route+"&after="+anchor.id;
    const original=(await f.req(next)).body.data;
    assert.equal(original.listings.length,7);
    const denied={listings:[],nextCursor:null};
    const checks=[
      ["UPDATE worker_listings SET moderation_status='hidden' WHERE id=?",
       "UPDATE worker_listings SET moderation_status='allowed' WHERE id=?",anchor.id],
      ["UPDATE worker_listings SET status='unpublished' WHERE id=?",
       "UPDATE worker_listings SET status='published' WHERE id=?",anchor.id],
      ["UPDATE accounts SET status='disabled' WHERE id=?",
       "UPDATE accounts SET status='active' WHERE id=?","feed-account-004"],
      ["UPDATE categories SET is_active=0 WHERE id=?",
       "UPDATE categories SET is_active=1 WHERE id=?","ac"],
    ];
    for(const [change,undo,id] of checks){
      f.db.prepare(change).run(id);
      assert.deepEqual((await f.req(next)).body.data,denied);
      f.db.prepare(undo).run(id);
      assert.deepEqual((await f.req(next)).body.data,original);
    }
    assert.deepEqual((await f.req(route+"&after="+f.hidden.id)).body.data,denied);
    assert.deepEqual((await f.req(route+"&after="+f.unpublished.id)).body.data,denied);
    assert.deepEqual((await f.req(route+"&after="+f.inactive.id)).body.data,denied);
    f.db.prepare("DELETE FROM worker_profiles WHERE account_id=?").run("feed-account-004");
    assert.deepEqual((await f.req(next)).body.data,denied);
  } finally {f.db.close();}
});

test("feed rejects malformed, surprising, duplicate parameters or request body",async()=>{
  const f=fixture();
  try{
    for(const path of [
      "/api/v1/listings?feed=all",
      "/api/v1/listings?feed=all&limit=26",
      "/api/v1/listings?feed=all&limit=01",
      "/api/v1/listings?feed=ALL&limit=1",
      "/api/v1/listings?feed=all&feed=all&limit=1",
      "/api/v1/listings?feed=all&limit=1&limit=2",
      "/api/v1/listings?feed=all&limit=1&after=../x",
      "/api/v1/listings?feed=all&limit=1&after=x&after=y",
      "/api/v1/listings?feed=all&limit=1&categoryId=ac",
      "/api/v1/listings?feed=all&limit=1&ownerId=x",
      "/api/v1/listings?feed=all&limit=1&lang=hi",
    ]){
      const r=await f.req(path);assert.equal(r.status,400,path);
      assert.equal(r.body.error.code,"INVALID_QUERY");
    }
    const post=await f.req(route,{method:"POST"});
    assert.equal(post.status,405);
    assert.equal(post.headers.get("Allow"),"GET");
    const body=await f.req(route,{method:"GET",body:"x",duplex:"half"});
    assert.equal(body.status,400);
    assert.equal((await f.req("/api/v1/listings?categoryId=ac")).status,200);
    const noDb=await worker.fetch(new Request(origin+route),{});
    assert.equal(noDb.status,503);
    const errorDb=await worker.fetch(new Request(origin+route),{
      DB:{prepare(){throw Error("secret internal SQL failure");}},
    });
    assert.equal(errorDb.status,503);
    assert.equal(JSON.stringify(await errorDb.json()).includes("secret"),false);
  } finally {f.db.close();}
});

test("global feed uses a dedicated public partial index without exposing private owner data",()=>{
  const f=fixture();
  try {
    const indexes=f.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all();
    assert.ok(indexes.some(x=>x.name==="idx_worker_listings_public_all"));
    for(const [query,args] of [
      [PAGED_ALL_PUBLIC_LISTINGS_QUERY,[8]],
      [CONTINUED_ALL_PUBLIC_LISTINGS_QUERY,[f.expected[3].id,8]],
    ]){
      const plan=f.db.prepare("EXPLAIN QUERY PLAN "+query).all(...args);
      assert.ok(plan.some(x=>String(x.detail).includes("idx_worker_listings_public_all")),
        JSON.stringify(plan));
    }
  } finally {f.db.close();}
});
