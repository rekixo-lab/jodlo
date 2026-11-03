import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localD1Adapter } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession, revokeSession, sessionHash, validSessionToken } from
  "../src/modules/identity/sessions.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { setOwnWorkerAgoraCallPreference } from
  "../src/modules/workers/agora-call-preference.ts";
import { setOwnWorkerAvailability, setOwnAgoraAccountBlock } from
  "../src/modules/interactions/agora-private-safety-state.ts";
import { validOpaqueId } from "../src/modules/shared/identifiers.ts";

/**
 * Cloudflare D1 batch() TRANSACTION SHAPE rehearsal with actual migrations
 * 0001–0008 and two disposable SQLite connections. Every table beginning
 * fake_batch_ exists only in this file, never in production D1. No provider,
 * recovery worker, push, RTC, real presence, rate budget or call metadata.
 *
 * Critical: merely batching TWO conditional INSERT ... SELECT statements
 * is NOT safe. A child SELECT that writes zero rows does not throw, so a
 * naive batch might commit an orphan parent. We force the child INSERT to
 * attempt a NOT NULL constrained write when its proof is absent: this throws
 * and rolls back the *entire* D1-shaped batch. All validity and returned
 * changes remain fail-closed; no JS read/await inside the transaction.
 */
const CALLER = "batch-local-caller-00001";
const WORKER = "batch-local-worker-00001";
const OTHER = "batch-local-other-00001";
const CATEGORY = "batch-local-category";
const CALL = "batch-local-call-000001";
const CALL_ALT = "batch-local-call-000002";
const NONCE = "server-trial-nonce-00000001";
const NONCE_ALT = "server-trial-nonce-00000002";
const WITHHELD = Object.freeze({ kind: "withheld" });
const MIGRATIONS = [
  "0001_public_catalog.sql",
  "0002_shared_accounts_worker_drafts.sql",
  "0003_google_identity_sessions.sql",
  "0004_worker_service_listings.sql",
  "0005_notification_delivery_receipts.sql",
  "0006_notification_dead_letters.sql",
  "0007_worker_agora_call_preferences.sql",
  "0008_agora_private_safety_state.sql",
];

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "jodlo-d1-batch-unsent-"));
  const a = new DatabaseSync(join(dir, "fixture.sqlite"));
  const b = new DatabaseSync(join(dir, "fixture.sqlite"));
  try {
    a.exec("PRAGMA journal_mode=WAL");
    for (const db of [a, b]) {
      db.exec("PRAGMA foreign_keys=ON");
      db.exec("PRAGMA busy_timeout=0");
    }
    for (const name of MIGRATIONS) {
      a.exec(readFileSync(
        new URL("../../../infra/migrations/" + name, import.meta.url),
        "utf8",
      ));
    }
    // A transient, server-owned original write attempt tag is TEST-ONLY.
    // Reusing a tag must never backfill an old/unknown delivery attempt.
    a.exec(
      "CREATE TABLE fake_batch_unsent (" +
      "call_id TEXT PRIMARY KEY,caller_id TEXT NOT NULL REFERENCES accounts(id)," +
      "worker_id TEXT NOT NULL REFERENCES accounts(id)," +
      "listing_id TEXT NOT NULL REFERENCES worker_listings(id)," +
      "consent_revision INTEGER NOT NULL CHECK(consent_revision>=1)," +
      "availability_revision INTEGER NOT NULL CHECK(availability_revision>=1)," +
      "attempt_nonce TEXT NOT NULL UNIQUE," +
      "state TEXT NOT NULL CHECK(state='unsent_test_only'));" +
      "CREATE TABLE fake_batch_recovery (" +
      "call_id TEXT PRIMARY KEY NOT NULL " +
      "REFERENCES fake_batch_unsent(call_id) ON DELETE CASCADE," +
      "attempt_nonce TEXT NOT NULL UNIQUE," +
      "state TEXT NOT NULL CHECK(state='pending_unsent_test_only'))",
    );
    const adapter = localD1Adapter(a);
    for (const id of [CALLER, WORKER, OTHER]) {
      await ensureAccount(adapter, id);
    }
    await optInAsWorker(adapter, WORKER);
    a.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) " +
      "VALUES(?,?,?,?,1)",
    ).run(CATEGORY, CATEGORY, "Fake batch only", "नकली बैच परीक्षण");
    const listing = await publishListing(adapter, WORKER, CATEGORY);
    const caller = (await issueSession(adapter, CALLER))?.accessToken;
    const worker = (await issueSession(adapter, WORKER))?.accessToken;
    const other = (await issueSession(adapter, OTHER))?.accessToken;
    assert.ok(listing && caller && worker && other);
    return {
      a, b, caller, worker, other, listing,
      consent: (enabled, rev) => setOwnWorkerAgoraCallPreference(
        localD1Adapter(b), worker, enabled, rev,
      ),
      availability: (enabled, rev) => setOwnWorkerAvailability(
        localD1Adapter(b), worker, enabled, rev,
      ),
      block: (bearer, target, value = true) => setOwnAgoraAccountBlock(
        localD1Adapter(b), bearer, target, value,
      ),
      close() { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); },
    };
  } catch (error) {
    a.close(); b.close(); rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

const count = (db, table) =>
  db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
const counts = db => [
  count(db, "fake_batch_unsent"), count(db, "fake_batch_recovery"),
];

/** Real current safety predicates are checked by the FIRST statement. */
const FIRST_INSERT =
  "INSERT INTO fake_batch_unsent " +
  "(call_id,caller_id,worker_id,listing_id,consent_revision," +
  "availability_revision,attempt_nonce,state) " +
  "SELECT ?,caller.id,worker.id,listing.id,consent.revision," +
  "availability.revision,?,'unsent_test_only' " +
  "FROM auth_sessions AS s " +
  "JOIN accounts AS caller ON caller.id=s.account_id " +
  "JOIN worker_listings AS listing ON listing.id=? " +
  "JOIN accounts AS worker ON worker.id=listing.worker_account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=worker.id " +
  "JOIN categories AS category ON category.id=listing.category_id " +
  "JOIN worker_agora_call_preferences AS consent " +
  "ON consent.account_id=worker.id AND consent.calls_enabled=1 " +
  "JOIN worker_agora_availability_preferences AS availability " +
  "ON availability.account_id=worker.id AND availability.accepting_calls=1 " +
  "WHERE s.token_hash=? AND s.expires_at>? " +
  "AND caller.status='active' AND worker.status='active' " +
  "AND caller.id<>worker.id AND profile.status='draft' " +
  "AND listing.status='published' AND listing.moderation_status='allowed' " +
  "AND category.is_active=1 " +
  "AND consent.revision=? AND availability.revision=? " +
  "AND NOT EXISTS(SELECT 1 FROM agora_account_blocks AS block " +
  "WHERE (block.blocker_account_id=caller.id " +
  "AND block.blocked_account_id=worker.id) " +
  "OR (block.blocker_account_id=worker.id " +
  "AND block.blocked_account_id=caller.id))";

/**
 * The SECOND statement is deliberately a VALUES INSERT whose scalar
 * subquery may be NULL. A missing current proof then fails the NOT NULL
 * constraint and ROLLS BACK the first write rather than committing an
 * orphan. The scalar subquery binds the same OWN caller session, original
 * consent/availability revisions, listing owner, category and mutual blocks.
 * A new per-attempt nonce prevents attaching an old orphan on a fresh try.
 *
 * This is a local architecture candidate, NOT a production outbox.
 */
const SECOND_INSERT =
  "INSERT INTO fake_batch_recovery(call_id,attempt_nonce,state) " +
  "VALUES((SELECT intent.call_id FROM fake_batch_unsent AS intent " +
  "JOIN auth_sessions AS s ON s.account_id=intent.caller_id " +
  "JOIN accounts AS caller ON caller.id=intent.caller_id " +
  "JOIN accounts AS worker ON worker.id=intent.worker_id " +
  "JOIN worker_listings AS listing ON listing.id=intent.listing_id " +
  "AND listing.worker_account_id=worker.id " +
  "JOIN worker_profiles AS profile ON profile.account_id=worker.id " +
  "JOIN categories AS category ON category.id=listing.category_id " +
  "JOIN worker_agora_call_preferences AS consent " +
  "ON consent.account_id=worker.id AND consent.calls_enabled=1 " +
  "AND consent.revision=intent.consent_revision " +
  "JOIN worker_agora_availability_preferences AS availability " +
  "ON availability.account_id=worker.id AND availability.accepting_calls=1 " +
  "AND availability.revision=intent.availability_revision " +
  "WHERE intent.call_id=? AND intent.attempt_nonce=? " +
  "AND s.token_hash=? AND s.expires_at>? " +
  "AND caller.status='active' AND worker.status='active' " +
  "AND caller.id<>worker.id AND profile.status='draft' " +
  "AND listing.status='published' AND listing.moderation_status='allowed' " +
  "AND category.is_active=1 " +
  "AND NOT EXISTS(SELECT 1 FROM agora_account_blocks AS block " +
  "WHERE (block.blocker_account_id=caller.id " +
  "AND block.blocked_account_id=worker.id) " +
  "OR (block.blocker_account_id=worker.id " +
  "AND block.blocked_account_id=caller.id)))," +
  "?,'pending_unsent_test_only')";

async function stageBatchOnly(f, {
  db = f.a, bearer = f.caller, callId = CALL, nonce = NONCE,
  expectedConsentRevision = 1, expectedAvailabilityRevision = 1,
} = {}) {
  if (!validSessionToken(bearer) || !validOpaqueId(callId) ||
      typeof nonce !== "string" || !/^server-trial-nonce-[0-9]{8}$/.test(nonce) ||
      !Number.isSafeInteger(expectedConsentRevision) ||
      expectedConsentRevision < 1 || expectedConsentRevision > 2147483647 ||
      !Number.isSafeInteger(expectedAvailabilityRevision) ||
      expectedAvailabilityRevision < 1 ||
      expectedAvailabilityRevision > 2147483647) return WITHHELD;
  const tokenDigest = await sessionHash(bearer);
  const now = Math.floor(Date.now() / 1000);
  const adapter = localD1Adapter(db);
  try {
    const results = await adapter.batch([
      adapter.prepare(FIRST_INSERT).bind(
        callId, nonce, f.listing.id, tokenDigest, now,
        expectedConsentRevision, expectedAvailabilityRevision,
      ),
      adapter.prepare(SECOND_INSERT).bind(
        callId, nonce, tokenDigest, now, nonce,
      ),
    ]);
    // Cloudflare's D1 returns meta.changes; local facade returns SQLite .changes.
    // Do not infer "success" merely because the batch Promise resolved.
    const oneChange = result =>
      result?.meta?.changes === 1 || result?.changes === 1;
    return results.length === 2 && results.every(oneChange)
      ? Object.freeze({ kind: "paired_unsent_test_only" }) : WITHHELD;
  } catch {
    return WITHHELD; // DB error, integrity failure or contention: no retry grant.
  }
}

async function enable(f) {
  assert.equal((await f.consent(true, 0)).kind, "updated");
  assert.equal((await f.availability(true, 0)).kind, "updated");
}

test("D1-shaped batch atomically inserts one fake parent and child under real default-OFF safety", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await stageBatchOnly(f), WITHHELD);
    assert.deepEqual(counts(f.b), [0, 0]);
    assert.equal((await f.consent(true, 0)).kind, "updated");
    assert.deepEqual(await stageBatchOnly(f), WITHHELD);
    assert.deepEqual(counts(f.a), [0, 0]);
    assert.equal((await f.availability(true, 0)).kind, "updated");
    assert.deepEqual(await stageBatchOnly(f),
      { kind: "paired_unsent_test_only" });
    assert.deepEqual(counts(f.b), [1, 1]);
    const parent = f.b.prepare("SELECT * FROM fake_batch_unsent").get();
    const child = f.b.prepare("SELECT * FROM fake_batch_recovery").get();
    assert.equal(parent.call_id, child.call_id);
    assert.equal(parent.attempt_nonce, child.attempt_nonce);
    assert.equal(parent.consent_revision, 1);
    assert.equal(parent.availability_revision, 1);
    assert.equal(parent.state, "unsent_test_only");
    assert.equal(child.state, "pending_unsent_test_only");
    assert.equal(JSON.stringify([parent, child]).includes(f.caller), false);
    assert.equal(JSON.stringify([parent, child]).includes(f.worker), false);
  } finally { f.close(); }
});

