import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localD1Adapter, openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { setOwnWorkerAgoraCallPreference } from
  "../src/modules/workers/agora-call-preference.ts";
import {
  readCallerSessionBoundAgoraConsentEpoch,
  readWorkerSessionBoundAgoraConsentEpochMatch,
} from "../src/modules/interactions/request-target.ts";
import {
  prepareSyntheticAgoraInvite, decideSyntheticAgoraCallEvent,
} from "../src/modules/interactions/agora-call-lifecycle.ts";
import { assessSyntheticAgoraRtcConsentEpochPreflight } from
  "../src/modules/interactions/agora-rtc-preflight.ts";
import { validOpaqueId } from "../src/modules/shared/identifiers.ts";

/**
 * M-003/M-005 OFFLINE DESIGN REHEARSAL — TWO LOCAL SQLITE CONNECTIONS.
 *
 * Reuses unmodified REAL catalog/identity/worker-consent migrations in a
 * disposable file, plus fake call + UNSENT intent tables that exist ONLY
 * inside this test. A local BEGIN IMMEDIATE serializes the caller's CURRENT
 * consent read with immutable ORIGINAL-epoch call and UNSENT intent staging.
 *
 * No real caller/worker presence, block store, availability, capacity
 * decision, durable provider record, D1/DO cross-region atomic guarantee,
 * credential issuer, device notification or Agora signaling. All scheduled
 * clocks and policy facts are exclusively injected test fixtures. No P02
 * one/two-slot option is chosen by this test.
 */
const CALLER = "account-two-writer-caller-01";
const WORKER = "account-two-writer-worker-01";
const OTHER = "account-two-writer-other-001";
const CATEGORY = "two-writer-agora-test";
const CALL_A = "call-two-writer-original-001";
const CALL_B = "call-two-writer-original-002";
const CALL_C = "call-two-writer-new-epoch01";
const CREATED = 1_800_000_000_000;
const withheld = Object.freeze({ kind: "withheld" });
const goodPolicy = () => ({
  listingAvailable: true, blockedByRequester: false,
  blockedByWorker: false, workerConsentedToCalls: true,
  callDestinationVerified: true, connectionPrivacyApproved: true,
  abuseLimitPassed: true,
});
const MIGRATIONS = [
  "0001_public_catalog.sql", "0002_shared_accounts_worker_drafts.sql",
  "0003_google_identity_sessions.sql", "0004_worker_service_listings.sql",
  "0011_worker_listing_revision.sql", "0015_service_reports_and_appeals.sql",
  "0005_notification_delivery_receipts.sql",
  "0006_notification_dead_letters.sql",
  "0007_worker_agora_call_preferences.sql",
  "0008_agora_private_safety_state.sql",
];

