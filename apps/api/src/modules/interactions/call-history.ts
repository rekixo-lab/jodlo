import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";

export const CALL_HISTORY_RETENTION_SECONDS = 90 * 24 * 60 * 60;
export const CALL_HISTORY_CLEANUP_CRON = "17 * * * *";
const CLEANUP_BATCH = 500;
const MAX_CLEANUP_BATCHES = 20;
const HISTORY_PAGE_SIZE = 25;

type CallHistorySummary = Readonly<{
  id: string;
  direction: "incoming" | "outgoing";
  outcome: "ended" | "declined" | "busy" | "cancelled" | "missed" | "failed";
  endedAt: number;
  connectedSeconds: number;
}>;

export async function readOwnCallHistory(
  db: D1Database, bearer: string, after: string | null, now = Math.floor(Date.now() / 1000),
): Promise<{items: CallHistorySummary[]; nextCursor: string | null} | null> {
  if (!validSessionToken(bearer)) return null;
  const {results} = await db.prepare(
    "SELECT h.id,h.direction,h.outcome,h.ended_at AS endedAt,h.connected_seconds AS connectedSeconds " +
    "FROM auth_sessions AS s JOIN accounts AS a ON a.id=s.account_id AND a.status='active' " +
    "LEFT JOIN call_history AS anchor ON anchor.id=? AND anchor.account_id=a.id AND anchor.ended_at>? AND anchor.ended_at<=? " +
    "LEFT JOIN call_history AS h ON h.account_id=a.id AND h.ended_at>? AND h.ended_at<=? " +
    "AND (? IS NULL OR (h.ended_at,h.id)<(anchor.ended_at,anchor.id)) " +
    "WHERE s.token_hash=? AND s.expires_at>? ORDER BY h.ended_at DESC,h.id DESC LIMIT ?",
  ).bind(after, now - CALL_HISTORY_RETENTION_SECONDS, now, now - CALL_HISTORY_RETENTION_SECONDS,
    now, after, await sessionHash(bearer), now, HISTORY_PAGE_SIZE + 1)
    .all<CallHistorySummary | {id: null}>();
  if (!results.length) return null;
  const items = results.filter((row): row is CallHistorySummary => row.id !== null).slice(0, HISTORY_PAGE_SIZE);
  return {items, nextCursor: results.length > HISTORY_PAGE_SIZE ? items.at(-1)?.id ?? null : null};
}

export async function purgeExpiredCallHistory(db: D1Database, now: number): Promise<number> {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("Invalid cleanup time");
  const cutoff = now - CALL_HISTORY_RETENTION_SECONDS;
  let removed = 0;
  for (let page = 0; page < MAX_CLEANUP_BATCHES; page++) {
    const {meta} = await db.prepare(
      "DELETE FROM call_history WHERE id IN (" +
      "SELECT id FROM call_history WHERE ended_at<=? ORDER BY ended_at,id LIMIT ?)",
    ).bind(cutoff, CLEANUP_BATCH).run();
    removed += meta.changes;
    if (meta.changes < CLEANUP_BATCH) break;
  }
  return removed;
}
