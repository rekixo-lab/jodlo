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
  prepareSyntheticAgoraInvite,
  decideSyntheticAgoraCallEvent,
} from "../src/modules/interactions/agora-call-lifecycle.ts";
import {
  assessSyntheticAgoraRtcConsentEpochPreflight,
} from "../src/modules/interactions/agora-rtc-preflight.ts";

/**
 * Offline-only synthetic RTC preflight: original consent revision must be a
 * TRUSTED SERVER-HELD historical fact. It is NOT an authenticated stored call,
 * provider credential, real presence, worker busy lock or approved M-005
 * token grant. Never substitute a current revision for historical consent.
 */
const CALLER = "account-rtc-epoch-caller01";
const WORKER = "account-rtc-epoch-worker01";
const OTHER = "account-rtc-epoch-other001";
const CATEGORY = "rtc-epoch-synthetic-test";
const NOW = 1_800_000_000_000;
const allowedPolicy = () => ({
  listingAvailable: true,
  blockedByRequester: false,
  blockedByWorker: false,
  workerConsentedToCalls: true,
  callDestinationVerified: true,
  connectionPrivacyApproved: true,
  abuseLimitPassed: true,
});
const denied = reason => ({ kind: "denied", reason });

async function fixture() {
  const { db, adapter } = openLocalDatabase();
  try {
    for (const account of [CALLER, WORKER, OTHER])
      await ensureAccount(adapter, account);
    await optInAsWorker(adapter, WORKER);
    db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)"
    ).run(CATEGORY, CATEGORY, "Synthetic RTC consent", "परीक्षण आवाज़ सहमति");
    const listing = await publishListing(adapter, WORKER, CATEGORY);
    assert.ok(listing);
    const callerToken = (await issueSession(adapter, CALLER))?.accessToken;
    const workerToken = (await issueSession(adapter, WORKER))?.accessToken;
    const otherToken = (await issueSession(adapter, OTHER))?.accessToken;
    assert.ok(callerToken && workerToken && otherToken);
    const makeCall = (id = "call-rtc-epoch-original01", phase = "accepted") => {
      const prepared = prepareSyntheticAgoraInvite({
        requesterAccountId: CALLER, workerAccountId: WORKER,
        listingId: listing.id, listingOwnerAccountId: WORKER,
        categoryId: CATEGORY, requesterActive: true, workerActive: true,
        workerOptedIn: true, categoryActive: true,
        listingPublished: true, moderationApproved: true,
      }, allowedPolicy(), id, NOW, NOW + 30000);
      assert.equal(prepared.kind, "prepared");
      const accepted = decideSyntheticAgoraCallEvent(prepared.call, {
        actorAccountId: WORKER, event: "accept", expectedRevision: 0,
        idempotencyKey: "rtc-epoch-test-accept-" + id,
        nowMs: NOW + 1000,
      });
      assert.equal(accepted.kind, "apply");
      if (phase === "accepted") return accepted.result;
      assert.equal(phase, "connected");
      const connected = decideSyntheticAgoraCallEvent(accepted.result, {
        actorAccountId: null, event: "media_ready", expectedRevision: 1,
        idempotencyKey: "rtc-epoch-test-media-" + id,
        nowMs: NOW + 2000,
      });
      assert.equal(connected.kind, "apply");
      return connected.result;
    };
    const preview = (call, role = "caller", epoch = 1, {
      token = role === "caller" ? callerToken : workerToken,
      revision = call?.revision, policy = allowedPolicy(),
    } = {}) => assessSyntheticAgoraRtcConsentEpochPreflight(
      adapter, call, token, role, revision, epoch, policy,
    );
    return {
      db, adapter, listing, callerToken, workerToken, otherToken,
      makeCall, preview, close() { db.close(); },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

test("default OFF denies both RTC roles without minting any credential", async () => {
  const f = await fixture();
  try {
    const accepted = f.makeCall();
    for (const role of ["caller", "worker"]) {
      assert.deepEqual(await f.preview(accepted, role, 1),
        denied("SESSION_OR_TARGET_UNAVAILABLE"));
    }
    assert.equal(JSON.stringify(await f.preview(accepted)).includes(f.callerToken),
      false);
  } finally { f.close(); }
});

test("correct original consent revision admits ONLY a synthetic prerequisite for both roles", async () => {
  const f = await fixture();
  try {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter, f.workerToken, true, 0)).kind, "updated");
    for (const phase of ["accepted", "connected"]) {
      const call = f.makeCall("call-rtc-epoch-" + phase + "-001", phase);
      for (const role of ["caller", "worker"]) {
        const answer = await f.preview(call, role, 1);
        assert.deepEqual(answer, { kind: "prerequisite_only", role });
        assert.equal(Object.isFrozen(answer), true);
        assert.equal(JSON.stringify(answer).includes("token"), false);
        assert.equal(JSON.stringify(answer).includes("channel"), false);
      }
    }
  } finally { f.close(); }
});

