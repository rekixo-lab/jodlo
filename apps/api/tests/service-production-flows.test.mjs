import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { generateKeyPair, SignJWT } from "jose";
import { handleRequest } from "../src/http/router.ts";
import { verifyGoogleIdToken } from "../src/modules/identity/google.ts";
import { createFcmProvider } from "../src/modules/notifications/fcm-provider.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { createOwnListing } from "../src/modules/workers/listings.ts";

const moderationKey = "ab".repeat(32);
const category = "repair";

async function fixture() {
  const {db, adapter} = openLocalDatabase();
  try {
    const owner = "service-owner-01";
    const customer = "service-customer-01";
    await ensureAccount(adapter, owner);
    await ensureAccount(adapter, customer);
    await optInAsWorker(adapter, owner);
    db.prepare("INSERT INTO categories(id,slug,name_en,is_active) VALUES(?,?,?,1)")
      .run(category, category, "Repair");
    const service = await createOwnListing(adapter, owner, category);
    assert.ok(service);
    const ownerToken = (await issueSession(adapter, owner)).accessToken;
    const customerToken = (await issueSession(adapter, customer)).accessToken;
    async function send(path, {method = "GET", bearer, body} = {}) {
      const headers = {};
      if (bearer) headers.Authorization = "Bearer " + bearer;
      if (body) headers["Content-Type"] = "application/json";
      const response = await worker.fetch(new Request("https://jodlo.test/api/v1/" + path, {
        method, headers, body: body && JSON.stringify(body),
      }), {DB: adapter, SERVICE_MODERATION_KEY: moderationKey, CONTACT_BLOCKS_ENABLED: "1"});
      const payload = await response.json();
      return {status: response.status, data: payload.data, error: payload.error};
    }
    return {db, adapter, service, send, ownerToken, customerToken};
  } catch (error) {
    db.close();
    throw error;
  }
}

test("worker call preference starts off, checks ownership and rejects stale changes", async () => {
  const f = await fixture();
  try {
    const path = "me/call-preference";
    const owner = {bearer:f.ownerToken};
    const customer = {bearer:f.customerToken};
    const post = {method:"POST", ...owner};
    assert.equal((await f.send(path)).status, 401);
    assert.equal((await f.send(path, customer)).status, 404);
    assert.deepEqual((await f.send(path, owner)).data, {enabled:false, revision:0});
    assert.equal((await f.send(path + "?enabled=1&enabled=0&revision=0", post)).status, 400);
    assert.equal((await f.send(path + "?enabled=1&revision=0", {method:"POST", ...customer})).status, 409);
    assert.deepEqual((await f.send(path + "?enabled=1&revision=0", post)).data,
      {enabled:true, revision:1});
    assert.equal((await f.send(path + "?enabled=0&revision=0", post)).status, 409);
    assert.deepEqual((await f.send(path + "?enabled=0&revision=1", post)).data,
      {enabled:false, revision:2});
    assert.deepEqual((await f.send(path, owner)).data, {enabled:false, revision:2});
  } finally {
    f.db.close();
  }
});

test("blocked contacts are private and a stale removal cannot undo a new block", async () => {
  const f = await fixture();
  try {
    const list = "me/contact-blocks?lang=en";
    const block = "me/contact-block?listingId=" + f.service.id;
    const customer = {bearer:f.customerToken};
    const owner = {bearer:f.ownerToken};
    assert.equal((await f.send(list)).status, 401);
    assert.deepEqual((await f.send(list, customer)).data, {items:[], nextCursor:null});
    assert.equal((await f.send(block, {method:"POST", ...customer})).status, 200);
    const [first] = (await f.send(list, customer)).data.items;
    assert.match(first.id, /^[a-f0-9]{32}$/);
    assert.deepEqual(first, {id:first.id, categoryName:"Repair"});
    assert.deepEqual((await f.send(list, owner)).data.items, []);
    const remove = "me/contact-blocks?id=" + first.id;
    assert.equal((await f.send(remove, {method:"DELETE", ...owner})).status, 404);
    assert.equal((await f.send(remove, {method:"DELETE", ...customer})).status, 200);
    assert.equal((await f.send(block, {method:"POST", ...customer})).status, 200);
    const [second] = (await f.send(list, customer)).data.items;
    assert.notEqual(first.id, second.id);
    assert.equal((await f.send(remove, {method:"DELETE", ...customer})).status, 404);
    f.db.prepare("UPDATE worker_listings SET status='unpublished' WHERE id=?").run(f.service.id);
    assert.deepEqual((await f.send(list, customer)).data.items, [{id:second.id,categoryName:null}]);
    assert.equal((await f.send("me/contact-blocks?id=" + second.id,
      {method:"DELETE", ...customer})).status, 200);
  } finally {
    f.db.close();
  }
});