async function createTrial() {
  const dir = mkdtempSync(join(tmpdir(), "jodlo-epoch-two-writer-"));
  const file = join(dir, "disposable.sqlite");
  const a = new DatabaseSync(file);
  const b = new DatabaseSync(file);
  try {
    a.exec("PRAGMA journal_mode=WAL");
    for (const db of [a, b]) {
      db.exec("PRAGMA foreign_keys=ON");
      db.exec("PRAGMA busy_timeout=0");
    }
    for (const name of MIGRATIONS) {
      a.exec(readFileSync(new URL("../../../infra/migrations/" + name,
        import.meta.url), "utf8"));
    }
    a.exec(
      "CREATE TABLE fake_epoch_journal (" +
      "call_id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, " +
      "caller_id TEXT NOT NULL, worker_id TEXT NOT NULL, " +
      "original_epoch INTEGER NOT NULL " +
      "CHECK(original_epoch BETWEEN 1 AND 2147483647), " +
      "call_revision INTEGER NOT NULL CHECK(call_revision BETWEEN 0 AND 3), " +
      "snapshot_json TEXT NOT NULL);" +
      "CREATE TABLE fake_epoch_unsent (" +
      "call_id TEXT PRIMARY KEY REFERENCES fake_epoch_journal(call_id), " +
      "state TEXT NOT NULL CHECK(state IN " +
      "('pending_test_only','claimed_test_only','revoked_test_only')));" +
      "CREATE TRIGGER fake_epoch_identity_immutable " +
      "BEFORE UPDATE OF call_id,listing_id,caller_id,worker_id,original_epoch " +
      "ON fake_epoch_journal BEGIN " +
      "SELECT RAISE(ABORT,'test-only original epoch immutable'); END;"
    );
    const adapters = [localD1Adapter(a), localD1Adapter(b)];
    for (const account of [CALLER, WORKER, OTHER])
      await ensureAccount(adapters[0], account);
    await optInAsWorker(adapters[0], WORKER);
    a.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)"
    ).run(CATEGORY, CATEGORY, "Synthetic writer", "परीक्षण लेखन");
    const listing = await publishListing(adapters[0], WORKER, CATEGORY);
    assert.ok(listing);
    const caller = (await issueSession(adapters[0], CALLER))?.accessToken;
    const worker = (await issueSession(adapters[0], WORKER))?.accessToken;
    const other = (await issueSession(adapters[0], OTHER))?.accessToken;
    assert.ok(caller && worker && other);
    return {
      db: [a, b], adapters, listing, caller, worker, other,
      close() {
        a.close(); b.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    a.close(); b.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
async function withTrial(fn) {
  const f = await createTrial();
  try { await fn(f); } finally { f.close(); }
}
function preference(db) {
  const r = db.prepare(
    "SELECT p.calls_enabled AS enabled,p.revision AS revision " +
    "FROM worker_agora_call_preferences AS p WHERE p.account_id=?"
  ).get(WORKER);
  return r ? { enabled: r.enabled, revision: r.revision } : null;
}
function journal(db, callId) {
  const row = db.prepare(
    "SELECT * FROM fake_epoch_journal WHERE call_id=?"
  ).get(callId);
  if (!row) return null;
  try {
    return {
      callId: row.call_id, listingId: row.listing_id,
      callerId: row.caller_id, workerId: row.worker_id,
      originalEpoch: row.original_epoch, revision: row.call_revision,
      call: JSON.parse(row.snapshot_json),
    };
  } catch {
    return null;
  }
}
function rows(db) {
  return db.prepare(
    "SELECT j.call_id AS call_id,j.original_epoch AS original_epoch, " +
    "j.call_revision AS call_revision,q.state AS state " +
    "FROM fake_epoch_journal AS j JOIN fake_epoch_unsent AS q " +
    "ON q.call_id=j.call_id ORDER BY j.call_id"
  ).all().map(r => ({ ...r }));
}
function consistent(j, id) {
  return j && j.callId === id &&
    validOpaqueId(j.callId) && validOpaqueId(j.listingId) &&
    validOpaqueId(j.callerId) && validOpaqueId(j.workerId) &&
    j.callerId !== j.workerId &&
    Number.isSafeInteger(j.originalEpoch) &&
    j.originalEpoch >= 1 && j.originalEpoch <= 2_147_483_647 &&
    Number.isSafeInteger(j.revision) && j.revision >= 0 && j.revision <= 3 &&
    j.call && typeof j.call === "object" && !Array.isArray(j.call) &&
    j.call.callId === id && j.call.listingId === j.listingId &&
    j.call.callerAccountId === j.callerId &&
    j.call.workerAccountId === j.workerId &&
    j.call.revision === j.revision;
}
const rollback = db => db.exec("ROLLBACK");

/** Caller-own D1 evidence, original epoch, snapshot and UNSENT are ONE write. */
async function stage(f, index, callId, {
  bearer = f.caller, failAfterJournal = false, failAfterUnsent = false,
} = {}) {
  if (!validOpaqueId(callId)) return withheld;
  const db = f.db[index], adapter = f.adapters[index];
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = await readCallerSessionBoundAgoraConsentEpoch(
      adapter, bearer, f.listing.id,
    );
    if (!current) {
      rollback(db);
      return withheld;
    }
    const prepared = prepareSyntheticAgoraInvite(
      current.target, goodPolicy(), callId, CREATED, CREATED + 30000,
    );
    if (prepared.kind !== "prepared") {
      rollback(db);
      return withheld;
    }
    // Never recycle a call ID for any participant, even after OFF/ON.
    if (journal(db, callId)) {
      rollback(db);
      return withheld;
    }
    db.prepare(
      "INSERT INTO fake_epoch_journal VALUES(?,?,?,?,?,?,?)"
    ).run(callId, prepared.call.listingId, current.target.requesterAccountId,
      current.target.workerAccountId, current.consentRevision, 0,
      JSON.stringify(prepared.call));
    if (failAfterJournal) throw Error("synthetic crash after journal");
    db.prepare("INSERT INTO fake_epoch_unsent VALUES(?,?)")
      .run(callId, "pending_test_only");
    if (failAfterUnsent) throw Error("synthetic crash after UNSENT");
    db.exec("COMMIT");
    return Object.freeze({ kind: "staged_unsent_test_only" });
  } catch (error) {
    rollback(db);
    throw error;
  }
}

/**
 * Trusted fixture worker-owned acceptance only: compare the ORIGINAL epoch,
 * not the freshly enabled worker's current revision, under the same local
 * write lock as the test call's revision CAS and UNSENT state change.
 */
async function accept(f, index, callId, { bearer = f.worker } = {}) {
  const db = f.db[index], adapter = f.adapters[index];
  db.exec("BEGIN IMMEDIATE");
  try {
    const j = journal(db, callId);
    const intent = db.prepare(
      "SELECT state FROM fake_epoch_unsent WHERE call_id=?"
    ).get(callId);
    if (!consistent(j, callId) || j.call.phase !== "ringing" ||
        j.revision !== 0 || intent?.state !== "pending_test_only") {
      rollback(db);
      return withheld;
    }
    const facts = await readWorkerSessionBoundAgoraConsentEpochMatch(
      adapter, bearer, j.listingId, j.callerId, j.originalEpoch,
    );
    if (!facts || facts.workerAccountId !== j.workerId ||
        facts.requesterAccountId !== j.callerId) {
      rollback(db);
      return withheld;
    }
    const next = decideSyntheticAgoraCallEvent(j.call, {
      actorAccountId: facts.workerAccountId,
      event: "accept", expectedRevision: 0,
      idempotencyKey: "dual-writer-accept-" + callId,
      nowMs: CREATED + 1000,
    });
    if (next.kind !== "apply" || next.result.phase !== "accepted") {
      rollback(db);
      return withheld;
    }
    const changed = db.prepare(
      "UPDATE fake_epoch_journal SET call_revision=?,snapshot_json=? " +
      "WHERE call_id=? AND call_revision=0 AND snapshot_json=?"
    ).run(1, JSON.stringify(next.result), callId, JSON.stringify(j.call));
    const claim = db.prepare(
      "UPDATE fake_epoch_unsent SET state='claimed_test_only' " +
      "WHERE call_id=? AND state='pending_test_only'"
    ).run(callId);
    if (changed.changes !== 1 || claim.changes !== 1)
      throw Error("synthetic accept CAS inconsistency");
    db.exec("COMMIT");
    return Object.freeze({ kind: "accepted_test_only" });
  } catch (error) {
    rollback(db);
    throw error;
  }
}

/** Worker-owned OFF transaction, not external Agora cancellation. */
async function optOut(f, index, epoch, {
  failAfterPreference = false, failAfterTombstone = false,
} = {}) {
  const db = f.db[index], adapter = f.adapters[index];
  db.exec("BEGIN IMMEDIATE");
  try {
    const update = await setOwnWorkerAgoraCallPreference(
      adapter, f.worker, false, epoch,
    );
    if (update.kind !== "updated") {
      rollback(db);
      return withheld;
    }
    if (failAfterPreference) throw Error("synthetic crash after preference OFF");
    const changed = db.prepare(
      "UPDATE fake_epoch_unsent SET state='revoked_test_only' " +
      "WHERE state='pending_test_only' AND call_id IN (" +
      "SELECT call_id FROM fake_epoch_journal WHERE worker_id=? " +
      "AND original_epoch<=?)"
    ).run(WORKER, epoch);
    if (failAfterTombstone) throw Error("synthetic crash after tombstone");
    db.exec("COMMIT");
    return Object.freeze({
      kind: "revoked_unsent_test_only", count: Number(changed.changes),
    });
  } catch (error) {
    rollback(db);
    throw error;
  }
}

/**
 * Read-only local join prerequisite. Request has no epoch, caller account,
 * worker account, listing or snapshot. Those come from test-owned rows.
 * No provider grant, token, send, media state proof or distributed lock.
 */
async function preview(f, index, request) {
  const fields = ["callId", "role", "bearer", "expectedCallRevision"];
  if (!request || typeof request !== "object" ||
      Array.isArray(request) ||
      Object.keys(request).length !== fields.length ||
      fields.some(k => !Object.hasOwn(request, k)) ||
      !validOpaqueId(request.callId) ||
      !["caller", "worker"].includes(request.role) ||
      !Number.isSafeInteger(request.expectedCallRevision) ||
      request.expectedCallRevision < 0) return withheld;
  const db = f.db[index], adapter = f.adapters[index];
  const j = journal(db, request.callId);
  const q = db.prepare(
    "SELECT state FROM fake_epoch_unsent WHERE call_id=?"
  ).get(request.callId);
  if (!consistent(j, request.callId) ||
      j.revision !== request.expectedCallRevision ||
      q?.state !== "claimed_test_only") return withheld;
  const verdict = await assessSyntheticAgoraRtcConsentEpochPreflight(
    adapter, j.call, request.bearer, request.role, j.revision,
    j.originalEpoch, goodPolicy(),
  );
  return verdict.kind === "prerequisite_only" ? verdict : withheld;
}
const request = (id, role, bearer, expectedCallRevision = 1) => ({
  callId: id, role, bearer, expectedCallRevision,
});

test("real local consent defaults OFF; no journal or UNSENT intent is staged", async () => {
  await withTrial(async f => {
    assert.equal(preference(f.db[0]), null);
    assert.deepEqual(await stage(f, 0, CALL_A), withheld);
    assert.deepEqual(rows(f.db[1]), []);
    assert.deepEqual(await preview(f, 1, request(CALL_A, "caller", f.caller)),
      withheld);
  });
});

test("two writers contend on one call ID; only one local journal plus UNSENT intent", async () => {
  await withTrial(async f => {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapters[0], f.worker, true, 0)).kind, "updated");
    f.db[0].exec("BEGIN IMMEDIATE");
    try {
      await assert.rejects(() => stage(f, 1, CALL_A), /database is locked|SQLITE_BUSY/i);
      assert.deepEqual(rows(f.db[0]), []);
      assert.deepEqual(rows(f.db[1]), []);
      assert.deepEqual(preference(f.db[0]), { enabled: 1, revision: 1 });
    } finally { rollback(f.db[0]); }
    assert.deepEqual(await stage(f, 1, CALL_A),
      { kind: "staged_unsent_test_only" });
    assert.deepEqual(await stage(f, 0, CALL_A), withheld,
      "same call ID must not duplicate an UNSENT alert");
    assert.deepEqual(rows(f.db[0]), [{
      call_id: CALL_A, original_epoch: 1,
      call_revision: 0, state: "pending_test_only",
    }]);
    assert.equal(journal(f.db[1], CALL_A).originalEpoch, 1);
    assert.deepEqual(f.db[1].prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("local crash at either persistence boundary rolls back call and UNSENT together", async () => {
  for (const failing of ["failAfterJournal", "failAfterUnsent"]) {
    await withTrial(async f => {
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapters[0], f.worker, true, 0)).kind, "updated");
      await assert.rejects(() => stage(f, 0, CALL_A, { [failing]: true }),
        /synthetic crash/);
      assert.deepEqual(rows(f.db[1]), []);
      assert.equal(journal(f.db[1], CALL_A), null);
      assert.deepEqual(await stage(f, 1, CALL_A),
        { kind: "staged_unsent_test_only" });
      assert.equal(rows(f.db[0]).length, 1);
    });
  }
});

