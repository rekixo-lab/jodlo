import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { issueSession, sessionHash } from "../src/modules/identity/sessions.ts";
import { publishListing } from "../src/modules/workers/listings.ts";

const origin = "https://api.jodlo.rekixo.com";
const a = "account-selfservice-a111", b = "account-selfservice-b222";

async function fixture() {
  const { db, adapter } = openLocalDatabase();
  try {
    await ensureAccount(adapter, a);
    await ensureAccount(adapter, b);
    await optInAsWorker(adapter, a);
    await optInAsWorker(adapter, b);
    db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
      .run("approved-trade","approved-trade","Synthetic Test Work","परीक्षण कार्य");
    const ownListing = await publishListing(adapter, a, "approved-trade");
    const otherListing = await publishListing(adapter, b, "approved-trade");
    assert.ok(ownListing && otherListing);
    const first = (await issueSession(adapter, a))?.accessToken;
    const second = (await issueSession(adapter, a))?.accessToken;
    const other = (await issueSession(adapter, b))?.accessToken;
    assert.ok(first && second && other);
    async function send(path, token = first, method = "GET") {
      const response = await worker.fetch(new Request(origin + path, {
        method,
        headers: token ? { Authorization: "Bearer " + token } : {},
      }), { DB: adapter });
      const json = await response.json();
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      return { status: response.status, json, raw: JSON.stringify(json), response };
    }
    return { db, adapter, first, second, other, ownListing, otherListing, send };
  } catch (err) { db.close(); throw err; }
}

test("account overview: current owner only, live session count and current publication", async () => {
  const f = await fixture();
  try {
    const own = await f.send("/api/v1/me/overview");
    const other = await f.send("/api/v1/me/overview", f.other);
    assert.equal(own.status, 200);
    assert.equal(other.status, 200);
    assert.equal(own.json.data.workerEnabled, true);
    assert.equal(own.json.data.totalServices, 1);
    assert.equal(own.json.data.publishedServices, 1);
    assert.equal(own.json.data.visibleServices, 1);
    assert.equal(own.json.data.activeSessions, 2);
    assert.equal(own.json.data.receivesCalls, false);
    assert.equal(other.json.data.totalServices, 1);
    assert.equal(other.json.data.activeSessions, 1);
    for (const secret of [f.first, f.second, f.other, a, b, "google_sub", "token_hash"]) {
      assert.equal(own.raw.includes(secret), false, "account overview must not expose " + secret);
      assert.equal(other.raw.includes(secret), false);
    }
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.ownListing.id);
    const hidden = await f.send("/api/v1/me/overview");
    assert.equal(hidden.json.data.publishedServices, 1);
    assert.equal(hidden.json.data.visibleServices, 0);
  } finally { f.db.close(); }
});

test("owner export: includes current D1-owned fields without bearer/token hashes or other account data", async () => {
  const f = await fixture();
  try {
    f.db.prepare("INSERT INTO agora_account_blocks(blocker_account_id,blocked_account_id) VALUES(?,?)")
      .run(a, b);
    const row = await f.send("/api/v1/me/data-export");
    assert.equal(row.status, 200);
    const data = row.json.data;
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.account.accountId, a);
    assert.equal(data.services.length, 1);
    assert.equal(data.services[0].id, f.ownListing.id);
    assert.equal(data.services[0].status, "published");
    assert.deepEqual(data.blocksMade, [{ blockedAccountId: b }]);
    assert.equal(data.sessions.length, 2);
    assert.equal(data.identity.length, 0);
    assert.equal(data.callPreferences.length, 0);
    assert.equal(data.availabilityPreferences.length, 0);
    assert.equal(data.abuseCounters.length, 0);
    const other = await f.send("/api/v1/me/data-export", f.other);
    assert.equal(other.status, 200);
    assert.equal(other.json.data.account.accountId, b);
    assert.equal(other.json.data.services[0].id, f.otherListing.id);
    assert.equal(other.raw.includes(f.ownListing.id), false);
    assert.equal(other.raw.includes(a), false);
    for (const secret of [f.first, f.second, f.other, await sessionHash(f.first),
      await sessionHash(f.other), "token_hash", "google_identities"]) {
      assert.equal(row.raw.includes(secret), false, "export must not expose credential " + secret);
      assert.equal(other.raw.includes(secret), false);
    }
  } finally { f.db.close(); }
});

test("self service: missing, expired and revoked tokens cannot read or export, input is strict", async () => {
  const f = await fixture();
  try {
    for (const path of ["/api/v1/me/overview", "/api/v1/me/data-export"]) {
      assert.equal((await f.send(path, null)).status, 401);
      assert.equal((await f.send(path + "?owner=" + b)).status, 400);
      const method = await f.send(path, f.first, "POST");
      assert.equal(method.status, 405);
      assert.equal(method.response.headers.get("Allow"), "GET");
      assert.equal((await f.send(path, "invalid")).status, 401);
    }
    assert.equal((await f.send("/api/v1/auth/logout-all", f.first, "POST")).status, 200);
    assert.equal((await f.send("/api/v1/me/overview", f.second)).status, 401);
    assert.equal((await f.send("/api/v1/me/data-export", f.first)).status, 401);
    assert.equal((await f.send("/api/v1/me/overview", f.other)).status, 200);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(b);
    assert.equal((await f.send("/api/v1/me/overview", f.other)).status, 401);
  } finally { f.db.close(); }
});

test("oversized export fails closed rather than returning a partial file beyond the native read budget", async () => {
  const f = await fixture();
  try {
    const cat = f.db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)"
    );
    const listing = f.db.prepare(
      "INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)"
    );
    // Many unique synthetic categories are used ONLY inside disposable local D1.
    // No historical Finworkar categories or production rows are activated.
    for (let i = 0; i < 500; i++) {
      const id = "fixture-" + i;
      cat.run(id, id, "Fixture only", "परीक्षण");
      listing.run(String(i).padStart(8, "0") + "-1111-4111-8111-111111111111", a, id);
    }
    const response = await f.send("/api/v1/me/data-export");
    assert.equal(response.status, 503);
    assert.deepEqual(response.json, {
      ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Account unavailable" },
    });
    assert.equal(response.raw.includes(f.ownListing.id), false);
    assert.equal(response.raw.includes(a), false);
    // Overview remains functional and no account/listing was altered by export.
    assert.equal((await f.send("/api/v1/me/overview")).status, 200);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM worker_listings WHERE worker_account_id=?")
      .get(a).n, 501);
  } finally { f.db.close(); }
});
