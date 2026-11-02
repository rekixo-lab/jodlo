import type { D1Database } from "../../data/d1.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { prepareSyntheticAgoraInvite, type AgoraCallSnapshot } from "./agora-call-lifecycle.ts";
import type { DirectCallPolicyFacts } from "./direct-call.ts";
import {
  readCallerSessionBoundAgoraOptInTarget,
  readCallerSessionBoundAgoraConsentEpoch,
  type RequestTargetFacts,
} from "./request-target.ts";

/**
 * OFFLINE ONLY: scripted, server-injected evidence for call-invitation safety
 * tests. No live presence, block list, moderation store, quota reservation,
 * policy thresholds, device delivery or authorized Agora call exists yet.
 * NEVER hydrate any field from client JSON or claim this is a real anti-spam
 * implementation. M-003/M-005 rules and collection remain founder-gated.
 */
export type SyntheticAgoraInviteRisk = Readonly<{
  kind: "synthetic_invite_risk_v1";
  callerAccountId: string;
  workerAccountId: string;
  listingId: string;
  checkedAtMs: number;
  expiresAtMs: number;
  workerPresence: "online" | "offline" | "unknown";
  workerAvailability: "available" | "busy" | "unavailable" | "unknown";
  blockedByCaller: boolean;
  blockedByWorker: boolean;
  /** An injected hypothetical verdict; NOT a reserved or persisted quota. */
  rateGate: "pass" | "deny" | "unknown";
  recipientVerified: boolean;
  privacyApproved: boolean;
}>;

const RISK_FIELDS = [
  "kind", "callerAccountId", "workerAccountId", "listingId",
  "checkedAtMs", "expiresAtMs", "workerPresence", "workerAvailability",
  "blockedByCaller", "blockedByWorker", "rateGate",
  "recipientVerified", "privacyApproved",
] as const;

/**
 * Capture exactly the documented OWN DATA properties without executing
 * getters. A mutable test adapter can change its input while the D1 query is
 * awaited; never re-read the original risk object after validation.
 * Non-enumerable, symbol, getter and unexpected private fields fail closed.
 */
function snapshotRisk(
  value: unknown,
  nowMs: number,
): SyntheticAgoraInviteRisk | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== RISK_FIELDS.length ||
        RISK_FIELDS.some(key =>
          !Object.hasOwn(descriptors, key) ||
          !Object.hasOwn(descriptors[key], "value"))) return null;
    const candidate: unknown = Object.fromEntries(
      RISK_FIELDS.map(key => [key, descriptors[key].value]),
    );
    return validRisk(candidate, nowMs) ? Object.freeze(candidate) : null;
  } catch {
    // Unexpected proxy/adapter behavior is never approval.
    return null;
  }
}

function validRisk(value: unknown, nowMs: number): value is SyntheticAgoraInviteRisk {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  if (Object.keys(record).length !== RISK_FIELDS.length ||
      RISK_FIELDS.some(key => !Object.hasOwn(record, key))) return false;
  return record.kind === "synthetic_invite_risk_v1" &&
    validOpaqueId(record.callerAccountId) &&
    validOpaqueId(record.workerAccountId) &&
    record.callerAccountId !== record.workerAccountId &&
    validOpaqueId(record.listingId) &&
    typeof record.checkedAtMs === "number" &&
    Number.isSafeInteger(record.checkedAtMs) &&
    record.checkedAtMs >= 0 && record.checkedAtMs <= nowMs &&
    typeof record.expiresAtMs === "number" &&
    Number.isSafeInteger(record.expiresAtMs) &&
    record.expiresAtMs > nowMs &&
    (record.workerPresence === "online" ||
     record.workerPresence === "offline" ||
     record.workerPresence === "unknown") &&
    (record.workerAvailability === "available" ||
     record.workerAvailability === "busy" ||
     record.workerAvailability === "unavailable" ||
     record.workerAvailability === "unknown") &&
    typeof record.blockedByCaller === "boolean" &&
    typeof record.blockedByWorker === "boolean" &&
    (record.rateGate === "pass" ||
     record.rateGate === "deny" ||
     record.rateGate === "unknown") &&
    typeof record.recipientVerified === "boolean" &&
    typeof record.privacyApproved === "boolean";
}

export type SyntheticInviteSafetyDecision =
  | Readonly<{ kind: "prepared"; call: AgoraCallSnapshot }>
  | Readonly<{ kind: "denied" }>;

/** Original worker preference epoch is measured in the SAME caller/session/
 * listing D1 statement as all current eligibility evidence. An epoch-less
 * preview must never be silently promoted to durable call admission.
 */
export type SyntheticEpochBoundInviteSafetyDecision =
  | Readonly<{
      kind: "prepared";
      call: AgoraCallSnapshot;
      originalConsentRevision: number;
    }>
  | Readonly<{ kind: "denied" }>;