test("OFF then ON never resurrects old accepted or connected epoch for either participant", async () => {
  const f = await fixture();
  try {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter, f.workerToken, true, 0)).kind, "updated");
    const older = [
      f.makeCall("call-rtc-epoch-old-accept01"),
      f.makeCall("call-rtc-epoch-old-media001", "connected"),
    ];
    for (const call of older) {
      for (const role of ["caller", "worker"]) {
        assert.equal((await f.preview(call, role, 1)).kind, "prerequisite_only");
      }
    }
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter, f.workerToken, false, 1)).kind, "updated");
    for (const call of older) {
      for (const role of ["caller", "worker"]) {
        assert.deepEqual(await f.preview(call, role, 1),
          denied("SESSION_OR_TARGET_UNAVAILABLE"));
      }
    }
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter, f.workerToken, true, 2)).kind, "updated");
    for (const call of older) {
      for (const role of ["caller", "worker"]) {
        assert.deepEqual(await f.preview(call, role, 1),
          denied("SESSION_OR_TARGET_UNAVAILABLE"),
          "old server-held epoch cannot be replaced with current worker setting");
      }
    }
    // Only a NEW synthetic call supplied by trusted state at current epoch.
    const fresh = f.makeCall("call-rtc-epoch-new-consent01");
    for (const role of ["caller", "worker"]) {
      assert.deepEqual(await f.preview(fresh, role, 3),
        { kind: "prerequisite_only", role });
    }
  } finally { f.close(); }
});

test("wrong role, participant bearer, call revision or server-policy facts deny", async () => {
  const f = await fixture();
  try {
    assert.equal((await setOwnWorkerAgoraCallPreference(
      f.adapter, f.workerToken, true, 0)).kind, "updated");
    const call = f.makeCall();
    for (const role of ["caller", "worker"]) {
      const opposite = role === "caller" ? f.workerToken : f.callerToken;
      assert.deepEqual(await f.preview(call, role, 1, { token: opposite }),
        denied("SESSION_OR_TARGET_UNAVAILABLE"));
      assert.deepEqual(await f.preview(call, role, 1, { token: f.otherToken }),
        denied(role === "caller" ? "CALL_OR_POLICY_DENIED" :
          "SESSION_OR_TARGET_UNAVAILABLE"),
        "other valid caller may read the listing, but cannot impersonate the call participant");
      assert.deepEqual(await f.preview(call, role, 1, { revision: 0 }),
        denied("CALL_OR_POLICY_DENIED"));
      assert.deepEqual(await f.preview(call, role, 1, {
        policy: { ...allowedPolicy(), blockedByWorker: true },
      }), denied("CALL_OR_POLICY_DENIED"));
      assert.deepEqual(await f.preview({
        ...call, categoryId: "different-rtc-epoch-category",
      }, role, 1), denied("CALL_OR_POLICY_DENIED"));
      assert.deepEqual(await f.preview({
        ...call, phase: "ringing", revision: 0,
      }, role, 1), denied("CALL_OR_POLICY_DENIED"));
    }
    assert.deepEqual(await f.preview(call, "invalid", 1), denied("INVALID_ROLE"));
  } finally { f.close(); }
});

