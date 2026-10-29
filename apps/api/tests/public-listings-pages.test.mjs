import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import {
  PAGED_PUBLIC_LISTINGS_QUERY, CONTINUED_PUBLIC_LISTINGS_QUERY,
} from "../src/modules/workers/listings.ts";

const origin="https://jodlo.rekixo.com";
const path="/api/v1/listings?categoryId=synthetic-main";

function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const [id,slug] of [
    ["synthetic-main","synthetic-main"],
    ["synthetic-other","synthetic-other"],
    ["synthetic-inactive","synthetic-inactive"],
  ]) {
    db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)")
      .run(id,slug,"Fixture "+slug,"परीक्षण",id==="synthetic-inactive"?0:1);
  }
  const make=(i,category="synthetic-main",moderation="allowed",status="published")=>{
    const owner="account-list-page-"+String(i).padStart(3,"0");
    const id="00000000-0000-4000-8000-"+String(i).padStart(12,"0");
    db.prepare("INSERT INTO accounts(id) VALUES(?)").run(owner);
    db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(owner);
    db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id,status,moderation_status,created_at) VALUES(?,?,?,?,?,?)")
      .run(id,owner,category,status,moderation,
        i<24?"2026-10-29T00:00:00.000Z":"2026-10-29T00:00:01.000Z");
    return {id,categoryId:category};
  };
  const expected=Array.from({length:40},(_,i)=>make(i));
  const hidden=make(40,"synthetic-main","hidden");
  const unpublished=make(41,"synthetic-main","allowed","unpublished");
  const other=make(42,"synthetic-other");
  const inactive=make(43,"synthetic-inactive");
  const get=async (url)=>{
    const response=await worker.fetch(new Request(origin+url),{DB:adapter});
    return {status:response.status,body:await response.json()};
  };
  return {db,get,expected,hidden,unpublished,other,inactive};
}

test("opt-in page crosses old 25 cap; equal timestamp ties never skip/duplicate",async()=>{
  const f=fixture();
  try{
    const legacy=await f.get(path);
    assert.equal(legacy.status,200);
    assert.deepEqual(Object.keys(legacy.body.data),["listings"]);
    assert.deepEqual(legacy.body.data.listings,f.expected.slice(0,25));

    const found=[];
    let cursor=null;
    let calls=0;
    do {
      const requested=path+"&limit=7"+(cursor===null?"":"&after="+encodeURIComponent(cursor));
      const response=await f.get(requested);
      assert.equal(response.status,200,requested);
      assert.deepEqual(Object.keys(response.body.data),["listings","nextCursor"]);
      const page=response.body.data;
      assert.ok(page.listings.length<=7);
      assert.ok(page.listings.every(item=>Object.keys(item).sort().join(",")==="categoryId,id"));
      assert.ok(page.listings.every(item=>item.categoryId==="synthetic-main"));
      found.push(...page.listings);
      cursor=page.nextCursor;
      if(cursor!==null){
        assert.equal(cursor,page.listings.at(-1).id);
        assert.ok(!cursor.includes("account"));
        assert.ok(!cursor.includes("2026"));
      }
      assert.ok(++calls<=7,"no endless cursor loop");
    } while(cursor!==null);
    assert.deepEqual(found,f.expected);
    assert.equal(new Set(found.map(x=>x.id)).size,40);
    assert.equal(JSON.stringify(found).includes("account-list-page"),false);
    assert.equal(JSON.stringify(found).includes("moderation"),false);
  }finally{f.db.close();}
});

test("pages filter current category, moderation and account status; cursor never crosses trades",async()=>{
  const f=fixture();
  try {
    const page=await f.get(path+"&limit=25");
    assert.equal(page.body.data.listings.length,25);
    const cursor=page.body.data.nextCursor;
    assert.equal(cursor,f.expected[24].id);

    const cross=await f.get("/api/v1/listings?categoryId=synthetic-other&limit=2&after="+cursor);
    assert.deepEqual(cross.body.data,{listings:[],nextCursor:null});
    const other=await f.get("/api/v1/listings?categoryId=synthetic-other&limit=2");
    assert.deepEqual(other.body.data,{listings:[f.other],nextCursor:null});

    // Hidden, unpublished, inactive and disabled owners cannot appear on any page.
    assert.equal((await f.get("/api/v1/listings?categoryId=synthetic-inactive&limit=5"))
      .body.data.listings.length,0);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?")
      .run("account-list-page-030");
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.expected[31].id);
    const remaining=[];
    let after=null;
    for(let attempt=0;attempt<8;attempt++){
      const url=path+"&limit=6"+(after?"&after="+after:"");
      const {body}=await f.get(url);
      remaining.push(...body.data.listings);
      after=body.data.nextCursor;
      if(after===null)break;
    }
    assert.equal(remaining.length,38);
    assert.ok(!remaining.some(x=>x.id===f.hidden.id||x.id===f.unpublished.id||
      x.id===f.expected[30].id||x.id===f.expected[31].id||x.id===f.inactive.id));
    assert.deepEqual((await f.get(path+"&limit=5&after=nonexistent-cursor")).body.data,
      {listings:[],nextCursor:null});
    // If a selected anchor disappears, fail closed instead of estimating a
    // timestamp or inventing a private owner identity.
    f.db.prepare("DELETE FROM accounts WHERE id=?").run("account-list-page-024");
    assert.deepEqual((await f.get(path+"&limit=5&after="+cursor)).body.data,
      {listings:[],nextCursor:null});
  }finally{f.db.close();}
});

test("strict opt-in parameter handling does not break original unpaged API",async()=>{
  const f=fixture();
  try{
    for(const suffix of [
      "&limit=0","&limit=26","&limit=01","&limit=-1","&limit=1.0",
      "&limit=1&limit=2","&limit=1&after=x&after=y",
      "&after="+f.expected[0].id,"&limit=2&after=../unsafe",
      "&limit=2&after=","&limit=5&extra=1",
      "&categoryId=synthetic-main","&availableOnly=1",
    ]){
      const r=await f.get(path+suffix);
      assert.equal(r.status,400,suffix);
      assert.equal(r.body.error.code,"INVALID_QUERY",suffix);
    }
    assert.deepEqual((await f.get(path)).body.data.listings,f.expected.slice(0,25));
    assert.deepEqual((await f.get(path+"&limit=25")).body.data.listings,
      f.expected.slice(0,25));
    assert.equal((await f.get(path+"&limit=25")).body.data.nextCursor,f.expected[24].id);
  }finally{f.db.close();}
});

test("paged public query uses the existing published index, never scans owners by client input",()=>{
  const f=fixture();
  try {
    for(const [query,args] of [
      [PAGED_PUBLIC_LISTINGS_QUERY,["synthetic-main",8]],
      [CONTINUED_PUBLIC_LISTINGS_QUERY,["synthetic-main",f.expected[4].id,"synthetic-main",8]],
    ]) {
      const plan=f.db.prepare("EXPLAIN QUERY PLAN "+query).all(...args);
      assert.ok(plan.some(x=>String(x.detail).includes("idx_worker_listings_public")),
        JSON.stringify(plan));
    }
  }finally{f.db.close();}
});
