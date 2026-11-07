import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "./sessions.ts";

/**
 * Owner-only account overview. This is NOT a public Worker profile: never
 * project a Google subject, token hash, account ID, identity, precise area,
 * block relationship or unreviewed trust badge into a general dashboard.
 */
export type OwnAccountOverview = Readonly<{
  createdAt: string;
  workerEnabled: boolean;
  workerSince: string | null;
  totalServices: number;
  publishedServices: number;
  visibleServices: number;
  activeSessions: number;
  receivesCalls: boolean;
}>;

const OVERVIEW_QUERY =
  "SELECT a.id AS accountId, a.created_at AS createdAt, wp.created_at AS workerSince, " +
  "(SELECT COUNT(*) FROM worker_listings AS l WHERE l.worker_account_id=a.id) AS totalServices, " +
  "(SELECT COUNT(*) FROM worker_listings AS l WHERE l.worker_account_id=a.id AND l.status='published') AS publishedServices, " +
  "(SELECT COUNT(*) FROM worker_listings AS l JOIN categories AS c ON c.id=l.category_id " +
  "WHERE l.worker_account_id=a.id AND l.status='published' AND l.moderation_status='allowed' AND l.report_hold=0 " +
  "AND c.is_active=1) AS visibleServices, " +
  "(SELECT COUNT(*) FROM auth_sessions AS s WHERE s.account_id=a.id AND s.expires_at>unixepoch()) AS activeSessions, " +
  "COALESCE((SELECT p.calls_enabled FROM worker_agora_call_preferences AS p WHERE p.account_id=a.id),0) AS receivesCalls " +
  "FROM accounts AS a LEFT JOIN worker_profiles AS wp ON wp.account_id=a.id " +
  "JOIN auth_sessions AS viewer ON viewer.account_id=a.id " +
  "WHERE viewer.token_hash=? AND viewer.expires_at>? AND a.status='active' LIMIT 1";

type OverviewRow = {
  accountId: string; createdAt: string; workerSince: string | null;
  totalServices: number; publishedServices: number;
  visibleServices: number; activeSessions: number; receivesCalls: number;
};

export async function ownAccountOverview(
  db: D1Database, bearer: string,
): Promise<OwnAccountOverview | null> {
  if (!validSessionToken(bearer)) return null;
  const {results} = await db.prepare(OVERVIEW_QUERY)
    .bind(await sessionHash(bearer), Math.floor(Date.now() / 1000)).all<OverviewRow>();
  const row = results[0];
  return row ? projectOverview(row) : null;
}

function projectOverview(row: OverviewRow): OwnAccountOverview {
  return {
    createdAt: row.createdAt,
    workerEnabled: row.workerSince !== null,
    workerSince: row.workerSince,
    totalServices: Number(row.totalServices),
    publishedServices: Number(row.publishedServices),
    visibleServices: Number(row.visibleServices),
    activeSessions: Number(row.activeSessions),
    receivesCalls: row.receivesCalls === 1,
  };
}

const EXPORT_ROW_LIMIT = 1000;

/** Bound each collection before aggregating it. All subqueries reuse the
 * same session-resolved account and the same SQLite statement snapshot.
 */
function exportCollection(alias: string, fields: readonly string[], query: string): string {
  const properties = fields.map(field => `'${field}',${field}`).join(",");
  return `(SELECT json_group_array(json_object(${properties})) FROM (${query} LIMIT ${EXPORT_ROW_LIMIT + 1})) AS ${alias}`;
}