test("revoked bearer, disabled/hidden listing and inactive Category block both role previews", async () => {
  for (const mutation of [
    f => f.db.prepare(
      "UPDATE worker_listings SET moderation_status='hidden' WHERE id=?"
    ).run(f.listing.id),
    f => f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?")
      .run(CATEGORY),
    f => f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?")
      .run(CALLER),
  ]) {
    const f = await fixture();
    try {
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapter, f.workerToken, true, 0)).kind, "updated");
      const call = f.makeCall();
      mutation(f);
      for (const role of ["caller", "worker"]) {
        assert.deepEqual(await f.preview(call, role, 1),
          denied("SESSION_OR_TARGET_UNAVAILABLE"));
      }
    } finally { f.close(); }
  }
  for (const role of ["caller", "worker"]) {
    const f = await fixture();
    try {
      assert.equal((await setOwnWorkerAgoraCallPreference(
        f.adapter, f.workerToken, true, 0)).kind, "updated");
      const call = f.makeCall();
      const token = role === "caller" ? f.callerToken : f.workerToken;
      assert.equal(await revokeSession(f.adapter, token), true);
      assert.deepEqual(await f.preview(call, role, 1),
        denied("SESSION_OR_TARGET_UNAVAILABLE"));
    } finally { f.close(); }
  }
});

test("invalid consent revision and role reject BEFORE any D1 prepare", async () => {
  const fakeDb = { prepare() { throw Error("D1 must not be accessed"); } };
  const call = { listingId: "listing-rtc-epoch-synthetic",
    callerAccountId: CALLER, revision: 1 };
  for (const value of [
    undefined, null, 0, -1, 1.5, "1", NaN, Infinity, 2_147_483_648,
    Number.MAX_SAFE_INTEGER,
  ]) {
    assert.deepEqual(await assessSyntheticAgoraRtcConsentEpochPreflight(
      fakeDb, call, "a".repeat(43), "caller", 1, value, allowedPolicy(),
    ), denied("INVALID_CONSENT_REVISION"), String(value));
  }
  assert.deepEqual(await assessSyntheticAgoraRtcConsentEpochPreflight(
    fakeDb, call, "a".repeat(43), "other", 1, 1, allowedPolicy(),
  ), denied("INVALID_ROLE"));
});

test("each epoch preview uses one D1 select with hashed bearer, exact epoch, no provider identity", async () => {
  for (const role of ["caller", "worker"]) {
    const calls = [];
    const db = {
      prepare(sql) {
        const item = { sql };
        calls.push(item);
        return {
          bind(...params) {
            item.params = params;
            return { async all() { return { results: [] }; } };
          },
        };
      },
    };
    const bearer = (role === "caller" ? "a" : "b").repeat(43);
    const result = await assessSyntheticAgoraRtcConsentEpochPreflight(
      db, { listingId: "listing-rtc-epoch-synthetic", callerAccountId: CALLER },
      bearer, role, 1, 3, allowedPolicy(),
    );
    assert.deepEqual(result, denied("SESSION_OR_TARGET_UNAVAILABLE"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.at(-1), 3);
    assert.equal(calls[0].params.length, role === "caller" ? 4 : 5);
    assert.match(calls[0].sql, /pref\.revision=\?/);
    const serialized = JSON.stringify(calls);
    assert.equal(serialized.includes(bearer), false);
    assert.equal(serialized.includes("phone_number"), false);
    assert.equal(serialized.includes("agoraToken"), false);
  }
});

test("D1 read exception or malformed rows always withhold epoch-bound preflight", async () => {
  const bearer = "a".repeat(43);
  const call = {
    listingId: "listing-rtc-epoch-synthetic",
    callerAccountId: CALLER,
  };
  const phases = ["prepare", "bind", "all", "null-result", "bad-result"];
  for (const phase of phases) {
    for (const role of ["caller", "worker"]) {
      const db = { prepare() {
        if (phase === "prepare") throw Error("offline D1 failure");
        return { bind() {
          if (phase === "bind") throw Error("offline D1 bind failure");
          return { async all() {
            if (phase === "all") throw Error("offline D1 select failure");
            if (phase === "null-result") return null;
            return { results: [{}] };
          } };
        } };
      } };
      assert.deepEqual(await assessSyntheticAgoraRtcConsentEpochPreflight(
        db, call, bearer, role, 1, 1, allowedPolicy(),
      ), denied("SESSION_OR_TARGET_UNAVAILABLE"), role + " " + phase);
    }
  }
});
