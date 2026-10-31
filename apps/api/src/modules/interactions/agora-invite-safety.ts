import type { D1Database } from "../../data/d1.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { prepareSyntheticAgoraInvite, type AgoraCallSnapshot } from "./agora-call-lifecycle.ts";
import type { DirectCallPolicyFacts } from "./direct-call.ts";
import { readTwoSessionBoundAgoraOptInTarget } from "./request-target.ts";

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

/**
 * Test-only rehearsal for a customer-initiated Agora ring, NOT RTC grant.
 * The worker's explicit consent is checked by an existing one-statement D1
 * read that also checks both live sessions, actual listing owner, active
 * Category and moderation. Scripted risk input must be CURRENT, exact and
 * identity-bound; any unknown/offline/busy/blocked/abuse/privacy state denies.
 *
 * A real invitation needs atomic admission / rate reservation, actual
 * server-owned block + presence + availability facts, owner-approved policy,
 * durable idempotency and separate consent-checked signaling. The worker's
 * bearer must never be supplied by the customer; this is only a paired
 * synthetic test harness, NOT an implementable customer-facing route.
 */
export async function prepareSyntheticSafetyCheckedAgoraInvite(
  db: D1Database,
  callerBearer: string,
  workerBearer: string,
  listingId: string,
  callId: string,
  nowMs: number,
  ringDeadlineMs: number,
  risk: SyntheticAgoraInviteRisk | null,
): Promise<SyntheticInviteSafetyDecision> {
  const denied = Object.freeze({ kind: "denied" as const });
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(ringDeadlineMs) ||
      !validRisk(risk, nowMs)) return denied;

  try {
    const target = await readTwoSessionBoundAgoraOptInTarget(
      db, callerBearer, workerBearer, listingId,
    );
    if (!target ||
        risk.callerAccountId !== target.requesterAccountId ||
        risk.workerAccountId !== target.workerAccountId ||
        risk.listingId !== target.listingId ||
        risk.workerPresence !== "online" ||
        risk.workerAvailability !== "available" ||
        risk.blockedByCaller || risk.blockedByWorker ||
        risk.rateGate !== "pass" ||
        !risk.recipientVerified || !risk.privacyApproved) return denied;

    // The consent in the real read is mandatory; remaining policy inputs
    // are SIMULATED. No quota, busy claim, notification or call is made.
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
    return result.kind === "prepared" ? result : denied;
  } catch {
    // No leakage of D1 errors, identity, presence or block relationships.
    return denied;
  }
}
