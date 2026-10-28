/**
 * A preliminary source-evidence cross-check for 17 M-005 work-scopes.
 * No approval can emerge from this file or this validator; no public imports.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname,join} from "node:path";
import {loadPinnedLegacySnapshot} from "./legacy-category-review.mjs";
import {loadPinnedExpansionPreflight} from "./catalog-activation-preflight.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SHA="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const ID=/^[a-z0-9_-]{1,64}$/u;
const SIGNOFFS=[
  "FOUNDER_M005_CATEGORY_POLICY_AND_ID",
  "HUMAN_TRADE_SAFETY_AND_LEGALITY",
  "HUMAN_HINDI_ENGLISH_NAMING",
  "OPERATIONAL_MODERATION_AND_CONTACT_SCOPE",
];
const required=[
  "sourceCategoryId","assessment","sourceSafetyTier","sourceServiceEvidenceEn",
  "suggestedNameHi","proposedScopeEn","proposedScopeHi","excludedWorkEn",
  "excludedWorkHi","riskReason","requiredSignoffs","reviewState",
];
const allowed=["NARROW_SCOPE_RECOMMENDATION","EXTRA_REVIEW_REQUIRED","HOLD_FOR_SPECIALIST_POLICY"];
const exact=(o,keys)=>o&&typeof o==="object"&&!Array.isArray(o)&&
  Object.keys(o).sort().join("\u0000")===keys.slice().sort().join("\u0000");
export function validateM005ScopeReview(review,snapshot,preflight){
  if(!exact(review,["kind","state","sourceJsonSha256","languages","assessment","categories"])||
    review.kind!=="JODLO_M005_SOURCE_BACKED_SCOPE_RECOMMENDATIONS_ONLY"||
    review.state!=="NO_HUMAN_CERTIFICATION_NO_FOUNDER_CATEGORY_APPROVAL_NO_D1_SEED"||
    review.assessment!=="PRELIMINARY_ASSISTANT_TEXT_REVIEW_NOT_LEGAL_OR_NATIVE_LANGUAGE_CERTIFICATION"||
    review.sourceJsonSha256!==SHA||
    JSON.stringify(review.languages)!=='["en","hi"]'||
    !Array.isArray(review.categories)||review.categories.length!==17||
    snapshot?.kind!=="JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED"||
    JSON.stringify(snapshot.languagePolicy)!=='["en","hi"]'||
    preflight?.kind!=="JODLO_CATALOG_ACTIVATION_PREFLIGHT_REVIEW_ONLY"||
    preflight.state!=="ZERO_APPROVAL_ZERO_SQL_ZERO_D1_MUTATION"||
    preflight.sourceJsonSha256!==SHA||
    preflight.summary.categoriesAuthorizedForActivation!==0)
    throw Error("M-005 review provenance, count or approval boundary invalid");
  const categories=new Map(snapshot.collections.categories.map(c=>[c.id,c]));
  const parent=new Map(preflight.categories.map(c=>[c.sourceCategoryId,c]));
  const services=new Map();
  for(const leaf of snapshot.collections.services){
    if(!services.has(leaf.categoryId))services.set(leaf.categoryId,new Set());
    services.get(leaf.categoryId).add(leaf.name_en);
  }
  const counts=Object.fromEntries(allowed.map(a=>[a,0]));
  const ids=new Set();
  for(const row of review.categories){
    if(!exact(row,required)||!ID.test(row.sourceCategoryId)||
      ids.has(row.sourceCategoryId)||!allowed.includes(row.assessment)||
      row.reviewState!=="ALL_APPROVALS_PENDING"||
      JSON.stringify(row.requiredSignoffs)!==JSON.stringify(SIGNOFFS))
      throw Error("Unapproved M-005 row has invalid fields or duplicate IDs");
    ids.add(row.sourceCategoryId);
    const source=categories.get(row.sourceCategoryId),p=parent.get(row.sourceCategoryId);
    if(!source||!p||source.safetyTier!==row.sourceSafetyTier ||
      p.sourceGroupId!==source.groupId||p.sourceFamilyId!==source.familyId||
      p.reviewState!=="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW"||
      !services.get(row.sourceCategoryId)?.has(row.sourceServiceEvidenceEn))
      throw Error("M-005 Category risk or Service evidence did not match pinned source");
    for(const key of ["suggestedNameHi","proposedScopeHi","excludedWorkHi"]){
      const value=row[key];
      if(typeof value!=="string"||!value.trim()||
        !/\p{Script=Devanagari}/u.test(value)||/[a-zA-Z]/u.test(value))
        throw Error("Review Hindi text must be Devanagari without Latin words");
    }
    for(const key of ["proposedScopeEn","excludedWorkEn","riskReason"]){
      if(typeof row[key]!=="string"||row[key].trim().length<15)
        throw Error("Missing bounded occupational exclusions/controls");
    }
    // Risky source classifications cannot be declared low-risk just because
    // the old Firestore Category happened to be active.
    if(["high_voltage","refrigerant_and_electrical"].includes(row.sourceSafetyTier)
       &&row.assessment!=="HOLD_FOR_SPECIALIST_POLICY")
      throw Error("Hazardous electrical/refrigerant source tier cannot bypass policy hold");
    if(["electronics_repair","vehicle_repair"].includes(row.sourceSafetyTier)
       &&row.assessment==="NARROW_SCOPE_RECOMMENDATION")
      throw Error("Data-sensitive or vehicle work needs additional review");
    if(row.sourceCategoryId==="home-tutor" &&
       (row.assessment!=="HOLD_FOR_SPECIALIST_POLICY"||
        !p.sourceReviewFlags.includes("PARENT_GROUP_STATUS_REVIEW")))
      throw Error("Minor safety and original disabled parent status hold lost");
    counts[row.assessment]++;
  }
  if(counts.NARROW_SCOPE_RECOMMENDATION!==10||
    counts.EXTRA_REVIEW_REQUIRED!==4||
    counts.HOLD_FOR_SPECIALIST_POLICY!==3)
    throw Error("Unreviewed changes to the 10/4/3 initial triage decision");
  return {sourceBacked:17,provisionalNarrow:10,extraReview:4,hold:3,approved:0};
}
export function loadPinnedM005ScopeReview(){
  const review=JSON.parse(readFileSync(join(ROOT,
    "docs/reference/data/jodlo-m005-first-17-scope-assessments-2026-10-28.json"),"utf8"));
  const result=validateM005ScopeReview(review,loadPinnedLegacySnapshot(),loadPinnedExpansionPreflight());
  return {review,summary:result};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const option=process.argv[2]??"--check";
  if(process.argv.length>3||!["--check","--summary"].includes(option))
    throw Error("Usage: node scripts/verify-m005-first-scope-review.mjs [--check|--summary]");
  const {summary}=loadPinnedM005ScopeReview();
  if(option==="--summary")process.stdout.write(JSON.stringify(summary,null,2)+"\n");
  else console.log("JODLO M-005 first 17 source-backed scopes: 10 narrow proposals, "+
    "4 need extra review, 3 held; ZERO category approval or activation");
}
