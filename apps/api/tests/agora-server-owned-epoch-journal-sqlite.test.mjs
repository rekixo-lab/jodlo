import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { issueSession, revokeSession } from "../src/modules/identity/sessions.ts";
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
 * M-003/M-005 DESIGN REHEARSAL — LOCAL TEST-ONLY SQLite call journal.
 *
 * The ORIGINAL worker opt-in epoch must originate from a current caller-own
 * D1 session/owner/consent read, then be written with the test call under one
 * SQLite lock. A future join supplies only call ID + its OWN bearer + role +
 * expected lifecycle revision. The historical epoch is loaded from the fake
 * server-owned journal, NEVER from a request body or current worker setting.
 *
 * No production call table, retention policy, authenticated durable call,
 * D1/DO distributed atomicity, actual provider send, token or media grant.
 * Test-only policy is injected, NOT authoritative live presence/blocks/rate.
 */
const CALLER = "account-journal-caller-0001";
const WORKER = "account-journal-worker-0001";
const OTHER = "account-journal-other-00001";
const CATEGORY = "journal-epoch-test-service";
const NOW = 1_800_000_000_000;
const DEADLINE = NOW + 30_000;
const OLD_ID = "call-journal-old-epoch-0001";
const NEW_ID = "call-journal-new-epoch-0001";
const withheld = Object.freeze({ kind: "withheld" });
const policy = () => ({
  listingAvailable: true, blockedByRequester: false,
  blockedByWorker: false, workerConsentedToCalls: true,
  callDestinationVerified: true, connectionPrivacyApproved: true,
  abuseLimitPassed: true,
});
const REQUEST_FIELDS = ["callId", "role", "bearer", "expectedCallRevision"];
const exact = (value, fields) =>
  value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length &&
  fields.every(k => Object.hasOwn(value, k));

async function fixture() {
  const { db, adapter } = openLocalDatabase();
  try {
    // This table and trigger are created ONLY by this test, after the
    // unmodified production migrations were opened in :memory:.
    db.exec(
      "CREATE TABLE fake_server_owned_call_epochs (" +
      "call_id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, " +
      "caller_id TEXT NOT NULL,worker_id TEXT NOT NULL, " +
      "original_epoch INTEGER NOT NULL CHECK(original_epoch BETWEEN 1 AND 2147483647), " +
      "lifecycle_revision INTEGER NOT NULL CHECK(lifecycle_revision>=0), " +
      "snapshot_json TEXT NOT NULL);" +
      "CREATE TRIGGER fake_original_epoch_immutable BEFORE UPDATE OF " +
      "call_id,listing_id,caller_id,worker_id,original_epoch " +
      "ON fake_server_owned_call_epochs BEGIN " +
      "SELECT RAISE(ABORT,'test-only call identity/epoch is immutable'); END;"
    );
    for (const account of [CALLER, WORKER, OTHER])
      await ensureAccount(adapter, account);
    await optInAsWorker(adapter, WORKER);
    db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)"
    ).run(CATEGORY, CATEGORY, "Synthetic journal", "परीक्षण जर्नल");
    const listing = await publishListing(adapter, WORKER, CATEGORY);
    assert.ok(listing);
    const caller = (await issueSession(adapter, CALLER))?.accessToken;
    const worker = (await issueSession(adapter, WORKER))?.accessToken;
    const other = (await issueSession(adapter, OTHER))?.accessToken;
    assert.ok(caller && worker && other);
    return { db, adapter, listing, caller, worker, other,
      close() { db.close(); } };
  } catch (err) {
    db.close();
    throw err;
  }
}

function stored(db, callId) {
  const row = db.prepare(
    "SELECT * FROM fake_server_owned_call_epochs WHERE call_id=?"
  ).get(callId);
  if (!row) return null;
  try {
    return {
      callId: row.call_id, listingId: row.listing_id,
      callerId: row.caller_id, workerId: row.worker_id,
      originalEpoch: row.original_epoch, revision: row.lifecycle_revision,
      call: JSON.parse(row.snapshot_json),
    };
  } catch {
    return null;
  }
}
function allStored(db) {
  return db.prepare(
    "SELECT call_id,worker_id,original_epoch,lifecycle_revision " +
    "FROM fake_server_owned_call_epochs ORDER BY call_id"
  ).all().map(r => ({ ...r }));
}
function consistent(row, callId) {
  return row && row.callId === callId &&
    validOpaqueId(row.callId) && validOpaqueId(row.listingId) &&
    validOpaqueId(row.workerId) && validOpaqueId(row.callerId) &&
    row.workerId !== row.callerId &&
    Number.isSafeInteger(row.originalEpoch) &&
    row.originalEpoch >= 1 && row.originalEpoch <= 2_147_483_647 &&
    Number.isSafeInteger(row.revision) && row.revision >= 0 &&
    row.call && typeof row.call === "object" && !Array.isArray(row.call) &&
    row.call.callId === row.callId &&
    row.call.listingId === row.listingId &&
    row.call.workerAccountId === row.workerId &&
    row.call.callerAccountId === row.callerId &&
    row.call.revision === row.revision;
}

