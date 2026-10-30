import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { decideContactSafety } from "../src/modules/interactions/contact-safety.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";

const base = () => ({
  requesterAccountId: "account-customer1", workerAccountId: "account-worker1",
  listingId: "listing-000001", listingOwnerAccountId: "account-worker1",
  categoryId: "cat1", requesterActive: true, workerActive: true,
  workerOptedIn: true, categoryActive: true, listingPublished: true, listingAvailable: true,
  moderationApproved: true, blockedByRequester: false, blockedByWorker: false,
  channelApprovedByPolicy: true,
});
const denied = reason => ({ allowed: false, reason });

test("a fully trusted, eligible synthetic interaction may proceed to future transaction", () => {
  const facts = base();
  assert.deepEqual(decideContactSafety(facts), { allowed: true });
  assert.deepEqual(facts, base());
});

test("self-contact and forged or mismatched listing ownership are rejected", () => {
  assert.deepEqual(decideContactSafety({...base(),
    requesterAccountId: "account-worker1"}),denied("SELF_CONTACT"));
  assert.deepEqual(decideContactSafety({...base(),
    listingOwnerAccountId: "account-other999"}),denied("LISTING_OWNER_MISMATCH"));
});

test("disabled requester or worker and unpublished opt-in draft fail closed", () => {
  for (const field of ["requesterActive","workerActive"]) {
    assert.deepEqual(decideContactSafety({...base(),[field]:false}),
      denied("ACCOUNT_UNAVAILABLE"));
  }
  for (const field of ["workerOptedIn","listingPublished"]) {
    assert.deepEqual(decideContactSafety({...base(),[field]:false}),
      denied("WORKER_NOT_PUBLISHED"));
  }
});

test("mod-locked, unavailable, either-way blocked and unapproved channel all deny", () => {
  const cases = [
    ["listingAvailable", "SERVICE_UNAVAILABLE"],
    ["categoryActive", "SERVICE_UNAVAILABLE"],
    ["moderationApproved", "MODERATION_RESTRICTED"],
    ["channelApprovedByPolicy", "CHANNEL_NOT_APPROVED"],
  ];
  for (const [field, reason] of cases) {
    assert.deepEqual(decideContactSafety({...base(),[field]:false}),denied(reason));
  }
  for (const field of ["blockedByRequester", "blockedByWorker"]) {
    assert.deepEqual(decideContactSafety({...base(),[field]:true}),
      denied("RELATIONSHIP_BLOCKED"));
  }
  assert.deepEqual(decideContactSafety({...base(),blockedByWorker:true,
    blockedByRequester:true}),denied("RELATIONSHIP_BLOCKED"));
});

test("missing boolean facts, forged ID, bad category, booleans as strings are invalid", () => {
  assert.deepEqual(decideContactSafety(null),denied("INVALID_FACTS"));
  for (const field of ["requesterAccountId","workerAccountId",
      "listingId","listingOwnerAccountId"]) {
    assert.deepEqual(decideContactSafety({...base(),[field]:"x"}),
      denied("INVALID_FACTS"));
  }
  assert.deepEqual(decideContactSafety({...base(),categoryId:"../secret"}),
    denied("INVALID_FACTS"));
  for (const field of ["requesterActive","workerActive","workerOptedIn",
      "categoryActive","listingPublished","listingAvailable","moderationApproved",
      "blockedByRequester","blockedByWorker","channelApprovedByPolicy"]) {
    assert.deepEqual(decideContactSafety({...base(),[field]:undefined}),
      denied("INVALID_FACTS"),field);
    assert.deepEqual(decideContactSafety({...base(),[field]:"true"}),
      denied("INVALID_FACTS"),field);
  }
});

test("fresh transaction facts override stale eligible search snapshot", () => {
  const browseFacts = base();
  assert.deepEqual(decideContactSafety(browseFacts),{allowed:true});
  for (const mutation of [
    {workerActive:false}, {categoryActive:false}, {listingAvailable:false}, {listingPublished:false},
    {blockedByWorker:true}, {blockedByRequester:true},
    {moderationApproved:false}, {channelApprovedByPolicy:false},
  ]) {
    assert.equal(decideContactSafety({...browseFacts,...mutation}).allowed,false);
  }
  // Later implementation MUST call this decision in same atomic D1 write as
  // the update; this synthetic test is not a concurrent D1 transaction proof.
});

