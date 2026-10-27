import type { D1Database } from "../../data/d1.ts";

export const FIND_GOOGLE_ACCOUNT_QUERY =
  "SELECT a.id AS accountId, a.status AS status " +
  "FROM google_identities AS g JOIN accounts AS a ON a.id = g.account_id " +
  "WHERE g.google_sub = ? LIMIT 1";

/** Resolve Google's verified, stable subject to one server-owned JODLO account.
 * D1 batch is transactional: duplicate parallel sign-ins cannot create orphan accounts.
 */
export async function resolveGoogleAccount(db: D1Database, verifiedSub: string): Promise<string | null> {
  const lookup = () => db.prepare(FIND_GOOGLE_ACCOUNT_QUERY)
    .bind(verifiedSub).all<{ accountId: string; status: string }>();
  let { results } = await lookup();
  if (!results.length) {
    const newId = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO accounts(id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM google_identities WHERE google_sub = ?)")
        .bind(newId, verifiedSub),
      db.prepare("INSERT INTO google_identities(google_sub, account_id) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM google_identities WHERE google_sub = ?)")
        .bind(verifiedSub, newId, verifiedSub),
    ]);
    ({ results } = await lookup());
  }
  const row = results[0];
  return row?.status === "active" ? row.accountId : null;
}