/** Server-injected synthetic admission; no client chooses worker or epoch. */
async function stageFakeCall(f, callId, bearer = f.caller, {
  failAfterRead = false, failAfterInsert = false,
} = {}) {
  if (!validOpaqueId(callId)) return withheld;
  let tx = false;
  try {
    f.db.exec("BEGIN IMMEDIATE"); tx = true;
    const current = await readCallerSessionBoundAgoraConsentEpoch(
      f.adapter, bearer, f.listing.id,
    );
    if (!current) {
      f.db.exec("ROLLBACK"); tx = false;
      return withheld;
    }
    if (failAfterRead) throw Error("synthetic crash after current opt-in read");
    const prepared = prepareSyntheticAgoraInvite(
      current.target, policy(), callId, NOW, DEADLINE,
    );
    if (prepared.kind !== "prepared") {
      f.db.exec("ROLLBACK"); tx = false;
      return withheld;
    }
    // A fake original epoch and call are inserted in the SAME local lock as
    // the current D1 opt-in/session evidence; never rebased on later ON.
    f.db.prepare(
      "INSERT INTO fake_server_owned_call_epochs VALUES(?,?,?,?,?,?,?)"
    ).run(callId, prepared.call.listingId, current.target.requesterAccountId,
      current.target.workerAccountId, current.consentRevision, 0,
      JSON.stringify(prepared.call));
    if (failAfterInsert) throw Error("synthetic crash after fake call insert");
    f.db.exec("COMMIT"); tx = false;
    return Object.freeze({ kind: "staged_unsent_test_only" });
  } catch {
    if (tx) f.db.exec("ROLLBACK");
    return withheld;
  }
}

/** Offline worker-own accepted state, no real ANSWER/RTC provider event. */
async function acceptFakeCall(f, callId, bearer = f.worker) {
  let tx = false;
  try {
    f.db.exec("BEGIN IMMEDIATE"); tx = true;
    const row = stored(f.db, callId);
    if (!consistent(row, callId) || row.call.phase !== "ringing" ||
        row.revision !== 0) {
      f.db.exec("ROLLBACK"); tx = false;
      return withheld;
    }
    const facts = await readWorkerSessionBoundAgoraConsentEpochMatch(
      f.adapter, bearer, row.listingId, row.callerId, row.originalEpoch,
    );
    if (!facts || facts.workerAccountId !== row.workerId ||
        facts.requesterAccountId !== row.callerId) {
      f.db.exec("ROLLBACK"); tx = false;
      return withheld;
    }
    const next = decideSyntheticAgoraCallEvent(row.call, {
      actorAccountId: facts.workerAccountId, event: "accept",
      expectedRevision: 0, idempotencyKey: "journal-accept-" + callId,
      nowMs: NOW + 1000,
    });
    if (next.kind !== "apply" || next.result.phase !== "accepted") {
      f.db.exec("ROLLBACK"); tx = false;
      return withheld;
    }
    const updated = f.db.prepare(
      "UPDATE fake_server_owned_call_epochs " +
      "SET lifecycle_revision=?,snapshot_json=? " +
      "WHERE call_id=? AND lifecycle_revision=? AND snapshot_json=?"
    ).run(1, JSON.stringify(next.result), callId, 0,
      JSON.stringify(row.call));
    if (updated.changes !== 1)
      throw Error("fake call lifecycle CAS failed");
    f.db.exec("COMMIT"); tx = false;
    return Object.freeze({ kind: "accepted_test_only" });
  } catch {
    if (tx) f.db.exec("ROLLBACK");
    return withheld;
  }
}

