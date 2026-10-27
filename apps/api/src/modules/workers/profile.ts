import type { D1Database } from "../../data/d1.ts";

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
): Promise<WorkerDraft | null> {
  const { results } = await db.prepare(OWN_DRAFT_QUERY).bind(accountId).all<WorkerDraft>();
  return results[0] ?? null;
}

export async function optInAsWorker(
  db: D1Database,
  accountId: string,
): Promise<WorkerDraft | null> {
  await db.prepare(OPT_IN_QUERY).bind(accountId).run();
  return ownWorkerDraft(db, accountId);
}
