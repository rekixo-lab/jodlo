import type { ContactDecision, ContactSafetyFacts } from "./contact-safety.ts";
import { decideContactSafety } from "./contact-safety.ts";
import type { RequestTargetFacts } from "./request-target.ts";

/**
 * ADR-0012 and binding clarification ADR-0013: initial contact is an
 * IN-APP AGORA RTC INTERNET AUDIO CALL, NOT a carrier/SIM telephone call
 * or a mandatory service request/accept-before-call workflow.
 *
 * Agora routes by server-authorized channel and participant IDs; worker
 * telephone numbers are not required, collected, disclosed or routed.
 * All additional facts below lack approved production sources today.
 */
export type DirectCallPolicyFacts = Readonly<{
  /** Current actual service availability, not a cached public Search hint. */
  listingAvailable: boolean;
  blockedByRequester: boolean;
  blockedByWorker: boolean;
  /** Explicit worker consent to receiving calls; listing publication != consent. */
  workerConsentedToCalls: boolean;
  /** Future trusted source checked the Agora recipient's eligible account/RTC UID; never pass the UID. */
  callDestinationVerified: boolean;
  /** Future server-authorized Agora channel/participant privacy and token access policy, NOT phone-number disclosure. */
  connectionPrivacyApproved: boolean;
  /** Caller is not blocked by abuse/rate-limiting safeguards. */
  abuseLimitPassed: boolean;
}>;

/** NEVER returns a phone number, worker ID, Agora channel/UID, RTC token, tel: URL or connection credential.
 * "candidate" is a synthetic policy result, NOT a live-call authorization.
 */
export type DirectCallCandidateDecision =
  | Readonly<{ kind: "candidate"; listingId: string; categoryId: string }>
  | Readonly<{ kind: "denied"; reason:
      "TARGET_UNAVAILABLE" | "CALL_POLICY_UNAVAILABLE" |
      Extract<ContactDecision, { allowed: false }>["reason"] }>;

const REQUIRED_POLICY_FIELDS = [
  "listingAvailable", "blockedByRequester", "blockedByWorker",
  "workerConsentedToCalls", "callDestinationVerified",
  "connectionPrivacyApproved", "abuseLimitPassed",
] as const;

/** Pure, fail-closed composition of already tested contact checks with the
 * unimplemented direct-phone-call-specific privacy and abuse requirements.
 *
 * Both inputs MUST be from fresh server-trusted sources. Today only target
 * account/listing/Category facts can be read from D1; there is deliberately
 * no source for the seven extra policy fields outside synthetic tests.
 * A future real call needs a separate race-safe disclosure/connect boundary.
 */
export function assessDirectCallCandidate(
  target: RequestTargetFacts | null,
  policy: DirectCallPolicyFacts | null,
): DirectCallCandidateDecision {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return { kind: "denied", reason: "TARGET_UNAVAILABLE" };
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy) ||
      Object.keys(policy).length !== REQUIRED_POLICY_FIELDS.length ||
      REQUIRED_POLICY_FIELDS.some(key =>
        !Object.hasOwn(policy, key) || typeof policy[key] !== "boolean")) {
    // Unknown policy fields are denied too: no telephone number, token or
    // client-declared consent may leak into this internal boundary.
    return { kind: "denied", reason: "CALL_POLICY_UNAVAILABLE" };
  }

  const facts: ContactSafetyFacts = {
    ...target,
    listingAvailable: policy.listingAvailable,
    blockedByRequester: policy.blockedByRequester,
    blockedByWorker: policy.blockedByWorker,
    channelApprovedByPolicy:
      policy.workerConsentedToCalls &&
      policy.callDestinationVerified &&
      policy.connectionPrivacyApproved &&
      policy.abuseLimitPassed,
  };
  const decision = decideContactSafety(facts);
  if (!decision.allowed) return { kind: "denied", reason: decision.reason };
  return Object.freeze({
    kind: "candidate" as const,
    listingId: target.listingId,
    categoryId: target.categoryId,
  });
}