/** Synthetic trusted-media transition, NEVER a provider acknowledgement. */
function connectFakeCall(f, callId) {
  const row = stored(f.db, callId);
  if (!consistent(row, callId) || row.call.phase !== "accepted")
    return withheld;
  const decision = decideSyntheticAgoraCallEvent(row.call, {
    actorAccountId: null, event: "media_ready", expectedRevision: 1,
    idempotencyKey: "journal-media-" + callId, nowMs: NOW + 2000,
  });
  if (decision.kind !== "apply" || decision.result.phase !== "connected")
    return withheld;
  const changed = f.db.prepare(
    "UPDATE fake_server_owned_call_epochs SET lifecycle_revision=2," +
    "snapshot_json=? WHERE call_id=? AND lifecycle_revision=1 AND snapshot_json=?"
  ).run(JSON.stringify(decision.result), callId, JSON.stringify(row.call));
  return changed.changes === 1
    ? Object.freeze({ kind: "connected_test_only" }) : withheld;
}

/**
 * This is deliberately the entire simulated client-facing request contract:
 * call ID + own bearer + role + expected lifecycle revision, NOT epoch,
 * account ID, snapshot, listing, worker, channel or provider token.
 * A future authenticated issuer needs atomic check+grant, not this two-read
 * preview. The fake journal alone does NOT prove authoritative provenance.
 */
async function previewFromServerOwnedFakeCall(f, request) {
  if (!exact(request, REQUEST_FIELDS) ||
      !validOpaqueId(request.callId) ||
      !["caller", "worker"].includes(request.role) ||
      !Number.isSafeInteger(request.expectedCallRevision) ||
      request.expectedCallRevision < 0) return withheld;
  const row = stored(f.db, request.callId);
  if (!consistent(row, request.callId) ||
      row.revision !== request.expectedCallRevision) return withheld;
  try {
    const candidate = await assessSyntheticAgoraRtcConsentEpochPreflight(
      f.adapter, row.call, request.bearer, request.role,
      request.expectedCallRevision, row.originalEpoch, policy(),
    );
    return candidate.kind === "prerequisite_only" ? candidate : withheld;
  } catch {
    return withheld;
  }
}
const request = (callId, role, bearer, expectedCallRevision = 1) =>
  ({ callId, role, bearer, expectedCallRevision });

test("default OFF withholds fake call journal creation", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await stageFakeCall(f, OLD_ID), withheld);
    assert.deepEqual(allStored(f.db), []);
    assert.deepEqual(await previewFromServerOwnedFakeCall(
      f, request(OLD_ID, "caller", f.caller)), withheld);
  } finally { f.close(); }
});

test("one current caller session stages immutable original epoch, worker-own accept, both own-role join previews", async () => {
  const f = await fixture();
  try {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter, f.worker, true, 0)).kind, "updated");
    assert.deepEqual(await stageFakeCall(f, OLD_ID),
      { kind: "staged_unsent_test_only" });
    const initial = stored(f.db, OLD_ID);
    assert.equal(initial.originalEpoch, 1);
    assert.equal(initial.call.phase, "ringing");
    assert.equal(initial.revision, 0);
    assert.equal(initial.workerId, WORKER);
    assert.equal(initial.callerId, CALLER);
    assert.deepEqual(await acceptFakeCall(f, OLD_ID),
      { kind: "accepted_test_only" });
    assert.equal(stored(f.db, OLD_ID).originalEpoch, 1);
    assert.equal(stored(f.db, OLD_ID).call.phase, "accepted");
    for (const [role, bearer] of [
      ["caller", f.caller], ["worker", f.worker],
    ]) {
      const verdict = await previewFromServerOwnedFakeCall(
        f, request(OLD_ID, role, bearer));
      assert.deepEqual(verdict, { kind: "prerequisite_only", role });
      assert.equal(Object.isFrozen(verdict), true);
      assert.equal(JSON.stringify(verdict).includes(bearer), false);
    }
    assert.deepEqual(await acceptFakeCall(f, OLD_ID), withheld,
      "stale worker accept cannot overwrite the persisted call");
    assert.equal(stored(f.db, OLD_ID).revision, 1);
  } finally { f.close(); }
});