test("consent OFF blocks new admission and tombstones old pending UNSENT atomically", async () => {
  await withTrial(async f => {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapters[0], f.worker, true, 0)).kind, "updated");
    assert.equal((await stage(f, 0, CALL_A)).kind, "staged_unsent_test_only");
    assert.equal((await stage(f, 1, CALL_B)).kind, "staged_unsent_test_only");
    assert.deepEqual(await optOut(f, 1, 1),
      { kind: "revoked_unsent_test_only", count: 2 });
    assert.deepEqual(preference(f.db[0]), { enabled: 0, revision: 2 });
    assert.deepEqual(rows(f.db[0]).map(r => r.state),
      ["revoked_test_only", "revoked_test_only"]);
    assert.deepEqual(await stage(f, 0, CALL_C), withheld);
    assert.deepEqual(await accept(f, 1, CALL_A), withheld);
    assert.deepEqual(await optOut(f, 0, 1), withheld);
    assert.deepEqual(journal(f.db[0], CALL_A).originalEpoch, 1);

    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapters[1], f.worker, true, 2)).kind, "updated");
    assert.deepEqual(await stage(f, 0, CALL_A), withheld);
    assert.deepEqual(await stage(f, 1, CALL_B), withheld);
    assert.deepEqual(await accept(f, 0, CALL_B), withheld);
    assert.deepEqual(await stage(f, 1, CALL_C),
      { kind: "staged_unsent_test_only" });
    assert.equal(journal(f.db[0], CALL_C).originalEpoch, 3);
    assert.deepEqual(await accept(f, 0, CALL_C), { kind: "accepted_test_only" });
    assert.deepEqual(await preview(f, 1,
      request(CALL_C, "caller", f.caller)), {
      kind: "prerequisite_only", role: "caller",
    });
  });
});

