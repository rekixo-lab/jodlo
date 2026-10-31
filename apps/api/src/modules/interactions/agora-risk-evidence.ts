import { validOpaqueId } from "../shared/identifiers.ts";
import type { SyntheticAgoraInviteRisk } from "./agora-invite-safety.ts";

/**
 * Strict OFFLINE-ONLY composition of five independently scripted risk checks.
 *
 * This module does NOT fetch server-owned presence, block relationships, busy
 * locks, rate budgets, device routes, or approved privacy settings. Inputs are
 * fake internal test evidence, NOT safe client JSON or production attestations.
 * A real adapter needs authoritative server reads and atomic admission, with
 * founder-approved M-003/M-005 policy and expiry/retention decisions.
 */
export type SyntheticAgoraRiskIdentity = Readonly<{
  callerAccountId: string;
  workerAccountId: string;
  listingId: string;
}>;

const IDENTITY_FIELDS = [
  "callerAccountId", "workerAccountId", "listingId",
] as const;
const ENVELOPE_FIELDS = [
  ...IDENTITY_FIELDS, "checkedAtMs", "expiresAtMs", "kind",
] as const;

/** One required, independently identity-bound fixture per risk dimension. */
const CHECK_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  synthetic_presence_check_v1: [...ENVELOPE_FIELDS, "workerPresence"],
  synthetic_availability_check_v1: [...ENVELOPE_FIELDS, "workerAvailability"],
  synthetic_mutual_blocks_check_v1: [...ENVELOPE_FIELDS, "blockedByCaller", "blockedByWorker"],
  synthetic_rate_check_v1: [...ENVELOPE_FIELDS, "rateGate"],
  synthetic_connection_check_v1: [...ENVELOPE_FIELDS, "recipientVerified", "privacyApproved"],
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(record).length === fields.length &&
    fields.every(field => Object.hasOwn(record, field));
}

function validCheckValue(kind: string, check: Record<string, unknown>): boolean {
  switch (kind) {
    case "synthetic_presence_check_v1":
      return check.workerPresence === "online" ||
        check.workerPresence === "offline" || check.workerPresence === "unknown";
    case "synthetic_availability_check_v1":
      return check.workerAvailability === "available" ||
        check.workerAvailability === "busy" ||
        check.workerAvailability === "unavailable" ||
        check.workerAvailability === "unknown";
    case "synthetic_mutual_blocks_check_v1":
      return typeof check.blockedByCaller === "boolean" &&
        typeof check.blockedByWorker === "boolean";
    case "synthetic_rate_check_v1":
      return check.rateGate === "pass" || check.rateGate === "deny" ||
        check.rateGate === "unknown";
    case "synthetic_connection_check_v1":
      return typeof check.recipientVerified === "boolean" &&
        typeof check.privacyApproved === "boolean";
    default:
      return false;
  }
}

/**
 * Rehearses a future multi-reader safety boundary without selecting live
 * presence timeout, concurrent-call policy or spam threshold.
 *
 * Returns null for missing/duplicate/unknown/stale/cross-account facts.
 * Does not convert a denial fact to an approval: downstream existing
 * prepareSyntheticSafetyCheckedAgoraInvite still denies offline/busy/blocked,
 * unknown rate or prohibited connection. The result is NOT a real grant.
 */
export function composeSyntheticAgoraInviteRisk(
  identityInput: SyntheticAgoraRiskIdentity,
  nowMs: number,
  checks: readonly unknown[],
): SyntheticAgoraInviteRisk | null {
  const identity = asRecord(identityInput);
  if (!identity || !exactFields(identity, IDENTITY_FIELDS) ||
      !validOpaqueId(identity.callerAccountId) ||
      !validOpaqueId(identity.workerAccountId) ||
      identity.callerAccountId === identity.workerAccountId ||
      !validOpaqueId(identity.listingId) ||
      !Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Array.isArray(checks) ||
      checks.length !== Object.keys(CHECK_FIELDS).length) return null;

  const verified = new Map<string, Record<string, unknown>>();
  let newestCheckedAt = 0;
  let earliestExpiry = Number.MAX_SAFE_INTEGER;
  for (const raw of checks) {
    const check = asRecord(raw);
    if (!check || typeof check.kind !== "string" ||
        !Object.hasOwn(CHECK_FIELDS, check.kind) ||
        verified.has(check.kind) ||
        !exactFields(check, CHECK_FIELDS[check.kind]) ||
        check.callerAccountId !== identity.callerAccountId ||
        check.workerAccountId !== identity.workerAccountId ||
        check.listingId !== identity.listingId ||
        !Number.isSafeInteger(check.checkedAtMs) ||
        !Number.isSafeInteger(check.expiresAtMs) ||
        (check.checkedAtMs as number) < 0 ||
        (check.checkedAtMs as number) > nowMs ||
        (check.expiresAtMs as number) <= nowMs ||
        !validCheckValue(check.kind, check)) return null;
    verified.set(check.kind, check);
    newestCheckedAt = Math.max(newestCheckedAt, check.checkedAtMs as number);
    earliestExpiry = Math.min(earliestExpiry, check.expiresAtMs as number);
  }

  const presence = verified.get("synthetic_presence_check_v1");
  const availability = verified.get("synthetic_availability_check_v1");
  const blocks = verified.get("synthetic_mutual_blocks_check_v1");
  const rate = verified.get("synthetic_rate_check_v1");
  const connection = verified.get("synthetic_connection_check_v1");
  if (!presence || !availability || !blocks || !rate || !connection ||
      newestCheckedAt >= earliestExpiry) return null;

  // The intersection of all five fake fact-validity windows, never an
  // arbitrary extension of a weaker observation's expiration.
  return Object.freeze({
    kind: "synthetic_invite_risk_v1" as const,
    callerAccountId: identity.callerAccountId as string,
    workerAccountId: identity.workerAccountId as string,
    listingId: identity.listingId as string,
    checkedAtMs: newestCheckedAt,
    expiresAtMs: earliestExpiry,
    workerPresence: presence.workerPresence as SyntheticAgoraInviteRisk["workerPresence"],
    workerAvailability: availability.workerAvailability as SyntheticAgoraInviteRisk["workerAvailability"],
    blockedByCaller: blocks.blockedByCaller as boolean,
    blockedByWorker: blocks.blockedByWorker as boolean,
    rateGate: rate.rateGate as SyntheticAgoraInviteRisk["rateGate"],
    recipientVerified: connection.recipientVerified as boolean,
    privacyApproved: connection.privacyApproved as boolean,
  });
}