test("duplicate or forged batch attempts cannot be mistaken for an idempotent send", async () => {
  const f = await fixture();
  try {
    await enable(f);
    assert.equal((await stageBatchOnly(f)).kind, "paired_unsent_test_only");
    for (const attempt of [
      {}, { nonce: NONCE_ALT }, { bearer: f.other, nonce: NONCE_ALT },
      { bearer: f.worker, nonce: NONCE_ALT },
      { callId: CALL_ALT, nonce: NONCE },
      { callId: CALL_ALT, nonce: "attacker" },
      { callId: CALL_ALT, expectedConsentRevision: 2 },
    ]) {
      assert.deepEqual(await stageBatchOnly(f, attempt), WITHHELD);
    }
    assert.deepEqual(counts(f.b), [1, 1]);
  } finally { f.close(); }
});

test("batch rollback before and after the fake child insert protects the original parent", async () => {
  for (const timing of ["BEFORE", "AFTER"]) {
    const f = await fixture();
    try {
      await enable(f);
      f.a.exec(
        "CREATE TRIGGER fake_batch_fail_child " + timing +
        " INSERT ON fake_batch_recovery BEGIN " +
        "SELECT RAISE(ABORT,'synthetic recovery child failure'); END",
      );
      assert.deepEqual(await stageBatchOnly(f), WITHHELD, timing);
      assert.deepEqual(counts(f.b), [0, 0], timing);
      f.a.exec("DROP TRIGGER fake_batch_fail_child");
      assert.equal((await stageBatchOnly(f, { db: f.b })).kind,
        "paired_unsent_test_only");
      assert.deepEqual(counts(f.a), [1, 1]);
    } finally { f.close(); }
  }
});

