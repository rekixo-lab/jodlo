import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCurrentLedger, validateHandoffPrecedence } from "./verify-current-state.mjs";

const fixture = await readFile(new URL("../docs/CURRENT_STATE.md", import.meta.url), "utf8");

test("a dated code snapshot and provider evidence remain separate", () => {
  const result = parseCurrentLedger(fixture);
  assert.equal(result.full_marketplace, "not_ready");
  assert.equal(result.migration_0009, "local_only_production_unverified");
  assert.match(result.source_main_sha, /^[0-9a-f]{40}$/);
});

test("a PR or CI cannot silently turn unknown production migration into done", () => {
  assert.throws(() => parseCurrentLedger(
    fixture.replace("local_only_production_unverified", "production_verified")),
    /local_only_production_unverified/);
});

test("human/catalog approval cannot be inferred from ready source worksheets", () => {
  assert.throws(() => parseCurrentLedger(
    fixture.replace("zero_at_last_review", "approved")),
    /zero_at_last_review/);
});

test("real API verification cannot be relabeled latest without new evidence and guard update", () => {
  assert.throws(() => parseCurrentLedger(
    fixture.replace("owner_verified_2026-11-03_current_version_unverified", "latest_main_deployed")),
    /owner_verified_2026-11-03_current_version_unverified/);
});

test("malformed or duplicated evidence facts fail closed", () => {
  assert.throws(() => parseCurrentLedger(
    fixture.replace("source_ci: verified_success", "source_ci: verified_success\nsource_ci: verified_success")),
    /Duplicate current-state field/);
  assert.throws(() => parseCurrentLedger(fixture.replace("JODLO_STATE_LEDGER_V1", "OLD_LEDGER")),
    /Missing versioned/);
});

test("handoff documents must link latest evidence ahead of historical instructions", () => {
  const valid = {
    "README.md": "# JODLO\nCurrent [verified status](docs/CURRENT_STATE.md); supersedes historical notes.",
    "docs/AI_HANDOFF.md": "[verified status](CURRENT_STATE.md) supersedes historical notes.",
    "docs/RELEASE_READINESS.md": "[verified status](CURRENT_STATE.md) supersedes old notes.",
    "docs/STATUS.md": "2026-11-05 — Worker status",
    "docs/ROADMAP.md": "2026-11-05 — Worker milestone",
  };
  assert.doesNotThrow(() => validateHandoffPrecedence(valid));
  assert.throws(() => validateHandoffPrecedence({
    ...valid, "docs/AI_HANDOFF.md": "First deploy pending. " + "x".repeat(1000) +
      "\n[verified status](CURRENT_STATE.md) supersedes historical notes.",
  }), /docs\/AI_HANDOFF.md/);
});
