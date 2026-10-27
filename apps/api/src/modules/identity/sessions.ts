import type { D1Database, IdentityVerifier } from "../../data/d1.ts";

const HOUR_SECONDS = 60 * 60;
export const SESSION_TTL_SECONDS = HOUR_SECONDS;

export const OWN_SESSION_QUERY =
  "SELECT a.id AS accountId FROM auth_sessions AS s " +
  "JOIN accounts AS a ON a.id = s.account_id " +
  "WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'active' LIMIT 1";

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
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
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

export async function issueSession(db: D1Database, accountId: string): Promise<{
  accessToken: string; tokenType: "Bearer"; expiresInSeconds: number;
}> {
  const token = newOpaqueSecret();
  const expiration = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await db.prepare("INSERT INTO auth_sessions(token_hash, account_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sessionHash(token), accountId, expiration).run();
  return { accessToken: token, tokenType: "Bearer", expiresInSeconds: SESSION_TTL_SECONDS };
}

export async function revokeSession(db: D1Database, token: string): Promise<boolean> {
  if (!await findSessionAccount(db, token)) return false;
  await db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
    .bind(await sessionHash(token)).run();
  return true;
}
