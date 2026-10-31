import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { issueSession, findSessionAccount } from "../src/modules/identity/sessions.ts";
import { readCurrentRequestTarget } from "../src/modules/interactions/request-target.ts";
import { assessDirectCallCandidate } from "../src/modules/interactions/direct-call.ts";

const CUSTOMER = "synthetic-caller-001";
const WORKER = "synthetic-worker-001";
const CATEGORY = "fixture-trade";
const ready = () => ({
  listingAvailable: true,
  blockedByRequester: false,
  blockedByWorker: false,
  workerConsentedToCalls: true,
  callDestinationVerified: true,
  connectionPrivacyApproved: true,
  abuseLimitPassed: true,
});
const denied = reason => ({ kind: "denied", reason });

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  await ensureAccount(adapter,CUSTOMER);
  await ensureAccount(adapter,WORKER);
  await optInAsWorker(adapter,WORKER);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run(CATEGORY,"fixture-trade","Synthetic fixture trade","परीक्षण सेवा");
  const listing=await publishListing(adapter,WORKER,CATEGORY);
  assert.ok(listing);
  const callerToken=(await issueSession(adapter,CUSTOMER))?.accessToken;
  assert.ok(callerToken);
  async function target(){
    const account=await findSessionAccount(adapter,callerToken);
    return account ? readCurrentRequestTarget(adapter,account,listing.id) : null;
  }
  return {db,adapter,listing,callerToken,target,close(){db.close();}};
}

test("default missing direct-call policy denies even a currently published listing",async()=>{
  const f=await fixture();
  try{
    const target=await f.target();
    assert.ok(target);
    for(const policy of [null, undefined, {}, false, [], {workerConsentedToCalls:true}]) {
      assert.deepEqual(assessDirectCallCandidate(target,policy),
        denied("CALL_POLICY_UNAVAILABLE"));
    }
    // A live policy store does not exist: an otherwise valid listing alone
    // never makes a customer contactable or discloses a phone number.
    assert.equal(JSON.stringify(target).includes("phone"),false);
  }finally{f.close();}
});

test("only complete synthetic consent + safety produces an opaque candidate, not a dialer destination",async()=>{
  const f=await fixture();
  try{
    const result=assessDirectCallCandidate(await f.target(),ready());
    assert.deepEqual(result,{kind:"candidate",listingId:f.listing.id,categoryId:CATEGORY});
    assert.equal(Object.isFrozen(result),true);
    const serialized=JSON.stringify(result);
    for(const privateValue of [CUSTOMER,WORKER,"phone","tel:","destination","token","consent","http"]) {
      assert.equal(serialized.includes(privateValue),false,privateValue);
    }
  }finally{f.close();}
});

test("missing explicit worker call consent, destination, privacy approval or abuse budget denies",async()=>{
  const f=await fixture();
  try{
    for(const field of [
      "workerConsentedToCalls","callDestinationVerified",
      "connectionPrivacyApproved","abuseLimitPassed",
    ]) {
      const result=assessDirectCallCandidate(await f.target(),{...ready(),[field]:false});
      assert.deepEqual(result,denied("CHANNEL_NOT_APPROVED"),field);
    }
    assert.deepEqual(assessDirectCallCandidate(await f.target(),ready()),
      {kind:"candidate",listingId:f.listing.id,categoryId:CATEGORY});
    // Worker self-publication can never set workerConsentedToCalls.
  }finally{f.close();}
});

test("requester/worker mutual block and service unavailability deny direct calls",async()=>{
  const f=await fixture();
  try{
    for(const field of ["blockedByRequester","blockedByWorker"]) {
      assert.deepEqual(assessDirectCallCandidate(await f.target(),{
        ...ready(),[field]:true,
      }),denied("RELATIONSHIP_BLOCKED"));
    }
    assert.deepEqual(assessDirectCallCandidate(await f.target(),{
      ...ready(),listingAvailable:false,
    }),denied("SERVICE_UNAVAILABLE"));
  }finally{f.close();}
});

