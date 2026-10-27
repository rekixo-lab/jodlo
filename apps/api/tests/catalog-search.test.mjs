import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { parseCatalogSearch, SEARCH_PUBLIC_CATEGORIES_QUERY } from "../src/modules/catalog/catalog.ts";

const base = "https://jodlo.rekixo.com/api/v1/catalog/search";
const request = (params = "", method = "GET") => new Request(base + params, { method });
const insert = (db, id, slug, en, hi, active=1, order=0) =>
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES (?,?,?,?,?,?)")
    .run(id, slug, en, hi, active, order);

function sample() {
  const { db, adapter } = openLocalDatabase();
  insert(db, "cat-1", "plumbing", "Plumbing", "प्लंबिंग", 1, 10);
  insert(db, "cat-2", "painting", "Painting", null, 1, 20);
  insert(db, "cat-3", "plumber-private", "Private plumber", "निजी नलसाज़", 0, 1);
  insert(db, "cat-4", "carpentry", "Carpentry", "बढ़ई", 1, 30);
  insert(db, "cat-5", "water-service", "Water plumbing", "पानी की मरम्मत", 1, 25);
  return { db, env: { DB: adapter } };
}

test("search returns only active public category fields and stable bilingual fallback", async () => {
  const { db, env } = sample();
  try {
    const english = await worker.fetch(request("?q=plumb"), env);
    assert.equal(english.status, 200);
    assert.deepEqual(await english.json(), {
      ok: true, data: { language: "en", query: "plumb", categories: [
        { id: "cat-1", slug: "plumbing", name: "Plumbing" },
        { id: "cat-5", slug: "water-service", name: "Water plumbing" },
      ], nextOffset: null },
    });
    const hindi = await worker.fetch(request("?lang=hi&q=" + encodeURIComponent("प्लंबिंग")), env);
    assert.deepEqual((await hindi.json()).data.categories, [
      { id: "cat-1", slug: "plumbing", name: "प्लंबिंग" }
    ]);
    const hindiFallback = await worker.fetch(request("?lang=hi&q=painting"), env);
    assert.deepEqual((await hindiFallback.json()).data.categories, [
      { id: "cat-2", slug: "painting", name: "Painting" }
    ]);
    const caseInsensitive = await worker.fetch(request("?q=PLUMB"), env);
    assert.equal((await caseInsensitive.json()).data.categories.length, 2);
    assert.equal((await worker.fetch(request("?q=absent"), env)).status, 200);
    assert.deepEqual((await (await worker.fetch(request("?q=absent"), env)).json()).data.categories, []);
  } finally { db.close(); }
});

test("search has bounded deterministic offset pages without disclosing extra rows", async () => {
  const { db, env } = sample();
  try {
    const first = await worker.fetch(request("?q=plumb&limit=1"), env);
    assert.deepEqual((await first.json()).data, {
      language: "en", query: "plumb",
      categories: [{ id: "cat-1", slug: "plumbing", name: "Plumbing" }],
      nextOffset: 1,
    });
    const second = await worker.fetch(request("?q=plumb&limit=1&offset=1"), env);
    assert.deepEqual((await second.json()).data, {
      language: "en", query: "plumb",
      categories: [{ id: "cat-5", slug: "water-service", name: "Water plumbing" }],
      nextOffset: null,
    });
    const beyond = await worker.fetch(request("?q=plumb&offset=100"), env);
    assert.deepEqual((await beyond.json()).data.categories, []);

  } finally { db.close(); }
});

test("SQL is parameterized; wildcard, quote and SQL comment characters are literal", async () => {
  const { db, env } = sample();
  try {
    for (const q of ["%_", "a%_", "' OR 1=1 --", "plumb%"]) {
      const response = await worker.fetch(request("?q=" + encodeURIComponent(q)), env);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data.categories, [], q);
    }
    const queryPlan = db.prepare("EXPLAIN QUERY PLAN " + SEARCH_PUBLIC_CATEGORIES_QUERY)
      .all("en", "plumb", "plumb", "plumb", 21, 0);
    assert.ok(queryPlan.some(r => String(r.detail).includes("idx_categories_active_sort")), JSON.stringify(queryPlan));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM categories").get().n, 5);
  } finally { db.close(); }
});

test("query parser rejects repeat, unknown, oversized, zero and malformed inputs", async () => {
  const { db, env } = sample();
  try {
    const invalid = [
      "", "?q=", "?q=a", "?q=" + "x".repeat(65), "?q=plumb&q=plumb",
      "?q=plumb&lang=hi&lang=en", "?q=plumb&lang=xx",
      "?q=plumb&extra=yes", "?q=plumb&limit=0",
      "?q=plumb&limit=26", "?q=plumb&limit=01", "?q=plumb&limit=-1",
      "?q=plumb&offset=-1", "?q=plumb&offset=101",
      "?q=plumb&offset=01", "?q=plumb&offset=1&offset=2",
      "?q=" + encodeURIComponent("ab\ncd"),
    ];
    for (const query of invalid) {
      const res = await worker.fetch(request(query), env);
      assert.equal(res.status, 400, query);
      assert.equal((await res.json()).error.code, "INVALID_QUERY");
    }
    assert.equal(parseCatalogSearch(new URLSearchParams("q= painting ")).query, "painting");
    const normalized = parseCatalogSearch(new URLSearchParams("q=" + encodeURIComponent("क\u093cकाम")));
    assert.equal(normalized.query, "क\u093cकाम".normalize("NFC"));
  } finally { db.close(); }
});

test("search rejects writes, absent D1 and SQL failures without exposing internals", async () => {
  const { db, env } = sample();
  try {
    for (const method of ["POST","PATCH","PUT","DELETE"]) {
      const r = await worker.fetch(request("?q=plumb", method), env);
      assert.equal(r.status, 405);
      assert.equal(r.headers.get("Allow"), "GET");
    }
    const missing = await worker.fetch(request("?q=plumb"));
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).error.code, "SERVICE_UNAVAILABLE");
    const failed = await worker.fetch(request("?q=plumb"), {
      DB: { prepare() { throw Error("SENSITIVE_SQL_VALUE"); } },
    });
    assert.equal(failed.status, 503);
    assert.equal((await failed.text()).includes("SENSITIVE_SQL_VALUE"), false);
  } finally { db.close(); }
});

test("no public worker listing, request creation, locality or contact data is exposed", async () => {
  const { db, env } = sample();
  try {
    const found = await worker.fetch(request("?q=plumb"), env);
    const text = await found.text();
    for (const privateField of ["account_id", "worker_profiles", "google_sub", "latitude", "longitude", "phone", "verified"]) {
      assert.equal(text.includes(privateField), false);
    }
    for (const path of ["/api/v1/workers", "/api/v1/requests", "/api/v1/areas"]) {
      const r = await worker.fetch(new Request("https://jodlo.rekixo.com" + path), env);
      assert.equal(r.status, 404);
    }
  } finally { db.close(); }
});
