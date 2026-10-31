import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validCategoryId, validOpaqueId } from "../shared/identifiers.ts";
import type { ContactSafetyFacts } from "./contact-safety.ts";

/**
 * Trusted current D1 facts for a FUTURE customer-to-worker interaction.
 * Does not supply worker phone, call consent, privacy method, availability,
 * blocks, or call abuse policy: the result is never connection authorization.
 */
export type RequestTargetFacts = Readonly<Pick<ContactSafetyFacts,
  "requesterAccountId" | "workerAccountId" | "listingId" |
  "listingOwnerAccountId" | "categoryId" | "requesterActive" |
  "workerActive" | "workerOptedIn" | "categoryActive" |
  "listingPublished" | "moderationApproved"
>>;

/** Reuse the exact account/listing/Category source projection for both legacy
 * trusted-account reads and the stronger, single-statement session-bound read.
 * A stale browser preview or a separate session lookup is NOT call permission.
 */
const REQUEST_TARGET_SOURCE_QUERY =
  "SELECT requester.id AS requesterId,requester.status AS requesterStatus, " +
  "worker.id AS workerAccountId,worker.status AS workerStatus, " +
  "wl.id AS listingId,wl.worker_account_id AS listingOwnerAccountId, " +
  "wl.category_id AS categoryId,wl.status AS listingStatus, " +
  "wl.moderation_status AS moderationStatus, " +
  "wp.status AS workerProfileStatus,c.is_active AS categoryActive " +
  "FROM worker_listings AS wl " +
  "JOIN accounts AS worker ON worker.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=worker.id " +
  "JOIN categories AS c ON c.id=wl.category_id ";

/** Existing trusted-account read. This is only for internal *previews*;
 * caller resolves requester from a verified server session beforehand.
 */
export const READ_CURRENT_REQUEST_TARGET_QUERY =
  REQUEST_TARGET_SOURCE_QUERY +
  "JOIN accounts AS requester ON requester.id=? " +
  "WHERE wl.id=? LIMIT 1";

/** A call's session must not be checked separately from its target: a
 * logout/expiry/disable between those two reads could leave stale approval.
 * One statement binds ONLY the SHA-256 token hash, trusted current time and
 * opaque listing ID; current requester ownership is resolved inside D1.
 *
 * Still only a read; future disclosure/connect requires additional M-003/M-005
 * policy and race-safe enforcement at the actual contact boundary.
 */
export const READ_SESSION_BOUND_CALL_TARGET_QUERY =
  REQUEST_TARGET_SOURCE_QUERY +
  "JOIN auth_sessions AS session ON session.token_hash=? AND session.expires_at>? " +
  "JOIN accounts AS requester ON requester.id=session.account_id " +
  "WHERE wl.id=? AND requester.status='active' LIMIT 1";

type RequestTargetRow = {
  requesterId: unknown;
  requesterStatus: unknown;
  workerAccountId: unknown;
  workerStatus: unknown;
  listingId: unknown;
  listingOwnerAccountId: unknown;
  categoryId: unknown;
  listingStatus: unknown;
  moderationStatus: unknown;
  workerProfileStatus: unknown;
  categoryActive: unknown;
};

/** One shared, fail-closed hydration boundary. A malformed fake/D1 row never
 * becomes an eligible account, and no private fields enter the return value.
 */
function projectRequestTarget(
  rows: unknown,
  listingId: string,
  expectedRequesterId: string | null,
): RequestTargetFacts | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row: RequestTargetRow = rows[0];
  if (!row || typeof row !== "object" ||
      !validOpaqueId(row.requesterId) ||
      (expectedRequesterId !== null && row.requesterId !== expectedRequesterId) ||
      row.listingId !== listingId ||
      !validOpaqueId(row.workerAccountId) ||
      row.workerAccountId !== row.listingOwnerAccountId ||
      !validCategoryId(row.categoryId) ||
      !["active", "disabled"].includes(row.requesterStatus as string) ||
      !["active", "disabled"].includes(row.workerStatus as string) ||
      row.workerProfileStatus !== "draft" ||
      !["published", "unpublished"].includes(row.listingStatus as string) ||
      !["allowed", "hidden"].includes(row.moderationStatus as string) ||
      (row.categoryActive !== 0 && row.categoryActive !== 1)) {
    return null;
  }
  return Object.freeze({
    requesterAccountId: row.requesterId,
    workerAccountId: row.workerAccountId,
    listingId,
    listingOwnerAccountId: row.listingOwnerAccountId as string,
    categoryId: row.categoryId,
    requesterActive: row.requesterStatus === "active",
    workerActive: row.workerStatus === "active",
    workerOptedIn: row.workerProfileStatus === "draft",
    categoryActive: row.categoryActive === 1,
    listingPublished: row.listingStatus === "published",
    moderationApproved: row.moderationStatus === "allowed",
  });
}

/** Internal preview of server-owned status. A missing/corrupt row fails
 * closed; D1 outages reject instead of fabricating allowed facts.
 * This must not be reused as a call consent/disclosure decision.
 */
export async function readCurrentRequestTarget(
  db: D1Database,
  requesterId: string,
  listingId: string,
): Promise<RequestTargetFacts | null> {
  if (!validOpaqueId(requesterId) || !validOpaqueId(listingId)) return null;
  const { results } = await db.prepare(READ_CURRENT_REQUEST_TARGET_QUERY)
    .bind(requesterId, listingId).all<RequestTargetRow>();
  return projectRequestTarget(results, listingId, requesterId);
}

/** Strict one-statement call preflight: current unexpired, non-revoked,
 * ACTIVE caller session and CURRENT listing/owner/category state share the
 * same SQLite/D1 SELECT. No caller-supplied account ID or worker identity.
 *
 * Deny unknown/invalid tokens without even touching D1. Token values never
 * reach SQL, logs or the projection; only the SHA-256 digest is bound.
 * Not a call credential or authorization to display any phone number.
 */
export async function readSessionBoundCallTarget(
  db: D1Database,
  bearerToken: string,
  listingId: string,
): Promise<RequestTargetFacts | null> {
  if (!validSessionToken(bearerToken) || !validOpaqueId(listingId)) return null;
  const { results } = await db.prepare(READ_SESSION_BOUND_CALL_TARGET_QUERY)
    .bind(await sessionHash(bearerToken), Math.floor(Date.now() / 1000), listingId)
    .all<RequestTargetRow>();
  const result = projectRequestTarget(results, listingId, null);
  // The SQL requires active status. Fail closed even if a malformed fake
  // adapter bypasses that WHERE predicate.
  return result?.requesterActive ? result : null;
}