const DENIED = Object.freeze({ kind: "denied" as const });

/** Share the exact hypothetical risk checks; no query, token or provider
 * side effect occurs here. The caller identity and actual worker identity
 * must always originate in the D1-backed server projection, not risk JSON.
 */
function prepareForCurrentTarget(
  target: RequestTargetFacts | null,
  risk: SyntheticAgoraInviteRisk,
  callId: string,
  nowMs: number,
  ringDeadlineMs: number,
): SyntheticInviteSafetyDecision {
  if (!target ||
      risk.callerAccountId !== target.requesterAccountId ||
      risk.workerAccountId !== target.workerAccountId ||
      risk.listingId !== target.listingId ||
      risk.workerPresence !== "online" ||
      risk.workerAvailability !== "available" ||
      risk.blockedByCaller || risk.blockedByWorker ||
      risk.rateGate !== "pass" ||
      !risk.recipientVerified || !risk.privacyApproved) return DENIED;

  const policy: DirectCallPolicyFacts = {
    listingAvailable: true,
    blockedByRequester: risk.blockedByCaller,
    blockedByWorker: risk.blockedByWorker,
    workerConsentedToCalls: true,
    callDestinationVerified: risk.recipientVerified,
    connectionPrivacyApproved: risk.privacyApproved,
    abuseLimitPassed: risk.rateGate === "pass",
  };
  const result = prepareSyntheticAgoraInvite(
    target, policy, callId, nowMs, ringDeadlineMs,
  );
  return result.kind === "prepared" ? result : DENIED;
}

/**
 * Test-only rehearsal for a customer-initiated Agora ring, NOT RTC grant.
 * The worker's explicit consent is checked by a single D1 SELECT with
 * the CALLER'S current session, actual listing owner, active Category
 * and moderation. The worker bearer is NOT needed to start an invite. Scripted risk input must be CURRENT, exact and
 * identity-bound; any unknown/offline/busy/blocked/abuse/privacy state denies.
 *
 * A real invitation needs atomic admission / rate reservation, actual
 * server-owned block + presence + availability facts, owner-approved policy,
 * durable idempotency and separate consent-checked signaling. A customer's
 * request can never include the worker bearer; presence is NOT inferred
 * from a worker session. This internal fake is NOT a public route.
 */
export async function prepareSyntheticSafetyCheckedAgoraInvite(
  db: D1Database,
  callerBearer: string,
  listingId: string,
  callId: string,
  nowMs: number,
  ringDeadlineMs: number,
  risk: SyntheticAgoraInviteRisk | null,
): Promise<SyntheticInviteSafetyDecision> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(ringDeadlineMs)) return DENIED;
  const checkedRisk = snapshotRisk(risk, nowMs);
  if (!checkedRisk) return DENIED;
  try {
    const target = await readCallerSessionBoundAgoraOptInTarget(
      db, callerBearer, listingId,
    );
    return prepareForCurrentTarget(
      target, checkedRisk, callId, nowMs, ringDeadlineMs,
    );
  } catch {
    // No leakage of D1 errors, identity, presence or block relationships.
    return DENIED;
  }
}

/**
 * STRONGER OFFLINE INVITE PREVIEW: one caller-owned live session-bound D1
 * SELECT captures both current listing/worker eligibility AND the exact
 * original enabled preference revision. No second independent consent read,
 * no worker bearer and no client-selected worker or epoch are accepted.
 *
 * Intended only for test fixture writers that begin a local write transaction
 * BEFORE calling this helper and commit their call+UNSENT intent within it.
 * Without the surrounding transaction this is still merely a stale-able
 * preview: never a live ringing, RTC token or provider-send permission.
 */
export async function prepareSyntheticConsentEpochBoundAgoraInvite(
  db: D1Database,
  callerBearer: string,
  listingId: string,
  callId: string,
  nowMs: number,
  ringDeadlineMs: number,
  risk: SyntheticAgoraInviteRisk | null,
): Promise<SyntheticEpochBoundInviteSafetyDecision> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(ringDeadlineMs)) return DENIED;
  const checkedRisk = snapshotRisk(risk, nowMs);
  if (!checkedRisk) return DENIED;
  try {
    const evidence = await readCallerSessionBoundAgoraConsentEpoch(
      db, callerBearer, listingId,
    );
    if (!evidence) return DENIED;
    const result = prepareForCurrentTarget(
      evidence.target, checkedRisk, callId, nowMs, ringDeadlineMs,
    );
    return result.kind === "prepared"
      ? Object.freeze({
          kind: "prepared" as const,
          call: result.call,
          originalConsentRevision: evidence.consentRevision,
        })
      : DENIED;
  } catch {
    return DENIED;
  }
}
