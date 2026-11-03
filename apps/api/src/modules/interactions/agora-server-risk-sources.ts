import type { D1Database } from "../../data/d1.ts";
import {
  readCallerSessionBoundAgoraConsentEpoch,
} from "./request-target.ts";
import {
  prepareSyntheticConsentEpochBoundAgoraInvite,
  type SyntheticEpochBoundInviteSafetyDecision,
} from "./agora-invite-safety.ts";
import {
  composeSyntheticAgoraInviteRisk,
  type SyntheticAgoraRiskIdentity,
} from "./agora-risk-evidence.ts";
import {
  readLocalCallerAgoraSafetyFacts,
  type LocalAgoraSafetyFacts,
} from "./agora-private-safety-state.ts";

/**
 * OFFLINE CONTRACT ONLY. These are five separately injected, server-owned,
 * READ-ONLY source ports. Never fill them from a customer body or reuse this
 * module as a live invitation, quota reservation or RTC token issuer.
 *
 * Their check shapes are verified by composeSyntheticAgoraInviteRisk.
 * Minimal private D1 directional blocks and availability intent exist, but
 * operational presence, quota, rate thresholds, retention and real provider
 * delivery are NOT implemented or approved (M-003/M-005/M-006).
 */
export type SyntheticAgoraRiskReader = (
  identity: SyntheticAgoraRiskIdentity,
) => Promise<unknown>;

export type SyntheticAgoraServerRiskReaders = Readonly<{
  presence: SyntheticAgoraRiskReader;
  availability: SyntheticAgoraRiskReader;
  mutualBlocks: SyntheticAgoraRiskReader;
  abuse: SyntheticAgoraRiskReader;
  connection: SyntheticAgoraRiskReader;
}>;

const SOURCE_NAMES = [
  "presence", "availability", "mutualBlocks", "abuse", "connection",
] as const;
const DENIED = Object.freeze({ kind: "denied" as const });

/** Snapshot the five injected ports BEFORE any D1 or external reads.
 * Missing, extra, accessor, hidden, symbol or throwing proxy properties
 * cannot silently turn into a default-allow source.
 */
function captureReaders(
  input: unknown,
): readonly SyntheticAgoraRiskReader[] | null {
  if (input === null || typeof input !== "object" ||
      Array.isArray(input)) return null;
  try {
    const props = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(props).length !== SOURCE_NAMES.length ||
        SOURCE_NAMES.some(name =>
          !Object.hasOwn(props, name) ||
          !Object.hasOwn(props[name], "value") ||
          typeof props[name].value !== "function")) return null;
    return Object.freeze(
      SOURCE_NAMES.map(name => props[name].value as SyntheticAgoraRiskReader),
    );
  } catch {
    return null;
  }
}

function validTime(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) && value >= 0;
}

/** This is an additional private D1 veto, NEVER positive evidence of
 * online presence, an available call slot, a budget or provider readiness.
 * All these must still come from separately approved authoritative sources.
 */
function privateStateAllowsRehearsal(
  facts: LocalAgoraSafetyFacts | null,
  originalConsentRevision: number,
): facts is LocalAgoraSafetyFacts {
  return facts !== null &&
    facts.consentRevision === originalConsentRevision &&
    facts.acceptingCalls === true &&
    Number.isSafeInteger(facts.availabilityRevision) &&
    facts.availabilityRevision > 0 &&
    facts.blockedByCaller === false &&
    facts.blockedByWorker === false;
}

/**
 * Actor-first local call preflight rehearsal:
 * 1. Current CALLER-owned D1 session/listing and enabled Worker consent epoch
 * 2. First PRIVATE D1 safety read rejects missing/off Worker availability
 *    intent or a block in EITHER direction, bound to original consent epoch.
 * 3. Five explicit independent synthetic sources receive ONLY the resolved
 *    opaque caller/worker/listing identity (NO bearer/phone).
 * 4. Exact five-check composition with earliest source expiry and a fresh
 *    caller-session/listing/consent-epoch bound hypothetical invite.
 * 5. Re-read private D1 state AFTER sources: require same consent AND
 *    availability revisions, current availability ON and no current blocks.
 * 6. Re-sample the injected test clock after ALL awaits; deny expired risk.
 *
 * IMPORTANT: even a positive "prepared" result is NOT an atomic real-call
 * permission. Other stores could change immediately after a SELECT. A real
 * writer needs founder-approved availability/blocks/rate facts, admission
 * reservations, atomic consent checks and a provider-send boundary.
 */
export async function prepareSyntheticServerRiskReadAgoraInvite(
  db: D1Database,
  callerBearer: string,
  listingId: string,
  callId: string,
  ringDeadlineMs: number,
  readersInput: SyntheticAgoraServerRiskReaders | null,
  clockNow: () => number,
): Promise<SyntheticEpochBoundInviteSafetyDecision> {
  const readers = captureReaders(readersInput);
  if (!readers || typeof clockNow !== "function" ||
      !validTime(ringDeadlineMs)) return DENIED;
  try {
    const startedAt = clockNow();
    if (!validTime(startedAt) || startedAt >= ringDeadlineMs) return DENIED;

    const initial = await readCallerSessionBoundAgoraConsentEpoch(
      db, callerBearer, listingId,
    );
    if (!initial) return DENIED;
    // A synthetic "all-pass" source can NEVER override a real private block,
    // missing explicit availability preference or a stale consent epoch.
    const firstSafety = await readLocalCallerAgoraSafetyFacts(
      db, callerBearer, listingId,
    );
    if (!privateStateAllowsRehearsal(
      firstSafety, initial.consentRevision,
    )) return DENIED;

    // Absolutely no bearer or arbitrary client worker ID in source scope.
    const identity: SyntheticAgoraRiskIdentity = Object.freeze({
      callerAccountId: initial.target.requesterAccountId,
      workerAccountId: initial.target.workerAccountId,
      listingId: initial.target.listingId,
    });
    const evidence = await Promise.all(readers.map(reader => reader(identity)));
    const gatheredAt = clockNow();
    if (!validTime(gatheredAt) || gatheredAt < startedAt ||
        gatheredAt >= ringDeadlineMs) return DENIED;

    const risk = composeSyntheticAgoraInviteRisk(
      identity, gatheredAt, evidence,
    );
    if (!risk) return DENIED;
    const prepared = await prepareSyntheticConsentEpochBoundAgoraInvite(
      db, callerBearer, listingId, callId, gatheredAt, ringDeadlineMs, risk,
    );
    if (prepared.kind !== "prepared" ||
        prepared.originalConsentRevision !== initial.consentRevision ||
        prepared.call.callerAccountId !== identity.callerAccountId ||
        prepared.call.workerAccountId !== identity.workerAccountId ||
        prepared.call.listingId !== identity.listingId) return DENIED;

    // No implicit "block: false" from a scripted source can undo a current
    // real D1 relationship block. Availability OFF->ON increments its epoch.
    const finalSafety = await readLocalCallerAgoraSafetyFacts(
      db, callerBearer, listingId,
    );
    const finishedAt = clockNow();
    if (!validTime(finishedAt) || finishedAt < gatheredAt ||
        finishedAt >= risk.expiresAtMs ||
        finishedAt >= ringDeadlineMs ||
        !privateStateAllowsRehearsal(
          finalSafety, initial.consentRevision,
        ) ||
        finalSafety.availabilityRevision !==
          firstSafety.availabilityRevision) return DENIED;
    return prepared;
  } catch {
    // Do not leak source presence, block, abuse or session details.
    return DENIED;
  }
}
