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

/** The same CURRENT DB eligibility controls both public listing rows and
 * the optional category-availability facet. Never count private/hidden items. */
export const PUBLIC_LISTING_ELIGIBILITY =
  "wl.status='published' AND wl.moderation_status='allowed' " +
  "AND a.status='active' AND wp.status='draft' AND c.is_active=1";

export const PUBLIC_LISTINGS_QUERY =
  "SELECT wl.id,wl.category_id AS categoryId,wl.worker_account_id AS workerId " +
  "FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.category_id=? AND " + PUBLIC_LISTING_ELIGIBILITY +
  " ORDER BY wl.created_at,wl.id LIMIT 25";

/** Opt-in bounded browse: the cursor must be a STILL-PUBLIC listing ID.
 * Look up its ordering tuple INSIDE D1 and recheck exactly the same eligibility
 * as returned public rows. A hidden/unpublished/disabled/deleted anchor must
 * not be usable as an existence/order oracle. Never publish private columns
 * or vary the established 25-row GET.
 */
const PUBLIC_LISTINGS_SELECT =
  "SELECT wl.id,wl.category_id AS categoryId,wl.worker_account_id AS workerId " +
  "FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.category_id=? AND " + PUBLIC_LISTING_ELIGIBILITY;

export const PAGED_PUBLIC_LISTINGS_QUERY =
  PUBLIC_LISTINGS_SELECT + " ORDER BY wl.created_at,wl.id LIMIT ?";

/** Cursor eligibility is evaluated inside the SAME SQL statement as the
 * page. Reuse the exact public listing predicate so moderation and account
 * changes invalidate a previously public cursor without a race-prone pre-read.
 * Inner aliases intentionally shadow outer aliases (a separate SQL scope).
 */
export const CONTINUED_PUBLIC_LISTINGS_QUERY =
  PUBLIC_LISTINGS_SELECT +
  " AND (wl.created_at,wl.id) > (SELECT wl.created_at,wl.id " +
  "FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id " +
  "JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.id=? AND wl.category_id=? AND " + PUBLIC_LISTING_ELIGIBILITY + ")" +
  " ORDER BY wl.created_at,wl.id LIMIT ?";

/** Owner-only projection: moderation-hidden and unpublished items remain
 * visible TO THEIR OWNER as rows with visible:false, not public listings.
 * Never project account ID, private notes, or current moderation reasons.
 */
const OWN_LISTINGS_SELECT =
  "SELECT wl.id,wl.category_id AS categoryId, " +
  "CASE WHEN wl.status='published' AND wl.moderation_status='allowed' AND c.is_active=1 " +
  "THEN 1 ELSE 0 END AS visible FROM worker_listings AS wl " +
  "JOIN accounts AS a ON a.id=wl.worker_account_id JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.worker_account_id=? AND a.status='active'";

export const MY_LISTINGS_QUERY =
  OWN_LISTINGS_SELECT + " ORDER BY wl.created_at,wl.id LIMIT 100";

/** Optional paged owner reads preserve the legacy 100-row GET contract.
 * The continuation anchor is looked up in the SAME owner's listings; a
 * foreign or deleted ID cannot act as an ordering oracle or skip records.
 * Unlike PUBLIC cursors, a hidden/unpublished owner row may be an anchor.
 */
export const PAGED_MY_LISTINGS_QUERY =
  OWN_LISTINGS_SELECT + " ORDER BY wl.created_at,wl.id LIMIT ?";

export const CONTINUED_MY_LISTINGS_QUERY =
  OWN_LISTINGS_SELECT +
  " AND (wl.created_at,wl.id) > (SELECT prior.created_at,prior.id " +
  "FROM worker_listings AS prior WHERE prior.worker_account_id=? AND prior.id=? LIMIT 1)" +
  " ORDER BY wl.created_at,wl.id LIMIT ?";

export type OwnListingsPageOptions = Readonly<{limit:number|null;after:string|null}>;

