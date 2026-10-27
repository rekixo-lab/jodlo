import type { D1Database, IdentityVerifier } from "../../data/d1.ts";

/** Bound active sessions prevent unbounded logins for one verified Google subject. */
export const SESSION_TTL_SECONDS = 60 * 60;
export const MAX_ACTIVE_SESSIONS = 6;
const CLEANUP_BATCH_SIZE = 100;
const VALID_SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const OWN_SESSION_QUERY =
  "SELECT a.id AS accountId FROM auth_sessions AS s " +
  "JOIN accounts AS a ON a.id = s.account_id " +
  "WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'active' LIMIT 1";

/** SQLite performs count + conditional insert as one atomic write statement.
 * No read-before-write race and no separate rate-limit tracking data is stored.
 */
export const INSERT_BOUNDED_SESSION_QUERY =
  "INSERT INTO auth_sessions(token_hash, account_id, expires_at) " +
  "SELECT ?, a.id, ? FROM accounts AS a " +
  "WHERE a.id = ? AND a.status = 'active' " +
  "AND (SELECT COUNT(*) FROM auth_sessions AS s " +
  "WHERE s.account_id = a.id AND s.expires_at > ?) < ?";

/** Index-backed bounded opportunistic cleanup: no cron or global table scan.
 * This is hygiene, NOT an approved personal-data retention/deletion policy.
 */
export const PRUNE_EXPIRED_QUERY =
  "DELETE FROM auth_sessions WHERE token_hash IN (" +
  "SELECT token_hash FROM auth_sessions WHERE expires_at <= ? LIMIT ?)";

function newOpaqueSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sessionHash(token: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
}

export async function findSessionAccount(db: D1Database, token: string): Promise<string | null> {
  if (!VALID_SESSION_TOKEN.test(token)) return null;
  const { results } = await db.prepare(OWN_SESSION_QUERY)
    .bind(await sessionHash(token), Math.floor(Date.now() / 1000))
    .all<{ accountId: string }>();
  return results[0]?.accountId ?? null;
}

export function makeSessionVerifier(db: D1Database): IdentityVerifier {
  return { async verify(token) {
    const accountId = await findSessionAccount(db, token);
    return accountId ? { accountId } : null;
  } };
}

export type IssuedSession = {
  accessToken: string; tokenType: "Bearer"; expiresInSeconds: number;
};

/** Returns null if active account/session-cap gate rejects the new session.
 * A 429 response is only a per-account *session issuance cap*, not an IP/WAF rate limit.
 */
export async function issueSession(db: D1Database, accountId: string): Promise<IssuedSession | null> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(PRUNE_EXPIRED_QUERY).bind(now, CLEANUP_BATCH_SIZE).run();
  const token = newOpaqueSecret();
  const result = await db.prepare(INSERT_BOUNDED_SESSION_QUERY)
    .bind(await sessionHash(token), now + SESSION_TTL_SECONDS, accountId, now, MAX_ACTIVE_SESSIONS)
    .run();
  if (result.meta.changes !== 1) return null;
  return { accessToken: token, tokenType: "Bearer", expiresInSeconds: SESSION_TTL_SECONDS };
}

/**
 * Single-statement conditional revoke: no read-then-delete TOCTOU window.
 * SQLite/D1 decides eligibility and row changes in the SAME write statement,
 * so an already-revoked/expired/disabled session can never report success.
 */
export const REVOKE_SESSION_QUERY =
  "DELETE FROM auth_sessions WHERE token_hash = ? AND expires_at > ? " +
  "AND account_id IN (SELECT id FROM accounts WHERE status = 'active')";

/**
 * Resolve the caller's account using its own LIVE bearer-hash in a subquery
 * inside the DELETE. No account ID supplied by headers/body or earlier reads.
 * Other accounts' sessions never match; the caller token is deleted too.
 */
export const REVOKE_ALL_SESSIONS_QUERY =
  "DELETE FROM auth_sessions WHERE account_id = (" +
  "SELECT s.account_id FROM auth_sessions AS s " +
  "JOIN accounts AS a ON a.id = s.account_id " +
  "WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'active' LIMIT 1)";

export async function revokeSession(db: D1Database, token: string): Promise<boolean> {
  if (!VALID_SESSION_TOKEN.test(token)) return false;
  const now = Math.floor(Date.now() / 1000);
  const { meta } = await db.prepare(REVOKE_SESSION_QUERY)
    .bind(await sessionHash(token), now).run();
  return meta.changes === 1;
}

/** Revoke all devices using a single owner-scoped database statement. */
export async function revokeAllSessions(db: D1Database, token: string): Promise<boolean> {
  if (!VALID_SESSION_TOKEN.test(token)) return false;
  const now = Math.floor(Date.now() / 1000);
  const { meta } = await db.prepare(REVOKE_ALL_SESSIONS_QUERY)
    .bind(await sessionHash(token), now).run();
  return meta.changes > 0;
}
