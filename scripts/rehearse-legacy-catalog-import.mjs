import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadPinnedCatalogMappingReadiness } from "./catalog-mapping-readiness.mjs";
import { loadPinnedLegacySnapshot } from "./legacy-category-review.mjs";

const [vocabularyPath] = process.argv.slice(2);
if (!vocabularyPath || process.argv.length !== 3) {
  throw Error("Usage: node scripts/rehearse-legacy-catalog-import.mjs PATH_TO_VOCABULARY.ndjson");
}

const vocabulary = readFileSync(vocabularyPath);
assert.equal(createHash("sha256").update(vocabulary).digest("hex"),
  "4a182a3801a81a17945be03566b679753bc31ac978989822398021e9e63a7853");

const { groups, families, categories, services } = loadPinnedLegacySnapshot().collections;
const source = new Map([
  ["group", groups], ["family", families], ["category", categories], ["service", services],
].map(([type, rows]) => [type, new Map(rows.map(row => [row.id, row]))]));
const seen = new Map([...source.keys()].map(type => [type, new Set()]));
// Local rehearsal mapping. Preserve the source ID as the lookup key so
// service and vocabulary references can be mapped without changing the archive.
const farmWorkerMapping = {
  sourceId: "farmer-helper-मजदूर",
  categoryId: "farm-worker",
  slug: "farm-worker",
};
assert.ok(!source.get("category").has(farmWorkerMapping.categoryId),
  "Rehearsal ID collides with a source category");
const categoryIds = new Map();
for (const row of loadPinnedCatalogMappingReadiness().result.categories) {
  const mapping = row.sourceCategoryId === farmWorkerMapping.sourceId ? farmWorkerMapping : null;
  if (mapping) {
    assert.deepEqual(row.syntaxIssues, [
      "SOURCE_CATEGORY_ID_INCOMPATIBLE", "SOURCE_CATEGORY_SLUG_INCOMPATIBLE",
    ]);
  } else {
    assert.deepEqual(row.syntaxIssues, [], `Unresolved category ${row.sourceCategoryId}`);
  }
  categoryIds.set(row.sourceCategoryId, {
    id: mapping?.categoryId ?? row.categoryIdCandidate,
    slug: mapping?.slug ?? row.slugCandidate,
  });
}
assert.equal(categoryIds.get(farmWorkerMapping.sourceId)?.id, farmWorkerMapping.categoryId);
assert.equal(new Set([...categoryIds.values()].map(row => row.id)).size, categories.length);
const [metadata, ...records] = vocabulary.toString("utf8").trimEnd().split("\n")
  .map(line => JSON.parse(line));
assert.equal(metadata.schema, "REKIXO_MATCHER_VOCABULARY_V1");

let ambiguityRules = 0;
let termOccurrences = 0;
let remappedServiceLinks = 0;
for (const row of records) {
  if (row.type === "ambiguity") {
    assert.ok(row.term.trim());
    assert.ok(new Set(row.categoryIds).size > 1);
    const mappedIds = row.categoryIds.map(id => categoryIds.get(id)?.id);
    assert.ok(mappedIds.every(Boolean));
    assert.ok(new Set(mappedIds).size > 1);
    ambiguityRules++;
    continue;
  }
  const original = source.get(row.type)?.get(row.id);
  const seenIds = seen.get(row.type);
  assert.ok(original && !seenIds.has(row.id),
    `Unknown or duplicate vocabulary record ${row.type}/${row.id}`);
  seenIds.add(row.id);
  for (const key of ["groupId", "familyId", "categoryId"]) {
    assert.equal(row[key], original[key], `Vocabulary ancestry mismatch for ${row.id}`);
  }
  assert.ok(Array.isArray(row.terms) && row.terms.every(term => typeof term === "string" && term.trim()));
  if (row.type === "service") {
    const parentId = categoryIds.get(row.categoryId)?.id;
    assert.ok(parentId, `Service has no mapped category: ${row.id}`);
    if (parentId !== row.categoryId) remappedServiceLinks++;
  }
  termOccurrences += row.terms.length;
}
for (const [type, rows] of source) {
  assert.equal(seen.get(type).size, rows.size, `Vocabulary coverage for ${type}`);
}

const db = new DatabaseSync(":memory:");
try {
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_public_catalog.sql", "0010_approved_catalog_hierarchy.sql"]) {
    db.exec(readFileSync(new URL(`../infra/migrations/${name}`, import.meta.url), "utf8"));
  }
  const insertGroup = db.prepare("INSERT INTO catalog_groups(id,name_en,name_hi) VALUES(?,?,?)");
  const insertFamily = db.prepare("INSERT INTO catalog_families(id,group_id,name_en,name_hi) VALUES(?,?,?,?)");
  const insertCategory = db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,sort_order) VALUES(?,?,?,?,?)");
  const insertMembership = db.prepare("INSERT INTO catalog_family_categories(family_id,category_id) VALUES(?,?)");
  for (const row of groups) insertGroup.run(row.id, row.name_en, row.name_hi);
  for (const row of families) insertFamily.run(row.id, row.groupId, row.name_en, row.name_hi);
  for (const row of categories) {
    const { id, slug } = categoryIds.get(row.id);
    insertCategory.run(id, slug, row.name_en, row.name_hi, row.order);
    insertMembership.run(row.familyId, id);
  }
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  const count = (table, where = "1") => db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get().n;
  const stagedCategories = count("categories");
  assert.equal(count("catalog_groups"), groups.length);
  assert.equal(count("catalog_families"), families.length);
  assert.equal(stagedCategories, categories.length);
  assert.equal(count("catalog_family_categories"), stagedCategories);
  assert.equal(count("categories", "is_active=1"), 0);
  assert.equal(count("catalog_groups", "is_active=1 OR is_approved=1"), 0);
  assert.equal(count("catalog_families", "is_active=1 OR is_approved=1"), 0);
  assert.equal(count("catalog_family_categories", "is_approved=1"), 0);

  console.log(JSON.stringify({
    localRehearsal: { groups: groups.length, families: families.length, categories: stagedCategories },
    rehearsalMapping: { ...farmWorkerMapping, remappedServiceLinks },
    checkedVocabulary: { services: services.length, termOccurrences, ambiguityRules },
    productionChanges: 0,
  }, null, 2));
} finally {
  db.close();
}
