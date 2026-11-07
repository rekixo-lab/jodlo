import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { PUBLIC_LISTING_ELIGIBILITY } from "../workers/listings.ts";

export type ReportReason = "misleading" | "unsafe" | "privacy" | "spam";
export type AppealReason = "corrected" | "mistaken";
export type CaseDecision = "dismissed" | "upheld" | "restored" | "appeal_denied";

const CURRENT_ACCOUNT =
  "SELECT a.id FROM auth_sessions AS s JOIN accounts AS a ON a.id=s.account_id " +
  "WHERE s.token_hash=? AND s.expires_at>unixepoch() AND a.status='active'";
const CURRENT_DETAILS =
  " LEFT JOIN worker_service_details AS d ON d.listing_id=wl.id " +
  "LEFT JOIN worker_service_photos AS p ON p.listing_id=wl.id ";
const CASE_FIELDS = "r.id,r.listing_id AS listingId,r.reason,r.status,r.revision";
const SNAPSHOT_MATCH =
  "r.listing_revision=wl.revision AND r.profile_revision=COALESCE(d.revision,0) " +
  "AND r.photo_revision=COALESCE(p.revision,0)";

export function validReportReason(value: unknown): value is ReportReason {
  return value === "misleading" || value === "unsafe" || value === "privacy" || value === "spam";
}
export function validAppealReason(value: unknown): value is AppealReason {
  return value === "corrected" || value === "mistaken";
}
export function validCaseDecision(value: unknown): value is CaseDecision {
  return value === "dismissed" || value === "upheld" || value === "restored" || value === "appeal_denied";
}
function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value < 2147483647;
}

export async function reportService(db: D1Database, bearer: string, listingId: string, reason: ReportReason) {
  if (!validSessionToken(bearer) || !validOpaqueId(listingId) || !validReportReason(reason)) return null;
  const {results} = await db.prepare(
    "INSERT INTO service_report_cases(id,listing_id,reporter_account_id,listing_revision," +
    "profile_revision,photo_revision,reason,status) " +
    "SELECT ?,wl.id,reporter.id,wl.revision,COALESCE(d.revision,0),COALESCE(p.revision,0),?,'pending' " +
    "FROM (" + CURRENT_ACCOUNT + ") AS reporter " +
    "JOIN worker_listings AS wl ON wl.id=? " +
    "JOIN accounts AS a ON a.id=wl.worker_account_id " +
    "JOIN worker_profiles AS wp ON wp.account_id=a.id " +
    "JOIN categories AS c ON c.id=wl.category_id " + CURRENT_DETAILS +
    "WHERE reporter.id<>wl.worker_account_id AND " + PUBLIC_LISTING_ELIGIBILITY +
    " AND (SELECT COUNT(*) FROM service_report_cases AS prior " +
    "WHERE prior.reporter_account_id=reporter.id AND prior.status='pending')<10 " +
    "ON CONFLICT DO NOTHING RETURNING id",
  ).bind(crypto.randomUUID(), reason, await sessionHash(bearer), listingId).all<{id: string}>();
  return results[0] ? {received: true} : null;
}

/** Reporter can see receipt only. No outcome, reporter identity or worker
 * moderation details are exposed through the reporter-facing route.
 */
export async function ownReportStatus(db: D1Database, bearer: string, listingId: string) {
  if (!validSessionToken(bearer) || !validOpaqueId(listingId)) return null;
  const {results} = await db.prepare(
    "SELECT EXISTS(SELECT 1 FROM service_report_cases AS r " +
    "WHERE r.listing_id=? AND r.reporter_account_id=viewer.id AND r.status='pending') AS pending " +
    "FROM (" + CURRENT_ACCOUNT + ") AS viewer",
  ).bind(listingId, await sessionHash(bearer)).all<{pending: number}>();
  return results[0] ? {received: results[0].pending === 1} : null;
}

export async function ownServiceAppealCase(db: D1Database, bearer: string, listingId: string) {
  if (!validSessionToken(bearer) || !validOpaqueId(listingId)) return null;
  const {results} = await db.prepare(
    "SELECT r.id,r.reason,r.status,r.revision FROM worker_listings AS wl " +
    "LEFT JOIN service_report_cases AS r ON r.id=(" +
    "SELECT x.id FROM service_report_cases AS x WHERE x.listing_id=wl.id " +
    "AND x.status IN ('upheld','appealed','restored','appeal_denied') " +
    "ORDER BY CASE WHEN x.status='restored' THEN 1 ELSE 0 END,x.created_at DESC,x.id DESC LIMIT 1) " +
    "WHERE wl.id=? AND wl.worker_account_id=(" + CURRENT_ACCOUNT + ")",
  ).bind(listingId, await sessionHash(bearer)).all<
    {id: string; reason: ReportReason; status: string; revision: number} | {id: null}
  >();
  return results[0] ? {case: results[0].id === null ? null : results[0]} : null;
}

