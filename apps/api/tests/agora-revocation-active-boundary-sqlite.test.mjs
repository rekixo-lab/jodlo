import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideSyntheticAgoraCallEvent } from
  "../src/modules/interactions/agora-call-lifecycle.ts";
import { validOpaqueId } from "../src/modules/shared/identifiers.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

/**
 * M-005 / ADR-0014 BOUNDARY TEST, DISPOSABLE SQLITE ONLY.
 *
 * Synthetic worker consent OFF must withhold further accept/join previews and
 * tombstone UNSENT local invite intents. Already accepted or connected calls
 * are NOT pronounced ended: an unimplemented provider cancellation, token
 * revocation, ACK and active-media policy cannot be inferred from local D1.
 *
 * No live sessions, actual provider send, device, push, RTC credential,
 * worker busy slot, production D1 metadata, or chosen policy/timeout. These
 * IDs and clocks are hardcoded offline fixtures, never caller-supplied JSON.
 */
const WORKER = "worker-boundary-test-0001";
const OTHER_WORKER = "worker-boundary-test-0002";
const CALLER = "caller-boundary-test-0001";
const OTHER_CALLER = "caller-boundary-test-0002";
const CATEGORY = "boundary-voice-test";
const LISTING = "listing-boundary-test-0001";
const NOW = 1_800_000_000_000;
const DEADLINE = NOW + 30_000;
const RING = "call-boundary-ringing-0001";
const ACCEPTED = "call-boundary-accepted-001";
const CONNECTED = "call-boundary-connected-01";
const FOREIGN = "call-boundary-other-000001";
const FRESH = "call-boundary-fresh-000001";
const withheld = Object.freeze({ kind: "withheld" });
const denied = reason => ({ kind: "denied", reason });

function snapshot(callId, workerId = WORKER, callerId = CALLER) {
  return {
    callId, listingId: LISTING, categoryId: CATEGORY,
    callerAccountId: callerId, workerAccountId: workerId,
    phase: "ringing", revision: 0, createdAtMs: NOW, ringDeadlineMs: DEADLINE,
  };
}
let nextKey = 0;
function command(actorAccountId, event, revision) {
  return {
    actorAccountId, event, expectedRevision: revision,
    idempotencyKey: "boundary-key-" + String(++nextKey).padStart(10, "0"),
    nowMs: NOW + (revision + 1) * 1_000,
  };
}

