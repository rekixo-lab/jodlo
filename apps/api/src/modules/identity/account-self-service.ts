import type { D1Database } from "../../data/d1.ts";

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
  "SELECT a.created_at AS createdAt, wp.created_at AS workerSince, " +
  "(SELECT COUNT(*) FROM worker_listings AS l WHERE l.worker_account_id=a.id) AS totalServices, " +
  "(SELECT COUNT(*) FROM worker_listings AS l WHERE l.worker_account_id=a.id AND l.status='published') AS publishedServices, " +
  "(SELECT COUNT(*) FROM worker_listings AS l JOIN categories AS c ON c.id=l.category_id " +
  "WHERE l.worker_account_id=a.id AND l.status='published' AND l.moderation_status='allowed' " +
  "AND c.is_active=1) AS visibleServices, " +
  "(SELECT COUNT(*) FROM auth_sessions AS s WHERE s.account_id=a.id AND s.expires_at>unixepoch()) AS activeSessions, " +
  "COALESCE((SELECT p.calls_enabled FROM worker_agora_call_preferences AS p WHERE p.account_id=a.id),0) AS receivesCalls " +
  "FROM accounts AS a LEFT JOIN worker_profiles AS wp ON wp.account_id=a.id " +
  "WHERE a.id=? AND a.status='active' LIMIT 1";

type OverviewRow = {
  createdAt: string; workerSince: string | null;
  totalServices: number; publishedServices: number;
  visibleServices: number; activeSessions: number; receivesCalls: number;
};

export async function ownAccountOverview(
  db: D1Database, accountId: string,
): Promise<OwnAccountOverview | null> {
  const { results } = await db.prepare(OVERVIEW_QUERY).bind(accountId).all<OverviewRow>();
  const row = results[0];
  if (!row) return null;
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

type ExportRow = Record<string, string | number | null>;

/** Per-account D1 export of the data JODLO actually persists today.
 * This is NOT a blanket claim of provider/backup erasure or GDPR compliance.
 * Limits fail closed rather than silently returning an incomplete export.
 */
async function completeRows<T extends ExportRow>(
  db: D1Database, sql: string, accountId: string,
): Promise<T[]> {
  const { results } = await db.prepare(sql + " LIMIT 1001").bind(accountId).all<T>();
  if (results.length > 1000) throw new Error("Account export exceeds review limit");
  return results;
}

export async function exportOwnAccountData(
  db: D1Database, accountId: string,
): Promise<Record<string, unknown> | null> {
  // Guard every route with actual current account status, not a stale UI session.
  const overview = await ownAccountOverview(db, accountId);
  if (!overview) return null;
  const identity = await completeRows<{ googleSub: string }>(
    db, "SELECT google_sub AS googleSub FROM google_identities WHERE account_id=? ORDER BY google_sub",
    accountId,
  );
  const services = await completeRows<{
    id: string; categoryId: string; status: string;
    moderationStatus: string; createdAt: string;
  }>(
    db, "SELECT id,category_id AS categoryId,status,moderation_status AS moderationStatus," +
      "created_at AS createdAt FROM worker_listings WHERE worker_account_id=? ORDER BY created_at,id",
    accountId,
  );
  const callPreferences = await completeRows<{
    callsEnabled: number; revision: number;
  }>(
    db, "SELECT calls_enabled AS callsEnabled,revision FROM worker_agora_call_preferences WHERE account_id=?",
    accountId,
  );
  const availabilityPreferences = await completeRows<{
    acceptingCalls: number; revision: number;
  }>(
    db, "SELECT accepting_calls AS acceptingCalls,revision FROM worker_agora_availability_preferences WHERE account_id=?",
    accountId,
  );
  const blocksMade = await completeRows<{ blockedAccountId: string }>(
    db, "SELECT blocked_account_id AS blockedAccountId FROM agora_account_blocks " +
      "WHERE blocker_account_id=? ORDER BY blocked_account_id",
    accountId,
  );
  const abuseCounters = await completeRows<{
    scope: string; windowStartMs: number; expiresAtMs: number;
    attemptCount: number; revision: number;
  }>(
    db, "SELECT scope,window_start_ms AS windowStartMs,expires_at_ms AS expiresAtMs," +
      "attempt_count AS attemptCount,revision FROM agora_abuse_window_counters " +
      "WHERE actor_account_id=? ORDER BY scope",
    accountId,
  );
  const sessions = await completeRows<{ createdAt: number; expiresAt: number }>(
    db, "SELECT created_at AS createdAt,expires_at AS expiresAt FROM auth_sessions " +
      "WHERE account_id=? ORDER BY created_at,expires_at",
    accountId,
  );
  const payload = {
    schemaVersion: 1,
    account: { accountId, ...overview },
    identity,
    services,
    callPreferences,
    availabilityPreferences,
    blocksMade,
    abuseCounters,
    sessions,
    limitations: [
      "JODLO-owned D1 rows only",
      "No Google, Cloudflare backup, third-party provider, notification or device data included",
      "No server-side token hashes or bearer credentials exported",
      "Accounts that blocked this user are never disclosed",
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
