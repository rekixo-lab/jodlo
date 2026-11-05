import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Keep code/build, owner-observed live state, and release approval as separate facts.
// This validates a human-maintained evidence snapshot; it deliberately NEVER
// infers that CI, a checked-in migration, or an old phone test is a fresh deployment.
export function parseCurrentLedger(markdown) {
  const block = markdown.match(/<!-- JODLO_STATE_LEDGER_V1\n([\s\S]*?)\n-->/);
  assert.ok(block, "Missing versioned current-state evidence block");
  const fields = Object.create(null);
  for (const raw of block[1].split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^([a-z][a-z0-9_]*): ([a-zA-Z0-9_-]+)$/);
    assert.ok(match, "Malformed evidence field: " + line);
    const [, key, value] = match;
    assert.ok(!(key in fields), "Duplicate current-state field: " + key);
    fields[key] = value;
  }
  const required = [
    "as_of_date", "source_main_sha", "source_ci", "live_api", "live_auth",
    "live_catalog", "migration_0009", "human_catalog_signoffs",
    "full_marketplace", "final_physical_phone_acceptance",
  ];
  assert.deepEqual(Object.keys(fields).sort(), [...required].sort(),
    "Current-state fields require explicit scope; update guard with any schema change");
  assert.match(fields.as_of_date, /^20\d\d-\d\d-\d\d$/);
  assert.match(fields.source_main_sha, /^[a-f0-9]{40}$/);
  assert.equal(fields.source_ci, "verified_success");
  assert.equal(fields.live_api, "owner_verified_2026-11-03_current_version_unverified");
  assert.equal(fields.live_auth, "owner_verified_2026-11-03_current_version_unverified");
  assert.equal(fields.live_catalog, "zero_at_last_owner_read_not_freshly_rechecked");
  assert.equal(fields.migration_0009, "local_only_production_unverified");
  assert.equal(fields.human_catalog_signoffs, "zero_at_last_review");
  assert.equal(fields.full_marketplace, "not_ready");
  assert.equal(fields.final_physical_phone_acceptance, "deferred_not_waived");
  assert.ok(markdown.includes("https://github.com/rekixo-lab/jodlo/commit/" +
    fields.source_main_sha), "Committed code SHA lacks clickable evidence");
  for (const fact of [
    "41956079039", "41956078782", "#235", "#221", "0001–0008",
    "889 Categories", "7,267 Services", "2026-11-03",
    "not a fresh Cloudflare/phone probe", "one consolidated",
    "do not deploy", "Finworkar",
  ]) {
    assert.ok(markdown.toLowerCase().includes(fact.toLowerCase()),
      "Current state missing evidence/boundary: " + fact);
  }
  return fields;
}

export function validateHandoffPrecedence(files) {
  // All three common entry points MUST put the current evidence source before
  // the many dated, superseded "first deployment pending" paragraphs.
  for (const [path, href] of Object.entries({
    "README.md": "docs/CURRENT_STATE.md",
    "docs/AI_HANDOFF.md": "CURRENT_STATE.md",
    "docs/RELEASE_READINESS.md": "CURRENT_STATE.md",
  })) {
    const content = files[path];
    assert.equal(typeof content, "string", "Missing entry point " + path);
    const first = content.slice(0, 850);
    assert.ok(first.includes("](" + href + ")"),
      path + " must link CURRENT_STATE within first 850 chars");
    assert.match(first, /supersed|historical|old|पुराने/i,
      path + " must identify historical state as superseded");
  }
  for (const path of ["docs/STATUS.md", "docs/ROADMAP.md"]) {
    const text = files[path];
    assert.equal(typeof text, "string", "Missing source " + path);
    assert.ok(text.slice(0, 5500).includes("2026-11-05") &&
      text.slice(0, 5500).includes("Worker"),
      path + " must retain latest software checkpoint");
  }
}

export async function verifyCurrentState(root) {
  const paths = [
    "docs/CURRENT_STATE.md", "README.md", "docs/AI_HANDOFF.md",
    "docs/RELEASE_READINESS.md", "docs/STATUS.md", "docs/ROADMAP.md",
  ];
  const files = Object.fromEntries(await Promise.all(paths.map(async path =>
    [path, await readFile(join(root, path), "utf8")])));
  const fields = parseCurrentLedger(files["docs/CURRENT_STATE.md"]);
  validateHandoffPrecedence(files);
  process.stdout.write("JODLO evidence ledger verified: " + fields.as_of_date +
    " source " + fields.source_main_sha.slice(0, 12) +
    "; deployment/phone gates remain separate.\n");
}
