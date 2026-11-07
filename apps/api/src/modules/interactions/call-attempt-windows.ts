import type { D1Database } from "../../data/d1.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { CALL_ATTEMPT_LIMITS, CALL_ATTEMPT_WINDOW_MS } from "./call-admission-policy.ts";

const RESERVE_ATTEMPT = `
WITH requested(counter_key, account_id, peer_account_id, max_count) AS (
  VALUES (?1, ?2, ?3, ?4), (?5, ?2, NULL, ?6), (?7, ?3, NULL, ?8)
), windows AS MATERIALIZED (
  SELECT requested.*,
    CASE WHEN old.expires_at_ms>?9 THEN old.window_start_ms ELSE ?9 END AS window_start_ms,
    CASE WHEN old.expires_at_ms>?9 THEN old.expires_at_ms ELSE ?10 END AS expires_at_ms,
    CASE WHEN old.expires_at_ms>?9 THEN old.attempt_count+1 ELSE 1 END AS attempt_count,
    old.window_start_ms AS old_start_ms
  FROM requested LEFT JOIN call_attempt_windows AS old USING(counter_key)
)
INSERT INTO call_attempt_windows(counter_key, account_id, peer_account_id, window_start_ms, expires_at_ms, attempt_count)
SELECT counter_key, account_id, peer_account_id, window_start_ms, expires_at_ms, attempt_count
FROM windows
WHERE (SELECT count(*) FROM accounts WHERE id IN (?2, ?3) AND status='active')=2
  AND NOT EXISTS (
    SELECT 1 FROM windows WHERE attempt_count>max_count OR old_start_ms>?9
  )
ON CONFLICT(counter_key) DO UPDATE SET
  window_start_ms=excluded.window_start_ms,
  expires_at_ms=excluded.expires_at_ms,
  attempt_count=excluded.attempt_count
RETURNING counter_key
`;

/** Internal quota reservation for distinct, already-authorized attempts.
 * A durable call coordinator must deduplicate attempts and coordinate the
 * invitation before this becomes a live admission path.
 */
export async function reserveCallAttemptWindows(
  db: D1Database, callerId: string, receiverId: string, nowMs: number,
): Promise<boolean> {
  if (!validOpaqueId(callerId) || !validOpaqueId(receiverId) || callerId === receiverId ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0 || nowMs > Number.MAX_SAFE_INTEGER - CALL_ATTEMPT_WINDOW_MS) {
    return false;
  }
  const {results} = await db.prepare(RESERVE_ATTEMPT).bind(
    `pair:${callerId}:${receiverId}`, callerId, receiverId, CALL_ATTEMPT_LIMITS.pair,
    `caller:${callerId}`, CALL_ATTEMPT_LIMITS.caller,
    `receiver:${receiverId}`, CALL_ATTEMPT_LIMITS.receiver,
    nowMs, nowMs + CALL_ATTEMPT_WINDOW_MS,
  ).all<{counter_key: string}>();
  return results.length === 3;
}

/** Expiration cleanup is separate from admission and can be safely retried. */
export async function purgeExpiredCallAttemptWindows(db: D1Database, nowMs: number): Promise<void> {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("Invalid cleanup time");
  for (let batch = 0; batch < 20; batch++) {
    const {meta} = await db.prepare(
      "DELETE FROM call_attempt_windows WHERE counter_key IN (" +
      "SELECT counter_key FROM call_attempt_windows WHERE expires_at_ms<=? ORDER BY expires_at_ms,counter_key LIMIT 500)",
    ).bind(nowMs).run();
    if (meta.changes < 500) break;
  }
}