test("nonboolean and extra phone/user fields cannot masquerade as consent",async()=>{
  const f=await fixture();
  try{
    for(const field of Object.keys(ready())){
      for(const invalid of [1,"true",null,undefined]){
        assert.deepEqual(assessDirectCallCandidate(await f.target(),{
          ...ready(),[field]:invalid,
        }),denied("CALL_POLICY_UNAVAILABLE"),field);
      }
    }
    for(const extra of [{phone:"+91-SYNTHETIC"},{customerId:CUSTOMER},{destination:"tel:000"}]) {
      assert.deepEqual(assessDirectCallCandidate(await f.target(),{
        ...ready(),...extra,
      }),denied("CALL_POLICY_UNAVAILABLE"));
    }
  }finally{f.close();}
});

test("first-contact direct-call decision does not weaken self-contact protection",async()=>{
  const f=await fixture();
  try{
    const self=await readCurrentRequestTarget(f.adapter,WORKER,f.listing.id);
    assert.deepEqual(assessDirectCallCandidate(self,ready()),denied("SELF_CONTACT"));
    assert.deepEqual(assessDirectCallCandidate(null,ready()),denied("TARGET_UNAVAILABLE"));
    assert.deepEqual(assessDirectCallCandidate(false,ready()),denied("TARGET_UNAVAILABLE"));
  }finally{f.close();}
});

test("fresh Category deactivation denies a direct call despite earlier search eligibility",async()=>{
  const f=await fixture();
  try{
    const previous=await f.target();
    assert.equal(assessDirectCallCandidate(previous,ready()).kind,"candidate");
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY);
    const current=await f.target();
    assert.deepEqual(assessDirectCallCandidate(current,ready()),denied("SERVICE_UNAVAILABLE"));
    assert.equal(previous.categoryActive,true,"old read is stale, not future permission");
  }finally{f.close();}
});

test("moderator hiding and unpublication deny a direct call",async()=>{
  const f=await fixture();
  try{
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(assessDirectCallCandidate(await f.target(),ready()),
      denied("MODERATION_RESTRICTED"));
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed', status='unpublished' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(assessDirectCallCandidate(await f.target(),ready()),
      denied("WORKER_NOT_PUBLISHED"));
  }finally{f.close();}
});

test("disabled requester/worker are denied regardless of a previously valid listing",async()=>{
  const f=await fixture();
  try{
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(CUSTOMER);
    assert.equal(await f.target(),null,"the actual session verifier denies disabled actor");
    assert.deepEqual(assessDirectCallCandidate(await f.target(),ready()),
      denied("TARGET_UNAVAILABLE"));
    f.db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(CUSTOMER);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER);
    assert.deepEqual(assessDirectCallCandidate(await f.target(),ready()),
      denied("ACCOUNT_UNAVAILABLE"));
  }finally{f.close();}
});

test("deleted listing and D1 error never fall through into phone contact",async()=>{
  const f=await fixture();
  try{
    f.db.prepare("DELETE FROM worker_listings WHERE id=?").run(f.listing.id);
    assert.deepEqual(assessDirectCallCandidate(await f.target(),ready()),
      denied("TARGET_UNAVAILABLE"));
    const failing={prepare(){return{bind(){return this;},async all(){throw Error("synthetic D1 unavailable");}}}};
    await assert.rejects(()=>readCurrentRequestTarget(failing,CUSTOMER,f.listing.id),
      /synthetic D1 unavailable/);
  }finally{f.close();}
});

test("no phone/contact/request API, schema, call SDK or UI is activated by this decision",async()=>{
  const f=await fixture();
  try{
    for(const path of ["/api/v1/calls","/api/v1/contact","/api/v1/requests"]){
      const res=await worker.fetch(new Request("https://jodlo.rekixo.com"+path,{
        method:"POST",headers:{
          Authorization:"Bearer "+f.callerToken,"Content-Type":"application/json",
        },body:JSON.stringify({listingId:f.listing.id,phone:"+91-PRIVATE"}),
      }),{DB:f.adapter});
      assert.equal(res.status,404,path);
    }
    const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all().map(x=>x.name);
    for(const table of ["call_sessions","phone_numbers","contact_records","service_requests"]) {
      assert.equal(tables.includes(table),false);
    }
    const res=await worker.fetch(new Request(
      "https://jodlo.rekixo.com/api/v1/listings?categoryId="+CATEGORY
    ),{DB:f.adapter});
    assert.equal(res.status,200);
    const raw=JSON.stringify(await res.json());
    assert.equal(raw.includes(WORKER),false);
    assert.equal(raw.includes("phone"),false);
  }finally{f.close();}
});
