import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localD1Adapter } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import {
  issueSession, revokeSession, sessionHash, validSessionToken,
} from "../src/modules/identity/sessions.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { setOwnWorkerAgoraCallPreference } from
  "../src/modules/workers/agora-call-preference.ts";
import {
  readLocalCallerAgoraSafetyFacts, setOwnWorkerAvailability,
  setOwnAgoraAccountBlock,
} from "../src/modules/interactions/agora-private-safety-state.ts";
import { readCallerSessionBoundAgoraConsentEpoch } from
  "../src/modules/interactions/request-target.ts";
import { validOpaqueId } from "../src/modules/shared/identifiers.ts";

/**
 * DISPOSABLE TWO-CONNECTION SQLITE REHEARSAL. This file creates one fake
 * UNSENT-only table in a temporary local database and tests the EXISTING
 * private D1 availability/blocks/consent tables under a SQLite write lock.
 * NO production migration, public call API, real provider evidence, rate
 * approval, online presence, cloud D1/DO guarantee or message is produced.
 * A passing test must never authorize network delivery or RTC credentials.
 */
const CALLER = "local-lock-caller-00001";
const OTHER = "local-lock-other-00001";
const WORKER = "local-lock-worker-00001";
const CATEGORY = "local-lock-category";
const CALL = "local-lock-call-000001";
const OTHER_CALL = "local-lock-call-000002";
const DENIED = Object.freeze({ kind: "withheld" });
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

async function trial() {
  const dir = mkdtempSync(join(tmpdir(), "jodlo-private-unsent-lock-"));
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
        new URL("../../../infra/migrations/" + name, import.meta.url), "utf8",
      ));
    }
    // Only the test owns this record. Not a production call, outbox or send.
    a.exec(
      "CREATE TABLE fake_private_unsent_intents (" +
      "call_id TEXT PRIMARY KEY,caller_id TEXT NOT NULL," +
      "worker_id TEXT NOT NULL,listing_id TEXT NOT NULL," +
      "consent_revision INTEGER NOT NULL,availability_revision INTEGER NOT NULL," +
      "state TEXT NOT NULL CHECK(state='unsent_test_only'))",
    );
    // Test-owned mutation epoch: a deliberate model for detecting ABA. This
    // table is NEVER a D1 migration and stores no reason, timestamp or log.
    a.exec(
      "CREATE TABLE fake_block_pair_epochs (" +
      "lower_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE," +
      "upper_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE," +
      "revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647)," +
      "CHECK(lower_id < upper_id)," +
      "PRIMARY KEY(lower_id,upper_id))",
    );
    // A recovery/lease record exists ONLY in this throwaway test database.
    // It cannot send a message, contact a worker or authorize any live call.
    a.exec(
      "CREATE TABLE fake_private_recovery_leases (" +
      "call_id TEXT PRIMARY KEY REFERENCES fake_private_unsent_intents(call_id)" +
      " ON DELETE CASCADE," +
      "phase TEXT NOT NULL CHECK(phase IN (" +
      "'pending_unsent_test_only','leased_pre_send_test_only'," +
      "'outcome_unknown_test_only'))," +
      "generation INTEGER NOT NULL DEFAULT 0 " +
      "CHECK(generation BETWEEN 0 AND 2147483647)," +
      "lease_until_ms INTEGER DEFAULT NULL " +
      "CHECK(lease_until_ms IS NULL OR lease_until_ms>=0)," +
      "deadline_ms INTEGER NOT NULL CHECK(deadline_ms>0)," +
      "pair_revision INTEGER NOT NULL " +
      "CHECK(pair_revision BETWEEN 0 AND 2147483647))",
    );
    const adapter = localD1Adapter(a);
    for (const id of [CALLER, WORKER, OTHER]) {
      await ensureAccount(adapter, id);
    }
    await optInAsWorker(adapter, WORKER);
    a.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)",
    ).run(CATEGORY, CATEGORY, "Synthetic lock", "परीक्षण लॉक");
    const listing = await publishListing(adapter, WORKER, CATEGORY);
    const caller = (await issueSession(adapter, CALLER))?.accessToken;
    const other = (await issueSession(adapter, OTHER))?.accessToken;
    const worker = (await issueSession(adapter, WORKER))?.accessToken;
    assert.ok(listing && caller && other && worker);
    return {
      a, b, listing, caller, other, worker,
      consent: (enabled, revision) => setOwnWorkerAgoraCallPreference(
        localD1Adapter(b), worker, enabled, revision,
      ),
      available: (enabled, revision) => setOwnWorkerAvailability(
        localD1Adapter(b), worker, enabled, revision,
      ),
      block: (bearer, target, value = true) => setOwnAgoraAccountBlock(
        localD1Adapter(b), bearer, target, value,
      ),
      rows: () => a.prepare(
        "SELECT * FROM fake_private_unsent_intents ORDER BY call_id",
      ).all(),
      close() {
        a.close();
        b.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function enable(f) {
  assert.equal((await f.consent(true, 0)).kind, "updated");
  assert.equal((await f.available(true, 0)).kind, "updated");
}

/** Test-only writer: current authenticated caller, worker's consent revision,
 * actual listing/Category/moderation, private availability epoch and either
 * block direction are all checked while the SAME local write lock is held
 * for the fake UNSENT insert. No scripted online/quota evidence is promoted.
 */
async function stageUnsent(f, {
  db = f.a, bearer = f.caller, callId = CALL,
  onLocked = async () => {}, crashBeforeCommit = false,
} = {}) {
  if (!validOpaqueId(callId)) return DENIED;
  let tx = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    tx = true;
    const adapter = localD1Adapter(db);
    const original = await readCallerSessionBoundAgoraConsentEpoch(
      adapter, bearer, f.listing.id,
    );
    const safety = await readLocalCallerAgoraSafetyFacts(
      adapter, bearer, f.listing.id,
    );
    if (!original || !safety ||
        safety.consentRevision !== original.consentRevision ||
        safety.acceptingCalls !== true ||
        !Number.isSafeInteger(safety.availabilityRevision) ||
        safety.availabilityRevision < 1 ||
        safety.contactBlocked !== false ||
        safety.workerPresence !== "unknown" ||
        safety.rateGate !== "unknown") {
      db.exec("ROLLBACK");
      tx = false;
      return DENIED;
    }
    const previous = db.prepare(
      "SELECT * FROM fake_private_unsent_intents WHERE call_id=?",
    ).get(callId);
    if (previous) {
      const same = previous.caller_id === original.target.requesterAccountId &&
        previous.worker_id === original.target.workerAccountId &&
        previous.listing_id === original.target.listingId &&
        previous.consent_revision === original.consentRevision &&
        previous.availability_revision === safety.availabilityRevision &&
        previous.state === "unsent_test_only";
      db.exec("ROLLBACK");
      tx = false;
      return same ? Object.freeze({ kind: "duplicate_suppressed_test_only" }) : DENIED;
    }
    // Optional TEST-ONLY expected mutation-fence check runs inside the same
    // local writer lock, never after the fake record is committed.
    if (await onLocked() === false) {
      db.exec("ROLLBACK");
      tx = false;
      return DENIED;
    }
    db.prepare(
      "INSERT INTO fake_private_unsent_intents VALUES(?,?,?,?,?,?,?)",
    ).run(callId, original.target.requesterAccountId,
      original.target.workerAccountId, original.target.listingId,
      original.consentRevision, safety.availabilityRevision,
      "unsent_test_only");
    if (crashBeforeCommit) throw Error("test-only crash before commit");
    db.exec("COMMIT");
    tx = false;
    return Object.freeze({ kind: "unsent_staged_test_only" });
  } catch (error) {
    if (tx) db.exec("ROLLBACK");
    throw error;
  }
}

/** Even an already-staged fake intent must be rechecked on a fresh
 * transactional read. A success remains UNSENT, never proof of delivery.
 * No block-generation storage exists, so transient block ABA is NOT solved.
 */
async function recheckUnsent(f, bearer = f.caller, callId = CALL) {
  let tx = false;
  try {
    f.a.exec("BEGIN IMMEDIATE");
    tx = true;
    const stored = f.a.prepare(
      "SELECT * FROM fake_private_unsent_intents WHERE call_id=?",
    ).get(callId);
    const adapter = localD1Adapter(f.a);
    const original = await readCallerSessionBoundAgoraConsentEpoch(
      adapter, bearer, f.listing.id,
    );
    const safety = await readLocalCallerAgoraSafetyFacts(
      adapter, bearer, f.listing.id,
    );
    const same = Boolean(stored && original && safety) &&
      stored.state === "unsent_test_only" &&
      stored.caller_id === original.target.requesterAccountId &&
      stored.worker_id === original.target.workerAccountId &&
      stored.listing_id === original.target.listingId &&
      stored.consent_revision === original.consentRevision &&
      stored.availability_revision === safety.availabilityRevision &&
      safety.contactBlocked === false &&
      safety.acceptingCalls === true;
    f.a.exec("ROLLBACK");
    tx = false;
    return same ? Object.freeze({ kind: "still_unsent_current_test_only" }) : DENIED;
  } catch {
    if (tx) f.a.exec("ROLLBACK");
    return DENIED;
  }
}

test("default-off consent and separate availability cannot create fake UNSENT", async () => {
  const f = await trial();
  try {
    assert.deepEqual(await stageUnsent(f), DENIED);
    assert.equal((await f.consent(true, 0)).kind, "updated");
    assert.deepEqual(await stageUnsent(f), DENIED);
    assert.equal((await f.available(true, 0)).kind, "updated");
    assert.deepEqual(await stageUnsent(f, { bearer: f.worker }), DENIED);
    assert.deepEqual(await stageUnsent(f, { bearer: "forged" }), DENIED);
    assert.deepEqual(f.rows(), []);
    assert.deepEqual(await stageUnsent(f), { kind: "unsent_staged_test_only" });
    assert.deepEqual(f.rows().map(x => x.state), ["unsent_test_only"]);
    assert.deepEqual(await recheckUnsent(f), { kind: "still_unsent_current_test_only" });
  } finally {
    f.close();
  }
});

test("either genuine D1 block, not synthetic evidence, prevents local UNSENT staging", async () => {
  const f = await trial();
  try {
    await enable(f);
    assert.deepEqual(await f.block(f.caller, WORKER), { kind: "updated" });
    assert.deepEqual(await stageUnsent(f), DENIED);
    assert.deepEqual(await f.block(f.caller, WORKER, false), { kind: "updated" });
    assert.deepEqual(await f.block(f.worker, CALLER), { kind: "updated" });
    assert.deepEqual(await stageUnsent(f), DENIED);
    assert.deepEqual(await stageUnsent(f, {
      bearer: f.other, callId: OTHER_CALL,
    }), { kind: "unsent_staged_test_only" },
    "the unrelated caller is not blocked by this pair");
    assert.equal(f.rows().length, 1);
    assert.deepEqual(await f.block(f.worker, CALLER, false), { kind: "updated" });
    assert.deepEqual(await stageUnsent(f), { kind: "unsent_staged_test_only" });
    assert.equal(f.rows().length, 2);
    assert.deepEqual(f.rows().map(x => x.state),
      ["unsent_test_only", "unsent_test_only"]);
  } finally {
    f.close();
  }
});

test("a block or availability OFF committed after preview vetoes the locked recheck", async () => {
  const f = await trial();
  try {
    await enable(f);
    const preview = await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    );
    assert.equal(preview.contactBlocked, false);
    assert.equal(preview.availabilityRevision, 1);
    assert.deepEqual(await f.block(f.worker, CALLER), { kind: "updated" });
    assert.deepEqual(await stageUnsent(f), DENIED);
    assert.deepEqual(await f.block(f.worker, CALLER, false), { kind: "updated" });
    assert.equal((await f.available(false, 1)).kind, "updated");
    assert.deepEqual(await stageUnsent(f), DENIED);
    assert.equal((await f.available(true, 2)).kind, "updated");
    assert.deepEqual(await stageUnsent(f), { kind: "unsent_staged_test_only" });
    assert.equal(f.rows()[0].availability_revision, 3);
    assert.notEqual(f.rows()[0].availability_revision, preview.availabilityRevision);
  } finally {
    f.close();
  }
});