test("city consent, private profile review, and reviewed photo reach only eligible public detail", async () => {
  const f = await fixture();
  try {
    const {id} = f.service;
    const cityPath = "me/service-area?id=" + id;
    const detailsPath = "me/service-details?id=" + id;
    const photoPath = "me/service-photo?id=" + id;
    const publicDetail = "listings?view=service&lang=en&profile=1&id=" + id;
    const publicPhoto = "listings/photo?id=" + id + "&categoryId=" + category + "&city=raipur";
    const owner = {bearer: f.ownerToken};
    const moderator = {bearer: moderationKey};
    assert.deepEqual((await f.send(cityPath, owner)).data, {city:null,revision:0});
    assert.equal((await f.send(cityPath + "&revision=0", {...owner,method:"PUT",body:{city:"raipur"}})).status, 200);
    assert.equal((await f.send(publicDetail + "&city=bilaspur")).status, 404);

    const profile = {displayName:"Repair Team",description:"Small household repairs and maintenance.",
      experienceYears:4,visitRateInr:250};
    assert.equal((await f.send(detailsPath + "&revision=0", {...owner,method:"PUT",body:profile})).status, 200);
    assert.equal((await f.send(publicDetail + "&city=raipur")).data.profile, null);
    assert.equal((await f.send("moderation/service-details?id=" + id + "&revision=1&decision=approved",
      {...moderator,method:"PUT"})).status, 200);

    assert.equal((await f.send(photoPath + "&revision=0", {...owner,method:"PUT",body:{jpeg: JPEG + "AAAA"}})).status, 400);
    assert.equal((await f.send(photoPath + "&revision=0", {...owner,method:"PUT",body:{jpeg:JPEG}})).status, 200);
    assert.equal((await f.send(publicPhoto)).status, 404);
    assert.equal((await f.send("moderation/service-photo?id=" + id + "&revision=1&decision=approved",
      {...moderator,method:"PUT"})).status, 200);
    const publicData = (await f.send(publicDetail + "&city=raipur")).data;
    assert.deepEqual(publicData.profile, profile);
    assert.equal(publicData.hasPhoto, true);
    assert.equal((await f.send(publicPhoto)).data.jpeg, JPEG);
    assert.equal((await f.send(photoPath + "&download=1", {bearer:f.customerToken})).status, 404);
    assert.equal((await f.send("me/data-export?version=3", owner)).data.servicePhotos[0].listingId, id);
    assert.equal((await f.send(photoPath + "&revision=2", {...owner,method:"DELETE"})).status, 200);
    assert.equal((await f.send(publicPhoto)).status, 404);
  } finally { f.db.close(); }
});

test("a report hold hides a service and an accepted appeal preserves independent moderation", async () => {
  const f = await fixture();
  try {
    const {id} = f.service;
    const listing = "listings?id=" + id;
    const report = "me/service-report?listingId=" + id;
    const appeal = "me/service-appeal";
    const moderation = "moderation/service-cases";
    const customer = {bearer:f.customerToken};
    const owner = {bearer:f.ownerToken};
    const moderator = {bearer:moderationKey};
    const body = {reason:"misleading"};
    assert.equal((await f.send(report, {...owner,method:"POST",body})).status, 409);
    assert.equal((await f.send(report, {...customer,method:"POST",body})).status, 201);
    assert.equal((await f.send(report, {...customer,method:"POST",body})).status, 409);
    const queued = (await f.send(moderation + "?queue=pending", moderator)).data.items[0];
    assert.equal(queued.listingId, id);
    assert.equal(queued.reporterAccountId, undefined);
    const review = moderation + "?id=" + queued.id;
    const decision = async (name, evidence) => f.send(review + "&revision=" + evidence.revision +
      "&decision=" + name + "&listingRevision=" + evidence.listingRevision +
      "&profileRevision=" + evidence.profileRevision + "&photoRevision=" + evidence.photoRevision,
      {...moderator,method:"PUT"});
    let evidence = (await f.send(review, moderator)).data;
    assert.equal((await decision("upheld", {...evidence,listingRevision:evidence.listingRevision+1})).status, 409);
    assert.equal((await decision("upheld", evidence)).status, 200);
    assert.equal((await f.send(listing)).status, 404);
    assert.equal((await f.send(appeal + "?listingId=" + id, customer)).status, 404);
    const ownCase = (await f.send(appeal + "?listingId=" + id, owner)).data.case;
    assert.equal(ownCase.status, "upheld");
    assert.equal((await f.send(appeal + "?id=" + ownCase.id + "&revision=" + ownCase.revision,
      {...owner,method:"POST",body:{reason:"mistaken"}})).status, 200);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?").run(id);
    evidence = (await f.send(review, moderator)).data;
    assert.equal((await decision("restored", evidence)).status, 200);
    const saved = f.db.prepare("SELECT report_hold,moderation_status FROM worker_listings WHERE id=?").get(id);
    assert.equal(saved.report_hold, 0);
    assert.equal(saved.moderation_status, "hidden");
    assert.equal((await f.send(listing)).status, 404);
  } finally { f.db.close(); }
});

