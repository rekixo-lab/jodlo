import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localD1Adapter } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession, sessionHash } from "../src/modules/identity/sessions.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { setOwnWorkerAgoraCallPreference } from
  "../src/modules/workers/agora-call-preference.ts";
import {
  readLocalCallerAgoraSafetyFacts,
  setOwnAgoraAccountBlock,
  setOwnWorkerAvailability,
} from "../src/modules/interactions/agora-private-safety-state.ts";

/**
 * DISPOSABLE, TWO-CONNECTION SQLITE SAFETY-CIRCUIT EXPERIMENT ONLY.
 *
 * A failed/overflowed hypothetical pair-history writer must not silently
 * permit an old invite. Conversely, coupling a user-facing BLOCK action to
 * an unavailable pair ledger could make blocking impossible. This experiment
 * rehearses a TRUSTED, GLOBAL, ONE-WAY CONTACT SHUTDOWN BEFORE falling back
 * to the unchanged owner-authenticated real D1 block writer.
 *
 * A trusted shutdown is not a user-accessible toggle, nor a production
 * implementation of online status, rate quotas, RTC, provider reconciliation,
 * historic block storage, replication, backup/restore or call delivery.
 *
 * Contact is HALTED for everyone after the fake circuit trips (including
 * unrelated users), until an external privacy/architecture review. Every
 * row beginning fake_ exists only in temporary local SQLite.
 */
