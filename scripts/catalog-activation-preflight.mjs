/**
 * Source-pinned, local-only ALL-CATEGORY activation REVIEW PREFLIGHT.
 * No permissions, acceptance, D1 seeding, deploy or live Search import.
 * This script must never be imported by the Cloudflare Worker.
 */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedLegacyReview,assertPinnedReview} from "./legacy-category-review.mjs";

const SOURCE="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const REQUEST="JODLO_CATALOG_EXPANSION_DRAFT_ONLY";
const STATE="M005_PENDING_NO_CATEGORY_APPROVAL_NO_SEED";
const OUTPUT="JODLO_CATALOG_ACTIVATION_PREFLIGHT_REVIEW_ONLY";
const NEVER="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW";
const MANDATORY=[
  "FOUNDER_M005_CATEGORY_ACTIVATION_PENDING",
  "HUMAN_OCCUPATIONAL_SAFETY_REVIEW_PENDING",
  "HUMAN_HINDI_ENGLISH_LABEL_REVIEW_PENDING",
  "JODLO_ID_AND_SLUG_MAPPING_REVIEW_PENDING",
];
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function exactKeys(value,keys){
  return value && typeof value==="object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|")===keys.slice().sort().join("|");
}
function getIndex(report){
  if(report?.kind!=="JODLO_LEGACY_CATEGORY_REVIEW_ONLY" ||
     report.state!=="NO_APPROVAL_NO_D1_SEED" ||
     report.sourceJsonSha256!==SOURCE ||
     JSON.stringify(report.languages)!=='["en","hi"]' ||
     !Array.isArray(report.categories) || report.categories.length>889)
    throw Error("Untrusted legacy category review source");
  const indexed=new Map();
  for(const row of report.categories){
    if(!row || typeof row.categoryId!=="string" || !row.categoryId ||
       indexed.has(row.categoryId) ||
       row.reviewState!=="UNAPPROVED_HUMAN_SAFETY_AND_LANGUAGE_REVIEW_REQUIRED" ||
       !Array.isArray(row.flags) ||
       !row.flags.every(flag=>typeof flag==="string") ||
       !["groupId","familyId","name_en","name_hi","historicalSafetyTier"]
         .every(key=>typeof row[key]==="string" && row[key].trim()) ||
       !Number.isInteger(row.sourceServiceCount) || row.sourceServiceCount<0) {
      throw Error("Unsafe or repeated source review row");
    }
    indexed.set(row.categoryId,row);
  }
  return indexed;
}

/** Creates a no-approval DRAFT for any exact set of historical IDs.
 * Crucially, including ALL 889 does not skip the invalid old Unicode ID:
 * it is included *with a mapping blocker*, not silently excluded/renamed.
 */