test("write lock stops competing block writer until UNSENT commit; post-commit block vetoes reuse", async () => {
  const f = await trial();
  try {
    await enable(f);
    assert.deepEqual(await stageUnsent(f, {
      onLocked: async () => {
        assert.throws(() => f.b.prepare(
          "INSERT INTO agora_account_blocks(blocker_account_id,blocked_account_id) VALUES(?,?)",
        ).run(WORKER, CALLER), /SQLITE_BUSY|database is locked/i);
        assert.equal(f.rows().length, 0, "no fake record written before the hook");
      },
    }), { kind: "unsent_staged_test_only" });
    assert.deepEqual(await f.block(f.worker, CALLER), { kind: "updated" });
    assert.deepEqual(await stageUnsent(f), DENIED);
    assert.deepEqual(await recheckUnsent(f), DENIED);
    assert.deepEqual(f.rows().map(x => x.state), ["unsent_test_only"],
      "historical local record is still UNSENT, not delivered");
  } finally {
    f.close();
  }
});

test("OFF-ON consent or availability never revives old fake UNSENT claim", async () => {
  const f = await trial();
  try {
    await enable(f);
    assert.equal((await stageUnsent(f)).kind, "unsent_staged_test_only");
    assert.equal((await f.available(false, 1)).kind, "updated");
    assert.deepEqual(await recheckUnsent(f), DENIED);
    assert.equal((await f.available(true, 2)).kind, "updated");
    assert.deepEqual(await recheckUnsent(f), DENIED);
    assert.deepEqual(await stageUnsent(f), DENIED,
      "same call ID cannot rebase a stored availability revision");
    assert.equal((await f.consent(false, 1)).kind, "updated");
    assert.equal((await f.consent(true, 2)).kind, "updated");
    assert.deepEqual(await recheckUnsent(f), DENIED);
    assert.equal((await stageUnsent(f, { callId: OTHER_CALL })).kind,
      "unsent_staged_test_only");
    assert.equal(f.rows().length, 2);
  } finally {
    f.close();
  }
});

test("same call ID replay, foreign actor and crash rollback never insert a second intent", async () => {
  const f = await trial();
  try {
    await enable(f);
    await assert.rejects(
      stageUnsent(f, { crashBeforeCommit: true }),
      /test-only crash before commit/,
    );
    assert.deepEqual(f.rows(), [], "write and fake intent must roll back together");
    assert.equal((await stageUnsent(f)).kind, "unsent_staged_test_only");
    assert.deepEqual(await stageUnsent(f),
      { kind: "duplicate_suppressed_test_only" });
    assert.deepEqual(await stageUnsent(f, { db: f.b, bearer: f.other }), DENIED);
    assert.deepEqual(await recheckUnsent(f, f.other), DENIED);
    assert.equal(f.rows().length, 1);
    assert.equal((await revokeSession(localD1Adapter(f.b), f.caller)), true);
    assert.deepEqual(await recheckUnsent(f), DENIED);
    assert.deepEqual(await stageUnsent(f), DENIED);
    assert.equal(f.rows()[0].state, "unsent_test_only");
  } finally {
    f.close();
  }
});


