import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { PUBLIC_LISTING_ELIGIBILITY } from "../workers/listings.ts";

const CURRENT_ACTOR =
  "SELECT actor.id FROM auth_sessions AS s " +
  "JOIN accounts AS actor ON actor.id=s.account_id " +
  "WHERE s.token_hash=? AND s.expires_at>? AND actor.status='active'";

const ELIGIBLE_ACTOR_AND_LISTING =
  " FROM (" + CURRENT_ACTOR + ") AS actor " +
  "JOIN worker_listings AS wl ON wl.id=? " +
  "JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id " +
  "JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE actor.id<>wl.worker_account_id AND " + PUBLIC_LISTING_ELIGIBILITY;

const BLOCK_LISTING_OWNER =
  "INSERT INTO agora_account_blocks(blocker_account_id,blocked_account_id) " +
  "SELECT actor.id,wl.worker_account_id" + ELIGIBLE_ACTOR_AND_LISTING +
  " ON CONFLICT(blocker_account_id,blocked_account_id) DO NOTHING";

const UNBLOCK_LISTING_OWNER =
  "DELETE FROM agora_account_blocks " +
  "WHERE blocker_account_id=(" + CURRENT_ACTOR + ") " +
  "AND blocked_account_id=(SELECT worker_account_id FROM worker_listings WHERE id=?)";

const READ_OWN_LISTING_BLOCK =
  "SELECT EXISTS(SELECT 1 FROM agora_account_blocks AS b " +
  "WHERE b.blocker_account_id=actor.id AND b.blocked_account_id=wl.worker_account_id) AS blocked" +
  ELIGIBLE_ACTOR_AND_LISTING;

/** Internal, directional safety read. It cannot reveal an incoming block,
 * another account identifier, or a hidden listing's owner.
 */
export async function readOwnAgoraListingBlock(
  db: D1Database, bearer: string, listingId: string,
): Promise<boolean | null> {
  if (!validSessionToken(bearer) || !validOpaqueId(listingId)) return null;
  const {results} = await db.prepare(READ_OWN_LISTING_BLOCK)
    .bind(await sessionHash(bearer), Math.floor(Date.now() / 1000), listingId)
    .all<{blocked: unknown}>();
  const blocked = results[0]?.blocked;
  if (results.length !== 1 || (blocked !== 0 && blocked !== 1)) return null;
  return blocked === 1;
}

/** One session-bound write using an opaque Listing ID. Blocking requires a
 * current public listing. Unblocking can remove the actor's own relationship
 * even if that listing has since been paused. The result exposes no target ID.
 */
export async function changeOwnAgoraListingBlock(
  db: D1Database, bearer: string, listingId: string, blocked: boolean,
): Promise<boolean> {
  if (!validSessionToken(bearer) || !validOpaqueId(listingId) ||
      typeof blocked !== "boolean") return false;
  const {meta} = await db.prepare(blocked ? BLOCK_LISTING_OWNER : UNBLOCK_LISTING_OWNER)
    .bind(await sessionHash(bearer), Math.floor(Date.now() / 1000), listingId).run();
  return meta.changes === 1;
}
