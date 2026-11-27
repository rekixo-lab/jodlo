import type { D1Database } from "../../data/d1.ts";
import { activeSessionWriteFence } from "../identity/sessions.ts";

export type WorkerDraft = { status: "draft" };

/** A verified active customer opts into becoming a worker.
 * Atomic, duplicate-safe and incapable of publishing or granting verification.
 */
export const OPT_IN_QUERY =
  "INSERT INTO worker_profiles(account_id) " +
  "SELECT id FROM accounts WHERE id = ? AND status = 'active' " +
  "ON CONFLICT(account_id) DO NOTHING";

export const OWN_DRAFT_QUERY =
  "SELECT wp.status FROM worker_profiles AS wp " +
  "JOIN accounts AS a ON a.id = wp.account_id " +
  "WHERE wp.account_id = ? AND a.status = 'active' LIMIT 1";

export async function ownWorkerDraft(
  db: D1Database,
  accountId: string,
  tokenHash?: string,
): Promise<WorkerDraft | null> {
  const fence = activeSessionWriteFence(accountId, tokenHash);
  const query = OWN_DRAFT_QUERY.replace(" LIMIT 1", fence.sql + " LIMIT 1");
  const { results } = await db.prepare(query).bind(accountId, ...fence.values).all<WorkerDraft>();
  return results[0] ?? null;
}

export async function optInAsWorker(
  db: D1Database,
  accountId: string,
  tokenHash?: string,
): Promise<WorkerDraft | null> {
  const fence = activeSessionWriteFence(accountId, tokenHash);
  const query = OPT_IN_QUERY.replace("ON CONFLICT", fence.sql + "ON CONFLICT");
  await db.prepare(query).bind(accountId, ...fence.values).run();
  return ownWorkerDraft(db, accountId, tokenHash);
}
