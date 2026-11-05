import type { D1Database } from "../../data/d1.ts";
import { validCategoryId } from "../shared/identifiers.ts";
import { PUBLIC_LISTING_ELIGIBILITY } from "../workers/listings.ts";
import type { CatalogLanguage } from "./catalog.ts";

/** An opt-in public-only hierarchy over *independently* approved metadata.
 * All three new tables are empty/default OFF. A reviewed assignment by itself
 * cannot publish a Category; the original Category active gate still applies.
 */
export type HierarchyLevel = "groups" | "families" | "categories";
export type HierarchyOptions = Readonly<{
  level: HierarchyLevel;
  language: CatalogLanguage;
  parentId: string | null;
  availableOnly: boolean;
  limit: number;
  after: string | null;
}>;
export type HierarchyItem = Readonly<{ id: string; name: string; slug?: string }>;

export function parseHierarchy(params: URLSearchParams): HierarchyOptions | null {
  const permitted=new Set(["level","lang","parentId","availableOnly","limit","after"]);
  for(const key of params.keys()) {
    if(!permitted.has(key) || params.getAll(key).length!==1)return null;
  }
  const level=params.get("level");
  if(level!=="groups" && level!=="families" && level!=="categories")return null;
  const language=params.get("lang");
  if(language!=="hi" && language!=="en")return null;
  const size=params.get("limit");
  if(size===null || !/^(?:[1-9]|1[0-9]|2[0-5])$/.test(size))return null;
  const available=params.get("availableOnly");
  if(available!==null && available!=="1")return null;
  const parentId=params.get("parentId");
  if(level==="groups" ? parentId!==null : !validCategoryId(parentId))return null;
  const after=params.get("after");
  if(after!==null && !validCategoryId(after))return null;
  return {level,language,parentId,availableOnly:available==="1",limit:Number(size),after};
}

/** A correlated EXISTS with the *same* current listing eligibility used by
 * existing Category and Listing browsing. Never reveal owner ID or counts.
 * The outer approved current Category is named 'cat'; inside 'c' is the
 * independently joined listing Category used by shared eligibility SQL.
 */
const listingExists = "EXISTS (SELECT 1 FROM worker_listings AS wl " +
  "JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id " +
  "JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.category_id=cat.id AND " + PUBLIC_LISTING_ELIGIBILITY + ")";

const approvedDescendant =
  " FROM catalog_families AS f " +
  "JOIN catalog_family_categories AS m ON m.family_id=f.id " +
  "JOIN categories AS cat ON cat.id=m.category_id " +
  "WHERE f.group_id=g.id AND f.is_active=1 AND f.is_approved=1 " +
  "AND m.is_approved=1 AND cat.is_active=1 ";

const approvedCategory =
  " FROM catalog_family_categories AS m " +
  "JOIN categories AS cat ON cat.id=m.category_id " +
  "WHERE m.family_id=f.id AND m.is_approved=1 AND cat.is_active=1 ";

function hierarchySql(level:HierarchyLevel, availableOnly:boolean):string {
  const availability=availableOnly ? " AND "+listingExists : "";
  const display=(alias:string)=>"CASE WHEN ?='hi' THEN COALESCE(NULLIF("+alias+
    ".name_hi,''),"+alias+".name_en) ELSE "+alias+".name_en END AS name";
  let select:string;
  if(level==="groups") {
    select="SELECT g.id, "+display("g")+", NULL AS slug FROM catalog_groups AS g " +
      "WHERE g.is_active=1 AND g.is_approved=1 " +
      "AND EXISTS (SELECT 1"+approvedDescendant+availability+")";
  }else if(level==="families") {
    select="SELECT f.id, "+display("f")+", NULL AS slug FROM catalog_families AS f " +
      "JOIN catalog_groups AS g ON g.id=f.group_id " +
      "WHERE f.group_id=? AND f.is_active=1 AND f.is_approved=1 " +
      "AND g.is_active=1 AND g.is_approved=1 " +
      "AND EXISTS (SELECT 1"+approvedCategory+availability+")";
  }else {
    select="SELECT cat.id, "+display("cat")+", cat.slug AS slug " +
      "FROM catalog_family_categories AS m " +
      "JOIN categories AS cat ON cat.id=m.category_id " +
      "JOIN catalog_families AS f ON f.id=m.family_id " +
      "JOIN catalog_groups AS g ON g.id=f.group_id " +
      "WHERE m.family_id=? AND m.is_approved=1 AND cat.is_active=1 " +
      "AND f.is_active=1 AND f.is_approved=1 " +
      "AND g.is_active=1 AND g.is_approved=1 "+availability;
  }
  // One SQL snapshot for source eligibility, anchor revalidation and page.
  // A previously approved but since-disabled anchor cannot skip new rows.
  return "WITH visible AS ("+select+") SELECT id,name,slug FROM visible " +
    "WHERE (?='' OR EXISTS(SELECT 1 FROM visible AS anchor WHERE anchor.id=?)) " +
    "AND (?='' OR id>?) ORDER BY id ASC LIMIT ?";
}

export async function readApprovedHierarchy(db:D1Database, options:HierarchyOptions):
  Promise<{language:CatalogLanguage;level:HierarchyLevel;parentId:string|null;
    items:HierarchyItem[];nextCursor:string|null}> {
  const {level,language,parentId,availableOnly,after,limit}=options;
  if(limit<1 || limit>25 || (level==="groups" ? parentId!==null : !validCategoryId(parentId)) ||
    (after!==null && !validCategoryId(after)))throw new Error("Invalid hierarchy scope");
  const cursor=after??"";
  const binds:(string|number)[]=[language];
  if(level!=="groups")binds.push(parentId!);
  binds.push(cursor,cursor,cursor,cursor,limit+1);
  const {results}=await db.prepare(hierarchySql(level,availableOnly))
    .bind(...binds).all<{id:string;name:string;slug:string|null}>();
  const selected=results.slice(0,limit);
  return {
    level,language,parentId,
    items:selected.map(({id,name,slug})=>
      level==="categories" ? {id,name,slug:slug!} : {id,name}),
    nextCursor:results.length>limit ? selected[selected.length-1]?.id??null : null,
  };
}