const CALLER = "fuse-local-caller-000001";
const WORKER = "fuse-local-worker-000001";
const OTHER = "fuse-local-other-000001";
const CATEGORY = "fuse-local-category";
const CALL = "fuse-local-call-000001";
const CALL2 = "fuse-local-call-000002";
const WITHHELD = Object.freeze({ kind: "withheld_test_only" });
const DENIED = Object.freeze({ kind: "denied" });
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
  const dir = mkdtempSync(join(tmpdir(), "jodlo-fuse-proof-"));
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
    a.exec(
      "CREATE TABLE fake_contact_circuit (" +
      "singleton INTEGER PRIMARY KEY CHECK(singleton=1)," +
      "mode TEXT NOT NULL CHECK(mode IN (" +
      "'open_test_only','halted_test_only')));" +
      "INSERT INTO fake_contact_circuit VALUES(1,'open_test_only');" +
      "CREATE TABLE fake_pair_epoch (" +
      "lower_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE," +
      "upper_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE," +
      "revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647)," +
      "CHECK(lower_id < upper_id),PRIMARY KEY(lower_id,upper_id));" +
      "CREATE TABLE fake_contact_intents (" +
      "call_id TEXT PRIMARY KEY,caller_id TEXT NOT NULL REFERENCES accounts(id)," +
      "worker_id TEXT NOT NULL REFERENCES accounts(id)," +
      "listing_id TEXT NOT NULL REFERENCES worker_listings(id)," +
      "consent_revision INTEGER NOT NULL," +
      "availability_revision INTEGER NOT NULL," +
      "expected_pair_epoch INTEGER NOT NULL," +
      "phase TEXT NOT NULL CHECK(phase IN (" +
      "'pending_test_only','leased_test_only'," +
      "'outcome_unknown_test_only')));" +
      "CREATE TRIGGER fake_circuit_no_auto_rearm " +
      "BEFORE UPDATE OF mode ON fake_contact_circuit " +
      "WHEN OLD.mode='halted_test_only' AND NEW.mode='open_test_only' " +
      "BEGIN SELECT RAISE(ABORT,'manual review required'); END",
    );
    const db = localD1Adapter(a);
    for (const id of [CALLER, WORKER, OTHER]) {
      await ensureAccount(db, id);
    }
    await optInAsWorker(db, WORKER);
    a.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) " +
      "VALUES(?,?,?,?,1)").run(CATEGORY, CATEGORY,
      "Fixture only", "सिर्फ परीक्षण");
    const listing = await publishListing(db, WORKER, CATEGORY);
    const caller = (await issueSession(db, CALLER))?.accessToken;
    const worker = (await issueSession(db, WORKER))?.accessToken;
    const other = (await issueSession(db, OTHER))?.accessToken;
    assert.ok(listing && caller && worker && other);
    return {
      a, b, listing, caller, worker, other,
      opt: (on, rev) => setOwnWorkerAgoraCallPreference(
        localD1Adapter(b), worker, on, rev,
      ),
      available: (on, rev) => setOwnWorkerAvailability(
        localD1Adapter(b), worker, on, rev,
      ),
      block: (bearer, target, on) => setOwnAgoraAccountBlock(
        localD1Adapter(b), bearer, target, on,
      ),
      close() { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); },
    };
  } catch (error) {
    a.close(); b.close(); rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

const mode = db => db.prepare(
  "SELECT mode FROM fake_contact_circuit WHERE singleton=1",
).get()?.mode;
const rows = db => db.prepare(
  "SELECT call_id,phase,expected_pair_epoch FROM fake_contact_intents " +
  "ORDER BY call_id",
).all();
const pairEpoch = (db, first, second) => {
  const [lo, hi] = [first, second].sort();
  return db.prepare(
    "SELECT revision FROM fake_pair_epoch WHERE lower_id=? AND upper_id=?",
  ).get(lo, hi)?.revision ?? 0;
};
async function enableWorker(f) {
  assert.equal((await f.opt(true, 0)).kind, "updated");
  assert.equal((await f.available(true, 0)).kind, "updated");
}

/** Local one-statement fake staging, NOT a production D1 admission. */
const STAGE_QUERY =
  "INSERT INTO fake_contact_intents " +
  "(call_id,caller_id,worker_id,listing_id,consent_revision," +
  "availability_revision,expected_pair_epoch,phase) " +
  "SELECT ?,caller.id,worker.id,listing.id,consent.revision," +
  "avail.revision,COALESCE(epoch.revision,0),'pending_test_only' " +
  "FROM auth_sessions AS session " +
  "JOIN accounts AS caller ON caller.id=session.account_id " +
  "JOIN worker_listings AS listing ON listing.id=? " +
  "JOIN accounts AS worker ON worker.id=listing.worker_account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=worker.id " +
  "JOIN categories AS category ON category.id=listing.category_id " +
  "JOIN worker_agora_call_preferences AS consent " +
  "ON consent.account_id=worker.id AND consent.calls_enabled=1 " +
  "JOIN worker_agora_availability_preferences AS avail " +
  "ON avail.account_id=worker.id AND avail.accepting_calls=1 " +
  "LEFT JOIN fake_pair_epoch AS epoch " +
  "ON epoch.lower_id=MIN(caller.id,worker.id) " +
  "AND epoch.upper_id=MAX(caller.id,worker.id) " +
  "WHERE session.token_hash=? AND session.expires_at>? " +
  "AND caller.status='active' AND worker.status='active' " +
  "AND caller.id<>worker.id AND profile.status='draft' " +
  "AND listing.status='published' AND listing.moderation_status='allowed' " +
  "AND category.is_active=1 " +
  "AND EXISTS(SELECT 1 FROM fake_contact_circuit " +
  "WHERE singleton=1 AND mode='open_test_only') " +
  "AND COALESCE(epoch.revision,0)=? " +
  "AND NOT EXISTS (SELECT 1 FROM agora_account_blocks AS block " +
  "WHERE (block.blocker_account_id=caller.id " +
  "AND block.blocked_account_id=worker.id) OR " +
  "(block.blocker_account_id=worker.id " +
  "AND block.blocked_account_id=caller.id))";

/** A background claim has NO customer bearer; it derives original identity
 * from the only fake stored intent. A system halt and private current safety
 * conditions veto any claim; no provider call or credential is issued.
 */
const CLAIM_QUERY =
  "UPDATE fake_contact_intents AS intent SET phase='leased_test_only' " +
  "WHERE intent.call_id=? AND intent.phase='pending_test_only' " +
  "AND EXISTS(SELECT 1 FROM fake_contact_circuit " +
  "WHERE singleton=1 AND mode='open_test_only') " +
  "AND EXISTS(SELECT 1 FROM accounts AS caller " +
  "JOIN accounts AS worker ON worker.id=intent.worker_id " +
  "JOIN worker_listings AS listing ON listing.id=intent.listing_id " +
  "AND listing.worker_account_id=worker.id " +
  "JOIN worker_profiles AS profile ON profile.account_id=worker.id " +
  "JOIN categories AS category ON category.id=listing.category_id " +
  "JOIN worker_agora_call_preferences AS consent " +
  "ON consent.account_id=worker.id AND consent.calls_enabled=1 " +
  "AND consent.revision=intent.consent_revision " +
  "JOIN worker_agora_availability_preferences AS avail " +
  "ON avail.account_id=worker.id AND avail.accepting_calls=1 " +
  "AND avail.revision=intent.availability_revision " +
  "LEFT JOIN fake_pair_epoch AS epoch " +
  "ON epoch.lower_id=MIN(caller.id,worker.id) " +
  "AND epoch.upper_id=MAX(caller.id,worker.id) " +
  "WHERE caller.id=intent.caller_id " +
  "AND caller.status='active' AND worker.status='active' " +
  "AND caller.id<>worker.id AND profile.status='draft' " +
  "AND listing.status='published' AND listing.moderation_status='allowed' " +
  "AND category.is_active=1 " +
  "AND COALESCE(epoch.revision,0)=intent.expected_pair_epoch " +
  "AND NOT EXISTS(SELECT 1 FROM agora_account_blocks AS block " +
  "WHERE (block.blocker_account_id=caller.id " +
  "AND block.blocked_account_id=worker.id) OR " +
  "(block.blocker_account_id=worker.id " +
  "AND block.blocked_account_id=caller.id)))";

async function stage(f, {
  db = f.a, id = CALL, expectedEpoch = 0, bearer = f.caller,
} = {}) {
  if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0) return WITHHELD;
  try {
    const digest = await sessionHash(bearer);
    const { meta } = await localD1Adapter(db).prepare(STAGE_QUERY)
      .bind(id, f.listing.id, digest,
        Math.floor(Date.now() / 1000), expectedEpoch).run();
    return meta.changes === 1
      ? Object.freeze({ kind: "staged_test_only" }) : WITHHELD;
  } catch { return WITHHELD; }
}

