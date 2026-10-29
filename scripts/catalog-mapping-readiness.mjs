/**
 * JODLO ADR-0011: offline ALL-889 Category ID/slug/label compatibility review.
 * Strictly NON-AUTHORIZING. Never import this in the Worker/Android bundle,
 * D1 migrations, activation tools or a public search index.
 *
 * Current D1 source of truth: infra/migrations/0001_public_catalog.sql.
 * An identical source identifier is a syntax-only candidate, not a final ID.
 */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedExpansionPreflight} from "./catalog-activation-preflight.mjs";

const SOURCE_SHA="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const KIND="JODLO_ALL_CATEGORY_MAPPING_COMPATIBILITY_REVIEW_ONLY";
const STATE="ALL_CATEGORIES_UNAPPROVED_NO_SQL_NO_SEED";
const ROW_STATE="HUMAN_ID_SLUG_LABEL_AND_SAFETY_REVIEW_REQUIRED";
const ID=/^[A-Za-z0-9_-]{1,64}$/u;
const SLUG=/^[a-z][a-z0-9-]{1,63}$/u;
const LATIN=/[A-Za-z]/u;
const CONTROL=/[\u0000-\u001f\u007f-\u009f]/u;
const GATES=[
  "FOUNDER_M005_CATEGORY_ACTIVATION_PENDING",
  "HUMAN_OCCUPATIONAL_SAFETY_REVIEW_PENDING",
  "HUMAN_HINDI_ENGLISH_LABEL_REVIEW_PENDING",
  "JODLO_ID_AND_SLUG_MAPPING_REVIEW_PENDING",
];
const INPUT_KEYS=[
  "sourceCategoryId","sourceGroupId","sourceFamilyId","historicalNameEn",
  "historicalNameHi","historicalSafetyTier","sourceServiceCount",
  "sourceReviewFlags","mandatoryHumanAndFounderGates","reviewState",
];
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function exact(v,keys) {
  return v!==null&&typeof v==="object"&&!Array.isArray(v)&&
    Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
}
function labelIssues(name,locale) {
  const issues=[];
  if(name!==name.trim() || [...name].length>120 || !name.trim() || CONTROL.test(name))
    issues.push(locale+"_LABEL_NEEDS_D1_LENGTH_OR_CONTROL_REVIEW");
  if(locale==="HI" && LATIN.test(name))
    issues.push("HI_CATEGORY_LABEL_LATIN_SCRIPT_REVIEW");
  return issues;
}
function checkedRows(preflight) {
  if(!exact(preflight,[
      "kind","state","sourceJsonSha256","languages","summary","categories",
    ])||
    preflight.kind!=="JODLO_CATALOG_ACTIVATION_PREFLIGHT_REVIEW_ONLY"||
    preflight.state!=="ZERO_APPROVAL_ZERO_SQL_ZERO_D1_MUTATION"||
    preflight.sourceJsonSha256!==SOURCE_SHA||
    JSON.stringify(preflight.languages)!=='["en","hi"]'||
    preflight.summary?.categoriesAuthorizedForActivation!==0||
    !Array.isArray(preflight.categories)||!preflight.categories.length||
    preflight.categories.length>889)
    throw Error("Untrusted or authorizing full-Category preflight");
  const seen=new Set();
  for(const row of preflight.categories) {
    if(!exact(row,INPUT_KEYS)||typeof row.sourceCategoryId!=="string"||
      !row.sourceCategoryId||
      typeof row.sourceGroupId!=="string"||!row.sourceGroupId||
      typeof row.sourceFamilyId!=="string"||!row.sourceFamilyId||
      typeof row.historicalNameEn!=="string"||!row.historicalNameEn.trim()||
      typeof row.historicalNameHi!=="string"||!row.historicalNameHi.trim()||
      typeof row.historicalSafetyTier!=="string"||!row.historicalSafetyTier||
      !Number.isInteger(row.sourceServiceCount)||row.sourceServiceCount<0||
      !Array.isArray(row.sourceReviewFlags)||
      row.sourceReviewFlags.some(flag=>typeof flag!=="string")||
      JSON.stringify(row.mandatoryHumanAndFounderGates)!==JSON.stringify(GATES)||
      row.reviewState!=="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW"||
      seen.has(row.sourceCategoryId))
      throw Error("Invalid, duplicate, modified or approved source Category row");
    seen.add(row.sourceCategoryId);
  }
  if(preflight.summary.requestedHistoricalCategories!==seen.size||
    preflight.summary.categoriesStillNeedingFounderDecision!==seen.size||
    preflight.categories.some((r,i)=>i>0 &&
      cmp(preflight.categories[i-1].sourceCategoryId,r.sourceCategoryId)>=0))
    throw Error("Missing or unordered source Category review rows");
  return preflight.categories;
}

/** Pure compatibility report, not a migration or a permission-bearing artifact.
 * Null mapping candidates demand explicit human correction. Even non-null IDs
 * are ONLY syntax-compatible, never approved for activation.
 */
