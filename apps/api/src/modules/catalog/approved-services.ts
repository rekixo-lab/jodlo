import type {D1Database} from "../../data/d1.ts";
import type {CatalogLanguage} from "./catalog.ts";
import {validCategoryId} from "../shared/identifiers.ts";

export type ApprovedServiceOptions=Readonly<{categoryId:string;language:CatalogLanguage;limit:number;after:string|null}>;
export type ApprovedServicePage=Readonly<{categoryId:string;language:CatalogLanguage;items:readonly {id:string;name:string}[];nextCursor:string|null}>;
/** Shared by public service options and Category search; alias s is local SQL. */
export const APPROVED_SERVICE_HIERARCHY_SQL=
  "EXISTS(SELECT 1 FROM catalog_family_categories m JOIN catalog_families f ON f.id=m.family_id JOIN catalog_groups g ON g.id=f.group_id " +
  "WHERE m.category_id=s.category_id AND m.is_approved=1 AND f.is_approved=1 AND f.is_active=1 AND g.is_approved=1 AND g.is_active=1)";
/** Reviewed service labels are suggestions, never proof of Worker supply. */
export function parseApprovedServices(params:URLSearchParams):ApprovedServiceOptions|null{
  const allowed=new Set(["categoryId","lang","limit","after"]);
  let invalid=false;
  params.forEach((_value,key)=>{if(!allowed.has(key)||params.getAll(key).length!==1)invalid=true;});
  if(invalid)return null;
  const categoryId=params.get("categoryId"),language=params.get("lang"),raw=params.get("limit");
  const after=params.get("after");
  if(!validCategoryId(categoryId)||(language!=="hi"&&language!=="en")||raw===null||!/^(?:[1-9]|1\d|2[0-5])$/.test(raw)||
      after!==null&&(!/^jodlo_s_[a-z0-9_]{2,56}$/.test(after)||after.length>64))return null;
  return {categoryId:categoryId!,language,limit:Number(raw),after};
}
export async function readApprovedServices(db:D1Database,o:ApprovedServiceOptions):Promise<ApprovedServicePage>{
  if(!parseApprovedServices(new URLSearchParams({categoryId:o.categoryId,lang:o.language,limit:String(o.limit),...(o.after===null?{}:{after:o.after})})))throw Error("Invalid service scope");
  const cursor=o.after??"";
  // Hierarchy, Category, service and cursor eligibility share one D1 snapshot.
  // Import approvals/source IDs/journal, Worker identities and counts stay private.
  const sql="WITH visible AS (SELECT s.id,CASE WHEN ?='hi' THEN s.name_hi ELSE s.name_en END AS name " +
    "FROM catalog_services s JOIN categories c ON c.id=s.category_id WHERE s.category_id=? AND s.is_active=1 AND c.is_active=1 " +
    "AND "+APPROVED_SERVICE_HIERARCHY_SQL+") " +
    "SELECT id,name FROM visible WHERE (?='' OR EXISTS(SELECT 1 FROM visible anchor WHERE anchor.id=?)) AND (?='' OR id>?) ORDER BY id LIMIT ?";
  const {results}=await db.prepare(sql).bind(o.language,o.categoryId,cursor,cursor,cursor,cursor,o.limit+1).all<{id:string;name:string}>();
  const selected=results.slice(0,o.limit);
  return {categoryId:o.categoryId,language:o.language,items:selected.map(({id,name})=>({id,name})),nextCursor:results.length>o.limit?selected.at(-1)?.id??null:null};
}
