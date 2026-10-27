import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PUBLIC_CATEGORIES_QUERY } from "../src/modules/catalog/catalog.ts";

const migration = readFileSync(new URL("../../../infra/migrations/0001_public_catalog.sql", import.meta.url), "utf8");
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  return db;
}
function insert(db, id, slug, en, hi, active, order) {
  db.prepare("INSERT INTO categories (id, slug, name_en, name_hi, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, slug, en, hi, active, order);
}

test("D1 migration builds a PII-free schema with active-only ordered index", () => {
  const db = setup();
  try {
    const columns = db.prepare("PRAGMA table_info(categories)").all().map(row => row.name);
    assert.deepEqual(columns, ["id", "slug", "name_en", "name_hi", "is_active", "sort_order", "updated_at"]);
    const plan = db.prepare("EXPLAIN QUERY PLAN " + PUBLIC_CATEGORIES_QUERY).all("en");
    assert.ok(plan.some(row => String(row.detail).includes("idx_categories_active_sort")), JSON.stringify(plan));
  } finally { db.close(); }
});

test("read query hides drafts, uses stable ordering and Hindi fallback", () => {
  const db = setup();
  try {
    insert(db, "c2", "painting", "Painting", null, 1, 20);
    insert(db, "c3", "private-service", "Private", "निजी", 0, 0);
    insert(db, "c1", "plumbing", "Plumbing", "प्लंबिंग", 1, 10);
    assert.deepEqual(db.prepare(PUBLIC_CATEGORIES_QUERY).all("hi"), [
      { id: "c1", slug: "plumbing", name: "प्लंबिंग" },
      { id: "c2", slug: "painting", name: "Painting" },
    ]);
    assert.deepEqual(db.prepare(PUBLIC_CATEGORIES_QUERY).all("en").map(row => row.name), ["Plumbing", "Painting"]);
  } finally { db.close(); }
});

test("database rejects duplicate slug, malformed names/status and invalid identifiers", () => {
  const db = setup();
  try {
    insert(db, "c1", "plumbing", "Plumbing", null, 1, 1);
    assert.throws(() => insert(db, "c2", "plumbing", "Other", null, 1, 2));
    assert.throws(() => insert(db, "c3", "Painting", "Painting", null, 1, 2));
    assert.throws(() => insert(db, "c4", "painting", "  ", null, 1, 2));
    assert.throws(() => insert(db, "c5", "painting", "Painting", null, 2, 2));
    assert.throws(() => insert(db, "", "painting", "Painting", null, 1, 2));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM categories").get().n, 1);
  } finally { db.close(); }
});