test("OFF loses local writer lock, cannot race an admitted call into another epoch", async () => {
  await withTrial(async f => {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapters[0], f.worker, true, 0)).kind, "updated");
    f.db[0].exec("BEGIN IMMEDIATE");
    try {
      const refused = await optOut(f, 1, 1).catch(() => withheld);
      assert.deepEqual(refused, withheld);
      assert.deepEqual(preference(f.db[0]), { enabled: 1, revision: 1 });
      assert.deepEqual(rows(f.db[0]), []);
    } finally { rollback(f.db[0]); }
    assert.deepEqual(await stage(f, 1, CALL_A),
      { kind: "staged_unsent_test_only" });
    assert.deepEqual(await optOut(f, 0, 1),
      { kind: "revoked_unsent_test_only", count: 1 });
    assert.equal(rows(f.db[1])[0].state, "revoked_test_only");
  });
});

test("crash after OFF preference or first tombstone rolls back both real preference and fake intents", async () => {
  for (const failure of ["failAfterPreference", "failAfterTombstone"]) {
    await withTrial(async f => {
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapters[0], f.worker, true, 0)).kind, "updated");
      assert.equal((await stage(f, 0, CALL_A)).kind, "staged_unsent_test_only");
      assert.equal((await stage(f, 1, CALL_B)).kind, "staged_unsent_test_only");
      const before = rows(f.db[0]);
      await assert.rejects(() => optOut(f, 0, 1, { [failure]: true }),
        /synthetic crash/);
      assert.deepEqual(preference(f.db[1]), { enabled: 1, revision: 1 });
      assert.deepEqual(rows(f.db[1]), before);
      assert.deepEqual(await optOut(f, 1, 1),
        { kind: "revoked_unsent_test_only", count: 2 });
    });
  }
});

