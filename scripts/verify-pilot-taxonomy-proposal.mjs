/** Reference-only pilot review guard. Never import into Worker or seed D1. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bytes = gunzipSync(readFileSync(join(root,
  "docs/reference/data/finworkar-catalog-bilingual-2026-10-27.json.gz")));
const source = JSON.parse(bytes.toString("utf8"));
const proposal = JSON.parse(readFileSync(join(root,
  "docs/reference/data/jodlo-pilot-candidates-2026-10-27.json"), "utf8"));
const sets = ["pilotCandidateCategoryIds", "needsExtraReviewCategoryIds", "holdCategoryIds"];
const latin = /[A-Za-z]/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
assert.deepEqual(Object.keys(proposal),
  ["kind", "state", "sourceJsonSha256", "languages", ...sets],
  "Manifest may never acquire deployment, seed or approval fields");
assert.equal(proposal.kind, "JODLO_UNAPPROVED_TAXONOMY_REVIEW_ONLY");
assert.equal(proposal.state, "FOUNDER_DECISION_REQUIRED_NO_D1_SEED");
assert.deepEqual(proposal.languages, ["en", "hi"]);
assert.deepEqual(source.languagePolicy, ["en", "hi"]);
assert.equal(createHash("sha256").update(bytes).digest("hex"), proposal.sourceJsonSha256);
const { groups, families, categories, services } = source.collections;
const groupMap = new Map(groups.map(g => [g.id, g]));
const familyMap = new Map(families.map(f => [f.id, f]));
const categoryMap = new Map(categories.map(c => [c.id, c]));
const byCategory = new Map();
for (const service of services) {
  assert.ok(categoryMap.has(service.categoryId), "Orphan service " + service.id);
  if (!byCategory.has(service.categoryId)) byCategory.set(service.categoryId, []);
  byCategory.get(service.categoryId).push(service);
}
const mixedServices = services.filter(service => latin.test(service.name_hi));
assert.equal(mixedServices.length, 4928, "Unexpected Hindi mixed-script service count");
assert.equal(new Set(mixedServices.map(service => service.categoryId)).size, 616,
  "Unexpected count of categories needing Hindi review");
for (const [name, rows] of [["groups", groups], ["families", families], ["categories", categories]])
  assert.equal(rows.filter(item => latin.test(item.name_hi)).length, 0,
    "Unexpected mixed-script Hindi ancestor labels: " + name);
const all = new Set();
for (const key of sets) {
  assert.ok(Array.isArray(proposal[key]) && proposal[key].length > 0, "Missing tier " + key);
  for (const id of proposal[key]) {
    assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(id) && !all.has(id),
      "Unsafe or repeated candidate ID " + id);
    all.add(id);
    const category = categoryMap.get(id);
    assert.ok(category, "Missing legacy category " + id);
    const family = familyMap.get(category.familyId);
    const group = groupMap.get(category.groupId);
    assert.ok(family && group && family.groupId === category.groupId,
      "Broken candidate ancestry " + id);
    assert.ok(category.active === true && category.selectable === true &&
      family.active === true && group.active === true, "Inactive candidate " + id);
    assert.ok(category.name_en.trim() && category.name_hi.trim() &&
      !latin.test(category.name_hi), "Unreviewed bilingual category label " + id);
    const leaves = byCategory.get(id) ?? [];
    assert.ok(leaves.length && leaves.length === category.serviceCount,
      "Unexpected service children " + id);
    if (key === "pilotCandidateCategoryIds") {
      assert.equal(group.status, "active", "Conflicting parent status " + id);
      assert.equal(category.status, "active", "Conflicting category status " + id);
      assert.ok(["standard", "skilled_trade"].includes(category.safetyTier),
        "First wave contains an elevated historical tier: " + id);
      assert.equal(leaves.filter(s => latin.test(s.name_hi)).length, 0,
        "Mixed-script Hindi leaves require cleanup before first-wave review " + id);
    }
  }
}
assert.equal(proposal.pilotCandidateCategoryIds.length, 10);
assert.equal(groupMap.get("education-advisory").status, "disabled_needs_population");
assert.equal(own(groupMap.get("environment-utilities"), "status"), false);
assert.ok(categoryMap.has("farmer-helper-मजदूर"),
  "Do not silently rename original invalid category ID");

// Founder selected exactly two **city names**, not city boundaries, personal location
// consent, active catalog categories or permission to deploy.
const cityScope = JSON.parse(readFileSync(join(root,
  "docs/reference/data/jodlo-pilot-cities-2026-10-27.json"), "utf8"));
assert.deepEqual(Object.keys(cityScope), ["kind", "decision", "languages", "cities"],
  "City scope must not carry coordinates, personal-data or rollout settings");
assert.equal(cityScope.kind, "JODLO_FOUNDER_SELECTED_PILOT_CITIES_REFERENCE_ONLY");
assert.equal(cityScope.decision,
  "FOUNDER_APPROVED_CITY_NAMES_ONLY_NOT_CATEGORIES_OR_AREAS");
assert.deepEqual(cityScope.languages, ["en", "hi"]);
assert.ok(Array.isArray(cityScope.cities));
assert.deepEqual(cityScope.cities.map(city => city.id), ["bilaspur", "raipur"]);
for (const city of cityScope.cities) {
  assert.deepEqual(Object.keys(city), ["id", "name_en", "name_hi"],
    "No coordinates, phone, address, ward, third locale or rollout details allowed");
  assert.match(city.name_en, /^[A-Za-z]+$/);
  assert.match(city.name_hi, /^[\u0900-\u097F]+$/);
}
console.log("JODLO founder-selected city names verified: Bilaspur and Raipur; no geography/PII/active categories.");

console.log("JODLO taxonomy proposal checked: 10 unapproved candidates; 4928/7267 Hindi service names have Latin letters in 616 categories; no D1 seed.");
