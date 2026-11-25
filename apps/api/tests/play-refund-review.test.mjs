import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { issueSession, sessionHash } from "../src/modules/identity/sessions.ts";
import { stageTrustedPlayConsumable } from "../src/modules/interactions/play-consumable-outbox.ts";
import { recordTrustedPlayRevocation } from "../src/modules/interactions/google-play-rtdn-fences.ts";
import { recordTrustedCallCreditEvent } from "../src/modules/interactions/private-call-credits.ts";
import { configuredPlayRefundPolicy, registerPlayRefundPolicy, readOwnRefundReviewSummary,
  releaseReviewedPlayRefundHold, listReviewedPlayRefundCases, refundReviewDemandSql,
} from "../src/modules/interactions/play-refund-review.ts";

const OWNER = "refund-review-owner";
const OTHER = "refund-review-other";
const HASH = "1".repeat(64);
const POLICY = {version: "jodlo-play-refund-hold-v1", approvalSha256: "a".repeat(64)};
const PRODUCTS = new Map([["jodlo.minutes5", 5]]);
const count = (db, name) => db.prepare("SELECT COUNT(*) AS n FROM " + name).get().n;

async function fixture() {
  const f = openLocalDatabase();
  f.db.exec(`INSERT INTO accounts(id) VALUES ('${OWNER}'),('${OTHER}')`);
  f.bearer = (await issueSession(f.adapter, OWNER)).accessToken;
  f.other = (await issueSession(f.adapter, OTHER)).accessToken;
  f.now = Date.now();
  f.authority = {sessionHash: await sessionHash(f.bearer), policyVersion: "jodlo-play-minutes-v1",
    approvalSha256: "b".repeat(64), purchasedAtMs: f.now - 1000};
  f.grant = (hash = HASH) => stageTrustedPlayConsumable(f.adapter, {
    accountId: OWNER, sourceKeyHash: hash, productId: "jodlo.minutes5", seconds: 300, createdAtMs: f.now,
  }, PRODUCTS, f.authority);
  f.fence = (hash = HASH) => recordTrustedPlayRevocation(f.adapter, {
    sourceKeyHash: hash, reason: "voided_purchase", recordedAtMs: f.now + 1,
  });
  f.summary = () => readOwnRefundReviewSummary(f.adapter, f.bearer);
  f.spend = (seconds, hash = "2".repeat(64)) => recordTrustedCallCreditEvent(f.adapter, {
    accountId: OWNER, sourceKeyHash: hash, kind: "verified_usage", seconds, createdAtMs: f.now + 2,
  });
  f.rawBalance = () => f.db.prepare("SELECT available_seconds FROM call_credit_balances WHERE account_id=?").get(OWNER).available_seconds;
  return f;
}

test("refund policy stays absent by default; explicit approval registers once and backfills verified grants only", async () => {
  const f = await fixture();
  try {
    assert.equal(configuredPlayRefundPolicy({}), null);
    assert.equal(configuredPlayRefundPolicy({PLAY_REFUND_HOLDS_ENABLED: "1"}), null);
    assert.equal(count(f.db, "play_refund_policy"), 0);
    await f.grant(); await f.fence();
    assert.equal(count(f.db, "play_refund_reviews"), 0, "migration itself grants no economic-policy approval");
    assert.equal(await registerPlayRefundPolicy(f.adapter, POLICY, f.now + 3), true);
    assert.equal(count(f.db, "play_refund_policy"), 1);
    assert.equal(count(f.db, "play_refund_reviews"), 1);
    assert.equal(await registerPlayRefundPolicy(f.adapter, POLICY, f.now + 4), true);
    assert.equal(count(f.db, "play_refund_reviews"), 1);
    assert.equal(await registerPlayRefundPolicy(f.adapter, {...POLICY, approvalSha256: "c".repeat(64)}, f.now + 5), false);
    assert.equal(f.db.prepare("SELECT approval_hash FROM play_refund_policy").get().approval_hash, POLICY.approvalSha256);
    assert.throws(() => refundReviewDemandSql("a.id;DELETE FROM accounts"), /Invalid/);
  } finally { f.db.close(); }
});