export async function appealServiceCase(
  db: D1Database, bearer: string, id: string, revision: number, reason: AppealReason,
) {
  if (!validSessionToken(bearer) || !validOpaqueId(id) || !validRevision(revision) ||
      !validAppealReason(reason)) return null;
  const {results} = await db.prepare(
    "UPDATE service_report_cases SET status='appealed',appeal_reason=?,revision=revision+1 " +
    "WHERE id=? AND revision=? AND status='upheld' AND EXISTS (" +
    "SELECT 1 FROM worker_listings AS wl WHERE wl.id=service_report_cases.listing_id " +
    "AND wl.worker_account_id=(" + CURRENT_ACCOUNT + ")) RETURNING id,reason,status,revision",
  ).bind(reason, id, revision, await sessionHash(bearer)).all<{
    id: string; reason: ReportReason; status: "appealed"; revision: number;
  }>();
  return results[0] ? {case: results[0]} : null;
}

export async function serviceCaseQueue(db: D1Database, status: "pending" | "appealed", after: string | null) {
  const {results} = await db.prepare(
    "SELECT " + CASE_FIELDS + ",wl.category_id AS categoryId,r.appeal_reason AS appealReason," +
    "CASE WHEN " + SNAPSHOT_MATCH + " THEN 1 ELSE 0 END AS matchesReportedVersion " +
    "FROM service_report_cases AS r JOIN worker_listings AS wl ON wl.id=r.listing_id " +
    CURRENT_DETAILS + "WHERE r.status=? AND r.id>? ORDER BY r.id LIMIT 26",
  ).bind(status, after ?? "").all<{id: string}>();
  const items = results.slice(0, 25);
  return {items, nextCursor: results.length > 25 ? items.at(-1)?.id ?? null : null};
}

export async function serviceCaseEvidence(db: D1Database, id: string, photo: boolean) {
  const columns = photo ? "p.jpeg_base64 AS jpeg" :
    CASE_FIELDS + ",wl.category_id AS categoryId,r.appeal_reason AS appealReason," +
    "CASE WHEN " + SNAPSHOT_MATCH + " THEN 1 ELSE 0 END AS matchesReportedVersion," +
    "wl.revision AS listingRevision,COALESCE(d.revision,0) AS profileRevision," +
    "COALESCE(p.revision,0) AS photoRevision,d.display_name AS displayName,d.description," +
    "d.experience_years AS experienceYears,d.visit_rate_inr AS visitRateInr," +
    "d.review_status AS profileStatus,p.review_status AS photoStatus";
  const {results} = await db.prepare(
    "SELECT " + columns + " FROM service_report_cases AS r " +
    "JOIN worker_listings AS wl ON wl.id=r.listing_id " + CURRENT_DETAILS +
    "WHERE r.id=? AND r.status IN ('pending','appealed')" + (photo ? " AND p.jpeg_base64 IS NOT NULL" : ""),
  ).bind(id).all<Record<string, unknown>>();
  return results[0] ?? null;
}

export async function decideServiceCase(
  db: D1Database, id: string, revision: number, decision: CaseDecision,
  evidence: {listing: number; profile: number; photo: number} | null,
) {
  if (!validOpaqueId(id) || !validRevision(revision) || !validCaseDecision(decision)) return false;
  const phase = decision === "upheld" || decision === "dismissed" ? "pending" : "appealed";
  const needsEvidence = decision === "upheld" || decision === "restored";
  if (needsEvidence && (!evidence || [evidence.listing, evidence.profile, evidence.photo].some(
    value => !Number.isSafeInteger(value) || value < 0 || value > 2147483647,
  ))) return false;
  const checkEvidence = needsEvidence ? " AND EXISTS (" +
    "SELECT 1 FROM worker_listings AS wl " + CURRENT_DETAILS +
    "WHERE wl.id=r.listing_id AND wl.revision=? AND COALESCE(d.revision,0)=? AND COALESCE(p.revision,0)=?" +
    (decision === "upheld" ? " AND " + SNAPSHOT_MATCH +
      " AND wl.report_hold=0 AND wl.status='published' AND wl.moderation_status='allowed'" : "") + ")" : "";
  const {results} = await db.prepare(
    "UPDATE service_report_cases AS r SET status=?,revision=revision+1 " +
    "WHERE r.id=? AND r.revision=? AND r.status=?" + checkEvidence + " RETURNING id",
  ).bind(decision, id, revision, phase,
    ...(needsEvidence && evidence ? [evidence.listing, evidence.profile, evidence.photo] : []))
    .all<{id: string}>();
  return results.length === 1;
}
