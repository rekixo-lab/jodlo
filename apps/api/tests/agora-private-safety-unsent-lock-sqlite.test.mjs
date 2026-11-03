import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localD1Adapter } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession, revokeSession } from "../src/modules/identity/sessions.ts";
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