test("confirmed revocation reserves unspent seconds atomically, without a debit, negative balance or debt", async () => {
  const f = await fixture();
  try {
    await registerPlayRefundPolicy(f.adapter, POLICY, f.now);
    await f.grant(); await f.fence();
    assert.deepEqual(await f.summary(), {openCases: 1, heldSeconds: 300, uncoveredSeconds: 0});
    assert.equal(f.rawBalance(), 300);
    assert.equal(count(f.db, "call_credit_events"), 1, "review is not a financial debit");
    await assert.rejects(f.spend(1), /CALL_SECONDS_RESERVED/);
    assert.equal(await f.grant("3".repeat(64)), "denied", "a new grant cannot be hidden inside an unresolved hold");
    assert.deepEqual(await readOwnRefundReviewSummary(f.adapter, f.other),
      {openCases: 0, heldSeconds: 0, uncoveredSeconds: 0});
    assert.equal(await readOwnRefundReviewSummary(f.adapter, "not-a-session"), null);
    const queue = await listReviewedPlayRefundCases(f.adapter, POLICY);
    assert.equal(queue.cases.length, 1);
    assert.deepEqual(queue.cases[0], {caseId: HASH, accountId: OWNER, seconds: 300,
      reason: "voided_purchase", openedAtMs: f.now + 1,
      accountHeldSeconds: 300, accountUncoveredSeconds: 0});
    assert.equal(queue.nextCursor, null);
  } finally { f.db.close(); }
});

test("partly used credits reserve the current balance only and expose an uncovered review amount", async () => {
  const f = await fixture();
  try {
    await registerPlayRefundPolicy(f.adapter, POLICY, f.now);
    await f.grant(); await f.spend(180); await f.fence();
    assert.equal(f.rawBalance(), 120);
    assert.deepEqual(await f.summary(), {openCases: 1, heldSeconds: 120, uncoveredSeconds: 180});
    await assert.rejects(f.spend(1, "4".repeat(64)), /CALL_SECONDS_RESERVED/);
    assert.equal(f.rawBalance(), 120);
    assert.equal(count(f.db, "call_credit_events"), 2);
  } finally { f.db.close(); }
});

test("preexisting verified call reservation has priority; forged direct usage cannot bypass refund holds", async () => {
  const f = await fixture();
  try {
    await registerPlayRefundPolicy(f.adapter, POLICY, f.now);
    await f.grant();
    const invitation = "11111111-2222-4333-8444-555555555555";
    const usageHash = "5".repeat(64);
    f.db.prepare("INSERT INTO call_usage_sessions(invitation_id,caller_account_id,receiver_account_id," +
      "policy_version,approval_hash,source_key_hash,reserved_seconds,authorized_from_ms,authorized_until_ms,settle_after_ms) " +
      "VALUES(?,?,?,'agora-overlap-v1',?,?,60,?,?,?)")
      .run(invitation, OWNER, OTHER, "e".repeat(64), usageHash, f.now, f.now + 60000, f.now + 120000);
    await f.fence();
    assert.deepEqual(await f.summary(), {openCases: 1, heldSeconds: 240, uncoveredSeconds: 60});
    assert.throws(() => f.db.prepare("INSERT INTO call_credit_events(id,account_id,source_key_hash,kind,seconds,created_at_ms) " +
      "VALUES(?,?,?,'verified_usage',30,?)").run(invitation, OWNER, usageHash, f.now + 120000),
      /CALL_SECONDS_RESERVED/, "an active call is not a settled, measured-use authorization");
    // Models the trusted module's one-statement, provider-verified transition.
    f.db.prepare("UPDATE call_usage_sessions SET state='settled',charged_seconds=30,settled_at_ms=? WHERE invitation_id=?")
      .run(f.now + 120000, invitation);
    assert.equal(f.rawBalance(), 270);
    assert.deepEqual(await f.summary(), {openCases: 1, heldSeconds: 270, uncoveredSeconds: 30});
    assert.throws(() => f.db.prepare("INSERT INTO call_credit_events(id,account_id,source_key_hash,kind,seconds,created_at_ms) " +
      "VALUES(?,?,?,'verified_usage',30,?)").run(invitation, OWNER, "6".repeat(64), f.now + 120000),
      /CALL_SECONDS_RESERVED/, "copying a call id cannot authorize a different event digest");
    assert.throws(() => f.db.prepare("INSERT INTO call_credit_events(id,account_id,source_key_hash,kind,seconds,created_at_ms) " +
      "VALUES(?,?,?,'verified_usage',30,?)").run(invitation, OWNER, usageHash, f.now + 120000),
      /UNIQUE/, "even an exact copied settled event cannot debit twice");
    assert.equal(f.rawBalance(), 270);
  } finally { f.db.close(); }
});

