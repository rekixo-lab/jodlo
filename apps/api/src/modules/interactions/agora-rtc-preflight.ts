import type { D1Database } from "../../data/d1.ts";
import type { DirectCallPolicyFacts } from "./direct-call.ts";
import type { AgoraCallSnapshot } from "./agora-call-lifecycle.ts";
import { assessSyntheticAgoraJoinPrerequisites } from "./agora-call-lifecycle.ts";
import { readTwoSessionBoundAgoraOptInTarget } from "./request-target.ts";

/**
 * An OFFLINE rehearsal of what an Agora AccessToken2 issuer MUST check.
 * This cannot create tokens, channel names, RTC user IDs or credentials.
 * Worker call opt-in now has a real owner-scoped D1 source. Other injected
 * policy flags still have NO approved real data sources.
 *
 * A future issuer must atomically bind call grant, participant session and
 * fresh consent/block/abuse facts; a read-only preflight is never enough
 * to authorize an external provider side effect.
 */
export async function assessSyntheticAgoraRtcPreflight(
  db: D1Database,
  call: AgoraCallSnapshot,
  callerBearer: string,
  workerBearer: string,
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
    const target = await readTwoSessionBoundAgoraOptInTarget(
      db, callerBearer, workerBearer, call?.listingId,
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
    // D1 outage/corrupt adapter is never a reason to issue RTC credentials.
    return { kind: "denied", reason: "SESSION_OR_TARGET_UNAVAILABLE" };
  }
}