/**
 * Hypothetical pair-generation model; deliberately NOT a production table or
 * proposed retention rule. Its identity is an unordered pair of test-owned
 * opaque account IDs. The public/private safety D1 projection STILL exposes
 * only contactBlocked, never the blocker direction or this test-only epoch.
 */
function fakePairRevision(db, first, second) {
  const [lower, upper] = [first, second].sort();
  return db.prepare(
    "SELECT revision FROM fake_block_pair_epochs WHERE lower_id=? AND upper_id=?",
  ).get(lower, upper)?.revision ?? 0;
}

/**
 * A fixture-only transaction emulates a future actor-authenticated mutation
 * and pair-generation update in one SQLite writer lock. It calls the EXISTING
 * real session-owned D1 block writer; the added epoch is fake local state.
 * Deliberately not an API, Durable Object, D1 schema or Cloudflare proof.
 */
async function mutateTestPairWithEpoch(f, {
  db = f.b, bearer, target, blocked, crashAfterEpoch = false,
}) {
  const actor = bearer === f.caller ? CALLER :
    bearer === f.worker ? WORKER :
    bearer === f.other ? OTHER : null;
  if (!actor || actor === target || typeof blocked !== "boolean") return DENIED;
  const [lower, upper] = [actor, target].sort();
  let tx = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    tx = true;
    const mutation = await setOwnAgoraAccountBlock(
      localD1Adapter(db), bearer, target, blocked,
    );
    if (mutation.kind !== "updated") {
      db.exec("ROLLBACK");
      tx = false;
      return DENIED;
    }
    const { changes } = db.prepare(
      "INSERT INTO fake_block_pair_epochs(lower_id,upper_id,revision)" +
      " VALUES(?,?,1) ON CONFLICT(lower_id,upper_id)" +
      " DO UPDATE SET revision=revision+1 WHERE revision<2147483647",
    ).run(lower, upper);
    if (changes !== 1) {
      db.exec("ROLLBACK");
      tx = false;
      return DENIED;
    }
    if (crashAfterEpoch) throw Error("synthetic block+epoch crash");
    db.exec("COMMIT");
    tx = false;
    return Object.freeze({ kind: "mutated_test_only" });
  } catch (error) {
    if (tx) db.exec("ROLLBACK");
    throw error;
  }
}

test("real D1 block -> unblock ABA is invisible to booleans, but a fake pair epoch fences stale UNSENT", async () => {
  const f = await trial();
  try {
    await enable(f);
    const first = await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    );
    assert.equal(first.contactBlocked, false);
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 0);

    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: true,
    }), { kind: "mutated_test_only" });
    const during = await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    );
    assert.equal(during.contactBlocked, true);
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: false,
    }), { kind: "mutated_test_only" });
    const after = await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    );
    assert.deepEqual(after, first,
      "existing current-state D1 reader alone CANNOT detect a historic block ABA");
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 2);
    assert.deepEqual(await stageUnsent(f, {
      onLocked: async () => fakePairRevision(f.a, CALLER, WORKER) === 0,
    }), DENIED, "stale historic preview must not create a fake UNSENT claim");
    assert.deepEqual(f.rows(), []);
    assert.deepEqual(await stageUnsent(f, {
      onLocked: async () => fakePairRevision(f.a, CALLER, WORKER) === 2,
    }), { kind: "unsent_staged_test_only" },
    "only a new TEST snapshot can continue under this hypothetical fence");
    assert.deepEqual(f.rows().map(x => x.state), ["unsent_test_only"]);
  } finally {
    f.close();
  }
});

test("pair generation is direction-independent and does not contaminate unrelated customers", async () => {
  const f = await trial();
  try {
    await enable(f);
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 0);
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.other, target: WORKER, blocked: true,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.other, target: WORKER, blocked: false,
    }), { kind: "mutated_test_only" });
    assert.equal(fakePairRevision(f.a, OTHER, WORKER), 2);
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 0);
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.caller, target: WORKER, blocked: true,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.caller, target: WORKER, blocked: false,
    }), { kind: "mutated_test_only" });
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 2);
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: true,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: false,
    }), { kind: "mutated_test_only" });
    assert.equal(fakePairRevision(f.a, WORKER, CALLER), 4);
    assert.equal(fakePairRevision(f.a, OTHER, WORKER), 2);
    assert.deepEqual(await stageUnsent(f, {
      bearer: f.other,
      callId: OTHER_CALL,
      onLocked: async () => fakePairRevision(f.a, OTHER, WORKER) === 2,
    }), { kind: "unsent_staged_test_only" });
    assert.equal(f.rows().length, 1);
  } finally {
    f.close();
  }
});

test("fixture block+epoch crash rollback, no-op and competing writer preserve the old pair fence", async () => {
  const f = await trial();
  try {
    await enable(f);
    await assert.rejects(mutateTestPairWithEpoch(f, {
      bearer: f.caller, target: WORKER, blocked: true, crashAfterEpoch: true,
    }), /synthetic block\+epoch crash/);
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 0);
    assert.equal((await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    ))?.contactBlocked, false, "block and fake revision rollback together");
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: "invalid", target: WORKER, blocked: true,
    }), DENIED);
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 0);

    f.a.exec("BEGIN IMMEDIATE");
    try {
      await assert.rejects(mutateTestPairWithEpoch(f, {
        bearer: f.caller, target: WORKER, blocked: true,
      }), /SQLITE_BUSY|database is locked/i);
    } finally {
      f.a.exec("ROLLBACK");
    }
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 0);
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.caller, target: WORKER, blocked: true,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.caller, target: WORKER, blocked: true,
    }), DENIED, "duplicate real block does not invent a new mutation epoch");
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 1);
    assert.deepEqual(await stageUnsent(f), DENIED);
    assert.deepEqual(f.rows(), []);
  } finally {
    f.close();
  }
});


/**
 * D1-PORTABLE SQL SHAPE TRIAL: ONE conditional INSERT ... SELECT statement,
 * not a multi-await SQLite BEGIN IMMEDIATE sequence. Only the local fixture
 * table is inserted; actual production has no intent/outbox table or writer.
 *
 * This statement observes current caller-owned session, listing, worker
 * consent, separate availability, BOTH block directions and the TEST-ONLY
 * unordered pair generation in the SAME database statement as the fake write.
 * The pair epoch is NOT part of migration 0008; every real mutation would
 * have to advance a durable, privacy-approved epoch for that check to mean
 * anything. No arbitrary worker ID or worker bearer is supplied.
 */
