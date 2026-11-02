import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";

// This is a BUSINESS ACTION CONTRACT test, not a simulated production call.
// Each HTTP request uses the actual Worker router and D1-shaped session verifier.
// Category/identity fixtures are synthetic; nothing is provisioned remotely.
const origin = "https://jodlo.rekixo.com";
const customerId = "account-business-customer";
const workerId = "account-business-worker";
const categoryId = "synthetic-approved-trade";
const category = { id: categoryId, slug: "test-trade", name: "Synthetic Trade" };

async function fixture() {
  const { db, adapter } = openLocalDatabase();
  await ensureAccount(adapter, customerId);
  await ensureAccount(adapter, workerId);
  db.prepare(
    "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)"
  ).run(categoryId, category.slug, category.name, "परीक्षण काम");
  db.prepare(
    "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,0)"
  ).run("synthetic-inactive", "inactive", "Inactive", "निष्क्रिय");
  const customerBearer = (await issueSession(adapter, customerId))?.accessToken;
  const workerBearer = (await issueSession(adapter, workerId))?.accessToken;
  assert.ok(customerBearer && workerBearer);
  async function send(path, method = "GET", bearer, body) {
    const response = await worker.fetch(new Request(origin + path, {
      method,
      headers: {
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { DB: adapter });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return { status: response.status, payload: await response.json() };
  }
  return { db, send, customerBearer, workerBearer };
}

test("approved action sequence: guest -> worker opt-in -> publish -> discover -> unpublish", async () => {
  const f = await fixture();
  try {
    const available = () => f.send("/api/v1/catalog?availableOnly=1");
    const listings = () => f.send("/api/v1/listings?categoryId=" + categoryId);

    assert.deepEqual((await available()).payload.data.categories, []);
    assert.deepEqual((await listings()).payload.data.listings, []);

    // A customer account does NOT become a worker or publish by default.
    assert.equal((await f.send("/api/v1/me/listings", "POST",
      f.customerBearer, { categoryId })).status, 403);
    assert.equal((await f.send("/api/v1/me/listings", "POST",
      f.workerBearer, { categoryId })).status, 403);

    assert.deepEqual((await f.send("/api/v1/me/worker-profile", "POST",
      f.workerBearer)).payload.data.profile, { status: "draft" });
    assert.equal((await f.send("/api/v1/me/listings", "POST",
      f.workerBearer, { categoryId: "synthetic-inactive" })).status, 403);

    const response = await f.send("/api/v1/me/listings", "POST",
      f.workerBearer, { categoryId });
    assert.equal(response.status, 200);
    const published = response.payload.data.listing;
    assert.deepEqual(Object.keys(published).sort(), ["categoryId", "id"]);
    assert.equal(published.categoryId, categoryId);

    // Publishing is NOT consent to receive incoming Agora calls.
    assert.equal(f.db.prepare(
      "SELECT COUNT(*) AS n FROM worker_agora_call_preferences WHERE account_id=?"
    ).get(workerId).n, 0);
    assert.deepEqual((await available()).payload.data.categories, [category]);
    assert.deepEqual((await listings()).payload.data.listings, [published]);

    // Another authenticated customer cannot edit the worker's listing.
    assert.equal((await f.send("/api/v1/me/listings?id=" + published.id,
      "DELETE", f.customerBearer)).status, 404);
    assert.deepEqual((await listings()).payload.data.listings, [published]);

    assert.equal((await f.send("/api/v1/me/listings?id=" + published.id,
      "DELETE", f.workerBearer)).status, 200);
    assert.deepEqual((await available()).payload.data.categories, []);
    assert.deepEqual((await listings()).payload.data.listings, []);
    assert.deepEqual((await f.send("/api/v1/catalog")).payload.data.categories, [
      { ...category }, { id: "synthetic-inactive", slug: "inactive", name: "Inactive" }
    ].slice(0, 1));
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n, 1);
  } finally {
    f.db.close();
  }
});

test("published listing cannot activate unapproved calling, report, payment or deletion routes", async () => {
  const f = await fixture();
  try {
    await f.send("/api/v1/me/worker-profile", "POST", f.workerBearer);
    const posted = await f.send("/api/v1/me/listings", "POST",
      f.workerBearer, { categoryId });
    assert.equal(posted.status, 200);

    // These endpoints are deliberately absent, even with real local bearer
    // sessions and a legitimately published listing. Synthetic Agora
    // lifecycle or notification tests are NOT a production permission.
    const gatedPaths = [
      "/api/v1/calls",
      "/api/v1/calls/invite",
      "/api/v1/agora/invites",
      "/api/v1/contacts",
      "/api/v1/reports",
      "/api/v1/blocks",
      "/api/v1/payments",
      "/api/v1/me/account/delete",
      "/api/v1/me/agora-call-preference",
    ];
    for (const path of gatedPaths) {
      for (const bearer of [f.customerBearer, f.workerBearer]) {
        const r = await f.send(path, "POST", bearer, {});
        assert.equal(r.status, 404, path);
        assert.deepEqual(r.payload, {
          ok: false, error: { code: "NOT_FOUND", message: "Endpoint not found" }
        }, path);
      }
    }
    assert.equal(f.db.prepare(
      "SELECT COUNT(*) AS n FROM worker_agora_call_preferences"
    ).get().n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n, 1);
  } finally {
    f.db.close();
  }
});