test("operator release requires reviewed immutable evidence, replays safely and never regrants a voided purchase", async () => {
  const f = await fixture();
  try {
    await registerPlayRefundPolicy(f.adapter, POLICY, f.now);
    await f.grant(); await f.fence();
    const resolution = {sourceKeyHash: HASH, policy: POLICY,
      resolutionEvidenceHash: "d".repeat(64), resolvedAtMs: f.now + 20};
    assert.equal(await releaseReviewedPlayRefundHold(f.adapter, {...resolution, resolutionEvidenceHash: ""}), "denied");
    assert.equal(await releaseReviewedPlayRefundHold(f.adapter, {...resolution, policy: {...POLICY, approvalSha256: "f".repeat(64)}}), "denied");
    assert.equal(await releaseReviewedPlayRefundHold(f.adapter, resolution), "applied");
    assert.equal(await releaseReviewedPlayRefundHold(f.adapter, resolution), "replay");
    assert.equal(await releaseReviewedPlayRefundHold(f.adapter, {...resolution, resolutionEvidenceHash: "e".repeat(64)}), "denied");
    assert.deepEqual(await f.summary(), {openCases: 0, heldSeconds: 0, uncoveredSeconds: 0});
    assert.equal(f.rawBalance(), 300);
    assert.equal(count(f.db, "call_credit_events"), 1);
    assert.equal(await f.grant(), "void_hold", "support cannot remove the source-key revocation");
    await f.fence(); await registerPlayRefundPolicy(f.adapter, POLICY, f.now + 30);
    assert.equal(f.db.prepare("SELECT state FROM play_refund_reviews").get().state, "released");
    assert.equal(count(f.db, "play_refund_reviews"), 1);
    assert.throws(() => f.db.prepare("UPDATE play_refund_reviews SET state='open'").run(), /IMMUTABLE/);
    assert.throws(() => f.db.prepare("UPDATE play_refund_reviews SET resolution_evidence_hash=?").run("f".repeat(64)), /IMMUTABLE/);
    assert.equal((await listReviewedPlayRefundCases(f.adapter, POLICY)).cases.length, 0);
  } finally { f.db.close(); }
});

test("review records cascade with account erasure while global provider-revocation protection remains", async () => {
  const f = await fixture();
  try {
    await registerPlayRefundPolicy(f.adapter, POLICY, f.now);
    await f.grant(); await f.fence();
    f.db.prepare("DELETE FROM accounts WHERE id=?").run(OWNER);
    assert.equal(count(f.db, "play_refund_reviews"), 0);
    assert.equal(count(f.db, "play_consume_outbox"), 0);
    assert.equal(count(f.db, "play_revocation_fences"), 1);
    assert.equal(await f.summary(), null);
  } finally { f.db.close(); }
});
