import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { projectVisibleListing } from "../src/modules/discovery/public-listing.ts";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";

const allowFacts=()=>({
  listingId:"listing-000001",
  listingOwnerAccountId:"account-worker1",
  workerAccountId:"account-worker1",
  categoryId:"category1",
  ownerActive:true,
  workerOptedIn:true,
  categoryActive:true,
  listingPublished:true,
  listingAvailable:true,
  moderationApproved:true,
  disclosureApprovedByPolicy:true,
});

test("synthetic fully-authorized facts yield ONLY a frozen minimal projection",()=>{
  const facts=allowFacts();
  const result=projectVisibleListing(facts);
  assert.deepEqual(result,{id:"listing-000001",categoryId:"category1"});
  assert.equal(Object.isFrozen(result),true);
  assert.deepEqual(facts,allowFacts());
});

test("missing, malformed or untrusted status flags fail closed instead of defaulting to true",()=>{
  assert.equal(projectVisibleListing(null),null);
  assert.equal(projectVisibleListing([]),null);
  for(const key of [
    "ownerActive","workerOptedIn","categoryActive",
    "listingPublished","listingAvailable","moderationApproved","disclosureApprovedByPolicy",
  ]){
    const missing={...allowFacts()};
    delete missing[key];
    assert.equal(projectVisibleListing(missing),null,key+" missing");
    assert.equal(projectVisibleListing({...allowFacts(),[key]:"true"}),null,key+" string");
    assert.equal(projectVisibleListing({...allowFacts(),[key]:1}),null,key+" number");
    assert.equal(projectVisibleListing({...allowFacts(),[key]:null}),null,key+" null");
  }
});

test("private draft opt-in alone does not imply published service",()=>{
  assert.equal(projectVisibleListing({...allowFacts(),workerOptedIn:false}),null);
  assert.equal(projectVisibleListing({...allowFacts(),listingPublished:false}),null);
  assert.equal(projectVisibleListing({...allowFacts(),disclosureApprovedByPolicy:false}),null);
});

test("disabled accounts, inactive categories, unavailable or hidden services remain private",()=>{
  for(const field of [
    "ownerActive","categoryActive","listingAvailable","moderationApproved",
  ]){
    assert.equal(projectVisibleListing({...allowFacts(),[field]:false}),null,field);
  }
});

test("listing owner mismatches or invalid server-owned IDs never yield public records",()=>{
  assert.equal(projectVisibleListing({...allowFacts(),
    listingOwnerAccountId:"account-other2"}),null);
  for(const field of ["listingId","listingOwnerAccountId","workerAccountId"]){
    assert.equal(projectVisibleListing({...allowFacts(),[field]:"x"}),null,field);
    assert.equal(projectVisibleListing({...allowFacts(),[field]:"../../secret"}),null,field);
  }
  assert.equal(projectVisibleListing({...allowFacts(),categoryId:"../invalid"}),null);
});

test("current authoritative facts must be rechecked, never reused from earlier browse results",()=>{
  const preview=allowFacts();
  assert.ok(projectVisibleListing(preview));
  for(const update of [
    {ownerActive:false},{workerOptedIn:false},{listingPublished:false},
    {listingAvailable:false},{moderationApproved:false},
    {categoryActive:false},{disclosureApprovedByPolicy:false},
    {listingOwnerAccountId:"account-other2"},
  ]){
    assert.equal(projectVisibleListing({...preview,...update}),null,JSON.stringify(update));
  }
});

test("projection allowlist ignores extra PII, verification, media and location fields",()=>{
  const facts={
    ...allowFacts(),
    phone:"+91-PRIVATE", googleSub:"secret-provider-sub",
    preciseGps:{lat:22.72,long:75.86}, workerAccountContact:"worker@example.test",
    verified:true, price:9999, paymentKey:"secret", internalModerationNote:"hidden",
  };
  const result=projectVisibleListing(facts);
  assert.deepEqual(Object.keys(result),["id","categoryId"]);
  for(const secret of [
    "phone","PRIVATE","googleSub","preciseGps","worker@example.test",
    "verified","price","paymentKey","internalModerationNote",
  ]) assert.equal(JSON.stringify(result).includes(secret),false,secret);
});

test("private worker profile remains draft; distinct listing controls publication",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    const accountId="account-worker1";
    await ensureAccount(adapter,accountId);
    await optInAsWorker(adapter,accountId);
    db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,?)")
      .run("category1","plumbing","Plumbing","प्लंबिंग",1);
    const state=db.prepare(
      "SELECT wp.status, a.status AS account_status FROM worker_profiles wp "+
      "JOIN accounts a ON a.id=wp.account_id WHERE wp.account_id=?").get(accountId);
    const category=db.prepare("SELECT is_active FROM categories WHERE id=?").get("category1");
    assert.equal(state.status,"draft");
    assert.equal(category.is_active,1);
    assert.deepEqual(projectVisibleListing({...allowFacts(),
      ownerActive:state.account_status==="active",
      workerOptedIn:state.status==="draft",
      categoryActive:category.is_active===1,
    }),{id:"listing-000001",categoryId:"category1"});
    assert.throws(()=>db.prepare(
      "UPDATE worker_profiles SET status='published' WHERE account_id=?").run(accountId),
      /CHECK constraint failed/);
    assert.equal(db.prepare("SELECT status FROM worker_profiles WHERE account_id=?")
      .get(accountId).status,"draft");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally {db.close();}
});

test("worker visibility module never adds real public listing, worker or contact routes",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    for(const path of [
      "/api/v1/workers","/api/v1/matching",
      "/api/v1/requests","/api/v1/contact",
    ]){
      const response=await worker.fetch(
        new Request("https://jodlo.rekixo.com"+path),{DB:adapter});
      assert.equal(response.status,404,path);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worker_profiles").get().n,0);
  } finally {db.close();}
});