test("safety decision exposes no contacts, precise location or internal metadata", () => {
  const facts = {...base(),phone:"+91-PRIVATE",coordinates:{lat:10,lng:20},
    googleSub:"not-public",trustLabel:"not-verified"};
  const response = decideContactSafety(facts);
  assert.deepEqual(response,{allowed:true});
  for(const secret of ["phone","PRIVATE","coordinates","googleSub","trustLabel"]) {
    assert.equal(JSON.stringify(response).includes(secret),false);
  }
});

test("no public contact, Nok-Nok, direct-call, listing or worker routes were added", async () => {
  for (const route of ["/api/v1/contact","/api/v1/noknok","/api/v1/calls",
      "/api/v1/workers","/api/v1/requests"]) {
    const response=await worker.fetch(new Request("https://jodlo.rekixo.com"+route));
    assert.equal(response.status,404,route);
  }
});


test("current SQLite Category activation is mandatory for future contact, not just listing publication", async () => {
  const {db,adapter} = openLocalDatabase();
  try {
    const requester="account-customer1",workerId="account-worker1";
    await ensureAccount(adapter,requester);
    await ensureAccount(adapter,workerId);
    await optInAsWorker(adapter,workerId);
    db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
      .run("cat1","fixture","Synthetic fixture","परीक्षण श्रेणी");
    const listing=await publishListing(adapter,workerId,"cat1");
    assert.ok(listing);

    // Read current server-owned rows instead of trusting a prior public browse.
    // This is an isolated local rehearsal, NOT a live contact/request transaction.
    function freshFacts() {
      const row=db.prepare(
        "SELECT wl.id AS listingId,wl.worker_account_id AS listingOwnerAccountId,"+
        "wl.category_id AS categoryId,wl.status AS listingStatus,"+
        "wl.moderation_status AS moderationStatus,c.is_active AS categoryActive,"+
        "a.status AS workerStatus,wp.status AS profileStatus "+
        "FROM worker_listings AS wl "+
        "JOIN categories AS c ON c.id=wl.category_id "+
        "JOIN accounts AS a ON a.id=wl.worker_account_id "+
        "JOIN worker_profiles AS wp ON wp.account_id=a.id WHERE wl.id=?"
      ).get(listing.id);
      const customer=db.prepare("SELECT status FROM accounts WHERE id=?").get(requester);
      return {
        requesterAccountId:requester,workerAccountId:workerId,
        listingId:row.listingId,listingOwnerAccountId:row.listingOwnerAccountId,
        categoryId:row.categoryId,requesterActive:customer.status==="active",
        workerActive:row.workerStatus==="active",workerOptedIn:row.profileStatus==="draft",
        categoryActive:row.categoryActive===1,listingPublished:row.listingStatus==="published",
        listingAvailable:row.listingStatus==="published",
        moderationApproved:row.moderationStatus==="allowed",
        blockedByRequester:false,blockedByWorker:false,channelApprovedByPolicy:true,
      };
    }
    const earlier=freshFacts();
    assert.deepEqual(decideContactSafety(earlier),{allowed:true});
    db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run("cat1");
    assert.deepEqual(decideContactSafety(freshFacts()),
      {allowed:false,reason:"SERVICE_UNAVAILABLE"});
    // An old allowed result is not an authorization to contact after deactivation.
    assert.equal(earlier.categoryActive,true);
    assert.equal(freshFacts().categoryActive,false);
    db.prepare("UPDATE categories SET is_active=1 WHERE id=?").run("cat1");
    assert.deepEqual(decideContactSafety(freshFacts()),{allowed:true});
    db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(listing.id);
    assert.deepEqual(decideContactSafety(freshFacts()),
      {allowed:false,reason:"MODERATION_RESTRICTED"});
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally { db.close(); }
});