function trial() {
  const folder = mkdtempSync(join(tmpdir(), "jodlo-active-boundary-"));
  const file = join(folder, "disposable.sqlite");
  const a = new DatabaseSync(file);
  const b = new DatabaseSync(file);
  try {
    a.exec("PRAGMA journal_mode=WAL");
    for (const db of [a, b]) {
      db.exec("PRAGMA foreign_keys=ON");
      db.exec("PRAGMA busy_timeout=0");
    }
    a.exec(
      "CREATE TABLE fake_consent (" +
      "worker_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0 " +
      "CHECK(enabled IN (0,1)), revision INTEGER NOT NULL DEFAULT 0);" +
      "CREATE TABLE fake_calls (" +
      "call_id TEXT PRIMARY KEY,worker_id TEXT NOT NULL " +
      "REFERENCES fake_consent(worker_id),caller_id TEXT NOT NULL," +
      "consent_revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL);" +
      "CREATE TABLE fake_unsent_intents (" +
      "call_id TEXT PRIMARY KEY REFERENCES fake_calls(call_id)," +
      "state TEXT NOT NULL CHECK(state IN(" +
      "'pending_test_only','claimed_test_only','revoked_test_only')));"
    );
    a.prepare("INSERT INTO fake_consent(worker_id) VALUES(?)").run(WORKER);
    a.prepare("INSERT INTO fake_consent(worker_id) VALUES(?)").run(OTHER_WORKER);
    return {
      a,b,close() {
        a.close();
        b.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    a.close();
    b.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}
async function withTrial(fn) {
  const t = trial();
  try { await fn(t); } finally { t.close(); }
}
function consent(db, workerId = WORKER) {
  const row = db.prepare(
    "SELECT enabled,revision FROM fake_consent WHERE worker_id=?"
  ).get(workerId);
  return row ? { enabled: row.enabled, revision: row.revision } : null;
}
function enableFixture(db, workerId = WORKER) {
  const result = db.prepare(
    "UPDATE fake_consent SET enabled=1,revision=revision+1 WHERE worker_id=?"
  ).run(workerId);
  assert.equal(result.changes, 1);
  return consent(db, workerId).revision;
}
function callRow(db, callId) {
  const row = db.prepare("SELECT * FROM fake_calls WHERE call_id=?").get(callId);
  return row ? {
    callId: row.call_id, workerId: row.worker_id, callerId: row.caller_id,
    epoch: row.consent_revision, call: JSON.parse(row.snapshot_json),
  } : null;
}
function queueRows(db) {
  return db.prepare(
    "SELECT * FROM fake_unsent_intents ORDER BY call_id"
  ).all().map(row => ({ callId: row.call_id, state: row.state }));
}

/** Only the test fixture can insert a new UNSENT synthetic call. */
function queueFixture(db, callId, workerId = WORKER, callerId = CALLER,
                      epoch = 1) {
  if (!validOpaqueId(callId) || !validOpaqueId(workerId) ||
      !validOpaqueId(callerId) || workerId === callerId ||
      !Number.isSafeInteger(epoch) || epoch < 1) return withheld;
  let tx = false;
  try {
    db.exec("BEGIN IMMEDIATE"); tx = true;
    const live = consent(db, workerId);
    if (!live || live.enabled !== 1 || live.revision !== epoch) {
      db.exec("ROLLBACK"); tx = false;
      return withheld;
    }
    db.prepare("INSERT INTO fake_calls VALUES(?,?,?,?,?)").run(
      callId, workerId, callerId, epoch,
      JSON.stringify(snapshot(callId, workerId, callerId)),
    );
    db.prepare("INSERT INTO fake_unsent_intents VALUES(?,?)").run(
      callId, "pending_test_only",
    );
    db.exec("COMMIT"); tx = false;
    return Object.freeze({ kind: "queued_unsent_test_only" });
  } catch (error) {
    if (tx) db.exec("ROLLBACK");
    throw error;
  }
}

/** Local, consent-epoch-checked worker accept; no real signaling. */
function acceptFixture(db, callId, expectedEpoch, { failAfterCall = false } = {}) {
  let tx = false;
  try {
    db.exec("BEGIN IMMEDIATE"); tx = true;
    const row = callRow(db, callId);
    const live = row ? consent(db, row.workerId) : null;
    const intent = db.prepare(
      "SELECT state FROM fake_unsent_intents WHERE call_id=?"
    ).get(callId);
    if (!row || !live || live.enabled !== 1 ||
        live.revision !== row.epoch || live.revision !== expectedEpoch ||
        intent?.state !== "pending_test_only") {
      db.exec("ROLLBACK"); tx = false;
      return withheld;
    }
    const accepted = decideSyntheticAgoraCallEvent(
      row.call, command(row.workerId, "accept", 0),
    );
    if (accepted.kind !== "apply" || accepted.result.phase !== "accepted") {
      db.exec("ROLLBACK"); tx = false;
      return withheld;
    }
    const change = db.prepare(
      "UPDATE fake_calls SET snapshot_json=? WHERE call_id=? " +
      "AND consent_revision=? AND snapshot_json=?"
    ).run(JSON.stringify(accepted.result), callId, row.epoch,
          JSON.stringify(row.call));
    if (change.changes !== 1) throw Error("fake accept CAS mismatch");
    if (failAfterCall) throw Error("synthetic accept crash");
    const intentChange = db.prepare(
      "UPDATE fake_unsent_intents SET state='claimed_test_only' " +
      "WHERE call_id=? AND state='pending_test_only'"
    ).run(callId);
    if (intentChange.changes !== 1) throw Error("synthetic intent CAS mismatch");
    db.exec("COMMIT"); tx = false;
    return Object.freeze({ kind: "accepted_test_only" });
  } catch (error) {
    if (tx) db.exec("ROLLBACK");
    throw error;
  }
}
/** A trusted provider-placeholder event, never an actual media connection. */
function markConnectedFixture(db, callId) {
  const row = callRow(db, callId);
  assert.equal(row?.call.phase, "accepted");
  const next = decideSyntheticAgoraCallEvent(
    row.call, command(null, "media_ready", 1),
  );
  assert.equal(next.kind, "apply");
  assert.equal(next.result.phase, "connected");
  const result = db.prepare(
    "UPDATE fake_calls SET snapshot_json=? WHERE call_id=? AND snapshot_json=?"
  ).run(JSON.stringify(next.result), callId, JSON.stringify(row.call));
  assert.equal(result.changes, 1);
}

/**
 * This function never ends accepted/connected media; it only atomically
 * tombstones still-UNSENT local intents after a fake worker switches OFF.
 * No actual provider cancel/ack, RTC token revocation or call termination.
 */
function revokeUnsentOnOptOutFixture(db, workerId, expectedEpoch, {
  failAfterConsent = false, failAfterFirstIntent = false,
} = {}) {
  if (!validOpaqueId(workerId) || !Number.isSafeInteger(expectedEpoch) ||
      expectedEpoch < 1 || expectedEpoch >= Number.MAX_SAFE_INTEGER)
    return withheld;
  let tx = false;
  try {
    db.exec("BEGIN IMMEDIATE"); tx = true;
    const change = db.prepare(
      "UPDATE fake_consent SET enabled=0,revision=revision+1 " +
      "WHERE worker_id=? AND revision=? AND enabled=1"
    ).run(workerId, expectedEpoch);
    if (change.changes !== 1) {
      db.exec("ROLLBACK"); tx = false;
      return withheld;
    }
    if (failAfterConsent) throw Error("synthetic OFF crash after consent");
    const pending = db.prepare(
      "SELECT q.call_id FROM fake_unsent_intents AS q " +
      "JOIN fake_calls AS c ON c.call_id=q.call_id " +
      "WHERE c.worker_id=? AND q.state='pending_test_only' ORDER BY q.call_id"
    ).all(workerId);
    for (const [index, row] of pending.entries()) {
      const tombstone = db.prepare(
        "UPDATE fake_unsent_intents SET state='revoked_test_only' " +
        "WHERE call_id=? AND state='pending_test_only'"
      ).run(row.call_id);
      if (tombstone.changes !== 1)
        throw Error("synthetic revoked UNSENT intent mismatch");
      if (index === 0 && failAfterFirstIntent)
        throw Error("synthetic OFF crash after first intent");
    }
    db.exec("COMMIT"); tx = false;
    return Object.freeze({
      kind: "unsent_revoked_test_only", count: pending.length,
    });
  } catch (error) {
    if (tx) db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Read-only, NO TOKEN / NO SEND. For accepted or connected snapshots,
 * checks that the ORIGINAL worker consent revision is still currently ON.
 * A revoked OFF->ON worker can never join an old epoch's snapshot again.
 * This is NOT authenticated owner/session or media provenance verification.
 */
function previewJoinFixture(db, callId, actorId) {
  const row = db.prepare(
    "SELECT c.snapshot_json,c.consent_revision,c.caller_id,c.worker_id," +
    "p.revision,p.enabled FROM fake_calls AS c " +
    "JOIN fake_consent AS p ON p.worker_id=c.worker_id WHERE c.call_id=?"
  ).get(callId);
  if (!row || row.enabled !== 1 ||
      row.revision !== row.consent_revision ||
      ![row.caller_id, row.worker_id].includes(actorId)) return withheld;
  try {
    const current = JSON.parse(row.snapshot_json);
    if (!["accepted", "connected"].includes(current.phase) ||
        current.callerAccountId !== row.caller_id ||
        current.workerAccountId !== row.worker_id ||
        current.callId !== callId ||
        current.revision !== (current.phase === "accepted" ? 1 : 2))
      return withheld;
    // A positive is only an internal hypothetical prerequisite, never a grant.
    return Object.freeze({ kind: "prerequisite_only" });
  } catch {
    return withheld;
  }
}

test("default OFF never creates a fake invite or join prerequisite", async () => {
  await withTrial(async t => {
    assert.deepEqual(consent(t.a), { enabled: 0, revision: 0 });
    assert.deepEqual(queueFixture(t.b, RING), withheld);
    assert.deepEqual(previewJoinFixture(t.a, RING, CALLER), withheld);
    assert.deepEqual(queueRows(t.b), []);
    assert.equal(callRow(t.a, RING), null);
  });
});

test("OFF before accept tombstones UNSENT and prevents a stale worker accept", async () => {
  await withTrial(async t => {
    assert.equal(enableFixture(t.a), 1);
    assert.equal(queueFixture(t.b, RING).kind, "queued_unsent_test_only");
    assert.deepEqual(revokeUnsentOnOptOutFixture(t.a, WORKER, 1),
      { kind: "unsent_revoked_test_only", count: 1 });
    assert.deepEqual(consent(t.b), { enabled: 0, revision: 2 });
    assert.deepEqual(acceptFixture(t.b, RING, 1), withheld);
    assert.deepEqual(previewJoinFixture(t.a, RING, WORKER), withheld);
    assert.equal(queueRows(t.a)[0].state, "revoked_test_only");
    assert.equal(callRow(t.b, RING).call.phase, "ringing",
      "tombstoning an UNSENT alert is not a provider-verified lifecycle event");
  });
});

test("accept before OFF keeps its existing phase but withholds future join proofs", async () => {
  await withTrial(async t => {
    assert.equal(enableFixture(t.a), 1);
    assert.equal(queueFixture(t.a, ACCEPTED).kind, "queued_unsent_test_only");
    assert.equal(acceptFixture(t.b, ACCEPTED, 1).kind, "accepted_test_only");
    assert.deepEqual(previewJoinFixture(t.a, ACCEPTED, CALLER),
      { kind: "prerequisite_only" });
    const before = callRow(t.a, ACCEPTED);
    assert.equal(before.call.phase, "accepted");
    assert.deepEqual(revokeUnsentOnOptOutFixture(t.b, WORKER, 1),
      { kind: "unsent_revoked_test_only", count: 0 },
      "a claimed-local intent is not a pending UNSENT alert");
    assert.deepEqual(previewJoinFixture(t.a, ACCEPTED, CALLER), withheld);
    assert.deepEqual(previewJoinFixture(t.b, ACCEPTED, WORKER), withheld);
    assert.deepEqual(callRow(t.b, ACCEPTED), before,
      "consent OFF does not prove provider termination of accepted call");
    assert.equal(queueRows(t.a)[0].state, "claimed_test_only");
  });
});

test("connected synthetic phase remains unverified, not automatically ended", async () => {
  await withTrial(async t => {
    assert.equal(enableFixture(t.a), 1);
    assert.equal(queueFixture(t.a, CONNECTED).kind, "queued_unsent_test_only");
    assert.equal(acceptFixture(t.b, CONNECTED, 1).kind, "accepted_test_only");
    markConnectedFixture(t.a, CONNECTED);
    assert.deepEqual(previewJoinFixture(t.b, CONNECTED, WORKER),
      { kind: "prerequisite_only" });
    const before = callRow(t.a, CONNECTED);
    assert.equal(before.call.phase, "connected");
    assert.equal(before.call.revision, 2);
    assert.deepEqual(revokeUnsentOnOptOutFixture(t.b, WORKER, 1),
      { kind: "unsent_revoked_test_only", count: 0 });
    assert.deepEqual(previewJoinFixture(t.a, CONNECTED, WORKER), withheld);
    assert.deepEqual(previewJoinFixture(t.b, CONNECTED, CALLER), withheld);
    assert.deepEqual(callRow(t.a, CONNECTED), before);
    assert.equal(queueRows(t.b)[0].state, "claimed_test_only");
  });
});

test("multi-phase opt-out sweeps only pending UNSENT alerts of that worker", async () => {
  await withTrial(async t => {
    assert.equal(enableFixture(t.a), 1);
    assert.equal(enableFixture(t.b, OTHER_WORKER), 1);
    for (const id of [RING, ACCEPTED, CONNECTED]) {
      assert.equal(queueFixture(t.a, id).kind, "queued_unsent_test_only");
    }
    assert.equal(queueFixture(t.b, FOREIGN, OTHER_WORKER, OTHER_CALLER)
      .kind, "queued_unsent_test_only");
    assert.equal(acceptFixture(t.a, ACCEPTED, 1).kind, "accepted_test_only");
    assert.equal(acceptFixture(t.b, CONNECTED, 1).kind, "accepted_test_only");
    markConnectedFixture(t.a, CONNECTED);
    const acceptedBefore = callRow(t.b, ACCEPTED);
    const connectedBefore = callRow(t.b, CONNECTED);
    const foreignBefore = callRow(t.b, FOREIGN);
    assert.deepEqual(revokeUnsentOnOptOutFixture(t.b, WORKER, 1),
      { kind: "unsent_revoked_test_only", count: 1 });
    const state = Object.fromEntries(queueRows(t.a).map(x=>[x.callId,x.state]));
    assert.deepEqual(state, {
      [RING]: "revoked_test_only",
      [ACCEPTED]: "claimed_test_only",
      [CONNECTED]: "claimed_test_only",
      [FOREIGN]: "pending_test_only",
    });
    assert.deepEqual(callRow(t.a, ACCEPTED), acceptedBefore);
    assert.deepEqual(callRow(t.a, CONNECTED), connectedBefore);
    assert.deepEqual(callRow(t.b, FOREIGN), foreignBefore);
    assert.deepEqual(consent(t.a, OTHER_WORKER), { enabled: 1, revision: 1 });
    assert.deepEqual(previewJoinFixture(t.b, CONNECTED, WORKER), withheld);
    assert.deepEqual(previewJoinFixture(t.b, ACCEPTED, CALLER), withheld);
    assert.deepEqual(previewJoinFixture(t.a, RING, CALLER), withheld);
    assert.equal(previewJoinFixture(t.a, FOREIGN, OTHER_CALLER).kind, "withheld",
      "a foreign ringing phase is never an accepted RTC prerequisite");
  });
});

test("OFF->ON new epoch cannot revive old accepted, connected or ringing IDs", async () => {
  await withTrial(async t => {
    assert.equal(enableFixture(t.a), 1);
    for (const id of [RING, ACCEPTED, CONNECTED])
      assert.equal(queueFixture(t.a, id).kind, "queued_unsent_test_only");
    assert.equal(acceptFixture(t.a, ACCEPTED, 1).kind, "accepted_test_only");
    assert.equal(acceptFixture(t.b, CONNECTED, 1).kind, "accepted_test_only");
    markConnectedFixture(t.a, CONNECTED);
    assert.equal(revokeUnsentOnOptOutFixture(t.b, WORKER, 1).count, 1);
    assert.equal(enableFixture(t.a), 3);
    assert.deepEqual(acceptFixture(t.b, RING, 1), withheld);
    assert.deepEqual(acceptFixture(t.b, RING, 3), withheld);
    assert.deepEqual(previewJoinFixture(t.a, ACCEPTED, WORKER), withheld);
    assert.deepEqual(previewJoinFixture(t.b, CONNECTED, CALLER), withheld);
    assert.deepEqual(queueFixture(t.a, RING, WORKER, CALLER, 3), withheld);
    assert.equal(queueFixture(t.a, FRESH, WORKER, CALLER, 3).kind,
      "queued_unsent_test_only");
    assert.equal(acceptFixture(t.b, FRESH, 3).kind, "accepted_test_only");
    assert.deepEqual(previewJoinFixture(t.a, FRESH, CALLER),
      { kind: "prerequisite_only" });
    assert.deepEqual(consent(t.b), { enabled: 1, revision: 3 });
    assert.equal(queueRows(t.a).find(x=>x.callId===RING).state,
      "revoked_test_only");
  });
});

test("failure injection rolls back both opt-out and UNSENT tombstones", async () => {
  for (const phase of ["failAfterConsent", "failAfterFirstIntent"]) {
    await withTrial(async t => {
      assert.equal(enableFixture(t.a), 1);
      assert.equal(queueFixture(t.a, RING).kind, "queued_unsent_test_only");
      assert.equal(queueFixture(t.a, ACCEPTED).kind, "queued_unsent_test_only");
      const before = {
        consent: consent(t.a),
        queue: queueRows(t.a),
        calls: [callRow(t.a, RING), callRow(t.a, ACCEPTED)],
      };
      assert.throws(() => revokeUnsentOnOptOutFixture(t.b, WORKER, 1, {
        [phase]: true,
      }), /synthetic OFF crash/);
      assert.deepEqual({
        consent: consent(t.b),
        queue: queueRows(t.b),
        calls: [callRow(t.b, RING), callRow(t.b, ACCEPTED)],
      }, before, phase + " must leave no partial opt-out");
      assert.deepEqual(revokeUnsentOnOptOutFixture(t.a, WORKER, 1),
        { kind: "unsent_revoked_test_only", count: 2 });
      assert.deepEqual(t.b.prepare("PRAGMA foreign_key_check").all(), []);
    });
  }
});

test("competing SQLite writers cannot interleave OFF with accept", async () => {
  await withTrial(async t => {
    assert.equal(enableFixture(t.a), 1);
    assert.equal(queueFixture(t.a, RING).kind, "queued_unsent_test_only");
    t.a.exec("BEGIN IMMEDIATE");
    try {
      assert.throws(() => revokeUnsentOnOptOutFixture(t.b, WORKER, 1),
        /database is locked|SQLITE_BUSY/i);
      assert.throws(() => acceptFixture(t.b, RING, 1),
        /database is locked|SQLITE_BUSY/i);
      assert.deepEqual(consent(t.a), { enabled: 1, revision: 1 });
      assert.equal(queueRows(t.a)[0].state, "pending_test_only");
    } finally { t.a.exec("ROLLBACK"); }
    assert.deepEqual(revokeUnsentOnOptOutFixture(t.b, WORKER, 1),
      { kind: "unsent_revoked_test_only", count: 1 });
    assert.deepEqual(acceptFixture(t.a, RING, 1), withheld);
    assert.deepEqual(revokeUnsentOnOptOutFixture(t.b, WORKER, 1), withheld,
      "stale epoch cannot revoke twice or roll forward another worker");
  });
});

test("invalid or foreign actor/epoch never creates a join prerequisite", async () => {
  await withTrial(async t => {
    assert.equal(enableFixture(t.a), 1);
    assert.equal(queueFixture(t.a, ACCEPTED).kind, "queued_unsent_test_only");
    assert.equal(acceptFixture(t.b, ACCEPTED, 1).kind, "accepted_test_only");
    for (const actor of ["not an account", OTHER_CALLER, OTHER_WORKER, null]) {
      assert.deepEqual(previewJoinFixture(t.a, ACCEPTED, actor), withheld);
    }
    assert.deepEqual(revokeUnsentOnOptOutFixture(t.a, WORKER, 0), withheld);
    assert.deepEqual(revokeUnsentOnOptOutFixture(t.b, WORKER, 2), withheld);
    assert.deepEqual(revokeUnsentOnOptOutFixture(t.a, "bad id", 1), withheld);
    assert.deepEqual(consent(t.b), { enabled: 1, revision: 1 });
    assert.deepEqual(previewJoinFixture(t.b, ACCEPTED, CALLER),
      { kind: "prerequisite_only" });
    assert.equal(queueRows(t.a)[0].state, "claimed_test_only");
  });
});

test("fake active/UNSENT tables never appear in production schema or store tokens", () => {
  const prod = openLocalDatabase();
  try {
    const tables = prod.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table'"
    ).all().map(x => x.name);
    for (const fake of [
      "fake_consent", "fake_calls", "fake_unsent_intents",
      "agora_call_sessions", "rtc_channels", "call_history",
    ]) assert.equal(tables.includes(fake), false);
  } finally { prod.db.close(); }
  const t = trial();
  try {
    assert.equal(enableFixture(t.a), 1);
    assert.equal(queueFixture(t.a, RING).kind, "queued_unsent_test_only");
    const stored = JSON.stringify([
      ...t.a.prepare("SELECT * FROM fake_consent").all(),
      ...t.a.prepare("SELECT * FROM fake_calls").all(),
      ...t.a.prepare("SELECT * FROM fake_unsent_intents").all(),
    ]);
    for (const forbidden of [
      "phoneNumber", "phone_number", "tel:", "agoraToken",
      "rtcUid", "channelName", "providerSend", "deviceToken",
      "providerAcknowledged", "mediaEndedAt",
    ]) assert.equal(stored.includes(forbidden), false, forbidden);
  } finally { t.close(); }
});
