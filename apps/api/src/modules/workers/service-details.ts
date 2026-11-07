import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";

export type ServiceDetails = {
  displayName: string;
  description: string;
  experienceYears: number | null;
  visitRateInr: number | null;
};
type ReviewStatus = "pending" | "approved" | "rejected";
type StoredDetails = ServiceDetails & {status: ReviewStatus; revision: number};
type OwnerDetails = {details: StoredDetails | null; revision: number};

const MAX_REVISION = 2147483647;
const CURRENT_WORKER =
  "SELECT s.account_id FROM auth_sessions AS s " +
  "JOIN accounts AS a ON a.id=s.account_id AND a.status='active' " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id AND wp.status='draft' " +
  "WHERE s.token_hash=? AND s.expires_at>unixepoch()";
const FIELDS =
  "display_name AS displayName,description,experience_years AS experienceYears," +
  "visit_rate_inr AS visitRateInr,review_status AS status,revision";

function publicText(input: unknown, min: number, max: number): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().normalize("NFC");
  const length = Array.from(value).length;
  if (length < min || length > max || /[\p{C}<>@]/u.test(value) ||
      /(?:[\p{Nd}][\s().+-]*){7}|https?:|www\./iu.test(value)) return null;
  return value;
}

export function parseServiceDetails(input: Partial<Record<keyof ServiceDetails, unknown>>): ServiceDetails | null {
  const displayName = publicText(input.displayName, 2, 60);
  const description = publicText(input.description, 10, 400);
  const {experienceYears, visitRateInr} = input;
  if (!displayName || !description ||
      !(experienceYears === null || typeof experienceYears === "number" &&
        Number.isSafeInteger(experienceYears) && experienceYears >= 0 && experienceYears <= 80) ||
      !(visitRateInr === null || typeof visitRateInr === "number" &&
        Number.isSafeInteger(visitRateInr) && visitRateInr >= 1 && visitRateInr <= 10000000)) return null;
  return {displayName, description, experienceYears, visitRateInr};
}

export async function readOwnServiceDetails(
  db: D1Database, bearer: string, id: string,
): Promise<OwnerDetails | null> {
  if (!validSessionToken(bearer) || !validOpaqueId(id)) return null;
  const {results} = await db.prepare(
    "SELECT d.display_name AS displayName,d.description,d.experience_years AS experienceYears," +
    "d.visit_rate_inr AS visitRateInr," +
    "CASE WHEN d.review_status='cleared' THEN 'cleared' " +
    "WHEN d.category_id<>wl.category_id THEN 'rejected' ELSE d.review_status END AS status,d.revision " +
    "FROM worker_listings AS wl LEFT JOIN worker_service_details AS d ON d.listing_id=wl.id " +
    "WHERE wl.id=? AND wl.worker_account_id=(" + CURRENT_WORKER + ")",
  ).bind(id, await sessionHash(bearer)).all<StoredDetails | {status: "cleared"; revision: number} | {status: null; revision: null}>();
  const row = results[0];
  if (!row) return null;
  if (row.status === null || row.status === "cleared") {
    return {details: null, revision: row.revision ?? 0};
  }
  return {details: row, revision: row.revision};
}

/** A new revision is private until reviewed. Even formerly approved content
 * immediately leaves the public projection when the owner submits an edit.
 */
export async function submitOwnServiceDetails(
  db: D1Database, bearer: string, id: string, input: ServiceDetails, revision: number,
): Promise<StoredDetails | null> {
  const details = parseServiceDetails(input);
  if (!details || !validSessionToken(bearer) || !validOpaqueId(id) ||
      !Number.isSafeInteger(revision) || revision < 0 || revision >= MAX_REVISION) return null;
  const {results} = await db.prepare(
    "INSERT INTO worker_service_details(listing_id,category_id,display_name,description," +
    "experience_years,visit_rate_inr,review_status,revision) " +
    "SELECT wl.id,wl.category_id,?,?,?,?,'pending',1 FROM worker_listings AS wl " +
    "WHERE wl.id=? AND wl.worker_account_id=(" + CURRENT_WORKER + ") " +
    "AND (?=0 OR EXISTS(SELECT 1 FROM worker_service_details WHERE listing_id=wl.id AND revision=?)) " +
    "ON CONFLICT(listing_id) DO UPDATE SET category_id=excluded.category_id," +
    "display_name=excluded.display_name,description=excluded.description," +
    "experience_years=excluded.experience_years,visit_rate_inr=excluded.visit_rate_inr," +
    "review_status='pending',revision=worker_service_details.revision+1 " +
    "WHERE worker_service_details.revision=? RETURNING " + FIELDS,
  ).bind(details.displayName, details.description, details.experienceYears, details.visitRateInr,
    id, await sessionHash(bearer), revision, revision, revision).all<StoredDetails>();
  return results[0] ?? null;
}

export async function clearOwnServiceDetails(
  db: D1Database, bearer: string, id: string, revision: number,
): Promise<boolean> {
  if (!validSessionToken(bearer) || !validOpaqueId(id) ||
      !Number.isSafeInteger(revision) || revision < 1 || revision >= MAX_REVISION) return false;
  // Keep the revision fence across clear/recreate so an old moderator
  // decision or edit cannot accidentally act on a newly submitted profile.
  const {meta} = await db.prepare(
    "UPDATE worker_service_details SET display_name=NULL,description=NULL," +
    "experience_years=NULL,visit_rate_inr=NULL,review_status='cleared',revision=revision+1 " +
    "WHERE listing_id=? AND revision=? AND EXISTS (SELECT 1 FROM worker_listings AS wl " +
    "WHERE wl.id=worker_service_details.listing_id AND wl.worker_account_id=(" + CURRENT_WORKER + "))",
  ).bind(id, revision, await sessionHash(bearer)).run();
  return meta.changes === 1;
}

export async function pendingServiceDetails(db: D1Database, after: string | null) {
  const {results} = await db.prepare(
    "SELECT d.listing_id AS listingId,d.category_id AS categoryId,d.display_name AS displayName," +
    "d.description,d.experience_years AS experienceYears,d.visit_rate_inr AS visitRateInr," +
    "d.review_status AS status,d.revision FROM worker_service_details AS d " +
    "JOIN worker_listings AS wl ON wl.id=d.listing_id " +
    "WHERE d.review_status='pending' AND d.category_id=wl.category_id AND d.listing_id>? " +
    "ORDER BY d.listing_id LIMIT 26",
  ).bind(after ?? "").all<StoredDetails & {listingId: string; categoryId: string}>();
  const items = results.slice(0,25);
  return {items, nextCursor: results.length > 25 ? items.at(-1)?.listingId ?? null : null};
}

export async function reviewServiceDetails(
  db: D1Database, id: string, revision: number, decision: "approved" | "rejected",
): Promise<boolean> {
  if (!validOpaqueId(id) || !Number.isSafeInteger(revision) || revision < 1 || revision >= MAX_REVISION ||
      (decision !== "approved" && decision !== "rejected")) return false;
  const {meta} = await db.prepare(
    "UPDATE worker_service_details SET review_status=?,revision=revision+1 " +
    "WHERE listing_id=? AND revision=? AND review_status='pending' AND EXISTS (" +
    "SELECT 1 FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
    "WHERE wl.id=worker_service_details.listing_id AND wl.category_id=worker_service_details.category_id " +
    "AND a.status='active')",
  ).bind(decision, id, revision).run();
  return meta.changes === 1;
}
