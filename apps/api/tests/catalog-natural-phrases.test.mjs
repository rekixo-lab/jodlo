import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { categoryIntentTerms } from "../src/modules/catalog/search-phrases.ts";

const base = "https://jodlo.rekixo.com/api/v1/catalog/search";
function fixture() {
  const { db, adapter } = openLocalDatabase();
  const insert = db.prepare(
    "INSERT INTO categories(id, slug, name_en, name_hi, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("cat-plumb", "plumbing", "Plumbing", "प्लंबिंग", 1, 10);
  insert.run("cat-paint", "painting", "Painting", "पेंटिंग", 1, 20);
  insert.run("cat-water", "water-plumbing", "Water plumbing", "पानी प्लंबिंग", 1, 30);
  insert.run("cat-hidden", "secret-plumbing", "Secret plumbing", "गुप्त प्लंबिंग", 0, 1);
  insert.run("cat-carp", "carpentry", "Carpentry", "बढ़ई", 1, 40);
  return { db, env: { DB: adapter } };
}

async function query(env, text, extras = "") {
  const response = await worker.fetch(new Request(base + "?q=" + encodeURIComponent(text) + extras), env);
  assert.equal(response.status, 200, text);
  return (await response.json()).data;
}

test("pure text analyzer supports Devanagari Hindi and English search grammar only", () => {
  assert.deepEqual(categoryIntentTerms("मुझे प्लंबिंग का काम चाहिए"), ["प्लंबिंग"]);
  assert.deepEqual(categoryIntentTerms("मैं प्लंबिंग का काम करता हूँ"), ["प्लंबिंग"]);
  assert.equal(categoryIntentTerms("main plumbing ka kaam karta hu"), null);
  assert.equal(categoryIntentTerms("mujhe painting chahiye"), null);
  assert.deepEqual(categoryIntentTerms("I need plumbing work"), ["plumbing"]);
  assert.deepEqual(categoryIntentTerms("painting or plumbing please"), ["painting","or","plumbing"]);
  assert.deepEqual(categoryIntentTerms("काम चाहिए"), []);
  assert.deepEqual(categoryIntentTerms("मुझे plumbing चाहिए"), []);
  assert.deepEqual(categoryIntentTerms("I need प्लंबिंग"), []);
  assert.deepEqual(categoryIntentTerms("需要 plumbing"), []);
  assert.deepEqual(categoryIntentTerms("I need painting"), ["painting"]);
  assert.equal(categoryIntentTerms("प्लंबिंग"), null);
  assert.equal(categoryIntentTerms("plumbing"), null);
  assert.equal(categoryIntentTerms("plumb% please"), null);
  assert.equal(categoryIntentTerms("' OR 1=1 --"), null);
});

test("Hindi user intent locates published category using original Hindi name", async () => {
  const { db, env } = fixture();
  try {
    const result = await query(env, "मुझे प्लंबिंग का काम चाहिए", "&lang=hi");
    assert.equal(result.query, "मुझे प्लंबिंग का काम चाहिए");
    assert.deepEqual(result.categories, [
      { id:"cat-plumb", slug:"plumbing", name:"प्लंबिंग" },
      { id:"cat-water", slug:"water-plumbing", name:"पानी प्लंबिंग" },
    ]);
    assert.equal(result.nextOffset, null);
    const workerStatement = await query(env, "मैं प्लंबिंग का काम करता हूँ", "&lang=en");
    assert.equal(workerStatement.categories.length, 2);
    assert.equal(workerStatement.categories[0].name, "Plumbing");
  } finally { db.close(); }
});

test("English natural searches work, while Romanized Hindi has no supported fallback", async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual((await query(env, "mujhe painting chahiye")).categories, []);
    assert.deepEqual((await query(env, "main plumbing ka kaam karta hu")).categories, []);
    assert.deepEqual((await query(env, "I need painting service")).categories, [
      { id:"cat-paint", slug:"painting", name:"Painting" }
    ]);
    assert.equal((await query(env, "I need painting service")).categories.length, 1);
    // Missing curated synonyms remain unmatched; do NOT hallucinate a service.
    assert.deepEqual((await query(env, "mujhe plumber chahiye")).categories, []);
  } finally { db.close(); }
});

test("multiple trade terms use intersection instead of assigning an uncertain occupation", async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual((await query(env, "mujhe plumbing painting chahiye")).categories, []);
    assert.deepEqual((await query(env, "मुझे काम चाहिए")).categories, []);
    assert.deepEqual((await query(env, "please need service")).categories, []);
    assert.deepEqual((await query(env, "I need secret plumbing")).categories, []);
    assert.equal((await query(env, "I need water plumbing")).categories.length, 1);
    assert.equal((await query(env, "I need water plumbing")).categories[0]?.id, "cat-water");
  } finally { db.close(); }
});

test("natural phrase pages remain stable and active-only, and yield no private fields", async () => {
  const { db, env } = fixture();
  try {
    const first = await query(env, "I need plumbing", "&limit=1");
    assert.deepEqual(first.categories, [{ id:"cat-plumb", slug:"plumbing", name:"Plumbing" }]);
    assert.equal(first.nextOffset, 1);
    const second = await query(env, "I need plumbing", "&limit=1&offset=1");
    assert.deepEqual(second.categories, [{ id:"cat-water", slug:"water-plumbing", name:"Water plumbing" }]);
    assert.equal(second.nextOffset, null);
    for(const forbidden of ["phone","lat","lng","google_sub","worker_profiles","verified","secret-plumbing"]) {
      assert.equal(JSON.stringify(first).includes(forbidden), false);
      assert.equal(JSON.stringify(second).includes(forbidden), false);
    }
  } finally { db.close(); }
});

test("literal wildcard/quote/SQL-like payloads and oversized input remain safely bounded", async () => {
  const { db, env } = fixture();
  try {
    for(const input of ["plumb% please", "_ painting please", "' OR 1=1 --",
      "painting; DROP TABLE categories", "plumbing=1 please"]) {
      const result = await query(env, input);
      assert.deepEqual(result.categories, [], input);
    }
    const tooLong = await worker.fetch(new Request(base + "?q=" + "x".repeat(65)), env);
    assert.equal(tooLong.status, 400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM categories").get().n, 5);
  } finally { db.close(); }
});

test("no locality, real worker, contact or request API is exposed by natural search", async () => {
  const { db, env } = fixture();
  try {
    for(const path of ["/api/v1/workers",
      "/api/v1/areas","/api/v1/requests","/api/v1/noknok"]) {
      assert.equal((await worker.fetch(new Request("https://jodlo.rekixo.com"+path), env)).status,404);
    }
    assert.deepEqual((await query(env, "मुझे unknown-category चाहिए", "&lang=hi")).categories,[]);
  } finally { db.close(); }
});

test("founder rule: no Hinglish or mixed-script discovery despite English/Hindi output labels", async () => {
  const { db, env } = fixture();
  try {
    for (const unsupported of [
      "mujhe plumbing chahiye",
      "main plumbing ka kaam karta hu",
      "मुझे plumbing चाहिए",
      "I need प्लंबिंग",
      "please प्लंबिंग",
      "需要 plumbing",
    ]) {
      assert.deepEqual((await query(env, unsupported)).categories, [], unsupported);
    }
    // lang changes display language; it does not enable transliteration.
    assert.equal((await query(env, "I need plumbing", "&lang=hi")).categories[0].name, "प्लंबिंग");
    assert.equal((await query(env, "मुझे प्लंबिंग चाहिए", "&lang=en")).categories[0].name, "Plumbing");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM categories").get().n, 5);
  } finally { db.close(); }
});
