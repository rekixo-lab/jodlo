import { validCategoryId, validOpaqueId } from "../shared/identifiers.ts";

/** Pure server-trusted safety facts. Never populate these from client flags.
 * A future D1 transaction MUST re-read every mutable fact before writing a
 * contact request: a preview result is never permission to interact later.
 * This does not select M-005's final channel/cooldown/request lifecycle.
 */
export type ContactSafetyFacts = Readonly<{
  requesterAccountId: string;
  workerAccountId: string;
  listingId: string;
  listingOwnerAccountId: string;
  categoryId: string;
  requesterActive: boolean;
  workerActive: boolean;
  workerOptedIn: boolean;
  listingPublished: boolean;
  listingAvailable: boolean;
  moderationApproved: boolean;
  blockedByRequester: boolean;
  blockedByWorker: boolean;
  channelApprovedByPolicy: boolean;
}>;

export type ContactDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason:
    "INVALID_FACTS" | "SELF_CONTACT" | "LISTING_OWNER_MISMATCH" |
    "ACCOUNT_UNAVAILABLE" | "WORKER_NOT_PUBLISHED" |
    "SERVICE_UNAVAILABLE" | "MODERATION_RESTRICTED" |
    "RELATIONSHIP_BLOCKED" | "CHANNEL_NOT_APPROVED" }>;

const REQUIRED_BOOLEAN_FIELDS = [
  "requesterActive", "workerActive", "workerOptedIn", "listingPublished",
  "listingAvailable", "moderationApproved", "blockedByRequester",
  "blockedByWorker", "channelApprovedByPolicy",
] as const;

/** Fails closed on all absent/untrusted internal flags, without leaking any
 * phone, GPS, profile, search index, trust label or legacy provider field.
 */
export function decideContactSafety(facts: ContactSafetyFacts): ContactDecision {
  if (!facts || typeof facts !== "object" ||
      !validOpaqueId(facts.requesterAccountId) ||
      !validOpaqueId(facts.workerAccountId) ||
      !validOpaqueId(facts.listingId) ||
      !validOpaqueId(facts.listingOwnerAccountId) ||
      !validCategoryId(facts.categoryId) ||
      REQUIRED_BOOLEAN_FIELDS.some(field => typeof facts[field] !== "boolean")) {
    return { allowed: false, reason: "INVALID_FACTS" };
  }
  if (facts.requesterAccountId === facts.workerAccountId) {
    return { allowed: false, reason: "SELF_CONTACT" };
  }
  if (facts.listingOwnerAccountId !== facts.workerAccountId) {
    return { allowed: false, reason: "LISTING_OWNER_MISMATCH" };
  }
  if (!facts.requesterActive || !facts.workerActive) {
    return { allowed: false, reason: "ACCOUNT_UNAVAILABLE" };
  }
  // Opt-in to a worker draft never makes the worker publicly contactable.
  if (!facts.workerOptedIn || !facts.listingPublished) {
    return { allowed: false, reason: "WORKER_NOT_PUBLISHED" };
  }
  if (!facts.listingAvailable) {
    return { allowed: false, reason: "SERVICE_UNAVAILABLE" };
  }
  if (!facts.moderationApproved) {
    return { allowed: false, reason: "MODERATION_RESTRICTED" };
  }
  if (facts.blockedByRequester || facts.blockedByWorker) {
    return { allowed: false, reason: "RELATIONSHIP_BLOCKED" };
  }
  if (!facts.channelApprovedByPolicy) {
    return { allowed: false, reason: "CHANNEL_NOT_APPROVED" };
  }
  return { allowed: true };
}