async function claim(f, { db = f.a, id = CALL } = {}) {
  try {
    const { meta } = await localD1Adapter(db)
      .prepare(CLAIM_QUERY).bind(id).run();
    return meta.changes === 1
      ? Object.freeze({ kind: "pre_send_lease_test_only" }) : WITHHELD;
  } catch { return WITHHELD; }
}

/** Deliberately one-way and trusted-only: never expose as client API.
 * This is a global safety halt candidate, NOT a real operational policy.
 */
function trustedHaltAdmission(f, db = f.a) {
  try {
    const { changes } = db.prepare(
      "UPDATE fake_contact_circuit SET mode='halted_test_only' " +
      "WHERE singleton=1 AND mode='open_test_only'",
    ).run();
    return changes === 1
      ? Object.freeze({ kind: "halted_test_only" }) : WITHHELD;
  } catch { return WITHHELD; }
}

/** No external transport. Marking local uncertainty is not delivery. */
function markUnknown(f, id = CALL) {
  const { changes } = f.a.prepare(
    "UPDATE fake_contact_intents " +
    "SET phase='outcome_unknown_test_only' " +
    "WHERE call_id=? AND phase='leased_test_only'",
  ).run(id);
  return changes === 1
    ? Object.freeze({ kind: "quarantined_test_only" }) : WITHHELD;
}

test("normal current private consent allows only fake UNSENT; no real call starts", async () => {
  const f = await fixture();
  try {
    assert.equal(mode(f.a), "open_test_only");
    assert.deepEqual(await stage(f), WITHHELD);
    await enableWorker(f);
    assert.deepEqual(await stage(f), { kind: "staged_test_only" });
    assert.deepEqual(await claim(f), { kind: "pre_send_lease_test_only" });
    assert.deepEqual(await claim(f), WITHHELD);
    assert.equal(rows(f.b)[0].phase, "leased_test_only");
    assert.equal(f.a.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'agora_call_%'",
    ).get().n, 0);
  } finally { f.close(); }
});

test("trusted halt BEFORE block keeps real block action usable despite fake exhausted revision", async () => {
  const f = await fixture();
  try {
    await enableWorker(f);
    // An old UNSENT fake candidate exists before the safety incident.
    assert.deepEqual(await stage(f), { kind: "staged_test_only" });
    const [lower, upper] = [CALLER, WORKER].sort();
    f.b.prepare(
      "INSERT INTO fake_pair_epoch(lower_id,upper_id,revision) " +
      "VALUES(?,?,2147483647)",
    ).run(lower, upper);
    assert.equal(pairEpoch(f.a, CALLER, WORKER), 2147483647);
    assert.deepEqual(trustedHaltAdmission(f),
      { kind: "halted_test_only" });
    assert.equal(mode(f.b), "halted_test_only",
      "the independent connection observes shutdown BEFORE block mutation");
    assert.deepEqual(await claim(f, { db: f.b }), WITHHELD);
    assert.deepEqual(await f.block(f.worker, CALLER, true), { kind: "updated" },
      "existing owner-authenticated blocking is not coupled to a broken fake ledger");
    const facts = await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    );
    assert.equal(facts.contactBlocked, true);
    assert.deepEqual(await f.block(f.worker, CALLER, false), { kind: "updated" });
    assert.equal(pairEpoch(f.a, CALLER, WORKER), 2147483647,
      "local block writer deliberately never touches fake pair metadata");
    assert.equal((await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    ))?.contactBlocked, false);
    assert.deepEqual(await stage(f, {
      id: CALL2, expectedEpoch: 2147483647,
    }), WITHHELD, "no new invite even though block has been removed");
    assert.deepEqual(await claim(f, { db: f.b }), WITHHELD,
      "old original preview is not resurrected by unblock");
    assert.equal(mode(f.b), "halted_test_only");
  } finally { f.close(); }
});

