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

export function validBlockManagementId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

const MANAGED_BLOCK_PAGE_SIZE = 20;

export async function readOwnContactBlocks(db: D1Database, bearer: string, after: string, language: "en" | "hi") {
  if (!validSessionToken(bearer) || (after !== "" && !validBlockManagementId(after))) return null;
  const {results} = await db.prepare(
    "SELECT b.management_id AS id, (SELECT CASE WHEN ?='hi' THEN COALESCE(c.name_hi,c.name_en) ELSE c.name_en END " +
    "FROM worker_listings AS wl " +
    "JOIN accounts AS a ON a.id=wl.worker_account_id " +
    "JOIN worker_profiles AS wp ON wp.account_id=a.id JOIN categories AS c ON c.id=wl.category_id " +
    "WHERE wl.worker_account_id=b.blocked_account_id AND " + PUBLIC_LISTING_ELIGIBILITY +
    " ORDER BY wl.id LIMIT 1) AS categoryName " +
    "FROM (" + CURRENT_ACTOR + ") AS actor " +
    "LEFT JOIN agora_account_blocks AS b ON b.blocker_account_id=actor.id AND b.management_id>? " +
    "ORDER BY b.management_id LIMIT ?",
  ).bind(language, await sessionHash(bearer), Math.floor(Date.now() / 1000), after, MANAGED_BLOCK_PAGE_SIZE + 1)
    .all<{id: string | null; categoryName: string | null}>();
  if (!results.length) return null;
  const items = results.filter((row): row is {id: string; categoryName: string | null} =>
    validBlockManagementId(row.id)).slice(0, MANAGED_BLOCK_PAGE_SIZE);
  return {items, nextCursor: results.length > MANAGED_BLOCK_PAGE_SIZE ? items.at(-1)?.id ?? null : null};
}

export async function removeOwnContactBlock(db: D1Database, bearer: string, id: string): Promise<boolean> {
  if (!validSessionToken(bearer) || !validBlockManagementId(id)) return false;
  const {meta} = await db.prepare(
    "DELETE FROM agora_account_blocks WHERE blocker_account_id=(" + CURRENT_ACTOR + ") AND management_id=?",
  ).bind(await sessionHash(bearer), Math.floor(Date.now() / 1000), id).run();
  return meta.changes === 1;
}
