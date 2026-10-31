import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing, unpublishListing } from "../src/modules/workers/listings.ts";
import {
  findSessionAccount, issueSession, revokeAllSessions, revokeSession, sessionHash,
} from "../src/modules/identity/sessions.ts";
import { assessDirectCallCandidate } from "../src/modules/interactions/direct-call.ts";
import {
  readCurrentRequestTarget, readSessionBoundCallTarget,
  READ_SESSION_BOUND_CALL_TARGET_QUERY,
} from "../src/modules/interactions/request-target.ts";

const CUSTOMER="account-call-customer-01";
const WORKER="account-call-worker-0001";
const OTHER="account-call-other-00001";
const CATEGORY="synthetic-trade";
const allSyntheticApprovals=()=>({
  listingAvailable:true,blockedByRequester:false,blockedByWorker:false,
  workerConsentedToCalls:true,callDestinationVerified:true,
  connectionPrivacyApproved:true,abuseLimitPassed:true,
});
const deny=reason=>({kind:"denied",reason});

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  for(const id of [CUSTOMER,WORKER,OTHER]) await ensureAccount(adapter,id);
  await optInAsWorker(adapter,WORKER);
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run(CATEGORY,"test-trade","Synthetic service","परीक्षण सेवा");
  const listing=await publishListing(adapter,WORKER,CATEGORY);
  assert.ok(listing);
  const customerToken=(await issueSession(adapter,CUSTOMER))?.accessToken;
  const workerToken=(await issueSession(adapter,WORKER))?.accessToken;
  const otherToken=(await issueSession(adapter,OTHER))?.accessToken;
  assert.ok(customerToken&&workerToken&&otherToken);
  return {db,adapter,listing,customerToken,workerToken,otherToken,close(){db.close();}};
}

test("single D1 statement joins session hash, expiry, active caller and live listing",async()=>{
  const f=await fixture();
  try {
    const existing=await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id);
    const checked=await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id);
    assert.deepEqual(checked,existing);
    assert.equal(Object.isFrozen(checked),true);
    assert.match(READ_SESSION_BOUND_CALL_TARGET_QUERY,/session\.token_hash=\?/);
    assert.match(READ_SESSION_BOUND_CALL_TARGET_QUERY,/session\.expires_at>\?/);
    assert.match(READ_SESSION_BOUND_CALL_TARGET_QUERY,/requester\.status='active'/);
    assert.match(READ_SESSION_BOUND_CALL_TARGET_QUERY,/WHERE wl\.id=\?/);
    assert.equal((READ_SESSION_BOUND_CALL_TARGET_QUERY.match(/\?/g)||[]).length,3);
    assert.equal(READ_SESSION_BOUND_CALL_TARGET_QUERY.includes("phone"),false);
    assert.equal(JSON.stringify(checked).includes(f.customerToken),false);
    assert.equal(JSON.stringify(checked).includes(CUSTOMER),true,"internal only, not public response");
  } finally {f.close();}
});

test("invalid bearer and listing inputs fail before ANY D1 call",async()=>{
  const db={prepare(){throw Error("no database call should happen");}};
  for(const token of [null,undefined,"",false,123,"Bearer "+"a".repeat(43),
      "a".repeat(42),"a".repeat(44),"a".repeat(42)+"!", "a' OR 1=1--"]) {
    assert.equal(await readSessionBoundCallTarget(db,token,"listing-opaque-00001"),null);
  }
  assert.equal(await readSessionBoundCallTarget(db,"A".repeat(43),"bad id"),null);
  const f=await fixture();
  try {
    assert.equal(await readSessionBoundCallTarget(f.adapter,"A".repeat(43),f.listing.id),null);
    assert.equal(await readSessionBoundCallTarget(f.adapter,f.customerToken,"missing-listing-000"),null);
  } finally {f.close();}
});

test("SQL binds SHA-256 session hash, not bearer secret or raw account ID",async()=>{
  const f=await fixture();
  try {
    const observed=[];
    const recording={prepare(query){
      observed.push({query});
      return {bind(...values){observed.at(-1).values=values;return this;},
        all(){return f.adapter.prepare(query).bind(...observed.at(-1).values).all();}};
    }};
    const facts=await readSessionBoundCallTarget(recording,f.customerToken,f.listing.id);
    assert.ok(facts);
    assert.equal(observed.length,1);
    assert.deepEqual(observed[0].values,[
      await sessionHash(f.customerToken),
      observed[0].values[1], f.listing.id,
    ]);
    assert.ok(Number.isSafeInteger(observed[0].values[1]));
    assert.notEqual(observed[0].values[0],f.customerToken);
    assert.equal(observed[0].query.includes(f.customerToken),false);
    assert.equal(JSON.stringify(facts).includes(f.customerToken),false);
    assert.equal(JSON.stringify(facts).includes(WORKER),true,"worker ID stays internal");
  } finally {f.close();}
});

test("revoked token loses eligibility, even if an earlier trusted-account preview remains",async()=>{
  const f=await fixture();
  try {
    const preview=await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id);
    assert.ok(preview);
    assert.ok(await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id));
    assert.equal(await revokeSession(f.adapter,f.customerToken),true);
    assert.equal(await findSessionAccount(f.adapter,f.customerToken),null);
    assert.equal(await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id),null);
    assert.ok(preview,"earlier snapshot is NOT permission to dial");
    assert.ok(await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id),
      "unbound account preview still exists and must never authorize calling");
  } finally {f.close();}
});