const ATOMIC_FAKE_UNSENT_INSERT_QUERY =
  "INSERT INTO fake_private_unsent_intents " +
  "(call_id,caller_id,worker_id,listing_id," +
  "consent_revision,availability_revision,state) " +
  "SELECT ?,caller.id,worker.id,wl.id,pref.revision,avail.revision," +
  "'unsent_test_only' " +
  "FROM auth_sessions AS session " +
  "JOIN accounts AS caller ON caller.id=session.account_id " +
  "JOIN worker_listings AS wl ON wl.id=? " +
  "JOIN accounts AS worker ON worker.id=wl.worker_account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=worker.id " +
  "JOIN categories AS category ON category.id=wl.category_id " +
  "JOIN worker_agora_call_preferences AS pref " +
  "ON pref.account_id=worker.id AND pref.calls_enabled=1 " +
  "JOIN worker_agora_availability_preferences AS avail " +
  "ON avail.account_id=worker.id AND avail.accepting_calls=1 " +
  "WHERE session.token_hash=? AND session.expires_at>? " +
  "AND caller.status='active' AND worker.status='active' " +
  "AND caller.id<>worker.id AND profile.status='draft' " +
  "AND category.is_active=1 AND wl.status='published' " +
  "AND wl.moderation_status='allowed' " +
  "AND pref.revision=? AND avail.revision=? " +
  "AND NOT EXISTS(SELECT 1 FROM agora_account_blocks AS block " +
  "WHERE (block.blocker_account_id=caller.id " +
  "AND block.blocked_account_id=worker.id) OR " +
  "(block.blocker_account_id=worker.id " +
  "AND block.blocked_account_id=caller.id)) " +
  "AND COALESCE((SELECT epoch.revision FROM fake_block_pair_epochs AS epoch " +
  "WHERE epoch.lower_id=MIN(caller.id,worker.id) " +
  "AND epoch.upper_id=MAX(caller.id,worker.id)),0)=? " +
  "ON CONFLICT(call_id) DO NOTHING";

async function stageOneStatementFakeUnsent(f, {
  db = f.a, bearer = f.caller, callId = CALL,
  expectedConsentRevision = 1, expectedAvailabilityRevision = 1,
  expectedPairRevision = 0,
} = {}) {
  if (!validOpaqueId(callId) || !validSessionToken(bearer) ||
      !Number.isSafeInteger(expectedConsentRevision) ||
      expectedConsentRevision < 1 || expectedConsentRevision > 2_147_483_647 ||
      !Number.isSafeInteger(expectedAvailabilityRevision) ||
      expectedAvailabilityRevision < 1 ||
      expectedAvailabilityRevision > 2_147_483_647 ||
      !Number.isSafeInteger(expectedPairRevision) ||
      expectedPairRevision < 0 || expectedPairRevision > 2_147_483_647) {
    return DENIED;
  }
  try {
    // A single D1-shaped bound .run() commits only if ALL WHERE predicates
    // hold. No separately awaited consent, block or availability read here.
    const { meta } = await localD1Adapter(db).prepare(
      ATOMIC_FAKE_UNSENT_INSERT_QUERY,
    ).bind(callId, f.listing.id, await sessionHash(bearer),
      Math.floor(Date.now() / 1000),
      expectedConsentRevision, expectedAvailabilityRevision,
      expectedPairRevision).run();
    return meta?.changes === 1
      ? Object.freeze({ kind: "unsent_staged_test_only" })
      : DENIED;
  } catch {
    // SQLITE_BUSY, malformed inputs, DB error and unique conflict all fail
    // closed. This is not an actionable live retry or delivery decision.
    return DENIED;
  }
}

test("one-statement fake D1-shaped writer remains OFF without consent+availability and refuses forged actors", async () => {
  const f = await trial();
  try {
    assert.equal(ATOMIC_FAKE_UNSENT_INSERT_QUERY.includes("BEGIN"), false);
    assert.equal(ATOMIC_FAKE_UNSENT_INSERT_QUERY.includes("COMMIT"), false);
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED);
    assert.equal((await f.consent(true, 0)).kind, "updated");
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED);
    assert.equal((await f.available(true, 0)).kind, "updated");
    for (const bearer of [f.worker, "fake", "Bearer " + f.caller]) {
      assert.deepEqual(await stageOneStatementFakeUnsent(f, {
        bearer,
      }), DENIED);
    }
    for (const bad of [0, -1, 2.5, Number.MAX_SAFE_INTEGER, NaN]) {
      assert.deepEqual(await stageOneStatementFakeUnsent(f, {
        expectedConsentRevision: bad,
      }), DENIED);
      assert.deepEqual(await stageOneStatementFakeUnsent(f, {
        expectedAvailabilityRevision: bad,
      }), DENIED);
    }
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      expectedPairRevision: -1,
    }), DENIED);
    assert.deepEqual(f.rows(), []);
    assert.deepEqual(await stageOneStatementFakeUnsent(f),
      { kind: "unsent_staged_test_only" });
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED,
      "single-statement unique conflict must not enqueue a second fake intent");
    assert.deepEqual(f.rows().map(x => Object.keys(x).sort()), [[
      "availability_revision","call_id","caller_id","consent_revision",
      "listing_id","state","worker_id",
    ]]);
    assert.equal(f.rows()[0].state, "unsent_test_only");
    assert.deepEqual(await recheckUnsent(f),
      { kind: "still_unsent_current_test_only" });
  } finally {
    f.close();
  }
});

test("one-statement D1-shaped writer rejects late block, consent/availability epochs and moderation", async () => {
  const f = await trial();
  try {
    await enable(f);
    assert.deepEqual(await f.block(f.worker, CALLER), { kind: "updated" });
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED);
    assert.deepEqual(await f.block(f.worker, CALLER, false), { kind: "updated" });
    assert.deepEqual(await f.block(f.caller, WORKER), { kind: "updated" });
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED);
    assert.deepEqual(await f.block(f.caller, WORKER, false), { kind: "updated" });

    assert.equal((await f.available(false, 1)).kind, "updated");
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED);
    assert.equal((await f.available(true, 2)).kind, "updated");
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED,
      "OFF->ON availability must not resurrect stale expected revision 1");
    assert.equal((await f.consent(false, 1)).kind, "updated");
    assert.equal((await f.consent(true, 2)).kind, "updated");
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      expectedAvailabilityRevision: 3,
    }), DENIED, "OFF->ON worker call consent invalidates original revision 1");

    f.a.prepare(
      "UPDATE worker_listings SET moderation_status='hidden' WHERE id=?",
    ).run(f.listing.id);
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      expectedConsentRevision: 3, expectedAvailabilityRevision: 3,
    }), DENIED);
    f.a.prepare(
      "UPDATE worker_listings SET moderation_status='allowed' WHERE id=?",
    ).run(f.listing.id);
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      expectedConsentRevision: 3, expectedAvailabilityRevision: 3,
    }), { kind: "unsent_staged_test_only" });
    assert.deepEqual(f.rows().map(x => x.state), ["unsent_test_only"]);
    assert.equal(f.rows()[0].consent_revision, 3);
    assert.equal(f.rows()[0].availability_revision, 3);
  } finally {
    f.close();
  }
});

test("single SQL test writer rejects real block ABA when FAKE pair revision advanced in same mutation", async () => {
  const f = await trial();
  try {
    await enable(f);
    const initial = await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    );
    assert.equal(initial.contactBlocked, false);
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 0);
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: true,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: false,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    ), initial, "real current D1 read alone misses historical block ABA");
    assert.equal(fakePairRevision(f.a, WORKER, CALLER), 2);
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED,
      "historical pair mutation must reject original revision 0");
    assert.deepEqual(f.rows(), []);
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      expectedPairRevision: 2,
    }), { kind: "unsent_staged_test_only" },
    "only a newly trusted TEST snapshot may use the updated pair epoch");
    assert.equal(f.rows()[0].state, "unsent_test_only");
  } finally {
    f.close();
  }
});

