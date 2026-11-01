import assert from "node:assert/strict";
import test from "node:test";
import {
  decideSyntheticAgoraCallEvent,
} from "../src/modules/interactions/agora-call-lifecycle.ts";

/**
 * Exhaustive, deterministic TEST-ONLY state-machine matrix.
 *
 * This checks the existing pure reducer against an independent transition
 * table; it does not choose the founder's P01/P02/T01/T02 operational policy.
 * Synthetic timestamps are only edge-case fixtures, NOT ring/RTC timeouts.
 * Actor identity here is synthetic and trusted by the test harness, not by
 * a real API. No provider, D1 writer, token, SDK, device or remote resource.
 */
const CALLER = "account-matrix-caller01";
const WORKER = "account-matrix-worker01";
const OTHER = "account-matrix-other001";
const CREATED = 1_800_000_000_000;
const DEADLINE = CREATED + 20_000;
const PHASES = [
  "ringing", "accepted", "connected", "declined", "busy",
  "cancelled", "missed", "ended",
];
const EVENTS = [
  "accept", "decline", "busy", "cancel", "ring_timeout",
  "media_ready", "media_failed", "hangup",
];
const ACTORS = [CALLER, WORKER, OTHER, null];
const CLOCKS = [CREATED + 1, DEADLINE, DEADLINE + 1];
const NEXT = Object.freeze({
  ringing: Object.freeze({
    accept: "accepted", decline: "declined", busy: "busy",
    cancel: "cancelled", ring_timeout: "missed",
  }),
  accepted: Object.freeze({
    media_ready: "connected", media_failed: "ended", hangup: "ended",
  }),
  connected: Object.freeze({
    media_failed: "ended", hangup: "ended",
  }),
  declined: Object.freeze({}),
  busy: Object.freeze({}),
  cancelled: Object.freeze({}),
  missed: Object.freeze({}),
  ended: Object.freeze({}),
});

function snapshot(phase) {
  return Object.freeze({
    callId: "call-matrix-00000001",
    listingId: "listing-matrix-00001",
    categoryId: "category-matrix",
    callerAccountId: CALLER,
    workerAccountId: WORKER,
    phase,
    revision: phase === "ringing" ? 0 :
      phase === "connected" ? 2 : phase === "ended" ? 3 : 1,
    createdAtMs: CREATED,
    ringDeadlineMs: DEADLINE,
  });
}
function command(actor, event, revision, time, index) {
  return Object.freeze({
    actorAccountId: actor,
    expectedRevision: revision,
    idempotencyKey: "matrix-key-" + String(index).padStart(8, "0"),
    event,
    nowMs: time,
  });
}
function allowed(actor, event) {
  if (["accept", "decline", "busy"].includes(event)) return actor === WORKER;
  if (event === "cancel") return actor === CALLER;
  if (event === "hangup") return actor === CALLER || actor === WORKER;
  return actor === null; // trusted-server-only test fixture
}
function expected(phase, actor, event, time) {
  if (!allowed(actor, event))
    return { kind: "reject", code: "NOT_PARTICIPANT" };
  if (phase === "ringing" && event === "ring_timeout" && time < DEADLINE)
    return { kind: "reject", code: "TOO_EARLY" };
  if (phase === "ringing" && event !== "ring_timeout" && time >= DEADLINE)
    return { kind: "reject", code: "RING_EXPIRED" };
  const next = NEXT[phase][event];
  return next ? { kind: "apply", phase: next } :
    { kind: "reject", code: "TRANSITION_DENIED" };
}

test("offline Agora matrix covers every phase/event/actor at and around ring expiry", () => {
  let count = 0;
  let applied = 0;
  for (const phase of PHASES) {
    for (const time of CLOCKS) {
      for (const event of EVENTS) {
        for (const actor of ACTORS) {
          const before = snapshot(phase);
          const original = { ...before };
          const input = command(actor, event, before.revision, time, ++count);
          const verdict = expected(phase, actor, event, time);
          const actual = decideSyntheticAgoraCallEvent(before, input);
          assert.equal(actual.kind, verdict.kind,
            JSON.stringify({ phase, time, event, actor }));
          assert.deepEqual(before, original, "reducer must not mutate input");
          assert.equal(Object.isFrozen(before), true);
          if (actual.kind === "apply") {
            applied++;
            assert.equal(actual.result.phase, verdict.phase);
            assert.equal(actual.result.revision, before.revision + 1);
            assert.equal(Object.isFrozen(actual.result), true);
            assert.equal(Object.isFrozen(actual.receipt), true);
            assert.deepEqual(
              { ...actual.result, phase: before.phase, revision: before.revision },
              before, "identity, listing and timing cannot change");
            assert.deepEqual(actual.receipt.result, actual.result);
            assert.equal(actual.receipt.callId, before.callId);
            assert.equal(actual.receipt.actorAccountId, actor);
            assert.equal(actual.receipt.idempotencyKey, input.idempotencyKey);
            assert.deepEqual(
              decideSyntheticAgoraCallEvent(actual.result, input, actual.receipt),
              { kind: "replay", receipt: actual.receipt },
              "exact idempotent replay must not apply a second transition");
            for (const forbidden of ["accessToken", "phoneNumber", "rtcUid", "agoraChannel"])
              assert.equal(JSON.stringify(actual).includes(forbidden), false);
          } else {
            assert.deepEqual(actual, verdict,
              "every rejected event must be explicitly denied");
          }
        }
      }
    }
  }
  assert.equal(count, 8 * 3 * 8 * 4);
  assert.ok(applied > 0);
});