test("logout-all invalidates sibling sessions but not a different customer's bearer",async()=>{
  const f=await fixture();
  try {
    const sibling=(await issueSession(f.adapter,CUSTOMER))?.accessToken;
    assert.ok(sibling);
    assert.ok(await readSessionBoundCallTarget(f.adapter,sibling,f.listing.id));
    assert.equal(await revokeAllSessions(f.adapter,f.customerToken),true);
    assert.equal(await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id),null);
    assert.equal(await readSessionBoundCallTarget(f.adapter,sibling,f.listing.id),null);
    const unaffected=await readSessionBoundCallTarget(f.adapter,f.otherToken,f.listing.id);
    assert.equal(unaffected.requesterAccountId,OTHER);
  } finally {f.close();}
});

test("expired session denies while account and public listing still exist",async()=>{
  const f=await fixture();
  try {
    assert.ok(await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id));
    f.db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?")
      .run(await sessionHash(f.customerToken));
    assert.equal(await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id),null);
    assert.ok(await readCurrentRequestTarget(f.adapter,CUSTOMER,f.listing.id));
  } finally {f.close();}
});

test("disabled caller is filtered within the same SQL, disabled worker remains denied",async()=>{
  const f=await fixture();
  try {
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(CUSTOMER);
    assert.equal(await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id),null);
    f.db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(CUSTOMER);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER);
    const facts=await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id);
    assert.equal(facts.workerActive,false);
    assert.deepEqual(assessDirectCallCandidate(facts,allSyntheticApprovals()),
      deny("ACCOUNT_UNAVAILABLE"));
  } finally {f.close();}
});

test("session-bound query sees unpublish, moderation and category changes without replaying an old preview",async()=>{
  const f=await fixture();
  try {
    const preview=await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id);
    assert.equal(assessDirectCallCandidate(preview,allSyntheticApprovals()).kind,"candidate");
    assert.equal(await unpublishListing(f.adapter,WORKER,f.listing.id),true);
    assert.deepEqual(assessDirectCallCandidate(
      await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id),
      allSyntheticApprovals()),deny("WORKER_NOT_PUBLISHED"));
    assert.ok(await publishListing(f.adapter,WORKER,CATEGORY));
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.listing.id);
    assert.deepEqual(assessDirectCallCandidate(
      await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id),
      allSyntheticApprovals()),deny("MODERATION_RESTRICTED"));
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed' WHERE id=?")
      .run(f.listing.id);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY);
    assert.deepEqual(assessDirectCallCandidate(
      await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id),
      allSyntheticApprovals()),deny("SERVICE_UNAVAILABLE"));
    assert.equal(preview.categoryActive,true,"first snapshot must stay stale");
  } finally {f.close();}
});

test("worker's own bearer cannot call self; unrelated caller can't choose a different account",async()=>{
  const f=await fixture();
  try {
    const self=await readSessionBoundCallTarget(f.adapter,f.workerToken,f.listing.id);
    assert.equal(self.requesterAccountId,WORKER);
    assert.deepEqual(assessDirectCallCandidate(self,allSyntheticApprovals()),deny("SELF_CONTACT"));
    const other=await readSessionBoundCallTarget(f.adapter,f.otherToken,f.listing.id);
    assert.equal(other.requesterAccountId,OTHER);
    assert.equal(other.workerAccountId,WORKER);
    assert.equal(other.requesterAccountId===CUSTOMER,false);
  } finally {f.close();}
});

test("corrupt data, deleted listing and database outage fail closed instead of minting call authority",async()=>{
  const f=await fixture();
  try {
    const valid=await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id);
    assert.ok(valid);
    const original=f.adapter;
    const bad={prepare(q){return {bind(){return this;},async all(){return {results:[
      {requesterId:"x",workerAccountId:WORKER,listingId:f.listing.id},
    ]};}};}};
    assert.equal(await readSessionBoundCallTarget(bad,f.customerToken,f.listing.id),null);
    const outage={prepare(){return {bind(){return this;},async all(){throw Error("D1 unavailable");}};}};
    await assert.rejects(()=>readSessionBoundCallTarget(outage,f.customerToken,f.listing.id),
      /D1 unavailable/);
    assert.ok(original);
    f.db.prepare("DELETE FROM worker_listings WHERE id=?").run(f.listing.id);
    assert.equal(await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id),null);
  } finally {f.close();}
});

test("no API, phone records, dialer or external telephony despite a synthetic call candidate",async()=>{
  const f=await fixture();
  try {
    const facts=await readSessionBoundCallTarget(f.adapter,f.customerToken,f.listing.id);
    assert.equal(assessDirectCallCandidate(facts,allSyntheticApprovals()).kind,"candidate");
    for(const path of ["/api/v1/calls","/api/v1/contact","/api/v1/requests"]){
      const res=await worker.fetch(new Request("https://jodlo.rekixo.com"+path,{
        method:"POST",
        headers:{Authorization:"Bearer "+f.customerToken,"Content-Type":"application/json"},
        body:JSON.stringify({listingId:f.listing.id,customerId:OTHER,phone:"+91-PRIVATE"}),
      }),{DB:f.adapter});
      assert.equal(res.status,404,path);
    }
    const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all().map(x=>x.name);
    for(const name of ["call_sessions","phone_numbers","contact_records","service_requests"])
      assert.equal(tables.includes(name),false);
  } finally {f.close();}
});
