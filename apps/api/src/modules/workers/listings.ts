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

/** Fresh, single-record public visibility read for a selected Listing.
 * The same current DB predicate is used by browse, availability facets,
 * pagination and this detail. No owner ID / profile / phone is projected.
 */
export const PUBLIC_LISTING_DETAIL_QUERY =
  "SELECT wl.id,wl.category_id AS categoryId,wl.worker_account_id AS workerId " +
  "FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.id=? AND " + PUBLIC_LISTING_ELIGIBILITY + " LIMIT 1";

/** Explicit, public-only SERVICE detail. A single authoritative query
 * rechecks the existing listing/owner/worker/moderation/current Category join
 * and obtains that same approved Category's language-specific name. No
 * Worker profile, phone, location, rate, badge or free-form description.
 */
export const PUBLIC_APPROVED_SERVICE_DETAIL_QUERY =
  "SELECT wl.id,wl.category_id AS categoryId,wl.worker_account_id AS workerId," +
  " c.id AS approvedCategoryId,c.slug AS categorySlug," +
  " CASE WHEN ?='hi' THEN COALESCE(NULLIF(c.name_hi,''),c.name_en)" +
  " ELSE c.name_en END AS categoryName " +
  "FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id " +
  "JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.id=? AND " + PUBLIC_LISTING_ELIGIBILITY + " LIMIT 1";

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

export type OwnListingsPageOptions = Readonly<{limit:number|null;after:string|null;management?:true}>;

/** Strict GET-only opt-in. When limit is absent, keep the exact old DTO. */
export function parseOwnListingsPage(params:URLSearchParams):OwnListingsPageOptions|null {
  let invalid=false;
  const allowed=new Set(["limit","after","view"]);
  params.forEach((_value,key)=>{
    if(!allowed.has(key)||params.getAll(key).length!==1)invalid=true;
  });
  if(invalid)return null;
  const limitRaw=params.get("limit"),after=params.get("after"),view=params.get("view");
  if(view!==null&&(view!=="management"||limitRaw===null))return null;
  if(after!==null&&limitRaw===null)return null;
  if(limitRaw!==null&&!/^(?:[1-9]|1[0-9]|2[0-5])$/.test(limitRaw))return null;
  if(after!==null&&!validOpaqueId(after))return null;
  return {limit:limitRaw===null?null:Number(limitRaw),after,
    ...(view==="management"?{management:true as const}:{})};
}

/** Explicit, AUTHENTICATED owner management view: current publication
 * intent is safe to show to the SAME owner, not a moderation verdict.
 * Existing legacy/paged DTOs and ALL public reads stay byte-compatible.
 * Public visibility may be false for an active 'published' row when Category
 * or moderation changes, so never infer status from visible alone.
 */
const MANAGED_OWN_LISTINGS_SELECT =
  "SELECT wl.id,wl.category_id AS categoryId,wl.status AS publicationStatus, " +
  "CASE WHEN wl.status='published' AND wl.moderation_status='allowed' AND c.is_active=1 " +
  "AND EXISTS(SELECT 1 FROM worker_profiles AS wp " +
  "WHERE wp.account_id=wl.worker_account_id AND wp.status='draft') " +
  "THEN 1 ELSE 0 END AS visible FROM worker_listings AS wl " +
  "JOIN accounts AS a ON a.id=wl.worker_account_id JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.worker_account_id=? AND a.status='active'";

export const MANAGED_OWN_LISTINGS_QUERY =
  MANAGED_OWN_LISTINGS_SELECT+" ORDER BY wl.created_at,wl.id LIMIT ?";
export const CONTINUED_MANAGED_OWN_LISTINGS_QUERY =
  MANAGED_OWN_LISTINGS_SELECT+
  " AND (wl.created_at,wl.id) > (SELECT prior.created_at,prior.id " +
  "FROM worker_listings AS prior WHERE prior.worker_account_id=? AND prior.id=? LIMIT 1)" +
  " ORDER BY wl.created_at,wl.id LIMIT ?";

/** Exact owner-selected read, separate from a paged or legacy GET.
 * Uses the SAME private status projection as managed pages, with actor+ID
 * filters in ONE SQL statement. Foreign, removed and disabled accounts
 * return identical absence, without leaking worker/category/moderator data.
 */
export const EXACT_MANAGED_OWN_LISTING_QUERY =
  MANAGED_OWN_LISTINGS_SELECT+" AND wl.id=? LIMIT 1";

