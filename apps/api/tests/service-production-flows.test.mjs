import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
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
      }), {DB: adapter, SERVICE_MODERATION_KEY: moderationKey});
      const payload = await response.json();
      return {status: response.status, data: payload.data, error: payload.error};
    }
    return {db, service, send, ownerToken, customerToken};
  } catch (error) {
    db.close();
    throw error;
  }
}

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

// Synthetic baseline JPEG with no EXIF, used only by the isolated SQLite fixture.
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCAAMAAwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLooorkPnz/9k=";