/** Strict GET-only opt-in. When limit is absent, keep the exact old DTO. */
export function parseOwnListingsPage(params:URLSearchParams):OwnListingsPageOptions|null {
  let invalid=false;
  const allowed=new Set(["limit","after"]);
  params.forEach((_value,key)=>{
    if(!allowed.has(key)||params.getAll(key).length!==1)invalid=true;
  });
  if(invalid)return null;
  const limitRaw=params.get("limit"),after=params.get("after");
  if(after!==null&&limitRaw===null)return null;
  if(limitRaw!==null&&!/^(?:[1-9]|1[0-9]|2[0-5])$/.test(limitRaw))return null;
  if(after!==null&&!validOpaqueId(after))return null;
  return {limit:limitRaw===null?null:Number(limitRaw),after};
}

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

type OwnListingDbRow = {id:string;categoryId:string;visible:number};
const ownListingProjections=(rows:readonly OwnListingDbRow[])=>
  rows.map(({id,categoryId,visible})=>({id,categoryId,visible:visible===1}));

/** The verified actor alone may see their IDs and current public visibility. */
export async function myListings(db:D1Database,actor:string) {
  if(!validOpaqueId(actor))return [];
  const {results}=await db.prepare(MY_LISTINGS_QUERY).bind(actor).all<OwnListingDbRow>();
  return ownListingProjections(results);
}

export type OwnListingPage=Readonly<{
  listings:ReturnType<typeof ownListingProjections>;
  nextCursor:string|null;
}>;

/** One deliberate, bounded page of current OWNER records, not public rows.
 * Query and anchor are both scoped to the authenticated actor. No polling,
 * automatic traversal, raw account ID, timestamp or trust/verification claim.
 */
export async function pageMyListings(
  db:D1Database,actor:string,limit:number,after:string|null,
):Promise<OwnListingPage> {
  if(!validOpaqueId(actor)||!Number.isSafeInteger(limit)||limit<1||limit>25||
      (after!==null&&!validOpaqueId(after))) {
    throw new Error("Invalid owner listing page");
  }
  const query=after===null?PAGED_MY_LISTINGS_QUERY:CONTINUED_MY_LISTINGS_QUERY;
  const args=after===null?[actor,limit+1]:[actor,actor,after,limit+1];
  const {results}=await db.prepare(query).bind(...args).all<OwnListingDbRow>();
  const selected=results.slice(0,limit);
  return {
    listings:ownListingProjections(selected),
    nextCursor:results.length>limit?selected.at(-1)?.id??null:null,
  };
}

type PublicListingDbRow = {id:string;categoryId:string;workerId:string};

/** DB joins CURRENT server-owned status; output never includes worker identity.
 * Shared two-field projection for legacy reads and the opt-in paged reader.
 */
function publicListingProjections(rows: PublicListingDbRow[]): PublicListing[] {
  return rows.flatMap(row=>{
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

export async function publicListings(db:D1Database,categoryId:string):Promise<PublicListing[]> {
  if(!validCategoryId(categoryId))return [];
  const {results}=await db.prepare(PUBLIC_LISTINGS_QUERY).bind(categoryId)
    .all<PublicListingDbRow>();
  return publicListingProjections(results);
}

export type PublicListingPage = Readonly<{
  listings: PublicListing[];
  nextCursor: string | null;
}>;

/** Page size at most 25; SQL reads at most one additional eligible row.
 * No offset scan, public timestamps, personal identifiers or worker scores.
 */
export async function pagePublicListings(
  db:D1Database,categoryId:string,limit:number,after:string|null,
):Promise<PublicListingPage> {
  if(!validCategoryId(categoryId) ||
     !Number.isSafeInteger(limit) || limit<1 || limit>25 ||
     (after!==null && !validOpaqueId(after))) {
    throw new Error("Invalid public listing page");
  }
  const query=after===null?PAGED_PUBLIC_LISTINGS_QUERY:CONTINUED_PUBLIC_LISTINGS_QUERY;
  const parameters=after===null
    ? [categoryId,limit+1]
    : [categoryId,after,categoryId,limit+1];
  const {results}=await db.prepare(query).bind(...parameters).all<PublicListingDbRow>();
  const listings=publicListingProjections(results.slice(0,limit));
  return {listings,nextCursor:results.length>limit ? listings.at(-1)?.id??null : null};
}

export async function unpublishListing(db:D1Database,actor:string,id:string):Promise<boolean> {
  if(!validOpaqueId(actor)||!validOpaqueId(id))return false;
  const {meta}=await db.prepare(UNPUBLISH_LISTING_QUERY).bind(id,actor).run();
  return meta.changes===1;
}
