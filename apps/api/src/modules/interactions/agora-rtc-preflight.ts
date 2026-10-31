import type { D1Database } from "../../data/d1.ts";
import type { DirectCallPolicyFacts } from "./direct-call.ts";
import type { AgoraCallSnapshot } from "./agora-call-lifecycle.ts";
import { assessSyntheticAgoraJoinPrerequisites } from "./agora-call-lifecycle.ts";
import {
  readCallerSessionBoundAgoraOptInTarget,
  readWorkerSessionBoundAgoraOptInTarget,
} from "./request-target.ts";

/**
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
