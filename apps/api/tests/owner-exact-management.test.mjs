import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

const origin="https://api.jodlo.rekixo.com";
const url=origin+"/api/v1/me/listings";
const own="owner-exact-alpha", stranger="owner-exact-beta";
const listing=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
function setup(total=106) {
  const {db,adapter}=openLocalDatabase();
  for(const actor of [own,stranger]){
    db.prepare("INSERT INTO accounts(id) VALUES(?)").run(actor);
    db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(actor);
  }
  const c=db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)");
  const l=db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)");
  for(let i=0;i<total;i++){
    const id="trade-"+String(i).padStart(3,"0");
    c.run(id,id,"Work "+i,"काम "+i,1);
    l.run(listing(i),i===total-1?stranger:own,id);
  }
  const AUTH={async verify(token) {
    return token==="owner-proof"?{accountId:own}:
      token==="other-proof"?{accountId:stranger}:null;
  }};
  async function get(query,token="owner-proof",method="GET",body) {
    const response=await worker.fetch(new Request(url+query,{
      method,headers:token?{Authorization:"Bearer "+token}:{},
      ...(body!==undefined?{body}:{})
    }),{DB:adapter,AUTH});
    return {status:response.status,body:await response.json()};
  }
  return {db,adapter,AUTH,get};
}

test("exact owner selected status works for listing beyond old 100-row page cap",async()=>{
  const f=setup();
  try{
    const id=listing(104), query="?id="+id+"&view=management";
    const result=await f.get(query);
    assert.equal(result.status,200);
    assert.deepEqual(result.body.data,{listing:{
      id,categoryId:"trade-104",visible:true,publicationStatus:"published"
    }});
    const body=JSON.stringify(result.body);
    for(const secret of [own,stranger,"worker_account_id","moderation_status",
      "workerId","email","phone","location","created_at","revision"])
      assert.equal(body.includes(secret),false,secret);
    assert.deepEqual(Object.keys(result.body.data),["listing"]);
    // Older routes and response shapes remain precisely unchanged.
    const old=await f.get("");
    assert.equal(old.body.data.listings.length,100);
    assert.ok(old.body.data.listings.every(row=>Object.keys(row).sort().join(",")==="categoryId,id,visible"));
    const pager=await f.get("?limit=2&view=management");
    assert.deepEqual(Object.keys(pager.body.data).sort(),["listings","nextCursor"]);
    assert.ok(pager.body.data.listings.every(row=>Object.keys(row).sort().join(",")==="categoryId,id,publicationStatus,visible"));
  }finally{f.db.close();}
});

test("different owner and absent listing are the same generic 404; no auth is 401",async()=>{
  const f=setup(3);
  try{
    assert.equal((await f.get("?id="+listing(2)+"&view=management")).status,404);
    assert.equal((await f.get("?id="+listing(0)+"&view=management","other-proof")).status,404);
    assert.equal((await f.get("?id="+listing(100)+"&view=management")).status,404);
    assert.equal((await f.get("?id="+listing(0)+"&view=management",null)).status,401);
    assert.equal((await f.get("?id="+listing(0)+"&view=management","wrong")).status,401);
    const legitimate=await f.get("?id="+listing(2)+"&view=management","other-proof");
    assert.deepEqual(legitimate.body.data.listing,{id:listing(2),
      categoryId:"trade-002",visible:true,publicationStatus:"published"});
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(stranger);
    assert.equal((await f.get("?id="+listing(2)+"&view=management","other-proof")).status,404);
  }finally{f.db.close();}
});

test("fresh exact owner read tracks paused, hidden, disabled Category, and edited Category independently",async()=>{
  const f=setup(3);
  try{
    const query="?id="+listing(0)+"&view=management";
    let row=(await f.get(query)).body.data.listing;
    assert.equal(row.visible,true);
    f.db.prepare("UPDATE worker_listings SET status='unpublished' WHERE id=?").run(listing(0));
    row=(await f.get(query)).body.data.listing;
    assert.equal(row.publicationStatus,"unpublished");
    assert.equal(row.visible,false);
    f.db.prepare("UPDATE worker_listings SET status='published',moderation_status='hidden' WHERE id=?").run(listing(0));
    row=(await f.get(query)).body.data.listing;
    assert.equal(row.publicationStatus,"published");
    assert.equal(row.visible,false);
    assert.equal(JSON.stringify(row).includes("hidden"),false);
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed' WHERE id=?").run(listing(0));
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run("trade-000");
    row=(await f.get(query)).body.data.listing;
    assert.equal(row.visible,false);
    // Never leak unpublished or private Category names in exact projection.
    assert.equal(JSON.stringify(row).includes("Work 0"),false);
    f.db.prepare("UPDATE categories SET is_active=1 WHERE id=?").run("trade-000");
    // A UNIQUE owner/Category collision fails closed without changing the ID.
    assert.throws(()=>
      f.db.prepare("UPDATE worker_listings SET category_id=? WHERE id=?")
        .run("trade-001",listing(0)),/UNIQUE constraint failed/);
    assert.equal((await f.get(query)).body.data.listing.categoryId,"trade-000");
    f.db.prepare("DELETE FROM worker_listings WHERE id=?").run(listing(1));
    f.db.prepare("UPDATE worker_listings SET category_id=? WHERE id=?")
      .run("trade-001",listing(0));
    const current=(await f.get(query)).body.data.listing;
    assert.equal(current.categoryId,"trade-001");
    assert.equal(current.visible,true);
  }finally{f.db.close();}
});

test("exact input requires one id and one view, refuses extra/duplicate and GET bodies",async()=>{
  const f=setup(3);
  try{
    for(const query of [
      "?id="+listing(0),"?view=management","?id="+listing(0)+"&view=legacy",
      "?id="+listing(0)+"&view=management&limit=1",
      "?id="+listing(0)+"&view=management&after="+listing(1),
      "?id="+listing(0)+"&view=management&owner="+stranger,
      "?id="+listing(0)+"&id="+listing(1)+"&view=management",
      "?id="+listing(0)+"&view=management&view=management",
      "?id=../private&view=management",
      "?id=x&view=management","?id=&view=management",
    ]){
      const r=await f.get(query);
      assert.equal(r.status,400,query);
      assert.equal(r.body.error.code,"INVALID_QUERY");
    }
    const post=await f.get("?id="+listing(0)+"&view=management",
      "owner-proof","POST");
    assert.equal(post.status,400);
  }finally{f.db.close();}
});

test("missing D1 and SQL failure never return raw DB or internal error details",async()=>{
  const q="?id="+listing(0)+"&view=management";
  const r=await worker.fetch(new Request(url+q,{headers:{Authorization:"Bearer owner-proof"}}));
  assert.equal(r.status,503);
  const broken=await worker.fetch(
    new Request(url+q,{headers:{Authorization:"Bearer owner-proof"}}),
    {DB:{prepare(){throw Error("SECRET_DATABASE_FAILURE");}},AUTH:{async verify(){return {accountId:own}}}});
  assert.equal(broken.status,503);
  assert.equal((await broken.text()).includes("SECRET_DATABASE_FAILURE"),false);
});
