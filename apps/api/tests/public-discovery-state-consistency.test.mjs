import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";

/**
 * One local D1, REAL /api/v1 router and REAL bearer sessions, not a collection
 * of synthetic "eligibility" booleans. No historic Categories are activated.
 * Every source of public availability must agree on current database facts.
 */
const origin = "https://jodlo.rekixo.com";
const repair = { id: "test-repair", slug: "test-repair", name: "Repair Service" };
const cleaning = { id: "test-cleaning", slug: "test-cleaning", name: "Cleaning Service" };
const ownerA = "account-eligibility-worker-a";
const ownerB = "account-eligibility-worker-b";
const customer = "account-eligibility-guest-customer";

async function fixture() {
  const { db, adapter } = openLocalDatabase();
  const insertCategory = db.prepare(
    "INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)"
  );
  insertCategory.run(repair.id, repair.slug, repair.name, "मरम्मत सेवा", 1, 10);
  insertCategory.run(cleaning.id, cleaning.slug, cleaning.name, "सफाई सेवा", 1, 20);
  insertCategory.run("test-inactive", "test-inactive", "Inactive Trade", "निष्क्रिय", 0, 30);
  for (const account of [ownerA, ownerB, customer]) await ensureAccount(adapter, account);
  const tokens = {};
  for (const account of [ownerA, ownerB, customer]) {
    const result = await issueSession(adapter, account);
    assert.ok(result?.accessToken);
    tokens[account] = result.accessToken;
  }
  async function call(path, method = "GET", actor, body) {
    const response = await worker.fetch(new Request(origin + path, {
      method,
      headers: {
        ...(actor ? { Authorization: "Bearer " + tokens[actor] } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { DB: adapter });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return { status: response.status, data: await response.json() };
  }
  const get = async (path) => {
    const response = await call(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.data.ok, true);
    return response.data.data;
  };
  const enrolled = account => call("/api/v1/me/worker-profile", "POST", account);
  const publish = (account, categoryId) =>
    call("/api/v1/me/listings", "POST", account, { categoryId });
  return { db, call, get, enrolled, publish };
}

const available = "/api/v1/catalog?availableOnly=1";
const publicListings = id => "/api/v1/listings?categoryId=" + id;
const availableSearch = "q=Repair&availableOnly=1";

test("all guest discovery surfaces agree after real worker writes, account disable, moderation and unpublish", async () => {
  const f = await fixture();
  try {
    const categories = async () => (await f.get(available)).categories.map(row => row.id);
    const search = async (query = availableSearch) =>
      (await f.get("/api/v1/catalog/search?" + query)).categories.map(row => row.id);
    const listed = async categoryId =>
      (await f.get(publicListings(categoryId))).listings;
    const privateListing = (account, path = "/api/v1/me/listings") =>
      f.call(path, "GET", account);
    const assertPublic = async (expectedCategories, expectedRepairIds, expectedCleanIds) => {
      assert.deepEqual(await categories(), expectedCategories);
      assert.deepEqual(await search(), expectedCategories.includes(repair.id) ? [repair.id] : []);
      assert.deepEqual(await search(availableSearch + "&cursor=1"),
        expectedCategories.includes(repair.id) ? [repair.id] : []);
      const repairIds = (await listed(repair.id)).map(row => row.id).sort();
      const cleanIds = (await listed(cleaning.id)).map(row => row.id).sort();
      assert.deepEqual(repairIds, expectedRepairIds.slice().sort());
      assert.deepEqual(cleanIds, expectedCleanIds.slice().sort());
      const all = JSON.stringify([
        await f.get(available), await f.get("/api/v1/catalog/search?" + availableSearch),
        await listed(repair.id), await listed(cleaning.id),
      ]);
      for (const forbidden of [ownerA, ownerB, customer, "worker_account_id", "moderation_status",
        "google_sub", "phone", "verified", "latitude", "longitude", "email", "session"]) {
        assert.equal(all.includes(forbidden), false, forbidden);
      }
    };

    assert.deepEqual((await f.get("/api/v1/catalog")).categories, [repair, cleaning]);
    await assertPublic([], [], []);
    // Worker creation does not publish anything; an unrelated customer cannot
    // publish on another person's behalf merely by knowing a Category ID.
    assert.equal((await f.publish(ownerA, repair.id)).status, 403);
    assert.equal((await f.publish(customer, repair.id)).status, 403);
    assert.equal((await f.enrolled(ownerA)).status, 200);
    assert.equal((await f.enrolled(ownerB)).status, 200);
    assert.deepEqual((await f.get(available)).categories, []);
    assert.equal((await f.publish(ownerA, "test-inactive")).status, 403);

    const first = await f.publish(ownerA, repair.id);
    const second = await f.publish(ownerB, repair.id);
    const third = await f.publish(ownerA, cleaning.id);
    for (const outcome of [first, second, third]) assert.equal(outcome.status, 200);
    const aRepair = first.data.data.listing.id;
    const bRepair = second.data.data.listing.id;
    const aCleaning = third.data.data.listing.id;
    await assertPublic([repair.id, cleaning.id], [aRepair, bRepair], [aCleaning]);

    // Bounded paged catalog + public listing discovery cannot drift from the
    // unpaged versions or expose private worker account identities.
    const firstCategory = await f.get(available + "&limit=1");
    assert.deepEqual(firstCategory.categories, [repair]);
    assert.equal(firstCategory.nextCursor, "10:" + repair.id);
    const secondCategory = await f.get(available + "&limit=1&after=" +
      encodeURIComponent(firstCategory.nextCursor));
    assert.deepEqual(secondCategory.categories, [cleaning]);
    assert.equal(secondCategory.nextCursor, null);
    const firstPage = await f.get(publicListings(repair.id) + "&limit=1");
    assert.equal(firstPage.listings.length, 1);
    assert.ok(firstPage.nextCursor);
    const secondPage = await f.get(publicListings(repair.id) + "&limit=1&after=" +
      firstPage.nextCursor);
    assert.equal(secondPage.listings.length, 1);
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(new Set([...firstPage.listings, ...secondPage.listings].map(x => x.id)),
      new Set([aRepair, bRepair]));

    // A disabled worker's published rows disappear immediately from public
    // discovery; another independently eligible worker remains available.
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(ownerA);
    await assertPublic([repair.id], [bRepair], []);
    assert.equal((await privateListing(ownerA)).status, 401);
    assert.equal((await privateListing(ownerB)).status, 200);
    assert.equal((await f.call("/api/v1/me/listings?id=" + aRepair,
      "DELETE", ownerB)).status, 404);

    // Reenable only to exercise the independent moderation guard in this
    // disposable fixture. This does NOT approve production account reactivation.
    f.db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(ownerA);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?").run(aRepair);
    await assertPublic([repair.id, cleaning.id], [bRepair], [aCleaning]);
    assert.equal((await f.publish(ownerA, repair.id)).status, 403);
    assert.deepEqual((await privateListing(ownerA)).data.data.listings
      .find(x => x.id === aRepair), { id: aRepair, categoryId: repair.id, visible: false });

    // When the LAST eligible worker unpublishes, the same category must leave
    // all available-only Catalog/Search surfaces but stay in active Catalog.
    assert.equal((await f.call("/api/v1/me/listings?id=" + bRepair,
      "DELETE", ownerB)).status, 200);
    await assertPublic([cleaning.id], [], [aCleaning]);
    assert.deepEqual((await f.get("/api/v1/catalog/search?q=Repair"))
      .categories.map(x => x.id), [repair.id]);
    assert.deepEqual((await f.get("/api/v1/catalog")).categories, [repair, cleaning]);

    // Disabling the remaining service Category hides it everywhere public;
    // its private owner row still exists for review (not automatic erasure).
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(cleaning.id);
    await assertPublic([], [], []);
    assert.deepEqual((await f.get("/api/v1/catalog")).categories, [repair]);
    assert.equal((await f.publish(ownerA, cleaning.id)).status, 403);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM worker_listings").get().count, 3);
    assert.equal((await privateListing(ownerA)).data.data.listings
      .find(x => x.id === aCleaning).visible, false);
  } finally {
    f.db.close();
  }
});

test("a stale discovery result cannot authorize a publish after Category deactivation", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.enrolled(ownerA)).status, 200);
    const preview = await f.get("/api/v1/catalog/search?q=Repair&lang=hi");
    assert.deepEqual(preview.categories, [
      { id: repair.id, slug: repair.slug, name: "मरम्मत सेवा" },
    ]);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(repair.id);
    assert.equal((await f.publish(ownerA, preview.categories[0].id)).status, 403);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM worker_listings").get().count, 0);
    assert.deepEqual((await f.get(publicListings(repair.id))).listings, []);
    assert.deepEqual((await f.get("/api/v1/catalog/search?q=Repair")).categories, []);
    // A valid inactive Category is not accidentally promoted by a prior read
    // or by an injected cross-account or extra privileged client field.
    assert.equal((await f.call("/api/v1/me/listings", "POST", ownerA,
      { categoryId: repair.id, verified: true })).status, 400);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM worker_listings").get().count, 0);
  } finally {
    f.db.close();
  }
});
