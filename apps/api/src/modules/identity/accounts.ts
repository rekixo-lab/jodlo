import type { D1Database } from "../../data/d1.ts";
import { validOpaqueId } from "../shared/identifiers.ts";

/** Called ONLY after a future approved identity adapter verified an external identity.
 * Never expose an unauthenticated public create-account route.
 */
export const CREATE_ACCOUNT_QUERY =
  "INSERT INTO accounts(id) VALUES (?) ON CONFLICT(id) DO NOTHING";

export async function ensureAccount(db: D1Database, internalAccountId: string): Promise<void> {
  if (!validOpaqueId(internalAccountId)) {
    throw new Error("Invalid internal account identifier");
  }
  await db.prepare(CREATE_ACCOUNT_QUERY).bind(internalAccountId).run();
}
