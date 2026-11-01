import type { D1Database } from "../../data/d1.ts";
import type { DirectCallPolicyFacts } from "./direct-call.ts";
import type { AgoraCallSnapshot } from "./agora-call-lifecycle.ts";
import { assessSyntheticAgoraJoinPrerequisites } from "./agora-call-lifecycle.ts";
import {
  readCallerSessionBoundAgoraOptInTarget,
  readCallerSessionBoundAgoraConsentEpochMatch,
  readWorkerSessionBoundAgoraOptInTarget,
  readWorkerSessionBoundAgoraConsentEpochMatch,
} from "./request-target.ts";

/**
 * LEGACY, NON-EPOCH-BOUND OFFLINE RTC JOIN rehearsal, never credential issuance
 * or provider access. It cannot reject an old accepted call after OFF->ON;
 * use the separate original-consent-epoch-bound helper below instead for
 * future strict offline preview checks. This legacy helper remains for
 * historical tests and MUST NEVER be promoted to a token issuer.
 *
 * OFFLINE RTC JOIN rehearsal, never credential issuance or provider access.
 * EACH participant supplies exclusively THEIR OWN session bearer. A caller
 * cannot access the worker's token; a worker cannot access the caller's.
 * Worker opt-in is checked directly in D1 for both roles.
 *
 * The internal call snapshot is simulated and NOT an authoritative durable
 * call record. A future token issuer must obtain a server-owned accepted
 * call with atomic participant authorization and current block/availability
 * /abuse/privacy checks before scoped, short-lived Agora AccessToken2 signing.
 */
export async function assessSyntheticAgoraRtcPreflight(
  db: D1Database,
  call: AgoraCallSnapshot,
  participantBearer: string,
  requestedRole: "caller" | "worker",
  expectedRevision: number,
  currentPolicy: DirectCallPolicyFacts | null,
): Promise<
  Readonly<{ kind: "prerequisite_only"; role: "caller" | "worker" }> |
  Readonly<{ kind: "denied"; reason:
    "INVALID_ROLE" | "SESSION_OR_TARGET_UNAVAILABLE" | "CALL_OR_POLICY_DENIED" }>
> {
  if (requestedRole !== "caller" && requestedRole !== "worker") {
    return { kind: "denied", reason: "INVALID_ROLE" };
  }
  try {
    const target = requestedRole === "caller"
      ? await readCallerSessionBoundAgoraOptInTarget(
          db, participantBearer, call?.listingId,
        )
      : await readWorkerSessionBoundAgoraOptInTarget(
          db, participantBearer, call?.listingId, call?.callerAccountId,
        );
    if (!target) return { kind: "denied", reason: "SESSION_OR_TARGET_UNAVAILABLE" };
    const account = requestedRole === "caller"
      ? target.requesterAccountId : target.workerAccountId;
    const decision = assessSyntheticAgoraJoinPrerequisites(
      call, account, expectedRevision, target, currentPolicy,
    );
    if (decision.kind !== "prerequisite_only" || decision.role !== requestedRole) {
      return { kind: "denied", reason: "CALL_OR_POLICY_DENIED" };
    }
    return Object.freeze({ kind: "prerequisite_only" as const, role: decision.role });
  } catch {
    return { kind: "denied", reason: "SESSION_OR_TARGET_UNAVAILABLE" };
  }
}

/**
 * STRICTER OFFLINE-ONLY RTC preview for future server-held accepted calls.
 *
 * In contrast to the historical (non-epoch-bound) preflight above, this
 * additionally requires a trusted, ORIGINAL worker opt-in revision. Each
 * role supplies ONLY its OWN current bearer, while the relevant D1 SELECT
 * atomically matches that original revision with the actual listing owner's
 * CURRENT enabled opt-in and the role's unexpired session/eligibility.
 *
 * The expected consent revision MUST be obtained from an authenticated,
 * durable, server-owned call record in a future implementation. It cannot
 * come from client JSON or be substituted with whatever revision is current
 * after OFF->ON; doing so would defeat the protection. Such durable call
 * history and retention require M-003/M-005 founder decisions.
 *
 * This is still ONLY a read, not an atomic token-grant boundary: no issued
 * token is revoked and current consent could change immediately afterward.
 * No Agora SDK, signaling, push, call storage or real provider authorization.
 */
export async function assessSyntheticAgoraRtcConsentEpochPreflight(
  db: D1Database,
  call: AgoraCallSnapshot,
  participantBearer: string,
  requestedRole: "caller" | "worker",
  expectedRevision: number,
  originalConsentRevision: number,
  currentPolicy: DirectCallPolicyFacts | null,
): Promise<
  Readonly<{ kind: "prerequisite_only"; role: "caller" | "worker" }> |
  Readonly<{ kind: "denied"; reason:
    "INVALID_ROLE" | "INVALID_CONSENT_REVISION" |
    "SESSION_OR_TARGET_UNAVAILABLE" | "CALL_OR_POLICY_DENIED" }>
> {
  if (requestedRole !== "caller" && requestedRole !== "worker") {
    return { kind: "denied", reason: "INVALID_ROLE" };
  }
  if (typeof originalConsentRevision !== "number" ||
      !Number.isSafeInteger(originalConsentRevision) ||
      originalConsentRevision < 1 ||
      originalConsentRevision > 2_147_483_647) {
    return { kind: "denied", reason: "INVALID_CONSENT_REVISION" };
  }
  try {
    const target = requestedRole === "caller"
      ? (await readCallerSessionBoundAgoraConsentEpochMatch(
          db, participantBearer, call?.listingId, originalConsentRevision,
        ))?.target ?? null
      : await readWorkerSessionBoundAgoraConsentEpochMatch(
          db, participantBearer, call?.listingId, call?.callerAccountId,
          originalConsentRevision,
        );
    if (!target) return { kind: "denied", reason: "SESSION_OR_TARGET_UNAVAILABLE" };

    const account = requestedRole === "caller"
      ? target.requesterAccountId : target.workerAccountId;
    const decision = assessSyntheticAgoraJoinPrerequisites(
      call, account, expectedRevision, target, currentPolicy,
    );
    if (decision.kind !== "prerequisite_only" ||
        decision.role !== requestedRole) {
      return { kind: "denied", reason: "CALL_OR_POLICY_DENIED" };
    }
    return Object.freeze({
      kind: "prerequisite_only" as const,
      role: decision.role,
    });
  } catch {
    return { kind: "denied", reason: "SESSION_OR_TARGET_UNAVAILABLE" };
  }
}
