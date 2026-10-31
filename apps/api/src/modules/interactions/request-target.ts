import type { D1Database } from "../../data/d1.ts";
import { validCategoryId, validOpaqueId } from "../shared/identifiers.ts";
import type { ContactSafetyFacts } from "./contact-safety.ts";

/**
 * Trusted current D1 facts for a FUTURE customer-to-worker interaction.
 *
 * Deliberately excludes the four M-005/M-003 policy facts that have no
 * approved data model yet: availability, either-way blocks and contact
 * channel consent. A database read is NEVER authorization to contact.
 * Future approval must re-read all facts inside the SAME atomic request write.
 */
export type RequestTargetFacts = Readonly<Pick<ContactSafetyFacts,
  "requesterAccountId" | "workerAccountId" | "listingId" |
  "listingOwnerAccountId" | "categoryId" | "requesterActive" |
  "workerActive" | "workerOptedIn" | "categoryActive" |
  "listingPublished" | "moderationApproved"
>>;

/** Exactly one bound current-state read. No client-declared worker identity,
 * untrusted preview flags, location, phone, ratings or unapproved request table.
 *
 * Statuses are not filtered in the WHERE clause: disabled/unpublished/hidden
 * records project to false facts, rather than being accidentally "eligible".
 */
export const READ_CURRENT_REQUEST_TARGET_QUERY =
  "SELECT requester.id AS requesterId,requester.status AS requesterStatus, " +
  "worker.id AS workerAccountId,worker.status AS workerStatus, " +
  "wl.id AS listingId,wl.worker_account_id AS listingOwnerAccountId, " +
  "wl.category_id AS categoryId,wl.status AS listingStatus, " +
  "wl.moderation_status AS moderationStatus, " +
  "wp.status AS workerProfileStatus,c.is_active AS categoryActive " +
  "FROM worker_listings AS wl " +
  "JOIN accounts AS worker ON worker.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=worker.id " +
  "JOIN categories AS c ON c.id=wl.category_id " +
  "JOIN accounts AS requester ON requester.id=? " +
  "WHERE wl.id=? LIMIT 1";

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

/** Internal, read-only projection. A missing/corrupt row fails closed; an
 * unavailable database throws (never returns fabricated "allowed" facts).
 * Caller must resolve requesterId from a VERIFIED server bearer session.
 * No public route or durable request is created by this function.
 */
export async function readCurrentRequestTarget(
  db: D1Database,
  requesterId: string,
  listingId: string,
): Promise<RequestTargetFacts | null> {
  if (!validOpaqueId(requesterId) || !validOpaqueId(listingId)) return null;
  const { results } = await db.prepare(READ_CURRENT_REQUEST_TARGET_QUERY)
    .bind(requesterId, listingId).all<RequestTargetRow>();
  if (!Array.isArray(results) || results.length !== 1) return null;
  const row = results[0];
  if (!row || row.requesterId !== requesterId || row.listingId !== listingId ||
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
    requesterAccountId: requesterId,
    workerAccountId: row.workerAccountId,
    listingId,
    listingOwnerAccountId: row.listingOwnerAccountId,
    categoryId: row.categoryId,
    requesterActive: row.requesterStatus === "active",
    workerActive: row.workerStatus === "active",
    workerOptedIn: row.workerProfileStatus === "draft",
    categoryActive: row.categoryActive === 1,
    listingPublished: row.listingStatus === "published",
    moderationApproved: row.moderationStatus === "allowed",
  });
}