test("OFF then ON cannot rebase old accepted or connected call IDs onto a new epoch", async () => {
  for (const connected of [false, true]) {
    const f = await fixture();
    try {
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapter, f.worker, true, 0)).kind, "updated");
      assert.equal((await stageFakeCall(f, OLD_ID)).kind, "staged_unsent_test_only");
      assert.equal((await acceptFakeCall(f, OLD_ID)).kind, "accepted_test_only");
      if (connected) {
        assert.deepEqual(connectFakeCall(f, OLD_ID),
          { kind: "connected_test_only" });
      }
      const rev = connected ? 2 : 1;
      for (const [role, token] of [
        ["caller", f.caller], ["worker", f.worker],
      ]) {
        assert.equal((await previewFromServerOwnedFakeCall(
          f, request(OLD_ID, role, token, rev))).kind, "prerequisite_only");
      }
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapter, f.worker, false, 1)).kind, "updated");
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapter, f.worker, true, 2)).kind, "updated");
      const original = stored(f.db, OLD_ID);
      assert.equal(original.originalEpoch, 1);
      assert.equal(original.revision, rev);
      for (const [role, token] of [
        ["caller", f.caller], ["worker", f.worker],
      ]) {
        assert.deepEqual(await previewFromServerOwnedFakeCall(
          f, request(OLD_ID, role, token, rev)), withheld);
      }
      assert.deepEqual(await stageFakeCall(f, OLD_ID), withheld);
      assert.deepEqual(stored(f.db, OLD_ID), original);
      assert.equal((await stageFakeCall(f, NEW_ID)).kind, "staged_unsent_test_only");
      assert.equal(stored(f.db, NEW_ID).originalEpoch, 3);
      assert.equal((await acceptFakeCall(f, NEW_ID)).kind, "accepted_test_only");
      assert.deepEqual(await previewFromServerOwnedFakeCall(
        f, request(NEW_ID, "worker", f.worker)),
        { kind: "prerequisite_only", role: "worker" });
      assert.equal(stored(f.db, OLD_ID).originalEpoch, 1);
    } finally { f.close(); }
  }
});

test("client cannot submit a current epoch, fake snapshot, worker identity or cross-call payload", async () => {
  const f = await fixture();
  try {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter, f.worker, true, 0)).kind, "updated");
    assert.equal((await stageFakeCall(f, OLD_ID)).kind, "staged_unsent_test_only");
    assert.equal((await acceptFakeCall(f, OLD_ID)).kind, "accepted_test_only");
    const good = request(OLD_ID, "caller", f.caller);
    for (const bad of [
      { ...good, originalConsentRevision: 3 },
      { ...good, consentRevision: 1 },
      { ...good, currentEpoch: 1 },
      { ...good, workerAccountId: WORKER },
      { ...good, callerAccountId: CALLER },
      { ...good, listingId: f.listing.id },
      { ...good, snapshot: stored(f.db, OLD_ID).call },
      { ...good, rtcToken: "forbidden" },
      { ...good, requestedRole: "worker" },
      { ...good, expectedCallRevision: "1" },
      { ...good, role: "admin" },
      { ...good, callId: "not opaque" },
      null,
    ]) assert.deepEqual(await previewFromServerOwnedFakeCall(f, bad), withheld);
    assert.deepEqual(await previewFromServerOwnedFakeCall(f,
      request(NEW_ID, "caller", f.caller)), withheld);
    assert.deepEqual(await previewFromServerOwnedFakeCall(f,
      request(OLD_ID, "worker", f.caller)), withheld);
    assert.deepEqual(await previewFromServerOwnedFakeCall(f,
      request(OLD_ID, "caller", f.worker)), withheld);
    assert.deepEqual(await previewFromServerOwnedFakeCall(f,
      request(OLD_ID, "caller", f.other)), withheld);
    assert.deepEqual(await previewFromServerOwnedFakeCall(f,
      request(OLD_ID, "worker", f.other)), withheld);
    assert.deepEqual(await previewFromServerOwnedFakeCall(f, good),
      { kind: "prerequisite_only", role: "caller" });
  } finally { f.close(); }
});

test("fake journal original epoch and participant bindings are immutable across lifecycle CAS", async () => {
  const f = await fixture();
  try {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter, f.worker, true, 0)).kind, "updated");
    assert.equal((await stageFakeCall(f, OLD_ID)).kind, "staged_unsent_test_only");
    assert.equal((await acceptFakeCall(f, OLD_ID)).kind, "accepted_test_only");
    for (const mutation of [
      ["original_epoch", 3], ["caller_id", OTHER], ["worker_id", OTHER],
      ["listing_id", "listing-new-journal-0001"],
      ["call_id", NEW_ID],
    ]) {
      assert.throws(() => f.db.prepare(
        "UPDATE fake_server_owned_call_epochs SET " + mutation[0] +
        "=? WHERE call_id=?"
      ).run(mutation[1], OLD_ID), /immutable/);
    }
    assert.equal(stored(f.db, OLD_ID).originalEpoch, 1);
    assert.equal(stored(f.db, OLD_ID).workerId, WORKER);
    assert.equal(stored(f.db, OLD_ID).callerId, CALLER);
    assert.equal(stored(f.db, OLD_ID).revision, 1);
    assert.deepEqual(allStored(f.db).map(r => r.call_id), [OLD_ID]);
  } finally { f.close(); }
});