test("account erasure requires the same Google identity and session-bound nonce", async () => {
  const f = await fixture();
  try {
    const audience = "jodlo-synthetic-test.apps.googleusercontent.com";
    const subject = "123456789012345678901";
    const otherSubject = "999999999999999999999";
    const keys = await generateKeyPair("RS256");
    const resolver = async () => keys.publicKey;
    const verify = (proof, client, _keys, android, nonce) =>
      verifyGoogleIdToken(proof, client, resolver, android, nonce);
    f.db.prepare("INSERT INTO google_identities(google_sub,account_id) VALUES(?,?)")
      .run(subject, "service-owner-01");
    const env = {DB: f.adapter, GOOGLE_CLIENT_ID: audience, ACCOUNT_ERASURE_RELEASE_KEY: "ac".repeat(32)};
    async function request(method, token, body) {
      const headers = {Authorization:"Bearer " + token};
      if (body) headers["Content-Type"] = "application/json";
      return handleRequest(new Request("https://jodlo.test/api/v1/me/account-erasure", {
        method,headers,body:body && JSON.stringify(body),
      }), env, verify);
    }
    async function proof(sub, nonce) {
      return new SignJWT({nonce}).setProtectedHeader({alg:"RS256"})
        .setIssuer("https://accounts.google.com").setAudience(audience).setSubject(sub)
        .setIssuedAt().setExpirationTime("3m").sign(keys.privateKey);
    }
    const prepared = await request("POST", f.ownerToken);
    assert.equal(prepared.status, 200);
    const {challenge, nonce} = (await prepared.json()).data;
    const matchingProof = await proof(subject, nonce);
    assert.equal(await verify(matchingProof, audience), null);
    assert.equal((await request("PUT", f.customerToken, {challenge,googleProof:matchingProof})).status, 409);
    assert.equal((await request("PUT", f.ownerToken, {challenge,googleProof:await proof(otherSubject, nonce)})).status, 409);
    assert.equal((await request("PUT", f.ownerToken, {challenge,googleProof:await proof(subject, "other-nonce")})).status, 409);
    assert.equal((await request("PUT", f.ownerToken, {challenge,googleProof:matchingProof})).status, 200);
    assert.equal(f.db.prepare("SELECT id FROM worker_listings WHERE id=?").get(f.service.id), undefined);
    assert.equal((await request("POST", f.ownerToken)).status, 401);
    assert.equal((await request("PUT", f.ownerToken, {challenge,googleProof:matchingProof})).status, 409);
    assert.equal((await request("POST", f.customerToken)).status, 200);
  } finally { f.db.close(); }
});

test("FCM adapter sends bounded data without putting account identity in the message", async () => {
  let request;
  const now = 1_700_000_000_000;
  const provider = createFcmProvider({
    projectId:"jodlo-test",
    now:() => now,
    accessToken:async () => "sample_oauth_token",
    resolveDestination:async () => "device-registration:test",
    request:async (url, options) => {
      request = {url,options};
      return new Response(null, {status:200});
    },
  });
  assert.equal(await provider.send({
    kind:"notification_delivery_v1",eventId:"event-12345678",recipientAccountId:"account-private-id",
    eventType:"call_invite",createdAtMs:now,expiresAtMs:now+12000,
  }), "accepted");
  assert.equal(request.url, "https://fcm.googleapis.com/v1/projects/jodlo-test/messages:send");
  assert.equal(request.options.headers.Authorization, "Bearer sample_oauth_token");
  assert.equal(JSON.parse(request.options.body).message.android.ttl, "12s");
  assert.equal(request.options.body.includes("account-private-id"), false);
});

// Synthetic baseline JPEG with no EXIF, used only by the isolated SQLite fixture.
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCAAMAAwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLooorkPnz/9k=";
