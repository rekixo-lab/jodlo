import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing, unpublishListing, publicListings } from "../src/modules/workers/listings.ts";
import { issueSession, findSessionAccount } from "../src/modules/identity/sessions.ts";
import { decideContactSafety } from "../src/modules/interactions/contact-safety.ts";
import {
  readCurrentRequestTarget, READ_CURRENT_REQUEST_TARGET_QUERY,
} from "../src/modules/interactions/request-target.ts";

const CUSTOMER = "account-request-customer";
const WORKER = "account-request-worker01";
const OTHER = "account-request-other01";
const CATEGORY = "fixture-category-1";
const deny = reason => ({allowed:false,reason});

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const id of [CUSTOMER,WORKER,OTHER]) await ensureAccount(adapter,id);
  await optInAsWorker(adapter,WORKER);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run(CATEGORY,"synthetic-category","Synthetic service","परीक्षण सेवा");
  const listing=await publishListing(adapter,WORKER,CATEGORY);
  assert.ok(listing?.id);
  const customerSession=(await issueSession(adapter,CUSTOMER))?.accessToken;
  const workerSession=(await issueSession(adapter,WORKER))?.accessToken;
  assert.ok(customerSession && workerSession);
  return {db,adapter,listing,customerSession,workerSession,close(){db.close();}};
}

// Only a disposable test may supply policy decisions that have NOT been
// approved/stored by JODLO. This is NOT an actual request authorization flow.
const completeSyntheticPolicy = facts => ({
  ...facts,
  listingAvailable:true,
  blockedByRequester:false,
  blockedByWorker:false,
  channelApprovedByPolicy:true,
});

test("D1 reuses current worker/listing/category/account rows without assuming request policies",async()=>{
  const f=await fixture();
  try{
    const actor=await findSessionAccount(f.adapter,f.customerSession);
    assert.equal(actor,CUSTOMER);
    const facts=await readCurrentRequestTarget(f.adapter,actor,f.listing.id);
    assert.deepEqual(facts,{
      requesterAccountId:CUSTOMER,workerAccountId:WORKER,
      listingId:f.listing.id,listingOwnerAccountId:WORKER,
      categoryId:CATEGORY,requesterActive:true,workerActive:true,
      workerOptedIn:true,categoryActive:true,listingPublished:true,
      moderationApproved:true,
    });
    assert.equal(Object.isFrozen(facts),true);
    for(const unapproved of [
      "listingAvailable","blockedByRequester","blockedByWorker",
      "channelApprovedByPolicy","phone","location","trustLabel",
    ]) assert.equal(Object.hasOwn(facts,unapproved),false,unapproved);
    // A partial D1 projection can NEVER itself authorize a contact.
    assert.deepEqual(decideContactSafety(facts),deny("INVALID_FACTS"));
    // Explicit test-only policy demonstrates compatibility with the
    // existing pure guard, not approval to enable a future endpoint.
    assert.deepEqual(decideContactSafety(completeSyntheticPolicy(facts)),{allowed:true});
  }finally{f.close();}
});

test("real bearer session resolves actor; spoofed/missing actor or listing never yields facts",async()=>{
  const f=await fixture();
  try{
    const actor=await findSessionAccount(f.adapter,f.customerSession);
    assert.equal(actor,CUSTOMER);
    assert.equal(await readCurrentRequestTarget(f.adapter,"other",f.listing.id),null);
    assert.equal(await readCurrentRequestTarget(f.adapter,CUSTOMER,"bad id"),null);
    assert.equal(await readCurrentRequestTarget(f.adapter,"account-not-present1",f.listing.id),null);
    assert.equal(await readCurrentRequestTarget(f.adapter,CUSTOMER,"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"),null);
    assert.deepEqual(await readCurrentRequestTarget(f.adapter,actor,f.listing.id),
      await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id));
    assert.deepEqual(await readCurrentRequestTarget(f.adapter,WORKER,f.listing.id),{
      ...await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id),
      requesterAccountId:WORKER,
    });
    const self=await readCurrentRequestTarget(f.adapter,WORKER,f.listing.id);
    assert.deepEqual(decideContactSafety(completeSyntheticPolicy(self)),deny("SELF_CONTACT"));
  }finally{f.close();}
});

test("deactivated Category never inherits earlier active public listing approval",async()=>{
  const f=await fixture();
  try{
    const preview=await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id);
    assert.equal(preview.categoryActive,true);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY);
    const current=await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id);
    assert.equal(current.categoryActive,false);
    assert.deepEqual(decideContactSafety(completeSyntheticPolicy(current)),deny("SERVICE_UNAVAILABLE"));
    assert.deepEqual(await publicListings(f.adapter,CATEGORY),[]);
    assert.equal(preview.categoryActive,true,"old preview must remain stale, never a write authorization");
  }finally{f.close();}
});