export async function exactManagedOwnListing(
  db:D1Database,actor:string,listingId:string,
):Promise<{id:string;categoryId:string;visible:boolean;
  publicationStatus:"published"|"unpublished"}|null> {
  if(!validOpaqueId(actor)||!validOpaqueId(listingId))return null;
  const {results}=await db.prepare(EXACT_MANAGED_OWN_LISTING_QUERY)
    .bind(actor,listingId).all<ManagedOwnListingRow>();
  const row=results[0];
  if(!row)return null;
  if(row.id!==listingId || !validCategoryId(row.categoryId) ||
    (row.publicationStatus!=="published"&&row.publicationStatus!=="unpublished") ||
    (row.visible!==0&&row.visible!==1) ||
    (row.visible===1&&row.publicationStatus!=="published")) {
    throw new Error("Invalid own service projection");
  }
  return {id:row.id,categoryId:row.categoryId,
    visible:row.visible===1,publicationStatus:row.publicationStatus};
}



/** Private opt-in v2 snapshot. The legacy exact owner query and public
 * two-field Listing DTO remain untouched. One actor+ID SQL statement,
 * and no account, Google, moderator reason or Worker personal fields.
 */
export const EXACT_VERSIONED_OWN_LISTING_QUERY =
  MANAGED_OWN_LISTINGS_SELECT.replace(
    "SELECT wl.id,",
    "SELECT wl.revision AS revision,wl.id,"
  )+" AND wl.id=? LIMIT 1";

export type VersionedOwnListing = Readonly<{
  id:string;categoryId:string;visible:boolean;
  publicationStatus:"published"|"unpublished";revision:number;
}>;
export async function exactVersionedOwnListing(
  db:D1Database,actor:string,listingId:string,
):Promise<VersionedOwnListing|null> {
  if(!validOpaqueId(actor)||!validOpaqueId(listingId))return null;
  const {results}=await db.prepare(EXACT_VERSIONED_OWN_LISTING_QUERY)
    .bind(actor,listingId).all<ManagedOwnListingRow&{revision:number}>();
  const row=results[0];
  if(!row)return null;
  if(row.id!==listingId||!validCategoryId(row.categoryId)||
    (row.visible!==0&&row.visible!==1)||
    (row.publicationStatus!=="published"&&row.publicationStatus!=="unpublished")||
    (row.visible===1&&row.publicationStatus!=="published")||
    !Number.isSafeInteger(row.revision)||row.revision<0||
    row.revision>2147483647)throw new Error("Invalid private Service revision");
  return {id:row.id,categoryId:row.categoryId,visible:row.visible===1,
    publicationStatus:row.publicationStatus,revision:row.revision};
}

/** Every mutation below is scoped to one PRIMARY KEY listing ID and
 * authenticated owner. The new 0011 AFTER UPDATE trigger updates the same
 * row's revision once. SQLite changes() (Node adapter) reports the ONE
 * direct update, while local Cloudflare D1 meta.changes may report TWO
 * including the trigger. Accept ONLY these two exact counts, never "any
 * positive count" and never a zero-row conflict as success.
 */
const changedExactlyOneOwnerListing=(count:number):boolean =>
  Number.isSafeInteger(count)&&(count===1||count===2);

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

/** One explicit, bounded owner-only management page; never mix with public
 * or legacy owner DTOs. No raw moderation, owner account, phone or location.
 */
