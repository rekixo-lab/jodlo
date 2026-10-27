import { validCategoryId, validOpaqueId } from "../shared/identifiers.ts";

/**
 * INTERNAL policy-driven candidate selection, synthetic only. No DB table,
 * public worker listing, trust/ranking assertion, geo, phone or payment data.
 * M-003/M-005 must approve an eligibility policy before real use.
 */
export type CandidateSnapshot = Readonly<{
  workerAccountId: string;
  categoryIds: readonly string[];
}>;
export type CandidateContext = Readonly<{
  requesterAccountId: string;
  categoryId: string;
}>;
export type CandidateApproval = (
  candidate: CandidateSnapshot, context: CandidateContext,
) => boolean;

const MAX_SCANNED = 100;
const MAX_RETURNED = 25;

/** Fail-closed if the caller omits a trusted approval policy.
 * Order follows trusted input, never inventing scores/verification.
 * Returns only opaque IDs; callers must recheck eligibility at write time.
 */
export function selectCandidateIds(
  context: CandidateContext,
  candidates: readonly CandidateSnapshot[],
  approve: CandidateApproval,
  limit = 20,
): string[] {
  if (!validOpaqueId(context?.requesterAccountId) ||
      !validCategoryId(context?.categoryId) ||
      !Array.isArray(candidates) || candidates.length > MAX_SCANNED ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RETURNED ||
      typeof approve !== "function") {
    throw new Error("Invalid selection input or missing trusted policy");
  }
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!validOpaqueId(candidate?.workerAccountId) ||
        !Array.isArray(candidate.categoryIds) ||
        candidate.categoryIds.length > 30 ||
        !candidate.categoryIds.every(validCategoryId)) {
      // Bad trusted-source candidate invalidates the batch: no partial exposure.
      throw new Error("Invalid internal candidate");
    }
    if (candidate.workerAccountId === context.requesterAccountId ||
        seen.has(candidate.workerAccountId)) continue;
    seen.add(candidate.workerAccountId);
    if (!candidate.categoryIds.includes(context.categoryId)) continue;
    if (approve(candidate, context) !== true) continue;
    accepted.push(candidate.workerAccountId);
    if (accepted.length === limit) break;
  }
  return accepted;
}