test("worker unpublish and moderation hide are reflected in same current-state read",async()=>{
  const f=await fixture();
  try{
    assert.equal(await unpublishListing(f.adapter,WORKER,f.listing.id),true);
    const afterUnpublish=await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id);
    assert.equal(afterUnpublish.listingPublished,false);
    assert.deepEqual(decideContactSafety(completeSyntheticPolicy(afterUnpublish)),deny("WORKER_NOT_PUBLISHED"));
    // A synthetic new publish is allowed only because Category remains active.
    assert.ok(await publishListing(f.adapter,WORKER,CATEGORY));
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?").run(f.listing.id);
    const afterHide=await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id);
    assert.equal(afterHide.listingPublished,true);
    assert.equal(afterHide.moderationApproved,false);
    assert.deepEqual(decideContactSafety(completeSyntheticPolicy(afterHide)),deny("MODERATION_RESTRICTED"));
    assert.deepEqual(await publicListings(f.adapter,CATEGORY),[]);
  }finally{f.close();}
});

test("disabled requester and worker never become contact-eligible from a stale preview",async()=>{
  const f=await fixture();
  try{
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(CUSTOMER);
    const requesterDisabled=await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id);
    assert.equal(requesterDisabled.requesterActive,false);
    assert.deepEqual(decideContactSafety(completeSyntheticPolicy(requesterDisabled)),deny("ACCOUNT_UNAVAILABLE"));
    // The real server session resolver also rejects disabled accounts.
    assert.equal(await findSessionAccount(f.adapter,f.customerSession),null);
    f.db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(CUSTOMER);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER);
    const workerDisabled=await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id);
    assert.equal(workerDisabled.workerActive,false);
    assert.deepEqual(decideContactSafety(completeSyntheticPolicy(workerDisabled)),deny("ACCOUNT_UNAVAILABLE"));
    assert.deepEqual(await publicListings(f.adapter,CATEGORY),[]);
  }finally{f.close();}
});

test("deletion of worker profile removes listing; absent actor fails closed",async()=>{
  const f=await fixture();
  try{
    f.db.prepare("DELETE FROM worker_profiles WHERE account_id=?").run(WORKER);
    assert.equal(await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id),null);
    assert.deepEqual(await publicListings(f.adapter,CATEGORY),[]);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{f.close();}
});

test("strict current-state reader rejects forged, duplicate or malformed source rows",async()=>{
  const f=await fixture();
  try{
    const good=await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id);
    assert.ok(good);
    const query=READ_CURRENT_REQUEST_TARGET_QUERY;
    assert.match(query,/WHERE wl\.id=\? LIMIT 1/);
    assert.match(query,/JOIN accounts AS requester ON requester\.id=\?/);
    assert.equal((query.match(/\?/g)||[]).length,2);
    // A fake provider returning arbitrary fields is NOT trustworthy.
    const validRow={
      requesterId:CUSTOMER,requesterStatus:"active",workerAccountId:WORKER,
      workerStatus:"active",listingId:f.listing.id,listingOwnerAccountId:WORKER,
      categoryId:CATEGORY,listingStatus:"published",moderationStatus:"allowed",
      workerProfileStatus:"draft",categoryActive:1,
    };
    for(const rows of [
      [],[validRow,validRow],
      [{...validRow,requesterId:OTHER}],
      [{...validRow,listingOwnerAccountId:OTHER}],
      [{...validRow,categoryActive:"1"}],
      [{...validRow,workerStatus:"verified"}],
      [{...validRow,workerProfileStatus:"published"}],
      [{...validRow,moderationStatus:"unknown"}],
    ]) {
      const db={prepare(){return{bind(){return this;},async all(){return{results:rows};}}}};
      assert.equal(await readCurrentRequestTarget(db,CUSTOMER,f.listing.id),null);
    }
  }finally{f.close();}
});

test("read failure propagates and cannot be mistaken for an authorized snapshot",async()=>{
  const db={prepare(){return{bind(){return this;},async all(){throw Error("synthetic D1 outage");}}}};
  await assert.rejects(()=>readCurrentRequestTarget(db,CUSTOMER,"listing-valid-000001"),/synthetic D1 outage/);
});

test("request/contact API and durable request tables remain disabled pending M-005",async()=>{
  const f=await fixture();
  try{
    const res=await worker.fetch(new Request("https://jodlo.rekixo.com/api/v1/requests",{
      method:"POST",headers:{Authorization:"Bearer "+f.customerSession,"Content-Type":"application/json"},
      body:JSON.stringify({listingId:f.listing.id,workerId:WORKER,channelApprovedByPolicy:true}),
    }),{DB:f.adapter});
    assert.equal(res.status,404);
    const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(x=>x.name);
    assert.equal(tables.includes("service_requests"),false);
    assert.equal(tables.includes("contact_records"),false);
  }finally{f.close();}
});