test("pair epoch in single-statement writer is NOT safe unless every block mutation tracks it", async () => {
  const f = await trial();
  try {
    await enable(f);
    // Real D1 writer intentionally does not populate this FAKE pair ledger.
    assert.deepEqual(await f.block(f.worker, CALLER), { kind: "updated" });
    assert.deepEqual(await f.block(f.worker, CALLER, false), { kind: "updated" });
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 0);
    assert.equal((await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    )).contactBlocked, false);
    assert.deepEqual(await stageOneStatementFakeUnsent(f),
      { kind: "unsent_staged_test_only" },
      "intentional negative-control: an untracked mutation bypasses fake ABA fence");
    assert.equal(f.rows()[0].state, "unsent_test_only");
  } finally {
    f.close();
  }
});

test("two SQLite connections serialize one SQL writer against a competing block and unrelated caller", async () => {
  const f = await trial();
  try {
    await enable(f);
    f.a.exec("BEGIN IMMEDIATE");
    try {
      assert.deepEqual(await stageOneStatementFakeUnsent(f, {
        db: f.b,
      }), DENIED, "a competing writer may be SQLITE_BUSY, not silently allowed");
    } finally {
      f.a.exec("ROLLBACK");
    }
    assert.deepEqual(await f.block(f.worker, CALLER), { kind: "updated" });
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED);
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      bearer: f.other, callId: OTHER_CALL,
    }), { kind: "unsent_staged_test_only" },
    "other caller relationship is independent");
    assert.equal(f.rows().length, 1);
    assert.equal(f.rows()[0].caller_id, OTHER);
    assert.equal(f.rows()[0].worker_id, WORKER);
    assert.equal(f.rows()[0].state, "unsent_test_only");
    assert.equal((await revokeSession(localD1Adapter(f.b), f.other)), true);
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      bearer: f.other, callId: CALL,
    }), DENIED);
    assert.deepEqual(await recheckUnsent(f, f.other, OTHER_CALL), DENIED);
  } finally {
    f.close();
  }
});


/**
 * PR #193: model a server-owned recovery candidate using real migrated
 * worker/caller/listing/consent/availability/blocks in ONE SQL UPDATE.
 * This model is not a callable production recovery port.
 *
 * The seed stands in for a FUTURE approved atomic original-intent + outbox
 * commit. No server key, provider response, phone, device ID, real signaling
 * or per-attempt user history is stored. All phases are TEST-ONLY.
 */
const FAKE_RECOVERY_NOW = 1_800_000_000_000;
const FAKE_RECOVERY_DEADLINE = FAKE_RECOVERY_NOW + 30_000;

function seedFakeRecovery(f, {
  callId = CALL, deadlineMs = FAKE_RECOVERY_DEADLINE,
  pairRevision = fakePairRevision(f.a, CALLER, WORKER),
} = {}) {
  if (!validOpaqueId(callId) || !Number.isSafeInteger(deadlineMs) ||
      deadlineMs < 1 || !Number.isSafeInteger(pairRevision) ||
      pairRevision < 0 || pairRevision > 2_147_483_647) return DENIED;
  try {
    const { changes } = f.a.prepare(
      "INSERT INTO fake_private_recovery_leases(" +
      "call_id,phase,generation,lease_until_ms,deadline_ms,pair_revision) " +
      "SELECT call_id,'pending_unsent_test_only',0,NULL,?,? " +
      "FROM fake_private_unsent_intents WHERE call_id=? " +
      "ON CONFLICT(call_id) DO NOTHING",
    ).run(deadlineMs, pairRevision, callId);
    return changes === 1
      ? Object.freeze({ kind: "seeded_unsent_test_only" }) : DENIED;
  } catch {
    return DENIED;
  }
}

const CLAIM_PRIVATE_UNSENT_RECOVERY_QUERY =
  "UPDATE fake_private_recovery_leases AS lease " +
  "SET phase='leased_pre_send_test_only',generation=generation+1," +
  "lease_until_ms=? " +
  "WHERE lease.call_id=? AND lease.generation=? " +
  "AND lease.generation<2147483647 AND lease.deadline_ms>? " +
  "AND ?>? AND ?<=lease.deadline_ms " +
  "AND ((lease.phase='pending_unsent_test_only' " +
  "AND lease.generation=0 AND lease.lease_until_ms IS NULL) " +
  "OR (lease.phase='leased_pre_send_test_only' " +
  "AND lease.lease_until_ms<=?)) " +
  "AND EXISTS (" +
  "SELECT 1 FROM fake_private_unsent_intents AS intent " +
  "JOIN accounts AS caller ON caller.id=intent.caller_id " +
  "JOIN worker_listings AS listing ON listing.id=intent.listing_id " +
  "JOIN accounts AS worker ON worker.id=intent.worker_id " +
  "AND worker.id=listing.worker_account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=worker.id " +
  "JOIN categories AS category ON category.id=listing.category_id " +
  "JOIN worker_agora_call_preferences AS consent " +
  "ON consent.account_id=worker.id AND consent.calls_enabled=1 " +
  "AND consent.revision=intent.consent_revision " +
  "JOIN worker_agora_availability_preferences AS availability " +
  "ON availability.account_id=worker.id " +
  "AND availability.accepting_calls=1 " +
  "AND availability.revision=intent.availability_revision " +
  "WHERE intent.call_id=lease.call_id " +
  "AND intent.state='unsent_test_only' " +
  "AND caller.status='active' AND worker.status='active' " +
  "AND caller.id<>worker.id AND profile.status='draft' " +
  "AND listing.status='published' " +
  "AND listing.moderation_status='allowed' " +
  "AND category.is_active=1 " +
  "AND NOT EXISTS (SELECT 1 FROM agora_account_blocks AS block " +
  "WHERE (block.blocker_account_id=caller.id " +
  "AND block.blocked_account_id=worker.id) OR " +
  "(block.blocker_account_id=worker.id " +
  "AND block.blocked_account_id=caller.id)) " +
  "AND COALESCE((SELECT epoch.revision FROM fake_block_pair_epochs AS epoch " +
  "WHERE epoch.lower_id=MIN(caller.id,worker.id) " +
  "AND epoch.upper_id=MAX(caller.id,worker.id)),0)=" +
  "lease.pair_revision)";

/**
 * The test lease is only PRE-SEND. A successful local claim does not send or
 * authorize provider contact. A lease can be retried after expiry ONLY while
 * the phase still says PRE-SEND; UNKNOWN is a non-retriable quarantine.
 */
async function claimFakePrivateRecovery(f, {
  db = f.a, callId = CALL, generation = 0,
  nowMs = FAKE_RECOVERY_NOW, leaseUntilMs = FAKE_RECOVERY_NOW + 1000,
} = {}) {
  if (!validOpaqueId(callId) ||
      !Number.isSafeInteger(generation) || generation < 0 ||
      generation >= 2_147_483_647 ||
      !Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(leaseUntilMs) ||
      leaseUntilMs <= nowMs) return DENIED;
  try {
    const { meta } = await localD1Adapter(db)
      .prepare(CLAIM_PRIVATE_UNSENT_RECOVERY_QUERY)
      .bind(leaseUntilMs, callId, generation,
        nowMs, leaseUntilMs, nowMs, leaseUntilMs, nowMs).run();
    return meta?.changes === 1
      ? Object.freeze({ kind: "pre_send_lease_test_only",
        generation: generation + 1 }) : DENIED;
  } catch {
    return DENIED;
  }
}