test("all synthetic terminal phases stay terminal, including at later times", () => {
  let count = 0;
  for (const phase of ["declined", "busy", "cancelled", "missed", "ended"]) {
    const current = snapshot(phase);
    for (const [actor, event] of [
      [WORKER, "accept"], [WORKER, "decline"], [WORKER, "busy"],
      [CALLER, "cancel"], [CALLER, "hangup"], [WORKER, "hangup"],
      [null, "ring_timeout"], [null, "media_ready"], [null, "media_failed"],
    ]) {
      const result = decideSyntheticAgoraCallEvent(current,
        command(actor, event, current.revision, DEADLINE + 50_000, ++count));
      assert.deepEqual(result,
        { kind: "reject", code: "TRANSITION_DENIED" },
        phase + " cannot reopen via " + event);
    }
  }
  assert.equal(count, 45);
});

test("synthetic accepted/connected trace allows no stale rewrite or duplicate receipt", () => {
  const first = snapshot("ringing");
  const accept = command(WORKER, "accept", 0, CREATED + 1000, 10001);
  const one = decideSyntheticAgoraCallEvent(first, accept);
  assert.equal(one.kind, "apply");
  const ready = command(null, "media_ready", 1, DEADLINE + 1000, 10002);
  const two = decideSyntheticAgoraCallEvent(one.result, ready);
  assert.equal(two.kind, "apply");
  const hangup = command(CALLER, "hangup", 2, DEADLINE + 2000, 10003);
  const three = decideSyntheticAgoraCallEvent(two.result, hangup);
  assert.equal(three.kind, "apply");
  assert.equal(three.result.phase, "ended");
  assert.equal(three.result.revision, 3);

  for (const [cmd, receipt] of [
    [accept, one.receipt], [ready, two.receipt], [hangup, three.receipt],
  ]) {
    assert.deepEqual(
      decideSyntheticAgoraCallEvent(three.result, cmd, receipt),
      { kind: "replay", receipt },
      "a later phase may acknowledge but never reapply a committed key");
    assert.deepEqual(
      decideSyntheticAgoraCallEvent(three.result,
        { ...cmd, idempotencyKey: cmd.idempotencyKey + "-changed" }, receipt),
      { kind: "reject", code: "KEY_CONFLICT" },
      "changed idempotency key must not inherit a prior receipt");
    assert.deepEqual(
      decideSyntheticAgoraCallEvent(three.result,
        { ...cmd, nowMs: cmd.nowMs + 1 }, receipt),
      { kind: "reject", code: "KEY_CONFLICT" },
      "receipt timestamp is bound to the original command");
  }
  assert.deepEqual(
    decideSyntheticAgoraCallEvent(three.result,
      command(WORKER, "hangup", 0, DEADLINE + 3000, 10004)),
    { kind: "reject", code: "STALE_REVISION" });
  assert.deepEqual(
    decideSyntheticAgoraCallEvent(three.result,
      command(WORKER, "accept", 3, DEADLINE + 3000, 10005)),
    { kind: "reject", code: "TRANSITION_DENIED" });
  assert.equal(first.phase, "ringing");
  assert.equal(first.revision, 0);
  assert.equal(one.result.phase, "accepted");
  assert.equal(two.result.phase, "connected");
});

/** A fake long-lived accepted call is not a founder-approved media TTL.
 * Expiry for accepted/connected phases is intentionally NOT chosen here. */
test("offline matrix does not silently apply unapproved accepted/media timeouts", () => {
  for (const phase of ["accepted", "connected"]) {
    const current = snapshot(phase);
    const event = phase === "accepted" ? "media_ready" : "hangup";
    const actor = phase === "accepted" ? null : WORKER;
    const next = decideSyntheticAgoraCallEvent(current,
      command(actor, event, current.revision, DEADLINE + 1_000_000, 20000));
    assert.equal(next.kind, "apply");
    assert.equal(next.result.phase, phase === "accepted" ? "connected" : "ended");
  }
});