export function buildCatalogMappingReadiness(preflight) {
  const source=checkedRows(preflight);
  const lineage=new Map();
  let idNeedsReview=0,slugNeedsReview=0,labelNeedsReview=0,sourceFlagged=0;
  const categories=source.map(row=>{
    const id=row.sourceCategoryId;
    const categoryIdCandidate=ID.test(id)?id:null;
    const slugCandidate=SLUG.test(id)?id:null;
    const mappingIssues=[
      ...(categoryIdCandidate===null?["SOURCE_CATEGORY_ID_INCOMPATIBLE"]:[]),
      ...(slugCandidate===null?["SOURCE_CATEGORY_SLUG_INCOMPATIBLE"]:[]),
      ...labelIssues(row.historicalNameEn,"EN"),
      ...labelIssues(row.historicalNameHi,"HI"),
    ];
    if((categoryIdCandidate===null)!==
      row.sourceReviewFlags.includes("CATEGORY_ID_MAPPING_REQUIRED"))
      throw Error("Source ID flag disagrees with actual D1 compatibility");
    if(categoryIdCandidate===null)idNeedsReview++;
    if(slugCandidate===null)slugNeedsReview++;
    if(mappingIssues.some(issue=>issue.includes("LABEL")))labelNeedsReview++;
    if(row.sourceReviewFlags.length)sourceFlagged++;
    const key=row.sourceGroupId+"\u0000"+row.sourceFamilyId;
    const family=lineage.get(key)??{
      sourceGroupId:row.sourceGroupId,sourceFamilyId:row.sourceFamilyId,
      categoryCount:0,categoryIdIssues:0,slugIssues:0,labelIssues:0,
    };
    family.categoryCount++;
    family.categoryIdIssues+=Number(categoryIdCandidate===null);
    family.slugIssues+=Number(slugCandidate===null);
    family.labelIssues+=Number(mappingIssues.some(issue=>issue.includes("LABEL")));
    lineage.set(key,family);
    return {
      sourceCategoryId:id,sourceGroupId:row.sourceGroupId,
      sourceFamilyId:row.sourceFamilyId,
      historicalNameEn:row.historicalNameEn,
      historicalNameHi:row.historicalNameHi,
      categoryIdCandidate,slugCandidate,
      syntaxIssues:mappingIssues,
      historicalReviewFlags:row.sourceReviewFlags.slice(),
      mandatoryHumanAndFounderGates:GATES.slice(),
      reviewState:ROW_STATE,
    };
  });
  const families=[...lineage.values()].sort((a,b)=>
    cmp(a.sourceGroupId,b.sourceGroupId)||
    cmp(a.sourceFamilyId,b.sourceFamilyId));
  const groups=new Set(families.map(x=>x.sourceGroupId));
  return {
    kind:KIND,state:STATE,sourceJsonSha256:SOURCE_SHA,languages:["en","hi"],
    summary:{
      sourceCategories:categories.length,
      representedGroups:groups.size,representedFamilies:families.length,
      categoryIdsRequiringHumanMapping:idNeedsReview,
      slugsRequiringHumanMapping:slugNeedsReview,
      categoryLabelsRequiringHumanCorrection:labelNeedsReview,
      categoriesWithHistoricalReviewFlags:sourceFlagged,
      categoriesWithSyntaxCompatibleIdsOnly:categories.length-idNeedsReview,
      categoriesAuthorizedForActivation:0,sqlStatementsGenerated:0,
    },
    groupFamilyCoverage:families,categories,
  };
}

/** Reject any injected approval, D1 mutation or altered source evidence. */
export function verifyCatalogMappingReadiness(preflight,output) {
  const expected=buildCatalogMappingReadiness(preflight);
  if(JSON.stringify(output)!==JSON.stringify(expected))
    throw Error("All-category mapping review diverges from pinned source or invents approval");
}
export function loadPinnedCatalogMappingReadiness() {
  const source=loadPinnedExpansionPreflight();
  const result=buildCatalogMappingReadiness(source);
  verifyCatalogMappingReadiness(source,result);
  if(result.summary.sourceCategories!==889||
     result.summary.representedGroups!==28||
     result.summary.representedFamilies!==206||
     result.summary.categoryIdsRequiringHumanMapping!==1||
     result.summary.categoriesAuthorizedForActivation!==0||
     result.summary.sqlStatementsGenerated!==0)
    throw Error("Pinned 889-Category compatibility baseline changed");
  return {source,result};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const mode=process.argv[2]??"--check";
  if(!["--check","--summary","--json"].includes(mode)||process.argv.length>3)
    throw Error("Use --check, --summary, or --json (review-only)");
  const {result}=loadPinnedCatalogMappingReadiness();
  if(mode==="--json")process.stdout.write(JSON.stringify(result,null,2)+"\n");
  else if(mode==="--summary")process.stdout.write(JSON.stringify(result.summary,null,2)+"\n");
  else console.log("JODLO all 889 Category mappings audited for D1 syntax; "+
      "all human/founder approvals pending, ZERO SQL/seed/activation.");
}