export function makeCatalogExpansionDraft(report,sourceIds){
  const source=getIndex(report);
  if(!Array.isArray(sourceIds)||sourceIds.length<1 ||
     sourceIds.length>source.size ||
     new Set(sourceIds).size!==sourceIds.length ||
     !sourceIds.every(id=>typeof id==="string"&&source.has(id)))
    throw Error("Unknown, duplicated or empty historical Category selection");
  return {
    kind:REQUEST,state:STATE,
    sourceJsonSha256:SOURCE,languages:["en","hi"],
    sourceCategoryIds:sourceIds.slice().sort(cmp),
  };
}
export function reviewCatalogExpansionDraft(report,draft){
  const source=getIndex(report);
  if(!exactKeys(draft,[
    "kind","state","sourceJsonSha256","languages","sourceCategoryIds",
  ]) || draft.kind!==REQUEST || draft.state!==STATE ||
     draft.sourceJsonSha256!==SOURCE ||
     JSON.stringify(draft.languages)!=='["en","hi"]' ||
     !Array.isArray(draft.sourceCategoryIds) ||
     draft.sourceCategoryIds.length<1 ||
     draft.sourceCategoryIds.length>source.size ||
     new Set(draft.sourceCategoryIds).size!==draft.sourceCategoryIds.length ||
     !draft.sourceCategoryIds.every(id=>typeof id==="string"&&source.has(id)) ||
     draft.sourceCategoryIds.slice().sort(cmp).join("\u0000")!==
       draft.sourceCategoryIds.join("\u0000")){
    throw Error("Invalid or unauthorized category-expansion DRAFT");
  }
  const counts={},items=[],scopeIds=new Set();
  for(const id of draft.sourceCategoryIds){
    const row=source.get(id);
    const flags=[...new Set(row.flags)].sort(cmp);
    for(const flag of flags)counts[flag]=(counts[flag]??0)+1;
    scopeIds.add(row.groupId);
    items.push({
      sourceCategoryId:id,
      sourceGroupId:row.groupId,
      sourceFamilyId:row.familyId,
      historicalNameEn:row.name_en,
      historicalNameHi:row.name_hi,
      historicalSafetyTier:row.historicalSafetyTier,
      sourceServiceCount:row.sourceServiceCount,
      sourceReviewFlags:flags,
      mandatoryHumanAndFounderGates:MANDATORY.slice(),
      reviewState:NEVER,
    });
  }
  return {
    kind:OUTPUT,state:"ZERO_APPROVAL_ZERO_SQL_ZERO_D1_MUTATION",
    sourceJsonSha256:SOURCE,languages:["en","hi"],
    summary:{
      requestedHistoricalCategories:items.length,
      historicalGroupsRepresented:scopeIds.size,
      sourceFlaggedCategories:items.filter(x=>x.sourceReviewFlags.length>0).length,
      categoriesStillNeedingFounderDecision:items.length,
      categoriesAuthorizedForActivation:0,
      diagnosticFlags:counts,
    },
    categories:items,
  };
}
export function verifyCatalogExpansionPreflight(report,out){
  if(!exactKeys(out,[
    "kind","state","sourceJsonSha256","languages","summary","categories",
  ]) || out.kind!==OUTPUT ||
     out.state!=="ZERO_APPROVAL_ZERO_SQL_ZERO_D1_MUTATION" ||
     out.sourceJsonSha256!==SOURCE ||
     JSON.stringify(out.languages)!=='["en","hi"]' ||
     !Array.isArray(out.categories) ||
     out.summary?.requestedHistoricalCategories!==out.categories.length ||
     out.summary.categoriesStillNeedingFounderDecision!==out.categories.length ||
     out.summary.categoriesAuthorizedForActivation!==0 ||
     out.categories.some(row=>
       !exactKeys(row,[
         "sourceCategoryId","sourceGroupId","sourceFamilyId",
         "historicalNameEn","historicalNameHi","historicalSafetyTier",
         "sourceServiceCount","sourceReviewFlags",
         "mandatoryHumanAndFounderGates","reviewState",
       ]) || row.reviewState!==NEVER ||
       JSON.stringify(row.mandatoryHumanAndFounderGates)!==
         JSON.stringify(MANDATORY))) {
    throw Error("Preflight appears to grant activation or lose mandatory gates");
  }
  const candidate=makeCatalogExpansionDraft(report,out.categories.map(x=>x.sourceCategoryId));
  const expected=reviewCatalogExpansionDraft(report,candidate);
  if(JSON.stringify(expected)!==JSON.stringify(out))
    throw Error("Preflight diverges from immutable source review");
}
export function loadPinnedExpansionPreflight(){
  const report=loadPinnedLegacyReview();
  assertPinnedReview(report);
  const draft=makeCatalogExpansionDraft(report,
    report.categories.map(row=>row.categoryId));
  const preflight=reviewCatalogExpansionDraft(report,draft);
  verifyCatalogExpansionPreflight(report,preflight);
  if(preflight.summary.requestedHistoricalCategories!==889 ||
     preflight.summary.categoriesAuthorizedForActivation!==0)
    throw Error("Full 889 review boundary changed");
  return preflight;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??"--check";
  if(!["--check","--summary","--json"].includes(mode)||process.argv.length>3)
    throw Error("Usage: node scripts/catalog-activation-preflight.mjs [--check|--summary|--json]");
  const result=loadPinnedExpansionPreflight();
  if(mode==="--json")process.stdout.write(JSON.stringify(result,null,2)+"\n");
  else if(mode==="--summary")process.stdout.write(JSON.stringify(result.summary,null,2)+"\n");
  else console.log("JODLO 889-category rollout PREFLIGHT: 889 queued, ZERO activated; "+
    "M-005 founder, occupational safety, bilingual labels and JODLO IDs all pending.");
}
