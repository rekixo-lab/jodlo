import type { D1Database } from "../../data/d1.ts";
import { validOpaqueId, validCategoryId } from "../shared/identifiers.ts";
import { projectVisibleListing } from "../discovery/public-listing.ts";

export type PublicListing = Readonly<{ id: string; categoryId: string }>;

export const PUBLISH_LISTING_QUERY =
  "INSERT INTO worker_listings(id,worker_account_id,category_id) " +
  "SELECT ?,wp.account_id,c.id FROM worker_profiles AS wp " +
  "JOIN accounts AS a ON a.id=wp.account_id JOIN categories AS c ON c.id=? " +
  "WHERE wp.account_id=? AND wp.status='draft' AND a.status='active' AND c.is_active=1 " +
  "ON CONFLICT(worker_account_id,category_id) DO UPDATE SET status='published' " +
  "WHERE worker_listings.moderation_status='allowed'";

export const OWN_LISTING_QUERY =
  "SELECT wl.id,wl.category_id AS categoryId,wl.status,wl.moderation_status AS moderation, " +
  "c.is_active AS active FROM worker_listings AS wl " +
  "JOIN accounts AS a ON a.id=wl.worker_account_id JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.worker_account_id=? AND a.status='active' AND wl.category_id=? LIMIT 1";

export const PUBLIC_LISTINGS_QUERY =
  "SELECT wl.id,wl.category_id AS categoryId,wl.worker_account_id AS workerId " +
  "FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.category_id=? AND wl.status='published' AND wl.moderation_status='allowed' " +
  "AND a.status='active' AND wp.status='draft' AND c.is_active=1 " +
  "ORDER BY wl.created_at,wl.id LIMIT 25";

export const MY_LISTINGS_QUERY =
  "SELECT wl.id,wl.category_id AS categoryId, " +
  "CASE WHEN wl.status='published' AND wl.moderation_status='allowed' AND c.is_active=1 " +
  "THEN 1 ELSE 0 END AS visible FROM worker_listings AS wl " +
  "JOIN accounts AS a ON a.id=wl.worker_account_id JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.worker_account_id=? AND a.status='active' ORDER BY wl.created_at,wl.id LIMIT 100";

export const UNPUBLISH_LISTING_QUERY =
  "UPDATE worker_listings SET status='unpublished' WHERE id=? AND worker_account_id=? " +
  "AND status='published' AND EXISTS (SELECT 1 FROM accounts " +
  "WHERE id=worker_listings.worker_account_id AND status='active')";

/** Atomic database UPSERT; duplicate retries use the SAME listing ID. */
export async function publishListing(db:D1Database,actor:string,categoryId:string):
  Promise<PublicListing|null> {
  if(!validOpaqueId(actor)||!validCategoryId(categoryId)) return null;
  await db.prepare(PUBLISH_LISTING_QUERY).bind(crypto.randomUUID(),categoryId,actor).run();
  const {results}=await db.prepare(OWN_LISTING_QUERY).bind(actor,categoryId)
    .all<{id:string;categoryId:string;status:string;moderation:string;active:number}>();
  const row=results[0];
  if(!row||row.status!=='published'||row.moderation!=='allowed'||row.active!==1)return null;
  return Object.freeze({id:row.id,categoryId:row.categoryId});
}

/** The verified actor alone may see their IDs and current public visibility. */
export async function myListings(db:D1Database,actor:string) {
  if(!validOpaqueId(actor))return [];
  const {results}=await db.prepare(MY_LISTINGS_QUERY).bind(actor)
    .all<{id:string;categoryId:string;visible:number}>();
  return results.map(({id,categoryId,visible})=>({id,categoryId,visible:visible===1}));
}

/** DB joins CURRENT server-owned status; output never includes worker identity. */
export async function publicListings(db:D1Database,categoryId:string):Promise<PublicListing[]> {
  if(!validCategoryId(categoryId))return [];
  const {results}=await db.prepare(PUBLIC_LISTINGS_QUERY).bind(categoryId)
    .all<{id:string;categoryId:string;workerId:string}>();
  return results.flatMap(row=>{
    const value=projectVisibleListing({
      listingId:row.id,listingOwnerAccountId:row.workerId,
      workerAccountId:row.workerId,categoryId:row.categoryId,
      ownerActive:true,workerOptedIn:true,categoryActive:true,
      listingPublished:true,listingAvailable:true,moderationApproved:true,
      disclosureApprovedByPolicy:true,
    });
    return value ? [value] : [];
  });
}

export async function unpublishListing(db:D1Database,actor:string,id:string):Promise<boolean> {
  if(!validOpaqueId(actor)||!validOpaqueId(id))return false;
  const {meta}=await db.prepare(UNPUBLISH_LISTING_QUERY).bind(id,actor).run();
  return meta.changes===1;
}
