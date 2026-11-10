import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validFcmRegistrationToken } from "./fcm-provider.ts";

/**
 * A refreshed sign-in for the SAME Worker may receive the same Firebase
 * installation token while the old session remains valid. Move only that
 * Worker's old token binding to the new current session, atomically. Never
 * steal a registration token belonging to a DIFFERENT account.
 *
 * A single D1 batch prevents another caller seeing a gap between release and
 * rebind. Read back the exact bound session/token and current worker consent
 * before telling the Android client that registration succeeded. No account
 * identifier or device token is returned over HTTP.
 */
export async function registerOwnCallDevice(
  db: D1Database, bearer: string, registrationToken: string, now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!validSessionToken(bearer) || !validFcmRegistrationToken(registrationToken)) return false;
  const hash = await sessionHash(bearer);
  await db.batch([
    db.prepare(`
      DELETE FROM private_call_devices WHERE registration_token=? AND session_hash IN (
        SELECT former.token_hash FROM auth_sessions AS former
        JOIN auth_sessions AS current ON current.account_id=former.account_id
          AND current.token_hash=? AND current.expires_at>?
        JOIN accounts AS owner ON owner.id=current.account_id AND owner.status='active'
        JOIN worker_agora_call_preferences AS consent
          ON consent.account_id=owner.id AND consent.calls_enabled=1
        WHERE former.token_hash<>current.token_hash
      )
    `).bind(registrationToken, hash, now),
    db.prepare(`
      INSERT INTO private_call_devices(session_hash, registration_token, registered_at)
      SELECT s.token_hash, ?, ? FROM auth_sessions AS s
      JOIN accounts AS a ON a.id=s.account_id AND a.status='active'
      JOIN worker_agora_call_preferences AS p ON p.account_id=a.id AND p.calls_enabled=1
      WHERE s.token_hash=? AND s.expires_at>?
        AND NOT EXISTS (
          SELECT 1 FROM private_call_devices WHERE registration_token=? AND session_hash<>s.token_hash
        )
      ON CONFLICT(session_hash) DO UPDATE SET
        registration_token=excluded.registration_token, registered_at=excluded.registered_at
    `).bind(registrationToken, now, hash, now, registrationToken),
  ]);
  const {results} = await db.prepare(`
    SELECT 1 AS registered FROM private_call_devices AS d
    JOIN auth_sessions AS s ON s.token_hash=d.session_hash AND s.expires_at>?
    JOIN accounts AS a ON a.id=s.account_id AND a.status='active'
    JOIN worker_agora_call_preferences AS p ON p.account_id=a.id AND p.calls_enabled=1
    WHERE d.session_hash=? AND d.registration_token=?
  `).bind(now, hash, registrationToken).all<{registered:number}>();
  return results.length === 1 && results[0]?.registered === 1;
}

export async function removeOwnCallDevice(db: D1Database, bearer: string): Promise<void> {
  if (!validSessionToken(bearer)) return;
  await db.prepare("DELETE FROM private_call_devices WHERE session_hash=?")
    .bind(await sessionHash(bearer)).run();
}

export async function purgeExpiredCallDevices(db: D1Database, now: number): Promise<void> {
  await db.prepare(`
    DELETE FROM private_call_devices WHERE session_hash IN (
      SELECT s.token_hash FROM auth_sessions AS s
      JOIN private_call_devices AS d ON d.session_hash=s.token_hash
      WHERE s.expires_at<=? ORDER BY s.expires_at LIMIT 1000
    )
  `).bind(now).run();
}

export async function readRegisteredCallDestination(db: D1Database, accountId: string) {
  const { results } = await db.prepare(`
    SELECT s.account_id AS accountId,d.registration_token AS registrationToken
    FROM private_call_devices AS d
    JOIN auth_sessions AS s ON s.token_hash=d.session_hash
    JOIN accounts AS a ON a.id=s.account_id AND a.status='active'
    JOIN worker_agora_call_preferences AS p ON p.account_id=a.id AND p.calls_enabled=1
    WHERE s.account_id=? AND s.expires_at>?
    ORDER BY d.registered_at DESC,d.session_hash LIMIT 1
  `).bind(accountId, Math.floor(Date.now() / 1000))
    .all<{accountId:string;registrationToken:string}>();
  return results[0] ?? null;
}