test("an old orphan intent cannot be silently backfilled by a new batch attempt", async () => {
  const f = await fixture();
  try {
    await enable(f);
    const digest = await sessionHash(f.caller);
    // Test-only injection mimics a damaged restore from a two-write system.
    f.a.prepare(FIRST_INSERT).run(
      CALL, NONCE, f.listing.id, digest, Math.floor(Date.now() / 1000), 1, 1,
    );
    assert.deepEqual(counts(f.b), [1, 0]);
    assert.deepEqual(await stageBatchOnly(f, { nonce: NONCE_ALT }), WITHHELD);
    assert.deepEqual(counts(f.a), [1, 0],
      "duplicate parent must abort rather than repair an orphan child");
    assert.deepEqual(await stageBatchOnly(f, { nonce: NONCE }), WITHHELD);
    assert.deepEqual(counts(f.b), [1, 0]);
  } finally { f.close(); }
});

test("both block directions and revoked sessions deny a batch without partial writes", async () => {
  for (const actor of ["worker", "caller"]) {
    const f = await fixture();
    try {
      await enable(f);
      const bearer = actor === "worker" ? f.worker : f.caller;
      const target = actor === "worker" ? CALLER : WORKER;
      assert.equal((await f.block(bearer, target)).kind, "updated");
      assert.deepEqual(await stageBatchOnly(f), WITHHELD);
      assert.deepEqual(counts(f.b), [0, 0]);
    } finally { f.close(); }
  }
  const f = await fixture();
  try {
    await enable(f);
    assert.equal((await revokeSession(localD1Adapter(f.b), f.caller)), true);
    assert.deepEqual(await stageBatchOnly(f), WITHHELD);
    assert.deepEqual(counts(f.a), [0, 0]);
  } finally { f.close(); }
});

