import { validCategoryId, validIdempotencyKey, validOpaqueId } from "../shared/identifiers.ts";
import type { RequestTargetFacts } from "./request-target.ts";
import { assessDirectCallCandidate, type DirectCallPolicyFacts } from "./direct-call.ts";

/**
 * ADR-0013: purely LOCAL, TEST-ONLY rehearsal of an Agora in-app AUDIO call.
 * Never expose these internal account IDs in public JSON or signaling.
 * This is NOT durable signaling, an approved ringing SLA, a D1 write, a
 * token issuer, a real RTC session, or any permission to join Agora.
 */
export type AgoraCallPhase =
  | "ringing" | "accepted" | "connected"
  | "declined" | "busy" | "cancelled" | "missed" | "ended";

export type AgoraCallEvent =
  | "accept" | "decline" | "busy" | "cancel" | "ring_timeout"
  | "media_ready" | "media_failed" | "hangup";

export type AgoraCallSnapshot = Readonly<{
  callId: string;
  listingId: string;
  categoryId: string;
  callerAccountId: string;
  workerAccountId: string;
  phase: AgoraCallPhase;
  revision: number;
  createdAtMs: number;
  ringDeadlineMs: number;
}>;

export type AgoraCallCommand = Readonly<{
  /** Trusted active session account; null is RESERVED for trusted server events. */
  actorAccountId: string | null;
  expectedRevision: number;
  idempotencyKey: string;
  event: AgoraCallEvent;
  nowMs: number;
}>;

export type AgoraCallReceipt = Readonly<{
  callId: string;
  actorAccountId: string | null;
  expectedRevision: number;
  idempotencyKey: string;
  event: AgoraCallEvent;
  nowMs: number;
  result: AgoraCallSnapshot;
}>;

export type AgoraCallDecision =
  | Readonly<{ kind: "apply"; result: AgoraCallSnapshot; receipt: AgoraCallReceipt }>
  | Readonly<{ kind: "replay"; receipt: AgoraCallReceipt }>
  | Readonly<{ kind: "reject"; code:
      "INVALID_INPUT" | "NOT_PARTICIPANT" | "STALE_REVISION" |
      "KEY_CONFLICT" | "TRANSITION_DENIED" | "RING_EXPIRED" | "TOO_EARLY" }>;

const SNAPSHOT_FIELDS = [
  "callId", "listingId", "categoryId", "callerAccountId", "workerAccountId",
  "phase", "revision", "createdAtMs", "ringDeadlineMs",
] as const;
const COMMAND_FIELDS = [
  "actorAccountId", "expectedRevision", "idempotencyKey", "event", "nowMs",
] as const;
const RECEIPT_FIELDS = [
  "callId", "actorAccountId", "expectedRevision", "idempotencyKey",
  "event", "nowMs", "result",
] as const;
const PHASES: readonly string[] = [
  "ringing", "accepted", "connected", "declined", "busy",
  "cancelled", "missed", "ended",
];
const EVENTS: readonly string[] = [
  "accept", "decline", "busy", "cancel", "ring_timeout",
  "media_ready", "media_failed", "hangup",
];
const RECEIPT_PHASES: Readonly<Record<AgoraCallEvent, AgoraCallPhase>> = Object.freeze({
  accept: "accepted", decline: "declined", busy: "busy",
  cancel: "cancelled", ring_timeout: "missed",
  media_ready: "connected", media_failed: "ended", hangup: "ended",
});

/** Test-only guard, NOT an approved caller ringing duration. */
export const MAX_SYNTHETIC_RING_WINDOW_MS = 120_000;

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const nonnegativeInteger = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const positiveInteger = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function validSnapshot(value: unknown): value is AgoraCallSnapshot {
  if (!record(value) || !exactKeys(value, SNAPSHOT_FIELDS)) return false;
  return validOpaqueId(value.callId) &&
    validOpaqueId(value.listingId) &&
    validCategoryId(value.categoryId) &&
    validOpaqueId(value.callerAccountId) &&
    validOpaqueId(value.workerAccountId) &&
    value.callerAccountId !== value.workerAccountId &&
    typeof value.phase === "string" && PHASES.includes(value.phase) &&
    nonnegativeInteger(value.revision) &&
    nonnegativeInteger(value.createdAtMs) &&
    positiveInteger(value.ringDeadlineMs) &&
    value.ringDeadlineMs > value.createdAtMs &&
    value.ringDeadlineMs - value.createdAtMs <= MAX_SYNTHETIC_RING_WINDOW_MS;
}

function validCommand(value: unknown): value is AgoraCallCommand {
  if (!record(value) || !exactKeys(value, COMMAND_FIELDS)) return false;
  return (value.actorAccountId === null || validOpaqueId(value.actorAccountId)) &&
    nonnegativeInteger(value.expectedRevision) &&
    validIdempotencyKey(value.idempotencyKey) &&
    typeof value.event === "string" && EVENTS.includes(value.event) &&
    nonnegativeInteger(value.nowMs);
}