test("a crash after committed safety shutdown, before blocking, leaves contact halted", async () => {
  const f = await fixture();
  try {
    await enableWorker(f);
    assert.deepEqual(await stage(f), { kind: "staged_test_only" });
    assert.deepEqual(trustedHaltAdmission(f),
      { kind: "halted_test_only" });
    // Synthetic crash: no block operation, no provider attempt, no reopening.
    assert.equal(f.b.prepare(
      "SELECT COUNT(*) AS n FROM agora_account_blocks",
    ).get().n, 0);
    assert.deepEqual(await claim(f, { db: f.b }), WITHHELD);
    assert.deepEqual(await stage(f, { db: f.b, id: CALL2 }), WITHHELD);
    assert.equal(mode(f.b), "halted_test_only");
    // Existing actor-owned block remains independently writable after restart.
    assert.deepEqual(await f.block(f.caller, WORKER, true), { kind: "updated" });
    assert.equal((await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    ))?.contactBlocked, true);
  } finally { f.close(); }
});

test("shutdown cannot be silently reset and duplicate stop never grants contact", async () => {
  const f = await fixture();
  try {
    await enableWorker(f);
    assert.deepEqual(trustedHaltAdmission(f),
      { kind: "halted_test_only" });
    assert.deepEqual(trustedHaltAdmission(f, f.b), WITHHELD);
    assert.throws(() => f.b.prepare(
      "UPDATE fake_contact_circuit SET mode='open_test_only' WHERE singleton=1",
    ).run(), /manual review required/);
    assert.equal(mode(f.a), "halted_test_only");
    assert.deepEqual(await stage(f), WITHHELD);
    assert.deepEqual(await claim(f), WITHHELD);
  } finally { f.close(); }
});

test("gate write lock denies halt acknowledgment; never claim safety shutdown without commit", async () => {
  const f = await fixture();
  try {
    await enableWorker(f);
    f.a.exec("BEGIN IMMEDIATE");
    try {
      assert.deepEqual(trustedHaltAdmission(f, f.b), WITHHELD);
      assert.equal(mode(f.a), "open_test_only");
    } finally { f.a.exec("ROLLBACK"); }
    assert.deepEqual(trustedHaltAdmission(f, f.b),
      { kind: "halted_test_only" });
    assert.equal(mode(f.a), "halted_test_only");
    assert.deepEqual(await stage(f), WITHHELD);
  } finally { f.close(); }
});

test("UNKNOWN remains quarantined after halt, unblock and independent local recovery", async () => {
  const f = await fixture();
  try {
    await enableWorker(f);
    assert.deepEqual(await stage(f), { kind: "staged_test_only" });
    assert.deepEqual(await claim(f), { kind: "pre_send_lease_test_only" });
    assert.deepEqual(markUnknown(f), { kind: "quarantined_test_only" });
    assert.deepEqual(trustedHaltAdmission(f),
      { kind: "halted_test_only" });
    assert.deepEqual(await f.block(f.worker, CALLER, true), { kind: "updated" });
    assert.deepEqual(await f.block(f.worker, CALLER, false), { kind: "updated" });
    assert.deepEqual(await claim(f, { db: f.b }), WITHHELD);
    assert.deepEqual(markUnknown(f), WITHHELD,
      "unknown must not be relabeled as another transport attempt");
    assert.equal(rows(f.b)[0].phase, "outcome_unknown_test_only");
    assert.equal(mode(f.b), "halted_test_only");
    assert.equal(pairEpoch(f.a, CALLER, WORKER), 0);
  } finally { f.close(); }
});

test("a global halt deliberately denies unrelated contact, not only the affected pair", async () => {
  const f = await fixture();
  try {
    await enableWorker(f);
    const otherBefore = await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.other, f.listing.id,
    );
    assert.equal(otherBefore.contactBlocked, false);
    assert.deepEqual(await stage(f, { bearer: f.other, id: CALL2 }),
      { kind: "staged_test_only" });
    assert.deepEqual(trustedHaltAdmission(f),
      { kind: "halted_test_only" });
    assert.deepEqual(await claim(f, { db: f.b, id: CALL2 }), WITHHELD);
    assert.deepEqual(await stage(f, { bearer: f.other, id: CALL }), WITHHELD);
    assert.equal((await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.other, f.listing.id,
    ))?.contactBlocked, false);
    assert.equal(mode(f.b), "halted_test_only");
  } finally { f.close(); }
});
