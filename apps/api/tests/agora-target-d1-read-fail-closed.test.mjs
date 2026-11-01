import assert from "node:assert/strict";
import test from "node:test";
import {
  readCurrentRequestTarget,
  readSessionBoundCallTarget,
  readCallerSessionBoundAgoraOptInTarget,
  readCallerSessionBoundAgoraConsentEpoch,
  readCallerSessionBoundAgoraConsentEpochMatch,
  readTwoSessionBoundCallTarget,
  readTwoSessionBoundAgoraOptInTarget,
  readWorkerSessionBoundAgoraOptInTarget,
  readWorkerSessionBoundAgoraConsentEpochMatch,
} from "../src/modules/interactions/request-target.ts";
import { prepareSyntheticSafetyCheckedAgoraInvite } from
  "../src/modules/interactions/agora-invite-safety.ts";

/**
 * Internal read-only contract regression, NO real Agora/worker presence.
 * All tokens/IDs here are artificial and never sent to a provider or stored.
 * Missing, malformed or failed D1 evidence must not become a contact/join
 * prerequisite. No M-005 presence/quotas/retry policy is selected.
 */
const CALLER = "account-d1-outage-caller001";
const LISTING = "listing-d1-outage-000001";
const TOKEN_A = "a".repeat(43);
const TOKEN_B = "b".repeat(43);
const NOW = 1_800_000_000_000;

const previews = [
  ["trusted-account target", db => readCurrentRequestTarget(db, CALLER, LISTING)],
  ["caller session target", db => readSessionBoundCallTarget(db, TOKEN_A, LISTING)],
  ["caller Agora opt-in target", db =>
    readCallerSessionBoundAgoraOptInTarget(db, TOKEN_A, LISTING)],
  ["caller Agora consent epoch", db =>
    readCallerSessionBoundAgoraConsentEpoch(db, TOKEN_A, LISTING)],
  ["caller expected Agora consent epoch", db =>
    readCallerSessionBoundAgoraConsentEpochMatch(db, TOKEN_A, LISTING, 1)],
  ["both session target", db =>
    readTwoSessionBoundCallTarget(db, TOKEN_A, TOKEN_B, LISTING)],
  ["both session Agora opt-in", db =>
    readTwoSessionBoundAgoraOptInTarget(db, TOKEN_A, TOKEN_B, LISTING)],
  ["worker-own Agora opt-in", db =>
    readWorkerSessionBoundAgoraOptInTarget(db, TOKEN_B, LISTING, CALLER)],
  ["worker-own expected consent epoch", db =>
    readWorkerSessionBoundAgoraConsentEpochMatch(db, TOKEN_B, LISTING, CALLER, 1)],
];

function failingAdapter(phase) {
  const counts = { prepare: 0, bind: 0, all: 0 };
  const db = {
    prepare() {
      counts.prepare++;
      if (phase === "prepare") throw Error("internal fake D1 unavailable");
      return {
        bind() {
          counts.bind++;
          if (phase === "bind") throw Error("internal fake D1 bind error");
          return {
            async all() {
              counts.all++;
              if (phase === "all") throw Error("internal fake D1 read error");
              if (phase === "null response") return null;
              if (phase === "missing response") return {};
              if (phase === "null rows") return { results: null };
              if (phase === "object rows") return { results: {} };
              if (phase === "bad row") return { results: [null] };
              if (phase === "duplicate bad rows")
                return { results: [{}, {}] };
              throw Error("invalid fixture phase");
            },
          };
        },
      };
    },
  };
  return { db, counts };
}

test("all nine read-only target/consent prerequisites deny D1 outages and malformed results", async () => {
  const phases = [
    "prepare", "bind", "all", "null response", "missing response",
    "null rows", "object rows", "bad row", "duplicate bad rows",
  ];
  let exercised = 0;
  for (const phase of phases) {
    for (const [name, read] of previews) {
      const { db, counts } = failingAdapter(phase);
      assert.equal(await read(db), null, name + " must withhold on " + phase);
      assert.equal(counts.prepare, 1, name + " must use a single D1 statement");
      if (phase !== "prepare") assert.equal(counts.bind, 1);
      if (!["prepare", "bind"].includes(phase)) assert.equal(counts.all, 1);
      exercised++;
    }
  }
  assert.equal(exercised, phases.length * previews.length);
});

test("an unavailable D1 never escapes the caller-initiated synthetic invite", async () => {
  const risk = {
    kind: "synthetic_invite_risk_v1",
    callerAccountId: CALLER,
    workerAccountId: "account-d1-outage-worker001",
    listingId: LISTING,
    checkedAtMs: NOW - 1,
    expiresAtMs: NOW + 1000,
    workerPresence: "online",
    workerAvailability: "available",
    blockedByCaller: false,
    blockedByWorker: false,
    rateGate: "pass",
    recipientVerified: true,
    privacyApproved: true,
  };
  for (const phase of ["prepare", "bind", "all", "null response", "object rows"]) {
    const { db, counts } = failingAdapter(phase);
    const result = await prepareSyntheticSafetyCheckedAgoraInvite(
      db, TOKEN_A, LISTING, "call-d1-outage-00000001",
      NOW, NOW + 100, risk,
    );
    assert.deepEqual(result, { kind: "denied" });
    assert.equal(counts.prepare, 1);
    assert.equal(JSON.stringify(result).includes(TOKEN_A), false);
  }
});

test("invalid actor/bearer/listing is rejected before D1 is touched", async () => {
  const db = { prepare() { throw Error("unexpected D1 access"); } };
  assert.equal(await readCurrentRequestTarget(db, "bad id", LISTING), null);
  assert.equal(await readSessionBoundCallTarget(db, "bad bearer", LISTING), null);
  assert.equal(await readCallerSessionBoundAgoraOptInTarget(
    db, TOKEN_A, "bad id"), null);
  assert.equal(await readTwoSessionBoundAgoraOptInTarget(
    db, TOKEN_A, TOKEN_A, LISTING), null);
  assert.equal(await readWorkerSessionBoundAgoraOptInTarget(
    db, TOKEN_B, LISTING, "bad id"), null);
});

test("D1 SQL bindings contain only synthetic hashed session secrets, not raw bearer", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, params: null };
      calls.push(call);
      return {
        bind(...params) {
          call.params = params;
          return { async all() { return { results: [] }; } };
        },
      };
    },
  };
  for (const [, read] of previews) assert.equal(await read(db), null);
  assert.equal(calls.length, previews.length);
  assert.equal(JSON.stringify(calls).includes(TOKEN_A), false);
  assert.equal(JSON.stringify(calls).includes(TOKEN_B), false);
  for (const entry of calls) {
    assert.equal(typeof entry.sql, "string");
    assert.ok(Array.isArray(entry.params));
    assert.ok(entry.params.length >= 2);
  }
});
