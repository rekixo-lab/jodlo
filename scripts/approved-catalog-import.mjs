/**
 * Operator catalog preparation. NEVER contacts Cloudflare or imports the
 * historical archive. A supplied, human-reviewed manifest is the only input.
 *
 * --scope-hash FILE: hash a draft for review (does not approve it)
 * --dry-run FILE [--database LOCAL_BACKUP.sqlite]: rehearse in an isolated copy
 * --sql stage|publish|reverse FILE: emit reviewable D1 SQL, never execute it
 *
 * The reviewer links are validated structurally, not authenticated offline.
 * An operator must verify their authorship/content before using generated SQL.
 * D1 file imports are transactional; do not execute this plan statement by
 * statement. D1 rejects explicit BEGIN/COMMIT in an import file.
 * https://developers.cloudflare.com/d1/best-practices/import-export-data/
 */
import {createHash} from "node:crypto";
import {readFileSync,readdirSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {DatabaseSync,backup} from "node:sqlite";
import {validJodloReviewUrl} from "./review-evidence-url.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const CATALOG_MANIFEST_KIND="JODLO_REVIEWED_CATALOG_V1";
const collections=["groups","families","categories","services"];
const singular={groups:"group",families:"family",categories:"category",services:"service"};
const tables={group:"catalog_groups",family:"catalog_families",category:"categories",service:"catalog_services"};
const prefixes={group:"jodlo_g_",family:"jodlo_f_",category:"jodlo_c_",service:"jodlo_s_"};
const MAX_BYTES=1_048_576;
const HASH=/^[a-f0-9]{64}$/;
const forbiddenText=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const exact=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
const hash=v=>createHash("sha256").update(typeof v==="string"?v:canonical(v)).digest("hex");
export function canonical(v){
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object")return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  return JSON.stringify(v);
}
function requireText(v,max,label){
  if(typeof v!=="string"||v!==v.trim()||!v||[...v].length>max||forbiddenText.test(v))throw Error("Invalid "+label);
}
function requireHash(v,label){if(typeof v!=="string"||!HASH.test(v)||/^0+$/.test(v))throw Error("Invalid "+label);}
function requireId(v,kind){
  if(typeof v!=="string"||v.length>64||!v.startsWith(prefixes[kind])||!/^[a-z0-9_]+$/.test(v)||v.length<prefixes[kind].length+2)
    throw Error("Use remapped JODLO "+kind+" IDs");
}
function scope(manifest){
  if(!exact(manifest,["kind","batchId","sourceSha256",...collections,"approvals"])||manifest.kind!==CATALOG_MANIFEST_KIND||
      !/^jodlo-[a-z0-9][a-z0-9-]{1,56}$/.test(manifest.batchId))throw Error("Invalid reviewed catalog manifest");
  requireHash(manifest.sourceSha256,"source digest");
  const limits={groups:32,families:100,categories:100,services:1000};
  const index={};
  for(const collection of collections){
    const rows=manifest[collection],kind=singular[collection];
    if(!Array.isArray(rows)||rows.length<1||rows.length>limits[collection])throw Error("Bounded nonempty "+collection+" required");
    index[kind]=new Map();
    for(const row of rows){
      const keys=["id","mode","sourceId","nameEn","nameHi",...(kind==="family"?["groupId"]:kind==="category"?["familyId","slug","sortOrder"]:kind==="service"?["categoryId"]:[])];
      if(!exact(row,keys)||!["create","reference"].includes(row.mode)||kind==="service"&&row.mode!=="create")throw Error("Invalid "+kind+" mapping");
      requireId(row.id,kind);requireText(row.sourceId,160,"source reference");
      requireText(row.nameEn,120,"English label");requireText(row.nameHi,120,"Hindi label");
      if(!/[A-Za-z]/u.test(row.nameEn)||!/[\u0900-\u097f]/u.test(row.nameHi))throw Error("English and Hindi reviewed labels required");
      if(row.sourceId===row.id||index[kind].has(row.id))throw Error("Duplicate or unremapped "+kind+" ID");
      if(kind==="category"&&(!/^[a-z][a-z0-9-]{1,63}$/.test(row.slug)||!Number.isSafeInteger(row.sortOrder)||row.sortOrder<0||row.sortOrder>1_000_000))throw Error("Invalid category slug/order");
      index[kind].set(row.id,row);
    }
  }
  for(const f of manifest.families)if(!index.group.has(f.groupId))throw Error("Unreviewed family parent");
  for(const c of manifest.categories)if(!index.family.has(c.familyId))throw Error("Unreviewed category parent");
  for(const s of manifest.services)if(!index.category.has(s.categoryId))throw Error("Unreviewed service parent");
  for(const g of manifest.groups)if(!manifest.families.some(f=>f.groupId===g.id))throw Error("Orphan group");
  for(const f of manifest.families)if(!manifest.categories.some(c=>c.familyId===f.id))throw Error("Orphan family");
  for(const c of manifest.categories)if(!manifest.services.some(s=>s.categoryId===c.id))throw Error("Category requires reviewed services");
  if(new Set(manifest.categories.map(c=>c.slug)).size!==manifest.categories.length)throw Error("Duplicate category slug");
  // Independent batches can add services to existing approved categories via
  // explicit references; reference rows are checked but never mutated.
  const normalized={kind:manifest.kind,batchId:manifest.batchId,sourceSha256:manifest.sourceSha256};
  for(const c of collections)normalized[c]=manifest[c].map(r=>({...r})).sort((a,b)=>a.id.localeCompare(b.id,"en"));
  if(Buffer.byteLength(canonical(normalized))>MAX_BYTES)throw Error("Catalog manifest too large");
  return normalized;
}
export function catalogScopeHash(manifest){return hash(scope(manifest));}
export function validateApprovedCatalog(manifest,{now=Date.now()}={}){
  const normalized=scope(manifest),scopeSha256=hash(normalized);
  if(!exact(manifest.approvals,["owner","bilingual","occupational"]))throw Error("Owner, bilingual and occupational evidence all required");
  for(const role of ["owner","bilingual","occupational"]){
    const a=manifest.approvals[role];
    if(!exact(a,["reviewer","decision","scopeSha256","reviewedAt","evidenceUrl"])||
       a.decision!=="approve_publication"||a.scopeSha256!==scopeSha256||
       !validJodloReviewUrl(a.evidenceUrl))throw Error("Missing or scope-mismatched "+role+" approval");
    requireText(a.reviewer,80,role+" reviewer");
    if(role==="owner"&&a.reviewer!=="rekixo-lab")throw Error("Repository owner approval required");
    if(typeof a.reviewedAt!=="string"||!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(a.reviewedAt)||
       !Number.isFinite(Date.parse(a.reviewedAt))||new Date(a.reviewedAt).toISOString()!==a.reviewedAt||Date.parse(a.reviewedAt)>now)
      throw Error("Invalid or future review timestamp");
  }
  return {manifest:{...normalized,approvals:structuredClone(manifest.approvals)},scopeSha256,approvalSha256:hash(manifest.approvals)};
}
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const assertSql=(condition,label)=>`SELECT CASE WHEN (${condition}) THEN 1 ELSE json('CATALOG_ASSERTION_FAILED') END AS ${q(label)};`;
function targetFields(kind,row){
  return {id:row.id,name_en:row.nameEn,name_hi:row.nameHi,
    ...(kind==="family"?{group_id:row.groupId}:kind==="category"?{slug:row.slug,sort_order:row.sortOrder}:kind==="service"?{category_id:row.categoryId}:{})};
}
function equality(fields,alias="t") {return Object.entries(fields).map(([k,v])=>`${alias}.${k}=${typeof v==="number"?v:q(v)}`).join(" AND ");}
function activeCondition(kind,active,alias="t"){
  return `${alias}.is_active=${active}`+(["group","family"].includes(kind)?` AND ${alias}.is_approved=${active}`:"");
}
function rowCount(manifest){return collections.reduce((n,c)=>n+manifest[c].length,0);}
export function catalogSql(manifest,operation,options={}){
  if(!["stage","publish","reverse"].includes(operation))throw Error("Expected stage, publish or reverse");
  const checked=validateApprovedCatalog(manifest,options),m=checked.manifest;
  const b=q(m.batchId),scopeHash=q(checked.scopeSha256),approvalHash=q(checked.approvalSha256);
  const batch=`SELECT 1 FROM catalog_import_batches WHERE batch_id=${b} AND scope_sha256=${scopeHash} AND approval_sha256=${approvalHash}`;
  const state=`(SELECT state FROM catalog_import_batches WHERE batch_id=${b})`;
  const active=`CASE WHEN ${state}='published' THEN 1 ELSE 0 END`;
  const statements=[`-- JODLO reviewed catalog ${operation}; batch ${m.batchId}; scope ${checked.scopeSha256}`,
    "-- No credentials or production requests. Apply the entire file atomically with D1 execute --file.",
    "-- Reviewer references require independent operator verification; this SQL is not approval authentication."];
  if(operation==="stage"){
    statements.push(assertSql(`NOT EXISTS(SELECT 1 FROM catalog_import_batches WHERE batch_id=${b}) OR EXISTS(${batch} AND state IN ('staged','published'))`,"batch_hash_or_state"));
  }else{
    statements.push(assertSql(`EXISTS(${batch}${operation==="publish"?" AND state IN ('staged','published')":""})`,"batch_hash_or_state"));
    statements.push(assertSql(`(SELECT count(*) FROM catalog_import_entries WHERE batch_id=${b})=${rowCount(m)}`,"complete_import_journal"));
  }
  for(const collection of collections)for(const row of m[collection]){
    const kind=singular[collection],table=tables[kind],fields=targetFields(kind,row);
    const entry=`SELECT 1 FROM catalog_import_entries WHERE batch_id=${b} AND entity_kind=${q(kind)} AND entity_id=${q(row.id)} AND record_sha256=${q(hash(row))} AND is_owned=${row.mode==="create"?1:0}`;
    const visible=row.mode==="reference"?"1":active;
    const matching=`EXISTS(SELECT 1 FROM ${table} AS t WHERE ${equality(fields)} AND ${activeCondition(kind,visible)})`;
    const member=kind==="category"?` AND EXISTS(SELECT 1 FROM catalog_family_categories WHERE family_id=${q(row.familyId)} AND category_id=${q(row.id)} AND is_approved=${visible})`:"";
    if(operation==="stage"&&row.mode==="create"){
      statements.push(assertSql(`NOT EXISTS(SELECT 1 FROM ${table} WHERE id=${q(row.id)}) OR (EXISTS(${entry}) AND ${matching}${member})`,kind+"_collision_or_drift"));
    }else{
      statements.push(assertSql(`${matching}${member}`+(operation!=="stage"?` AND EXISTS(${entry})`:""),kind+"_reviewed_state"));
    }
  }
  if(operation==="stage"){
    statements.push(`INSERT INTO catalog_import_batches(batch_id,scope_sha256,approval_sha256,owner_evidence_url) VALUES(${b},${scopeHash},${approvalHash},${q(m.approvals.owner.evidenceUrl)}) ON CONFLICT(batch_id) DO NOTHING;`);
    for(const collection of collections)for(const row of m[collection]){
      const kind=singular[collection],fields=targetFields(kind,row);
      if(row.mode==="create"){
        statements.push(`INSERT INTO ${tables[kind]}(${Object.keys(fields).join(",")}) VALUES(${Object.values(fields).map(v=>typeof v==="number"?v:q(v)).join(",")}) ON CONFLICT(id) DO NOTHING;`);
        if(kind==="category")statements.push(`INSERT INTO catalog_family_categories(family_id,category_id) VALUES(${q(row.familyId)},${q(row.id)}) ON CONFLICT(family_id,category_id) DO NOTHING;`);
      }
      statements.push(`INSERT INTO catalog_import_entries(batch_id,entity_kind,entity_id,record_sha256,is_owned) VALUES(${b},${q(kind)},${q(row.id)},${q(hash(row))},${row.mode==="create"?1:0}) ON CONFLICT(batch_id,entity_kind,entity_id) DO NOTHING;`);
    }
  }else{
    if(operation==="reverse"){
      // A later batch may reference these parents. Reversing the parent must
      // never silently unpublish the descendant batch.
      statements.push(assertSql(`NOT EXISTS(SELECT 1 FROM catalog_import_entries own JOIN catalog_import_entries dep ON own.entity_kind=dep.entity_kind AND own.entity_id=dep.entity_id JOIN catalog_import_batches other ON other.batch_id=dep.batch_id WHERE own.batch_id=${b} AND own.is_owned=1 AND dep.batch_id<>${b} AND other.state<>'reversed')`,"dependent_batches"));
      for(const g of m.groups.filter(r=>r.mode==="create"))statements.push(assertSql(`NOT EXISTS(SELECT 1 FROM catalog_families f WHERE f.group_id=${q(g.id)} AND (f.is_active=1 OR f.is_approved=1) AND NOT EXISTS(SELECT 1 FROM catalog_import_entries e WHERE e.batch_id=${b} AND e.entity_kind='family' AND e.entity_id=f.id AND e.is_owned=1))`,"foreign_family"));
      for(const f of m.families.filter(r=>r.mode==="create"))statements.push(assertSql(`NOT EXISTS(SELECT 1 FROM catalog_family_categories c JOIN categories cat ON cat.id=c.category_id WHERE c.family_id=${q(f.id)} AND (cat.is_active=1 OR c.is_approved=1) AND NOT EXISTS(SELECT 1 FROM catalog_import_entries e WHERE e.batch_id=${b} AND e.entity_kind='category' AND e.entity_id=c.category_id AND e.is_owned=1))`,"foreign_category"));
      for(const c of m.categories.filter(r=>r.mode==="create"))statements.push(assertSql(`NOT EXISTS(SELECT 1 FROM catalog_services s WHERE s.category_id=${q(c.id)} AND s.is_active=1 AND NOT EXISTS(SELECT 1 FROM catalog_import_entries e WHERE e.batch_id=${b} AND e.entity_kind='service' AND e.entity_id=s.id AND e.is_owned=1))`,"foreign_service"));
    }
    const enabled=operation==="publish"?1:0;
    for(const collection of collections)for(const row of m[collection].filter(r=>r.mode==="create")){
      const kind=singular[collection];
      statements.push(`UPDATE ${tables[kind]} SET is_active=${enabled}${["group","family"].includes(kind)?`,is_approved=${enabled}`:""} WHERE id=${q(row.id)};`);
      if(kind==="category")statements.push(`UPDATE catalog_family_categories SET is_approved=${enabled} WHERE family_id=${q(row.familyId)} AND category_id=${q(row.id)};`);
    }
    statements.push(`UPDATE catalog_import_batches SET state='${operation==="publish"?"published":"reversed"}',${operation==="publish"?"published_at":"reversed_at"}=COALESCE(${operation==="publish"?"published_at":"reversed_at"},strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE batch_id=${b};`);
  }
  for(const sql of statements)if(Buffer.byteLength(sql)>90_000)throw Error("SQL statement exceeds bounded D1 budget");
  return statements.join("\n")+"\n";
}
export function runCatalogTransaction(db,sql){
  db.exec("BEGIN IMMEDIATE");
  try{db.exec(sql);db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;}
}
export async function rehearseCatalog(manifest,{databasePath=null,now=Date.now()}={}){
  validateApprovedCatalog(manifest,{now});
  const dir=mkdtempSync(join(tmpdir(),"jodlo-catalog-rehearsal-"));let db;
  try{
    const copy=join(dir,"isolated.sqlite");
    if(databasePath){
      // SQLite's backup API reads a consistent snapshot, including WAL state.
      // Never copy a live SQLite file with fs.copyFile or open it writable.
      const source=new DatabaseSync(resolve(databasePath),{readOnly:true});
      try{await backup(source,copy);}finally{source.close();}
    }
    db=new DatabaseSync(copy);db.exec("PRAGMA foreign_keys=ON");
    if(!databasePath)for(const file of readdirSync(join(ROOT,"infra/migrations")).filter(p=>p.endsWith(".sql")).sort())db.exec(readFileSync(join(ROOT,"infra/migrations",file),"utf8"));
    for(const step of ["stage","stage","publish","publish","reverse","reverse"])runCatalogTransaction(db,catalogSql(manifest,step,{now}));
    if(db.prepare("PRAGMA foreign_key_check").all().length||db.prepare("PRAGMA quick_check").get().quick_check!=="ok")throw Error("Catalog rehearsal integrity check failed");
    return {kind:"JODLO_CATALOG_LOCAL_REHEARSAL",batchId:manifest.batchId,scopeSha256:catalogScopeHash(manifest),
      checked:["stage","idempotent-stage","publish","idempotent-publish","reverse-without-deletion","idempotent-reverse"],
      categories:manifest.categories.length,services:manifest.services.length,
      target:databasePath?"isolated-backup-copy":"empty-local-migration-fixture",productionChanges:0,
      evidenceAuthentication:"MANUAL_REVIEW_REQUIRED",readyToDeploy:false};
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
}
function readManifest(path){
  const raw=readFileSync(path);if(raw.length>MAX_BYTES)throw Error("Manifest file too large");
  return JSON.parse(raw.toString("utf8"));
}
export function catalogManifestTemplate(){
  const common={id:"",mode:"create",sourceId:"",nameEn:"",nameHi:""};
  return {kind:CATALOG_MANIFEST_KIND,batchId:"",sourceSha256:"",groups:[{...common}],families:[{...common,groupId:""}],
    categories:[{...common,familyId:"",slug:"",sortOrder:0}],services:[{...common,categoryId:""}],
    approvals:Object.fromEntries(["owner","bilingual","occupational"].map(role=>[role,{reviewer:role==="owner"?"rekixo-lab":"",decision:"",scopeSha256:"",reviewedAt:"",evidenceUrl:""}]))};
}
async function main(args){
  if(args.length===1&&args[0]==="--template")return console.log(JSON.stringify(catalogManifestTemplate(),null,2));
  if(args.length===2&&args[0]==="--scope-hash")return console.log(catalogScopeHash(readManifest(args[1])));
  if(args[0]==="--sql"&&args.length===3)return process.stdout.write(catalogSql(readManifest(args[2]),args[1]));
  if(args[0]==="--dry-run"&&(args.length===2||args.length===4&&args[2]==="--database"))return console.log(JSON.stringify(await rehearseCatalog(readManifest(args[1]),{databasePath:args[3]??null}),null,2));
  throw Error("Use --template, --scope-hash MANIFEST, --dry-run MANIFEST [--database LOCAL_BACKUP], or --sql stage|publish|reverse MANIFEST");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{
  process.stderr.write("JODLO catalog preflight failed. Check manifest schema, scope-bound reviews, database state and manual evidence; no remote action was performed.\n");process.exitCode=1;
});
