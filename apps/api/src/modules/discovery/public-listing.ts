import { validCategoryId, validOpaqueId } from "../shared/identifiers.ts";

/**
 * PURE, INTERNAL visibility projection for synthetic trusted facts.
 *
 * It does not publish workers, query a listing table, grant verified status,
 * expose a public route or choose the M-005 publication process. A future
 * D1 reader must construct every flag from current authoritative records
 * and use a founder-approved disclosure policy, not client/body flags.
 */
export type ListingVisibilityFacts = Readonly<{
  listingId: string;
  listingOwnerAccountId: string;
  workerAccountId: string;
  categoryId: string;
  ownerActive: boolean;
  workerOptedIn: boolean;
  /** Existing worker_profiles status='draft' MUST be treated as private. */
  workerDraftOnly: boolean;
  categoryActive: boolean;
  listingPublished: boolean;
  listingAvailable: boolean;
  moderationApproved: boolean;
  /** Must be independently provided by the eventual approved M-005 policy. */
  disclosureApprovedByPolicy: boolean;
}>;

export type SyntheticPublicListing = Readonly<{
  id: string;
  categoryId: string;
}>;

const REQUIRED_BOOLEAN_FIELDS = [
  "ownerActive", "workerOptedIn", "workerDraftOnly",
  "categoryActive", "listingPublished", "listingAvailable",
  "moderationApproved", "disclosureApprovedByPolicy",
] as const;

/**
 * Returns only an explicit, immutable two-field allowlist, or null.
 * No names, personal location, worker account IDs, photos, trust badges,
 * contact details, internal draft state or hidden moderation reasons.
 *
 * NOT a full business listing DTO or approval to make it public.
 */
export function projectVisibleListing(
  facts: ListingVisibilityFacts,
): SyntheticPublicListing | null {
  if (!facts || typeof facts !== "object" ||
      !validOpaqueId(facts.listingId) ||
      !validOpaqueId(facts.listingOwnerAccountId) ||
      !validOpaqueId(facts.workerAccountId) ||
      !validCategoryId(facts.categoryId) ||
      REQUIRED_BOOLEAN_FIELDS.some(field => typeof facts[field] !== "boolean")) {
    return null;
  }
  if (facts.listingOwnerAccountId !== facts.workerAccountId) return null;
  if (!facts.ownerActive || !facts.workerOptedIn || facts.workerDraftOnly ||
      !facts.categoryActive || !facts.listingPublished ||
      !facts.listingAvailable || !facts.moderationApproved ||
      !facts.disclosureApprovedByPolicy) {
    return null;
  }
  return Object.freeze({ id: facts.listingId, categoryId: facts.categoryId });
}