type ManagedOwnListingRow=OwnListingDbRow&{
  publicationStatus:"published"|"unpublished";
};
export async function pageManagedOwnListings(
  db:D1Database,actor:string,limit:number,after:string|null,
):Promise<{listings:{id:string;categoryId:string;visible:boolean;
                  publicationStatus:"published"|"unpublished"}[];nextCursor:string|null}> {
  if(!validOpaqueId(actor)||!Number.isSafeInteger(limit)||limit<1||limit>25||
      (after!==null&&!validOpaqueId(after)))throw new Error("Invalid management page");
  const query=after===null?MANAGED_OWN_LISTINGS_QUERY:CONTINUED_MANAGED_OWN_LISTINGS_QUERY;
  const args=after===null?[actor,limit+1]:[actor,actor,after,limit+1];
  const {results}=await db.prepare(query).bind(...args).all<ManagedOwnListingRow>();
  const selected=results.slice(0,limit);
  // A corrupt status must fail closed, never be inferred as user-paused.
  if(selected.some(row=>row.publicationStatus!=="published"&&
      row.publicationStatus!=="unpublished"))throw new Error("Invalid publication state");
  return {
    listings:selected.map(({id,categoryId,visible,publicationStatus})=>
      ({id,categoryId,visible:visible===1,publicationStatus})),
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

/** Read the selected public listing AGAIN on navigation, rather than treating
 * a previous page as permission to disclose worker metadata/contact.
 * Hidden, unpublished, inactive Category/worker rows all yield the same null.
 */
export async function publicListingDetail(
  db:D1Database,id:string,
):Promise<PublicListing|null> {
  if(!validOpaqueId(id))return null;
  const {results}=await db.prepare(PUBLIC_LISTING_DETAIL_QUERY).bind(id)
    .all<PublicListingDbRow>();
  return publicListingProjections(results)[0]??null;
}

export type PublicApprovedServiceDetail = Readonly<{
  language:"en"|"hi";
  listing:PublicListing;
  category:Readonly<{id:string;slug:string;name:string}>;
}>;

/** No second query or TOCTOU Category-label lookup. The returned name is
 * exactly current approved Catalog text, never generated from Worker input.
 */
export async function publicApprovedServiceDetail(
  db:D1Database,id:string,language:"en"|"hi",
):Promise<PublicApprovedServiceDetail|null> {
  if(!validOpaqueId(id)||(language!=="en"&&language!=="hi"))return null;
  const {results}=await db.prepare(PUBLIC_APPROVED_SERVICE_DETAIL_QUERY)
    .bind(language,id).all<PublicListingDbRow&{
      approvedCategoryId:string;categorySlug:string;categoryName:string;
    }>();
  const row=results[0];
  if(!row||row.categoryId!==row.approvedCategoryId||
      !validCategoryId(row.categorySlug)||
      typeof row.categoryName!=="string"||!row.categoryName.trim()||
      Array.from(row.categoryName).length>160||
      /[\u0000-\u001F\u007F]/.test(row.categoryName))return null;
  const listing=publicListingProjections([row])[0];
  if(!listing)return null;
  return Object.freeze({
    language,
    listing,
    category:Object.freeze({
      id:listing.categoryId,slug:row.categorySlug,name:row.categoryName,
    }),
  });
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

/** Anonymous all-category feed, STILL the same two-field current-public
 * listing projection. Unlike single-Category paging, this keyset spans trades
 * and never uses a client-provided category, owner or timestamp.
 *
 * A cursor is valid only while the exact anchor Listing remains eligible
 * under current status, moderation, owner and active-category joins.
 * A listing changed between pages can only disappear, never leak private
 * owner data; no persistent feed snapshots or automatic notifications.
 */
const ALL_PUBLIC_LISTINGS_SELECT =
  "SELECT wl.id,wl.category_id AS categoryId,wl.worker_account_id AS workerId " +
  "FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id " +
  "JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE " + PUBLIC_LISTING_ELIGIBILITY;

export const PAGED_ALL_PUBLIC_LISTINGS_QUERY =
  ALL_PUBLIC_LISTINGS_SELECT + " ORDER BY wl.created_at,wl.id LIMIT ?";

export const CONTINUED_ALL_PUBLIC_LISTINGS_QUERY =
  ALL_PUBLIC_LISTINGS_SELECT +
  " AND (wl.created_at,wl.id) > (SELECT wl.created_at,wl.id " +
  "FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id " +
  "JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.id=? AND " + PUBLIC_LISTING_ELIGIBILITY + ")" +
  " ORDER BY wl.created_at,wl.id LIMIT ?";

export async function pageAllPublicListings(
  db:D1Database,limit:number,after:string|null,
):Promise<PublicListingPage> {
  if(!Number.isSafeInteger(limit)||limit<1||limit>25||
    (after!==null&&!validOpaqueId(after)))throw new Error("Invalid all-public feed");
  const sql=after===null?PAGED_ALL_PUBLIC_LISTINGS_QUERY:CONTINUED_ALL_PUBLIC_LISTINGS_QUERY;
  const {results}=await db.prepare(sql).bind(...(after===null?[limit+1]:[after,limit+1]))
    .all<PublicListingDbRow>();
  const rows=publicListingProjections(results.slice(0,limit));
  return {
    listings:rows,
    nextCursor:results.length>limit?rows.at(-1)?.id??null:null,
  };
}

/** An owner may reactivate ONLY an already-unpublished Service with the
 * exact same Listing ID and Category. This is NOT an upsert or a new Listing:
 * a stale, still-published, hidden/moderated, inactive-Category, disabled-owner,
 * non-worker, or foreign ID cannot be revived. All current guards are checked
 * inside one D1 UPDATE; no private status is projected back to the caller.
 */
export const RESUME_OWN_LISTING_QUERY =
  "UPDATE worker_listings AS wl SET status='published' " +
  "WHERE wl.id=? AND wl.worker_account_id=? AND wl.category_id=? " +
  "AND wl.status='unpublished' AND wl.moderation_status='allowed' " +
  "AND EXISTS(SELECT 1 FROM worker_profiles AS wp " +
  "JOIN accounts AS a ON a.id=wp.account_id " +
  "WHERE wp.account_id=wl.worker_account_id AND wp.status='draft' AND a.status='active') " +
  "AND EXISTS(SELECT 1 FROM categories AS c " +
  "WHERE c.id=wl.category_id AND c.is_active=1)";

export async function resumeOwnListing(
  db:D1Database,actor:string,id:string,expectedCategoryId:string,
):Promise<PublicListing|null> {
  if(!validOpaqueId(actor)||!validOpaqueId(id)||
      !validCategoryId(expectedCategoryId))return null;
  const {meta}=await db.prepare(RESUME_OWN_LISTING_QUERY)
    .bind(id,actor,expectedCategoryId).run();
  if(!changedExactlyOneOwnerListing(meta.changes))return null;
  return Object.freeze({id,categoryId:expectedCategoryId});
}

export async function unpublishListing(db:D1Database,actor:string,id:string):Promise<boolean> {
  if(!validOpaqueId(actor)||!validOpaqueId(id))return false;
  const {meta}=await db.prepare(UNPUBLISH_LISTING_QUERY).bind(id,actor).run();
  return changedExactlyOneOwnerListing(meta.changes);
}

/** Owner-scoped compare-and-swap of an existing Category-only service.
 * Never changes owner, public status, moderation or createdAt. A worker cannot
 * transfer a listing to another worker or use an inactive/nonreviewed Category.
 * A stale expected Category, duplicate own Category, hidden moderation, or
 * foreign ID all produce the SAME no-change result with no identity oracle.
 *
 * No new D1 columns (especially address, PII, price, experience or uploads).
 * The existing UNIQUE(worker_account_id,category_id) remains authoritative
 * during concurrent edits. A SQLite uniqueness race fails closed in the router.
 */
export const EDIT_OWN_CATEGORY_QUERY =
  "UPDATE worker_listings AS wl SET category_id=? " +
  "WHERE wl.id=? AND wl.worker_account_id=? AND wl.category_id=? " +
  "AND wl.moderation_status='allowed' " +
  "AND EXISTS(SELECT 1 FROM worker_profiles AS wp " +
  "JOIN accounts AS a ON a.id=wp.account_id " +
  "WHERE wp.account_id=wl.worker_account_id AND wp.status='draft' AND a.status='active') " +
  "AND EXISTS(SELECT 1 FROM categories AS c WHERE c.id=? AND c.is_active=1) " +
  "AND NOT EXISTS(SELECT 1 FROM worker_listings AS other " +
  "WHERE other.worker_account_id=wl.worker_account_id AND other.category_id=?)";

/** v2 exact-revision CAS, including ABA safety. Existing owner, moderation,
 * current active Category, UNIQUE(owner,Category) and expected Category
 * checks remain mandatory. The versioned route never falls back to v1.
 * An AFTER UPDATE trigger bumps revision even for old v1 or moderation writes.
 */
export const EDIT_OWN_CATEGORY_VERSIONED_QUERY =
  EDIT_OWN_CATEGORY_QUERY.replace(
    "AND NOT EXISTS(SELECT 1 FROM worker_listings AS other ",
    "AND wl.revision=? AND wl.revision<2147483647 "+
    "AND NOT EXISTS(SELECT 1 FROM worker_listings AS other "
  );

export async function editOwnListingCategoryVersioned(
  db:D1Database,actor:string,listingId:string,
  expectedCategoryId:string,nextCategoryId:string,expectedRevision:number,
):Promise<{id:string;categoryId:string;revision:number}|null> {
  if(!validOpaqueId(actor)||!validOpaqueId(listingId)||
    !validCategoryId(expectedCategoryId)||!validCategoryId(nextCategoryId)||
    expectedCategoryId===nextCategoryId||
    !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
    expectedRevision>=2147483647)return null;
  const {meta}=await db.prepare(EDIT_OWN_CATEGORY_VERSIONED_QUERY)
    .bind(nextCategoryId,listingId,actor,expectedCategoryId,
      nextCategoryId,expectedRevision,nextCategoryId).run();
  if(!changedExactlyOneOwnerListing(meta.changes))return null;
  // The declared migration trigger increments once for the Category change.
  // A subsequent cross-device write may advance it again; this response is
  // ONLY the version of our successful update, not a fresh current read.
  return Object.freeze({id:listingId,categoryId:nextCategoryId,
    revision:expectedRevision+1});
}

export async function editOwnListingCategory(
  db: D1Database, actor: string, listingId: string,
  expectedCategoryId: string, nextCategoryId: string,
): Promise<PublicListing | null> {
  if(!validOpaqueId(actor)||!validOpaqueId(listingId)||
      !validCategoryId(expectedCategoryId)||!validCategoryId(nextCategoryId)||
      expectedCategoryId===nextCategoryId) return null;
  const {meta}=await db.prepare(EDIT_OWN_CATEGORY_QUERY)
    .bind(nextCategoryId,listingId,actor,expectedCategoryId,nextCategoryId,nextCategoryId).run();
  if(!changedExactlyOneOwnerListing(meta.changes)) return null;
  return Object.freeze({id:listingId,categoryId:nextCategoryId});
}