test("accepted local call remains accepted on OFF, but old epoch cannot grant new join", async () => {
  await withTrial(async f => {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapters[0], f.worker, true, 0)).kind, "updated");
    assert.equal((await stage(f, 1, CALL_A)).kind, "staged_unsent_test_only");
    assert.deepEqual(await accept(f, 0, CALL_A),
      { kind: "accepted_test_only" });
    for (const [role, bearer] of [
      ["caller", f.caller], ["worker", f.worker],
    ]) {
      assert.deepEqual(await preview(f, 1, request(CALL_A, role, bearer)),
        { kind: "prerequisite_only", role });
    }
    assert.deepEqual(await optOut(f, 1, 1),
      { kind: "revoked_unsent_test_only", count: 0 },
      "claimed local intent must not be falsely labelled provider-cancelled");
    assert.deepEqual(preference(f.db[0]), { enabled: 0, revision: 2 });
    assert.equal(journal(f.db[1], CALL_A).call.phase, "accepted");
    assert.equal(rows(f.db[1])[0].state, "claimed_test_only");
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapters[0], f.worker, true, 2)).kind, "updated");
    for (const [role, bearer] of [
      ["caller", f.caller], ["worker", f.worker],
    ]) {
      assert.deepEqual(await preview(f, 0, request(CALL_A, role, bearer)),
        withheld);
    }
    assert.equal(journal(f.db[0], CALL_A).originalEpoch, 1);
  });
});