function exportQuery(version: number): string {
  const includeCity = version >= 2;
  return "SELECT overview.*, " + [
    exportCollection("identity", ["googleSub"],
      "SELECT google_sub AS googleSub FROM google_identities WHERE account_id=overview.accountId ORDER BY google_sub"),
    exportCollection("services", ["id", "categoryId", "status", "moderationStatus", "createdAt",
      ...(includeCity ? ["city"] : [])],
      "SELECT id,category_id AS categoryId,status,moderation_status AS moderationStatus,created_at AS createdAt" +
      (includeCity ? ",service_city AS city" : "") +
      " FROM worker_listings WHERE worker_account_id=overview.accountId ORDER BY created_at,id"),
    ...(version === 3 ? [exportCollection("serviceDetails",
      ["listingId", "categoryId", "displayName", "description", "experienceYears", "visitRateInr", "status", "revision"],
      "SELECT d.listing_id AS listingId,d.category_id AS categoryId,d.display_name AS displayName," +
      "d.description,d.experience_years AS experienceYears,d.visit_rate_inr AS visitRateInr," +
      "d.review_status AS status,d.revision FROM worker_service_details AS d " +
      "JOIN worker_listings AS wl ON wl.id=d.listing_id " +
      "WHERE wl.worker_account_id=overview.accountId AND d.review_status<>'cleared' ORDER BY d.listing_id"),
    exportCollection("servicePhotos", ["listingId", "status", "revision"],
      "SELECT p.listing_id AS listingId,p.review_status AS status,p.revision FROM worker_service_photos AS p " +
      "JOIN worker_listings AS wl ON wl.id=p.listing_id " +
      "WHERE wl.worker_account_id=overview.accountId AND p.review_status<>'cleared' ORDER BY p.listing_id"),
    exportCollection("serviceReports", ["listingId", "reason", "receivedAt"],
      "SELECT listing_id AS listingId,reason,created_at AS receivedAt FROM service_report_cases " +
      "WHERE reporter_account_id=overview.accountId ORDER BY created_at,id"),
    exportCollection("serviceAppeals", ["listingId", "reason", "status", "appealReason"],
      "SELECT r.listing_id AS listingId,r.reason,r.status,r.appeal_reason AS appealReason " +
      "FROM service_report_cases AS r JOIN worker_listings AS wl ON wl.id=r.listing_id " +
      "WHERE wl.worker_account_id=overview.accountId AND r.status IN ('upheld','appealed','restored','appeal_denied') " +
      "ORDER BY r.created_at,r.id")] : []),
    exportCollection("callPreferences", ["callsEnabled", "revision"],
      "SELECT calls_enabled AS callsEnabled,revision FROM worker_agora_call_preferences WHERE account_id=overview.accountId"),
    exportCollection("availabilityPreferences", ["acceptingCalls", "revision"],
      "SELECT accepting_calls AS acceptingCalls,revision FROM worker_agora_availability_preferences WHERE account_id=overview.accountId"),
    exportCollection("blocksMade", ["blockedAccountId"],
      "SELECT blocked_account_id AS blockedAccountId FROM agora_account_blocks " +
      "WHERE blocker_account_id=overview.accountId ORDER BY blocked_account_id"),
    exportCollection("abuseCounters", ["scope", "windowStartMs", "expiresAtMs", "attemptCount", "revision"],
      "SELECT scope,window_start_ms AS windowStartMs,expires_at_ms AS expiresAtMs," +
      "attempt_count AS attemptCount,revision FROM agora_abuse_window_counters " +
      "WHERE actor_account_id=overview.accountId ORDER BY scope"),
    exportCollection("sessions", ["createdAt", "expiresAt"],
      "SELECT created_at AS createdAt,expires_at AS expiresAt FROM auth_sessions " +
      "WHERE account_id=overview.accountId ORDER BY created_at,expires_at"),
  ].join(", ") + " FROM (" + OVERVIEW_QUERY + ") AS overview";
}

type ExportSnapshot = OverviewRow & Record<
  "identity" | "services" | "callPreferences" | "availabilityPreferences" |
  "blocksMade" | "abuseCounters" | "sessions" | "serviceDetails" | "servicePhotos" | "serviceReports" | "serviceAppeals", string
>;

function decodeExportCollection(encoded: string): unknown[] {
  const rows: unknown = JSON.parse(encoded);
  if (!Array.isArray(rows) || rows.length > EXPORT_ROW_LIMIT) {
    throw new Error("Account export exceeds review limit");
  }
  return rows;
}

/** Consistent export of JODLO-owned D1 data, scoped to an active account. */
export async function exportOwnAccountData(
  db: D1Database, bearer: string, version = 1,
): Promise<Record<string, unknown> | null> {
  if (!validSessionToken(bearer)) return null;
  const {results} = await db.prepare(exportQuery(version))
    .bind(await sessionHash(bearer), Math.floor(Date.now() / 1000)).all<ExportSnapshot>();
  const row = results[0];
  if (!row) return null;
  const payload = {
    schemaVersion: version,
    account: { accountId: row.accountId, ...projectOverview(row) },
    identity: decodeExportCollection(row.identity),
    services: decodeExportCollection(row.services),
    ...(version === 3 ? {
      serviceDetails: decodeExportCollection(row.serviceDetails),
      servicePhotos: decodeExportCollection(row.servicePhotos),
      serviceReports: decodeExportCollection(row.serviceReports),
      serviceAppeals: decodeExportCollection(row.serviceAppeals),
    } : {}),
    callPreferences: decodeExportCollection(row.callPreferences),
    availabilityPreferences: decodeExportCollection(row.availabilityPreferences),
    blocksMade: decodeExportCollection(row.blocksMade),
    abuseCounters: decodeExportCollection(row.abuseCounters),
    sessions: decodeExportCollection(row.sessions),
    limitations: [
      "JODLO-owned D1 rows only",
      "No Google, Cloudflare backup, third-party provider, notification or device data included",
      "No server-side token hashes or bearer credentials exported",
      "Accounts that blocked this user are never disclosed",
      ...(version === 3 ? ["Download each uploaded JPEG from its owner service photo screen"] : []),
    ],
  };
  // Never send a partial/truncated data export. The native one-shot UTF-8
  // decoder accepts at most 65,536 response bytes. Reserve space for the API
  // envelope and require an explicit failure if the account has grown beyond
  // this first bounded export version. Future pagination needs its own review.
  const byteLength = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (byteLength > 60_000) throw new Error("Account export exceeds byte budget");
  return payload;
}