const MARK_UNCERTAIN_TEST_ONLY_QUERY =
  "UPDATE fake_private_recovery_leases " +
  "SET phase='outcome_unknown_test_only',lease_until_ms=NULL " +
  "WHERE call_id=? AND phase='leased_pre_send_test_only' " +
  "AND generation=? AND lease_until_ms>?";

/** Just a local durable boundary marker; NO provider request follows. */
async function markFakeTransportUnknown(f, {
  db = f.a, callId = CALL, generation,
  nowMs = FAKE_RECOVERY_NOW + 10,
} = {}) {
  if (!validOpaqueId(callId) ||
      !Number.isSafeInteger(generation) || generation < 1 ||
      generation > 2_147_483_647 ||
      !Number.isSafeInteger(nowMs) || nowMs < 0) return DENIED;
  try {
    const { meta } = await localD1Adapter(db)
      .prepare(MARK_UNCERTAIN_TEST_ONLY_QUERY)
      .bind(callId, generation, nowMs).run();
    return meta?.changes === 1
      ? Object.freeze({ kind: "quarantined_unknown_test_only" }) : DENIED;
  } catch {
    return DENIED;
  }
}

function fakeRecoveryRows(db) {
  return db.prepare(
    "SELECT * FROM fake_private_recovery_leases ORDER BY call_id",
  ).all();
}

test("private D1 one-statement recovery rechecks actual state and only claims PRE-SEND fixture", async () => {
  const f = await trial();
  try {
    assert.deepEqual(seedFakeRecovery(f), DENIED,
      "a recovery job without an original server-held intent fails closed");
    assert.deepEqual(await claimFakePrivateRecovery(f), DENIED);
    await enable(f);
    assert.deepEqual(await stageOneStatementFakeUnsent(f),
      { kind: "unsent_staged_test_only" });
    assert.deepEqual(seedFakeRecovery(f),
      { kind: "seeded_unsent_test_only" });
    assert.deepEqual(seedFakeRecovery(f), DENIED);
    assert.equal(CLAIM_PRIVATE_UNSENT_RECOVERY_QUERY.includes("auth_sessions"), false,
      "background recovery does not ask for the caller's bearer");
    assert.equal(CLAIM_PRIVATE_UNSENT_RECOVERY_QUERY.includes("BEGIN"), false);
    assert.equal(CLAIM_PRIVATE_UNSENT_RECOVERY_QUERY.includes("COMMIT"), false);
    assert.deepEqual(await claimFakePrivateRecovery(f),
      { kind: "pre_send_lease_test_only", generation: 1 });
    assert.deepEqual(await claimFakePrivateRecovery(f), DENIED,
      "same generation may never claim the same fake job twice");
    assert.deepEqual(fakeRecoveryRows(f.b).map(row => ({
      phase: row.phase, generation: row.generation,
    })), [{ phase: "leased_pre_send_test_only", generation: 1 }]);
    assert.equal(fakeRecoveryRows(f.a)[0].pair_revision, 0);
    assert.equal(f.rows()[0].state, "unsent_test_only");
  } finally {
    f.close();
  }
});

test("private D1 recovery refuses blocks, OFF->ON epochs, account and listing revocations", async () => {
  const cases = [
    ["worker blocks caller", async f => {
      assert.deepEqual(await f.block(f.worker, CALLER), { kind: "updated" });
    }],
    ["caller blocks worker", async f => {
      assert.deepEqual(await f.block(f.caller, WORKER), { kind: "updated" });
    }],
    ["worker availability OFF", async f => {
      assert.equal((await f.available(false, 1)).kind, "updated");
    }],
    ["worker availability OFF ON", async f => {
      assert.equal((await f.available(false, 1)).kind, "updated");
      assert.equal((await f.available(true, 2)).kind, "updated");
    }],
    ["worker call consent OFF ON", async f => {
      assert.equal((await f.consent(false, 1)).kind, "updated");
      assert.equal((await f.consent(true, 2)).kind, "updated");
    }],
    ["caller disabled", async f => {
      f.b.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(CALLER);
    }],
    ["worker disabled", async f => {
      f.b.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER);
    }],
    ["listing unpublished", async f => {
      f.b.prepare(
        "UPDATE worker_listings SET status='unpublished' WHERE id=?",
      ).run(f.listing.id);
    }],
    ["listing moderation hidden", async f => {
      f.b.prepare(
        "UPDATE worker_listings SET moderation_status='hidden' WHERE id=?",
      ).run(f.listing.id);
    }],
    ["category disabled", async f => {
      f.b.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY);
    }],
  ];
  for (const [label, mutate] of cases) {
    const f = await trial();
    try {
      await enable(f);
      assert.equal((await stageOneStatementFakeUnsent(f)).kind,
        "unsent_staged_test_only", label);
      assert.equal(seedFakeRecovery(f).kind, "seeded_unsent_test_only");
      await mutate(f);
      assert.deepEqual(await claimFakePrivateRecovery(f), DENIED, label);
      assert.equal(fakeRecoveryRows(f.a)[0].phase,
        "pending_unsent_test_only", label);
    } finally {
      f.close();
    }
  }
});

test("historic block->unblock ABA remains fenced only when ALL mutation paths track fake pair revision", async () => {
  const f = await trial();
  try {
    await enable(f);
    assert.equal((await stageOneStatementFakeUnsent(f)).kind,
      "unsent_staged_test_only");
    assert.equal(seedFakeRecovery(f).kind, "seeded_unsent_test_only");
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: true,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: false,
    }), { kind: "mutated_test_only" });
    const actual = await readLocalCallerAgoraSafetyFacts(
      localD1Adapter(f.a), f.caller, f.listing.id,
    );
    assert.equal(actual.contactBlocked, false);
    assert.equal(fakePairRevision(f.a, CALLER, WORKER), 2);
    assert.deepEqual(await claimFakePrivateRecovery(f), DENIED,
      "original pair revision zero is now stale, even though current block is false");
    assert.equal(fakeRecoveryRows(f.a)[0].generation, 0);
  } finally {
    f.close();
  }
});

test("reclaim expired PRE-SEND lease with new generation; UNKNOWN outcome cannot be auto-retried", async () => {
  const f = await trial();
  try {
    await enable(f);
    assert.equal((await stageOneStatementFakeUnsent(f)).kind,
      "unsent_staged_test_only");
    assert.equal(seedFakeRecovery(f).kind, "seeded_unsent_test_only");
    assert.deepEqual(await claimFakePrivateRecovery(f),
      { kind: "pre_send_lease_test_only", generation: 1 });
    assert.deepEqual(await claimFakePrivateRecovery(f, {
      db: f.b, generation: 1,
      nowMs: FAKE_RECOVERY_NOW + 100,
      leaseUntilMs: FAKE_RECOVERY_NOW + 2_000,
    }), DENIED, "unexpired lease prevents another dispatcher");
    assert.deepEqual(await claimFakePrivateRecovery(f, {
      db: f.b, generation: 1,
      nowMs: FAKE_RECOVERY_NOW + 1_000,
      leaseUntilMs: FAKE_RECOVERY_NOW + 2_000,
    }), { kind: "pre_send_lease_test_only", generation: 2 });
    assert.deepEqual(await markFakeTransportUnknown(f, {
      generation: 1, nowMs: FAKE_RECOVERY_NOW + 1_010,
    }), DENIED, "stale generation cannot cross the transport uncertainty boundary");
    assert.deepEqual(await markFakeTransportUnknown(f, {
      db: f.b, generation: 2, nowMs: FAKE_RECOVERY_NOW + 1_020,
    }), { kind: "quarantined_unknown_test_only" });
    assert.deepEqual(await claimFakePrivateRecovery(f, {
      generation: 2, nowMs: FAKE_RECOVERY_NOW + 5_000,
      leaseUntilMs: FAKE_RECOVERY_NOW + 6_000,
    }), DENIED, "UNKNOWN is not an affirmative provider failure or safe resend");
    assert.deepEqual(await markFakeTransportUnknown(f, {
      generation: 2, nowMs: FAKE_RECOVERY_NOW + 1_030,
    }), DENIED);
    assert.equal(fakeRecoveryRows(f.a)[0].phase, "outcome_unknown_test_only");
    assert.equal(fakeRecoveryRows(f.a)[0].lease_until_ms, null);
    assert.equal(f.rows()[0].state, "unsent_test_only");
  } finally {
    f.close();
  }
});