function actorAuthorized(call: AgoraCallSnapshot, cmd: AgoraCallCommand): boolean {
  switch (cmd.event) {
    case "accept": case "decline": case "busy":
      return cmd.actorAccountId === call.workerAccountId;
    case "cancel":
      return cmd.actorAccountId === call.callerAccountId;
    case "hangup":
      return cmd.actorAccountId === call.callerAccountId ||
        cmd.actorAccountId === call.workerAccountId;
    // These commands are generated by a trusted server/provider adapter,
    // NEVER by a client supplying a null/missing account ID.
    case "ring_timeout": case "media_ready": case "media_failed":
      return cmd.actorAccountId === null;
  }
}

/**
 * Even a test-only replay receipt must describe a temporally possible event.
 * Receipt timestamps are NOT signatures or proof of a committed call; a real
 * store must still authenticate an atomic transition and unique receipt.
 */
function validReceiptTiming(
  event: AgoraCallEvent,
  expectedRevision: number,
  nowMs: number,
  result: AgoraCallSnapshot,
): boolean {
  if (nowMs < result.createdAtMs) return false;
  switch (event) {
    case "accept": case "decline": case "busy": case "cancel":
      return expectedRevision === 0 && nowMs < result.ringDeadlineMs;
    case "ring_timeout":
      return expectedRevision === 0 && nowMs >= result.ringDeadlineMs;
    case "media_ready": case "media_failed": case "hangup":
      return expectedRevision >= 1;
  }
}

function validReceipt(value: unknown): value is AgoraCallReceipt {
  if (!record(value) || !exactKeys(value, RECEIPT_FIELDS) ||
      !validSnapshot(value.result)) return false;
  const { result } = value;
  if (!validOpaqueId(value.callId) ||
      !(value.actorAccountId === null || validOpaqueId(value.actorAccountId)) ||
      !nonnegativeInteger(value.expectedRevision) ||
      !validIdempotencyKey(value.idempotencyKey) ||
      !nonnegativeInteger(value.nowMs) ||
      typeof value.event !== "string" || !EVENTS.includes(value.event)) return false;
  return validReceiptTiming(
      value.event as AgoraCallEvent,
      value.expectedRevision, value.nowMs, result,
    ) &&
    result.callId === value.callId &&
    result.revision === value.expectedRevision + 1 &&
    result.phase === RECEIPT_PHASES[value.event as AgoraCallEvent] &&
    actorAuthorized(result, {
      event: value.event as AgoraCallEvent,
      actorAccountId: value.actorAccountId as string | null,
    } as AgoraCallCommand);
}

/** Synthetic initialization requires a complete *test-only* future policy.
 * Merely publishing a listing or having an Agora App ID never opens a call.
 * Caller/worker identities are internal; no number, channel, UID or token.
 */
export function prepareSyntheticAgoraInvite(
  target: RequestTargetFacts | null,
  policy: DirectCallPolicyFacts | null,
  callId: string,
  createdAtMs: number,
  ringDeadlineMs: number,
): Readonly<{ kind: "prepared"; call: AgoraCallSnapshot }> |
   Readonly<{ kind: "denied"; reason: "INVALID_INVITE" | "CONTACT_NOT_APPROVED" }> {
  if (!validOpaqueId(callId) || !nonnegativeInteger(createdAtMs) ||
      !positiveInteger(ringDeadlineMs) ||
      ringDeadlineMs <= createdAtMs ||
      ringDeadlineMs - createdAtMs > MAX_SYNTHETIC_RING_WINDOW_MS) {
    return { kind: "denied", reason: "INVALID_INVITE" };
  }
  const decision = assessDirectCallCandidate(target, policy);
  if (decision.kind !== "candidate" || !target) {
    return { kind: "denied", reason: "CONTACT_NOT_APPROVED" };
  }
  return { kind: "prepared", call: Object.freeze({
    callId, listingId: decision.listingId, categoryId: decision.categoryId,
    callerAccountId: target.requesterAccountId,
    workerAccountId: target.workerAccountId,
    phase: "ringing" as const, revision: 0, createdAtMs, ringDeadlineMs,
  }) };
}

/**
 * Deterministic actor-scoped state transitions for OFFLINE tests only.
 * No default booking/request flow, transport send, external Agora call,
 * persistence, alarm scheduler, or asynchronous side effect.
 *
 * Future adapter MUST enforce CAS(callId, revision) and UNIQUE(callId,key)
 * ATOMICALLY in an M-003/M-005-approved durable store; merely using this
 * pure reducer cannot prevent multi-worker duplicate delivery.
 */