test("foreign bearer, client epoch and corrupted journal/outbox deny offline join proof", async () => {
  await withTrial(async f => {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapters[0], f.worker, true, 0)).kind, "updated");
    assert.equal((await stage(f, 0, CALL_A)).kind, "staged_unsent_test_only");
    assert.equal((await accept(f, 1, CALL_A)).kind, "accepted_test_only");
    const good = request(CALL_A, "caller", f.caller);
    for (const bad of [
      { ...good, originalConsentRevision: 1 },
      { ...good, currentConsentEpoch: 1 },
      { ...good, callerAccountId: CALLER },
      { ...good, workerAccountId: WORKER },
      { ...good, snapshot: journal(f.db[0], CALL_A).call },
      { ...good, expectedCallRevision: "1" },
      { ...good, role: "admin" }, null,
    ]) assert.deepEqual(await preview(f, 1, bad), withheld);
    assert.deepEqual(await preview(f, 0,
      request(CALL_A, "caller", f.other)), withheld);
    assert.deepEqual(await preview(f, 0,
      request(CALL_A, "worker", f.caller)), withheld);
    assert.deepEqual(await preview(f, 1, good),
      { kind: "prerequisite_only", role: "caller" });

    const previous = journal(f.db[0], CALL_A);
    f.db[0].prepare(
      "UPDATE fake_epoch_journal SET call_revision=2 WHERE call_id=?"
    ).run(CALL_A);
    assert.deepEqual(await preview(f, 1, good), withheld);
    f.db[0].prepare(
      "UPDATE fake_epoch_journal SET call_revision=1,snapshot_json=? " +
      "WHERE call_id=?"
    ).run(JSON.stringify(previous.call), CALL_A);
    f.db[0].prepare(
      "UPDATE fake_epoch_unsent SET state='revoked_test_only' WHERE call_id=?"
    ).run(CALL_A);
    assert.deepEqual(await preview(f, 1, good), withheld);
    assert.deepEqual(f.db[0].prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("original worker epoch and participant/listing fields cannot be rebased by normal updates", async () => {
  await withTrial(async f => {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapters[0], f.worker, true, 0)).kind, "updated");
    assert.equal((await stage(f, 0, CALL_A)).kind, "staged_unsent_test_only");
    for (const [field, value] of [
      ["original_epoch", 3], ["caller_id", OTHER], ["worker_id", OTHER],
      ["listing_id", "listing-two-writer-other001"], ["call_id", CALL_B],
    ]) {
      assert.throws(() => f.db[1].prepare(
        "UPDATE fake_epoch_journal SET " + field + "=? WHERE call_id=?"
      ).run(value, CALL_A), /immutable/);
    }
    assert.equal(journal(f.db[1], CALL_A).originalEpoch, 1);
    assert.equal(rows(f.db[0]).length, 1);
  });
});

test("test-only call/outbox schema is absent from production migrations and stores no tokens", async () => {
  const real = openLocalDatabase();
  try {
    const names = real.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' OR type='trigger'"
    ).all().map(x => x.name);
    for (const table of [
      "fake_epoch_journal", "fake_epoch_unsent",
      "fake_epoch_identity_immutable", "agora_call_sessions",
      "rtc_channels",
    ]) assert.equal(names.includes(table), false, table);
  } finally { real.db.close(); }
  await withTrial(async f => {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapters[0], f.worker, true, 0)).kind, "updated");
    assert.equal((await stage(f, 1, CALL_A)).kind, "staged_unsent_test_only");
    const saved = JSON.stringify([
      ...f.db[0].prepare("SELECT * FROM fake_epoch_journal").all(),
      ...f.db[1].prepare("SELECT * FROM fake_epoch_unsent").all(),
    ]);
    for (const prohibited of [
      f.caller, f.worker, f.other, "phone_number", "phoneNumber",
      "Bearer ", "agoraToken", "rtcUid", "channelName",
      "deviceToken", "mediaEndedAt", "providerAcknowledged",
    ]) assert.equal(saved.includes(prohibited), false, "test secret present");
  });
});