test("private recovery deadlines, bad generations, two SQLite writers and missing state fail closed", async () => {
  const f = await trial();
  try {
    await enable(f);
    assert.equal((await stageOneStatementFakeUnsent(f)).kind,
      "unsent_staged_test_only");
    assert.equal(seedFakeRecovery(f).kind, "seeded_unsent_test_only");
    for (const bad of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER]) {
      assert.deepEqual(await claimFakePrivateRecovery(f, {
        generation: bad,
      }), DENIED);
    }
    assert.deepEqual(await claimFakePrivateRecovery(f, {
      leaseUntilMs: FAKE_RECOVERY_DEADLINE + 1,
    }), DENIED);
    assert.deepEqual(await claimFakePrivateRecovery(f, {
      nowMs: FAKE_RECOVERY_DEADLINE,
      leaseUntilMs: FAKE_RECOVERY_DEADLINE + 1,
    }), DENIED);
    f.a.exec("BEGIN IMMEDIATE");
    try {
      assert.deepEqual(await claimFakePrivateRecovery(f, {
        db: f.b,
      }), DENIED, "SQLite busy must never fabricate an acquired lease");
      assert.equal(fakeRecoveryRows(f.a)[0].generation, 0);
    } finally {
      f.a.exec("ROLLBACK");
    }
    assert.deepEqual(await claimFakePrivateRecovery(f, {
      db: f.b,
    }), { kind: "pre_send_lease_test_only", generation: 1 });
    assert.equal(fakeRecoveryRows(f.a).length, 1);
    assert.equal(fakeRecoveryRows(f.a)[0].generation, 1);
  } finally {
    f.close();
  }
});


/**
 * A disposable SQLite trigger rehearses one *all-or-nothing* original
 * admission + recovery enqueue. It is installed ONLY in explicitly scoped
 * tests and NEVER added to a production migration or callable API.
 *
 * The BEFORE work is the existing D1-shaped authenticated conditional
 * INSERT in stageOneStatementFakeUnsent. The AFTER trigger runs inside
 * that very same SQLite statement, so failure to persist the recovery row
 * must undo the original UNSENT insert. This does not make remote delivery
 * or cross-store D1/DO/Ago​ra operations atomic.
 */
function installFakeAtomicEnqueue(f, deadlineMs = FAKE_RECOVERY_DEADLINE) {
  assert.ok(Number.isSafeInteger(deadlineMs) && deadlineMs > 0);
  f.a.exec(
    "CREATE TRIGGER test_only_atomic_recovery_enqueue " +
    "AFTER INSERT ON fake_private_unsent_intents BEGIN " +
    "INSERT INTO fake_private_recovery_leases " +
    "(call_id,phase,generation,lease_until_ms,deadline_ms,pair_revision) " +
    "VALUES (NEW.call_id,'pending_unsent_test_only',0,NULL," +
    String(deadlineMs) + ",COALESCE((" +
    "SELECT epoch.revision FROM fake_block_pair_epochs AS epoch " +
    "WHERE epoch.lower_id=MIN(NEW.caller_id,NEW.worker_id) " +
    "AND epoch.upper_id=MAX(NEW.caller_id,NEW.worker_id)),0)); " +
    "END",
  );
}

/** Read-only integrity check; NEVER silently reconstruct a missing record.
 * Orphans are not safe to resend or to call a successful recovery.
 * Return only aggregate shape, no personal pair, bearer or block direction.
 */
function auditFakeAtomicEnqueue(f, db = f.a) {
  try {
    const missing = db.prepare(
      "SELECT COUNT(*) AS n FROM fake_private_unsent_intents AS intent " +
      "LEFT JOIN fake_private_recovery_leases AS lease " +
      "ON lease.call_id=intent.call_id " +
      "WHERE lease.call_id IS NULL",
    ).get()?.n;
    const foreign = db.prepare(
      "SELECT COUNT(*) AS n FROM fake_private_recovery_leases AS lease " +
      "LEFT JOIN fake_private_unsent_intents AS intent " +
      "ON intent.call_id=lease.call_id " +
      "WHERE intent.call_id IS NULL",
    ).get()?.n;
    if (typeof missing !== "number" || typeof foreign !== "number" ||
        missing !== 0 || foreign !== 0 ||
        db.prepare("PRAGMA foreign_key_check").all().length !== 0) return DENIED;
    return Object.freeze({ kind: "consistent_test_only" });
  } catch {
    return DENIED;
  }
}

test("one authenticated D1-shaped INSERT atomically persists fake UNSENT and matching recovery row", async () => {
  const f = await trial();
  try {
    installFakeAtomicEnqueue(f);
    assert.deepEqual(auditFakeAtomicEnqueue(f), { kind: "consistent_test_only" });
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED,
      "default-OFF cannot create either linked record");
    assert.deepEqual(f.rows(), []);
    assert.deepEqual(fakeRecoveryRows(f.b), []);
    await enable(f);
    assert.deepEqual(await stageOneStatementFakeUnsent(f),
      { kind: "unsent_staged_test_only" });
    assert.deepEqual(auditFakeAtomicEnqueue(f, f.b),
      { kind: "consistent_test_only" });
    assert.equal(f.rows().length, 1);
    assert.deepEqual(fakeRecoveryRows(f.b).map(row => ({ ...row })), [{
      call_id: CALL, phase: "pending_unsent_test_only",
      generation: 0, lease_until_ms: null,
      deadline_ms: FAKE_RECOVERY_DEADLINE, pair_revision: 0,
    }]);
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED,
      "duplicate call ID must not fire a second enqueue");
    assert.equal(fakeRecoveryRows(f.b).length, 1);
    assert.deepEqual(await claimFakePrivateRecovery(f, { db: f.b }),
      { kind: "pre_send_lease_test_only", generation: 1 });
    assert.equal(f.rows()[0].state, "unsent_test_only",
      "lease is not a delivered call or transport attempt");
  } finally {
    f.close();
  }
});