test("OFF->ON consent and availability epoch mismatch cannot create a batch pair", async () => {
  const f = await fixture();
  try {
    await enable(f);
    assert.equal((await f.consent(false, 1)).kind, "updated");
    assert.equal((await f.consent(true, 2)).kind, "updated");
    assert.equal((await f.availability(false, 1)).kind, "updated");
    assert.equal((await f.availability(true, 2)).kind, "updated");
    assert.deepEqual(await stageBatchOnly(f), WITHHELD);
    assert.deepEqual(counts(f.b), [0, 0]);
    assert.equal((await stageBatchOnly(f, {
      expectedConsentRevision: 3, expectedAvailabilityRevision: 3,
    })).kind, "paired_unsent_test_only");
    assert.deepEqual(counts(f.a), [1, 1]);
  } finally { f.close(); }
});

test("independent SQLite writers cannot interleave a D1-shaped transaction", async () => {
  const f = await fixture();
  try {
    await enable(f);
    f.a.exec("BEGIN IMMEDIATE");
    try {
      assert.deepEqual(await stageBatchOnly(f, { db: f.b }), WITHHELD);
      assert.deepEqual(counts(f.a), [0, 0]);
    } finally { f.a.exec("ROLLBACK"); }
    assert.equal((await stageBatchOnly(f, { db: f.b })).kind,
      "paired_unsent_test_only");
    assert.deepEqual(await stageBatchOnly(f, { db: f.a }), WITHHELD);
    assert.deepEqual(counts(f.a), [1, 1]);
    assert.deepEqual(f.a.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { f.close(); }
});

test("local batch architecture never creates real D1 call tables or any provider operation", async () => {
  const f = await fixture();
  try {
    const names = f.a.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' " +
      "AND name LIKE 'fake_batch_%'",
    ).all().map(x => x.name).sort();
    assert.deepEqual(names, ["fake_batch_recovery", "fake_batch_unsent"]);
    assert.equal(FIRST_INSERT.includes("BEGIN"), false);
    assert.equal(SECOND_INSERT.includes("COMMIT"), false);
    assert.deepEqual(counts(f.a), [0, 0]);
    assert.equal(f.a.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' " +
      "AND name LIKE 'agora_call_%'",
    ).get().n, 0);
  } finally { f.close(); }
});
