import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { decideContactSafety } from "../src/modules/interactions/contact-safety.ts";

const base = () => ({
  requesterAccountId: "account-customer1", workerAccountId: "account-worker1",
  listingId: "listing-000001", listingOwnerAccountId: "account-worker1",
  categoryId: "cat1", requesterActive: true, workerActive: true,
  workerOptedIn: true, listingPublished: true, listingAvailable: true,
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
      "listingPublished","listingAvailable","moderationApproved",
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
    {workerActive:false}, {listingAvailable:false}, {listingPublished:false},
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
      "/api/v1/listings","/api/v1/workers","/api/v1/requests"]) {
    const response=await worker.fetch(new Request("https://jodlo.rekixo.com"+route));
    assert.equal(response.status,404,route);
  }
});