export function decideSyntheticAgoraCallEvent(
  current: AgoraCallSnapshot,
  command: AgoraCallCommand,
  priorReceipt: AgoraCallReceipt | null = null,
): AgoraCallDecision {
  if (!validSnapshot(current) || !validCommand(command) ||
      command.nowMs < current.createdAtMs ||
      current.revision === Number.MAX_SAFE_INTEGER) {
    return { kind: "reject", code: "INVALID_INPUT" };
  }
  if (!actorAuthorized(current, command)) {
    return { kind: "reject", code: "NOT_PARTICIPANT" };
  }
  if (priorReceipt !== null) {
    if (!validReceipt(priorReceipt) ||
        priorReceipt.callId !== current.callId ||
        priorReceipt.actorAccountId !== command.actorAccountId ||
        priorReceipt.expectedRevision !== command.expectedRevision ||
        priorReceipt.idempotencyKey !== command.idempotencyKey ||
        priorReceipt.event !== command.event ||
        priorReceipt.nowMs !== command.nowMs ||
        priorReceipt.result.listingId !== current.listingId ||
        priorReceipt.result.categoryId !== current.categoryId ||
        priorReceipt.result.callerAccountId !== current.callerAccountId ||
        priorReceipt.result.workerAccountId !== current.workerAccountId ||
        priorReceipt.result.createdAtMs !== current.createdAtMs ||
        priorReceipt.result.ringDeadlineMs !== current.ringDeadlineMs ||
        current.revision < priorReceipt.result.revision ||
        (current.revision === priorReceipt.result.revision &&
         current.phase !== priorReceipt.result.phase)) {
      return { kind: "reject", code: "KEY_CONFLICT" };
    }
    return { kind: "replay", receipt: priorReceipt };
  }

  if (command.expectedRevision !== current.revision) {
    return { kind: "reject", code: "STALE_REVISION" };
  }
  if (current.phase === "ringing") {
    if (command.event === "ring_timeout") {
      if (command.nowMs < current.ringDeadlineMs) {
        return { kind: "reject", code: "TOO_EARLY" };
      }
    } else if (command.nowMs >= current.ringDeadlineMs) {
      return { kind: "reject", code: "RING_EXPIRED" };
    }
  }
  let nextPhase: AgoraCallPhase | null = null;
  if (current.phase === "ringing") {
    switch (command.event) {
      case "accept": nextPhase = "accepted"; break;
      case "decline": nextPhase = "declined"; break;
      case "busy": nextPhase = "busy"; break;
      case "cancel": nextPhase = "cancelled"; break;
      case "ring_timeout": nextPhase = "missed"; break;
    }
  } else if (current.phase === "accepted") {
    switch (command.event) {
      case "media_ready": nextPhase = "connected"; break;
      case "hangup": case "media_failed": nextPhase = "ended"; break;
    }
  } else if (current.phase === "connected") {
    if (command.event === "hangup" || command.event === "media_failed")
      nextPhase = "ended";
  }
  if (!nextPhase) return { kind: "reject", code: "TRANSITION_DENIED" };

  const result: AgoraCallSnapshot = Object.freeze({
    ...current, phase: nextPhase, revision: current.revision + 1,
  });
  const receipt: AgoraCallReceipt = Object.freeze({
    callId: current.callId, actorAccountId: command.actorAccountId,
    expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey,
    event: command.event, nowMs: command.nowMs, result,
  });
  return { kind: "apply", result, receipt };
}

/**
 * ONLY a pure prerequisite preview. Not an Agora token/UID/channel/membership
 * grant; future token issuer must check the authenticated actor and CURRENT
 * approved policy in the same race-safe admission path, with revocation and
 * short token TTL. The worker must have a separately verified live session.
 */
export function assessSyntheticAgoraJoinPrerequisites(
  current: AgoraCallSnapshot,
  actorFromTrustedSession: string,
  expectedRevision: number,
  currentTarget: RequestTargetFacts | null,
  currentPolicy: DirectCallPolicyFacts | null,
): Readonly<{ kind: "prerequisite_only"; role: "caller" | "worker" }> |
   Readonly<{ kind: "denied"; reason:
     "INVALID_STATE" | "NOT_PARTICIPANT" | "STALE_REVISION" |
     "CALL_NOT_ACCEPTED" | "CURRENT_POLICY_DENIED" }> {
  if (!validSnapshot(current) || !validOpaqueId(actorFromTrustedSession) ||
      !nonnegativeInteger(expectedRevision)) {
    return { kind: "denied", reason: "INVALID_STATE" };
  }
  if (actorFromTrustedSession !== current.callerAccountId &&
      actorFromTrustedSession !== current.workerAccountId) {
    return { kind: "denied", reason: "NOT_PARTICIPANT" };
  }
  if (expectedRevision !== current.revision) {
    return { kind: "denied", reason: "STALE_REVISION" };
  }
  if (current.phase !== "accepted" && current.phase !== "connected") {
    return { kind: "denied", reason: "CALL_NOT_ACCEPTED" };
  }
  const verdict = assessDirectCallCandidate(currentTarget, currentPolicy);
  if (verdict.kind !== "candidate" || !currentTarget ||
      verdict.listingId !== current.listingId ||
      verdict.categoryId !== current.categoryId ||
      currentTarget.requesterAccountId !== current.callerAccountId ||
      currentTarget.workerAccountId !== current.workerAccountId) {
    return { kind: "denied", reason: "CURRENT_POLICY_DENIED" };
  }
  return Object.freeze({
    kind: "prerequisite_only" as const,
    role: actorFromTrustedSession === current.callerAccountId
      ? "caller" as const : "worker" as const,
  });
}