test("child INSERT crash aborts the original fake intent and leaves no recoverable orphan", async () => {
  const f = await trial();
  try {
    await enable(f);
    installFakeAtomicEnqueue(f);
    // Fault injected before the trigger's child row can persist. The parent
    // insert is rolled back by SQLite's single-statement atomicity.
    f.a.exec(
      "CREATE TRIGGER test_only_fail_recovery_child " +
      "BEFORE INSERT ON fake_private_recovery_leases BEGIN " +
      "SELECT RAISE(ABORT,'synthetic child persistence failure'); END",
    );
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED);
    assert.deepEqual(f.rows(), []);
    assert.deepEqual(fakeRecoveryRows(f.b), []);
    assert.deepEqual(auditFakeAtomicEnqueue(f, f.b),
      { kind: "consistent_test_only" });
    f.a.exec("DROP TRIGGER test_only_fail_recovery_child");
    assert.deepEqual(await stageOneStatementFakeUnsent(f),
      { kind: "unsent_staged_test_only" });
    assert.equal(f.rows().length, 1);
    assert.equal(fakeRecoveryRows(f.b).length, 1);
    assert.deepEqual(auditFakeAtomicEnqueue(f),
      { kind: "consistent_test_only" });
  } finally {
    f.close();
  }
});

test("old separately staged UNSENT without recovery is detected and not silently reconstructed", async () => {
  const f = await trial();
  try {
    await enable(f);
    assert.equal((await stageOneStatementFakeUnsent(f)).kind,
      "unsent_staged_test_only");
    assert.deepEqual(fakeRecoveryRows(f.a), [],
      "old fixture path had no atomic recovery enqueue");
    installFakeAtomicEnqueue(f);
    assert.deepEqual(auditFakeAtomicEnqueue(f), DENIED,
      "orphaned original intent is a recovery blocker, not an invitation to replay");
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED);
    assert.deepEqual(await claimFakePrivateRecovery(f), DENIED);
    assert.equal(fakeRecoveryRows(f.a).length, 0,
      "audit must not backfill unknown historical delivery outcome");
    // A new, separate test-only call identifier can be staged consistently.
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      callId: OTHER_CALL,
    }), { kind: "unsent_staged_test_only" });
    assert.equal(fakeRecoveryRows(f.a).length, 1);
    assert.deepEqual(auditFakeAtomicEnqueue(f), DENIED,
      "one healthy new record does not repair the earlier orphan");
  } finally {
    f.close();
  }
});

test("two local writers cannot split atomic enqueue and new pair revision remains pinned", async () => {
  const f = await trial();
  try {
    await enable(f);
    installFakeAtomicEnqueue(f);
    f.a.exec("BEGIN IMMEDIATE");
    try {
      assert.deepEqual(await stageOneStatementFakeUnsent(f, { db: f.b }), DENIED);
      assert.deepEqual(f.rows(), []);
      assert.deepEqual(fakeRecoveryRows(f.a), []);
    } finally {
      f.a.exec("ROLLBACK");
    }
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: true,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.worker, target: CALLER, blocked: false,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED,
      "stale expected pair revision zero cannot enqueue");
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      db: f.b, expectedPairRevision: 2,
    }), { kind: "unsent_staged_test_only" });
    assert.equal(fakeRecoveryRows(f.a)[0].pair_revision, 2,
      "original UNSENT and recovery must capture one pair version");
    assert.deepEqual(auditFakeAtomicEnqueue(f, f.b),
      { kind: "consistent_test_only" });
    assert.deepEqual(await claimFakePrivateRecovery(f),
      { kind: "pre_send_lease_test_only", generation: 1 });
    assert.deepEqual(await mutateTestPairWithEpoch(f, {
      bearer: f.caller, target: WORKER, blocked: true,
    }), { kind: "mutated_test_only" });
    assert.deepEqual(await claimFakePrivateRecovery(f, {
      generation: 1, nowMs: FAKE_RECOVERY_NOW + 1000,
      leaseUntilMs: FAKE_RECOVERY_NOW + 2000,
    }), DENIED, "a later block invalidates the original recovery epoch");
  } finally {
    f.close();
  }
});

test("UNKNOWN test-only outcome stays quarantined across a simulated second-worker restart", async () => {
  const f = await trial();
  try {
    await enable(f);
    installFakeAtomicEnqueue(f);
    assert.equal((await stageOneStatementFakeUnsent(f)).kind,
      "unsent_staged_test_only");
    assert.deepEqual(await claimFakePrivateRecovery(f),
      { kind: "pre_send_lease_test_only", generation: 1 });
    assert.deepEqual(await markFakeTransportUnknown(f, {
      generation: 1,
    }), { kind: "quarantined_unknown_test_only" });
    assert.deepEqual(auditFakeAtomicEnqueue(f, f.b),
      { kind: "consistent_test_only" });
    assert.deepEqual(await claimFakePrivateRecovery(f, {
      db: f.b, generation: 1, nowMs: FAKE_RECOVERY_NOW + 1001,
      leaseUntilMs: FAKE_RECOVERY_NOW + 2001,
    }), DENIED);
    assert.deepEqual(await stageOneStatementFakeUnsent(f, {
      db: f.b,
    }), DENIED);
    assert.equal(fakeRecoveryRows(f.b)[0].phase,
      "outcome_unknown_test_only");
    assert.equal(f.rows().length, 1);
    assert.equal(f.rows()[0].state, "unsent_test_only",
      "UNKNOWN is not delivered, failed, or safe for automatic retransmission");
  } finally {
    f.close();
  }
});


test("failure after fake recovery child INSERT aborts the entire one-statement parent enqueue", async () => {
  const f = await trial();
  try {
    await enable(f);
    installFakeAtomicEnqueue(f);
    f.a.exec(
      "CREATE TRIGGER test_only_after_child_failure " +
      "AFTER INSERT ON fake_private_recovery_leases BEGIN " +
      "SELECT RAISE(ABORT,'synthetic crash after recovery child insert'); END",
    );
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED);
    assert.deepEqual(f.rows(), []);
    assert.deepEqual(fakeRecoveryRows(f.b), [],
      "even an AFTER-child failure must roll back both linked rows");
    f.a.exec("DROP TRIGGER test_only_after_child_failure");
    assert.deepEqual(await stageOneStatementFakeUnsent(f, { db: f.b }),
      { kind: "unsent_staged_test_only" });
    assert.deepEqual(auditFakeAtomicEnqueue(f),
      { kind: "consistent_test_only" });
  } finally {
    f.close();
  }
});

test("corrupt orphan recovery is withheld, never silently reattached or replayed", async () => {
  const f = await trial();
  try {
    await enable(f);
    installFakeAtomicEnqueue(f);
    assert.equal((await stageOneStatementFakeUnsent(f)).kind,
      "unsent_staged_test_only");
    // Deliberate disposable DB corruption simulates a broken external repair
    // or restore process. Not a production cleanup/deletion recipe.
    f.b.exec("PRAGMA foreign_keys=OFF");
    try {
      assert.equal(f.b.prepare(
        "DELETE FROM fake_private_unsent_intents WHERE call_id=?",
      ).run(CALL).changes, 1);
    } finally {
      f.b.exec("PRAGMA foreign_keys=ON");
    }
    assert.deepEqual(f.rows(), []);
    assert.equal(fakeRecoveryRows(f.a).length, 1);
    assert.deepEqual(auditFakeAtomicEnqueue(f), DENIED);
    assert.deepEqual(await claimFakePrivateRecovery(f), DENIED);
    assert.deepEqual(await stageOneStatementFakeUnsent(f), DENIED,
      "a stale dangling child must not be overwritten by a fresh parent");
    assert.deepEqual(f.rows(), []);
    assert.equal(fakeRecoveryRows(f.b).length, 1,
      "no automatic repair or unsafe retry after inconsistent restore");
  } finally {
    f.close();
  }
});