test("persisted snapshot tampering or lifecycle revision mismatch withholds without repair", async () => {
  const changes = [
    ["UPDATE fake_server_owned_call_epochs SET lifecycle_revision=2 WHERE call_id=?",
      [OLD_ID]],
    ["UPDATE fake_server_owned_call_epochs SET snapshot_json='not JSON' WHERE call_id=?",
      [OLD_ID]],
    ["UPDATE fake_server_owned_call_epochs SET snapshot_json=? WHERE call_id=?",
      [JSON.stringify({ phase: "accepted", revision: 1 }), OLD_ID]],
  ];
  for (const [sql, args] of changes) {
    const f = await fixture();
    try {
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapter, f.worker, true, 0)).kind, "updated");
      assert.equal((await stageFakeCall(f, OLD_ID)).kind, "staged_unsent_test_only");
      assert.equal((await acceptFakeCall(f, OLD_ID)).kind, "accepted_test_only");
      f.db.prepare(sql).run(...args);
      assert.deepEqual(await previewFromServerOwnedFakeCall(
        f, request(OLD_ID, "caller", f.caller)), withheld);
    } finally { f.close(); }
  }
});

test("invalid actor sessions, revised listing/Category state and policy withhold stored preview", async () => {
  for (const mode of ["caller_revoked", "worker_revoked", "hidden", "category_off"]) {
    const f = await fixture();
    try {
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapter, f.worker, true, 0)).kind, "updated");
      assert.equal((await stageFakeCall(f, OLD_ID)).kind, "staged_unsent_test_only");
      assert.equal((await acceptFakeCall(f, OLD_ID)).kind, "accepted_test_only");
      if (mode === "caller_revoked")
        assert.equal(await revokeSession(f.adapter, f.caller), true);
      if (mode === "worker_revoked")
        assert.equal(await revokeSession(f.adapter, f.worker), true);
      if (mode === "hidden")
        f.db.prepare(
          "UPDATE worker_listings SET moderation_status='hidden' WHERE id=?"
        ).run(f.listing.id);
      if (mode === "category_off")
        f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY);
      const caller = await previewFromServerOwnedFakeCall(
        f, request(OLD_ID, "caller", f.caller));
      const worker = await previewFromServerOwnedFakeCall(
        f, request(OLD_ID, "worker", f.worker));
      if (mode === "caller_revoked") {
        assert.deepEqual(caller, withheld);
        assert.equal(worker.kind, "prerequisite_only");
      } else if (mode === "worker_revoked") {
        assert.deepEqual(worker, withheld);
        assert.equal(caller.kind, "prerequisite_only");
      } else {
        assert.deepEqual(caller, withheld);
        assert.deepEqual(worker, withheld);
      }
    } finally { f.close(); }
  }
});

test("failure injection rolls back staged original epoch and preserves later safe retry", async () => {
  for (const phase of ["failAfterRead", "failAfterInsert"]) {
    const f = await fixture();
    try {
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapter, f.worker, true, 0)).kind, "updated");
      assert.deepEqual(await stageFakeCall(f, OLD_ID, f.caller,
        { [phase]: true }), withheld);
      assert.deepEqual(allStored(f.db), []);
      assert.equal((await stageFakeCall(f, OLD_ID)).kind, "staged_unsent_test_only");
      assert.equal(stored(f.db, OLD_ID).originalEpoch, 1);
      assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { f.close(); }
  }
});

test("test-owned call metadata is absent from unmodified production migrations", async () => {
  const base = openLocalDatabase();
  try {
    const names = base.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' OR type='trigger'"
    ).all().map(r => r.name);
    assert.equal(names.includes("fake_server_owned_call_epochs"), false);
    assert.equal(names.includes("fake_original_epoch_immutable"), false);
    for (const proposed of ["agora_calls", "agora_call_sessions",
      "agora_call_ledger", "rtc_channel_tokens"]) {
      assert.equal(names.includes(proposed), false);
    }
  } finally { base.db.close(); }
  const f = await fixture();
  try {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter, f.worker, true, 0)).kind, "updated");
    assert.equal((await stageFakeCall(f, OLD_ID)).kind, "staged_unsent_test_only");
    const raw = JSON.stringify(allStored(f.db)) +
      JSON.stringify(stored(f.db, OLD_ID));
    for (const secret of [
      "accessToken", "Bearer ", "phoneNumber", "phone_number",
      "deviceToken", "agoraToken", "channelName", "rtcUid",
      "providerDelivery", "mediaConnectedAt",
    ]) assert.equal(raw.includes(secret), false, secret);
  } finally { f.close(); }
});
