/** 
 * OFFLINE editorial PROPOSALS ONLY: this module is never imported by Workers,
 * D1, Android or the public matcher. No approval is inferred or granted.
 */
import {readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedLegacyPhraseReview,assertPinnedLegacyPhraseReview} from "./legacy-phrase-review.mjs";
import {loadPinnedLegacyReview,assertPinnedReview} from "./legacy-category-review.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SHA="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const KIND="JODLO_EDITORIAL_PHRASE_PROPOSALS_REVIEW_ONLY";
const STATE="NOT_APPROVED_NO_RUNTIME_MATCHER_NO_D1_SEED";
const REQUIRED=["LANGUAGE_MEANING_REVIEW","TRADE_SCOPE_REVIEW","FOUNDER_M005_CATEGORY_APPROVAL"];
const compare=(a,b)=>a<b?-1:a>b?1:0;
const hasExactly=(o,keys)=>o&&typeof o==="object"&&!Array.isArray(o) &&
  Object.keys(o).sort().join("|")===keys.slice().sort().join("|");
const validId=id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,64}$/u.test(id);
const romanHindi=/\b(?:mujhe|chahiye|kaam|karta|karti|mere|meri|mera|main)\b/u;
function validPhrase(lang,phrase){
  if(typeof phrase!=="string"||phrase!==phrase.trim()||
     phrase!==phrase.normalize("NFKC").toLowerCase()||
     [...phrase].length<6||[...phrase].length>64||phrase.includes("  "))return false;
  if(lang==="en")
    return /^[a-z]+(?: [a-z]+){1,5}$/u.test(phrase)&&!romanHindi.test(phrase);
  if(lang==="hi")
    return /^[\p{Script=Devanagari}\p{Mark}]+(?: [\p{Script=Devanagari}\p{Mark}]+){1,5}$/u.test(phrase);
  return false;
}
function sourceIndex(phrases,categories){
  if(phrases?.kind!=="JODLO_LEGACY_PHRASE_REVIEW_ONLY"||
     phrases.state!=="NO_ALIAS_APPROVAL_NO_SEARCH_INDEX_NO_D1_SEED"||
     categories?.kind!=="JODLO_LEGACY_CATEGORY_REVIEW_ONLY"||
     categories.state!=="NO_APPROVAL_NO_D1_SEED"||
     phrases.sourceJsonSha256!==SHA||categories.sourceJsonSha256!==SHA||
     JSON.stringify(phrases.languages)!=='["en","hi"]'||
     JSON.stringify(categories.languages)!=='["en","hi"]')
    throw Error("Unsafe historical review provenance or language");
  const lookup=new Map(phrases.phrases.map(x=>[x.locale+"\u0000"+x.normalizedPhrase,x]));
  const parents=new Map(categories.categories.map(x=>[x.categoryId,x]));
  if(lookup.size!==phrases.phrases.length||parents.size!==categories.categories.length)
    throw Error("Duplicate evidence identity");
  return {lookup,parents};
}
function validateRow(row,index) {
  if(!hasExactly(row,["locale","phrase","categoryId","sourceServiceIds",
      "sourceGroupId","sourceFamilyId","reviewRequired"])||
     !validId(row.categoryId)||!validPhrase(row.locale,row.phrase)||
     JSON.stringify(row.reviewRequired)!==JSON.stringify(REQUIRED)||
     !Array.isArray(row.sourceServiceIds)||
     row.sourceServiceIds.length<1||row.sourceServiceIds.length>24||
     row.sourceServiceIds.some(x=>typeof x!=="string"||!x)||
     new Set(row.sourceServiceIds).size!==row.sourceServiceIds.length||
     row.sourceServiceIds.slice().sort(compare).join("|")!==row.sourceServiceIds.join("|"))
    return "Invalid editorial proposal row "+index;
  return null;
}
function validationError(row,idx,source){
  const schema=validateRow(row,idx);
  if(schema)return schema;
  const parent=source.parents.get(row.categoryId);
  const phrase=source.lookup.get(row.locale+"\u0000"+row.phrase);
  if(!parent||!phrase||!Array.isArray(parent.flags) || parent.flags.length||
     parent.groupId!==row.sourceGroupId||parent.familyId!==row.sourceFamilyId||
     phrase.reviewState!=="UNAPPROVED_HUMAN_LANGUAGE_AND_PARENT_SCOPE_REQUIRED"||
     phrase.candidateCategoryIdsForHumanReview.length!==1||
     phrase.candidateCategoryIdsForHumanReview[0]!==row.categoryId||
     phrase.flags.includes("MULTIPLE_DIFFERENT_PARENT_CATEGORIES")||
     phrase.flags.includes("HINDI_LABEL_SCRIPT_REVIEW")||
     phrase.flags.includes("HISTORICAL_SERVICE_ID_MAPPING_REVIEW"))
    return "Ambiguous, blocked, inactive or unknown source category/phrase at "+idx;
  const original=phrase.sourceOccurrences;
  if(original.some(x=>x.categoryId!==row.categoryId||
      x.groupId!==parent.groupId||x.familyId!==parent.familyId))
    return "Source ancestor mismatch at "+idx;
  const exactIds=original.map(x=>x.serviceId).sort(compare);
  if(exactIds.join("|")!==row.sourceServiceIds.join("|"))
    return "Incomplete or invented source Service IDs at "+idx;
  return null;
}
export function validateEditorialProposal(batch,phrases,categories){
  let source;
  try{source=sourceIndex(phrases,categories);}catch(e){return [e.message];}
  if(!hasExactly(batch,["kind","state","languages","sourceJsonSha256","proposedAliases"])||
     batch.kind!==KIND||batch.state!==STATE||
     JSON.stringify(batch.languages)!=='["en","hi"]'||
     batch.sourceJsonSha256!==SHA||
     !Array.isArray(batch.proposedAliases)||batch.proposedAliases.length>100)
    return ["Invalid proposal kind, shape or unapproved state"];
  const seen=new Set(),problems=[];
  for(const [i,row] of batch.proposedAliases.entries()){
    const issue=validationError(row,i,source);
    if(issue){problems.push(issue);continue;}
    const key=row.locale+"\u0000"+row.phrase;
    if(seen.has(key))problems.push("Duplicate phrase in proposal at "+i);
    seen.add(key);
  }
  return problems;
}
export function buildEditorialReviewBatch(phrases,categories,categoryIds,perLocale=2){
  if(!Array.isArray(categoryIds)||categoryIds.length<1||categoryIds.length>50||
     new Set(categoryIds).size!==categoryIds.length||
     !categoryIds.every(validId)||!Number.isInteger(perLocale)||
     perLocale<1||perLocale>5)
    throw Error("Review batch needs 1..50 unique IDs and 1..5 rows per locale");
  const source=sourceIndex(phrases,categories);
  const accepted=new Set(categoryIds);
  if([...accepted].some(id=>!source.parents.has(id)))
    throw Error("Unknown old Category ID");
  const batch={
    kind:KIND,state:STATE,languages:["en","hi"],sourceJsonSha256:SHA,
    proposedAliases:[],
  };
  const quota=new Map();
  for(const phrase of phrases.phrases){
    if(phrase.candidateCategoryIdsForHumanReview.length!==1)continue;
    const id=phrase.candidateCategoryIdsForHumanReview[0];
    if(!accepted.has(id)||!validPhrase(phrase.locale,phrase.normalizedPhrase))continue;
    const parent=source.parents.get(id);
    const key=id+"\u0000"+phrase.locale;
    if((quota.get(key)??0)>=perLocale || parent.flags.length)continue;
    const row={
      locale:phrase.locale,phrase:phrase.normalizedPhrase,categoryId:id,
      sourceServiceIds:phrase.sourceOccurrences.map(x=>x.serviceId).sort(compare),
      sourceGroupId:parent.groupId,sourceFamilyId:parent.familyId,
      reviewRequired:REQUIRED.slice(),
    };
    if(validationError(row,0,source))continue;
    batch.proposedAliases.push(row);
    quota.set(key,(quota.get(key)??0)+1);
  }
  batch.proposedAliases.sort((a,b)=>compare(a.categoryId,b.categoryId)||
    compare(a.locale,b.locale)||compare(a.phrase,b.phrase));
  const errors=validateEditorialProposal(batch,phrases,categories);
  if(errors.length)throw Error("Generated batch invalid: "+errors.join("; "));
  return batch;
}
export function loadPinnedEditorialBatch(){
  const phrases=loadPinnedLegacyPhraseReview();
  const categories=loadPinnedLegacyReview();
  assertPinnedLegacyPhraseReview(phrases);assertPinnedReview(categories);
  const ids=JSON.parse(readFileSync(join(ROOT,
    "docs/reference/data/jodlo-pilot-candidates-2026-10-27.json"),"utf8"));
  if(!hasExactly(ids,["kind","state","sourceJsonSha256","languages",
      "pilotCandidateCategoryIds","needsExtraReviewCategoryIds","holdCategoryIds"])||
     ids.kind!=="JODLO_UNAPPROVED_TAXONOMY_REVIEW_ONLY"||
     ids.state!=="FOUNDER_DECISION_REQUIRED_NO_D1_SEED"||
     ids.sourceJsonSha256!==SHA||JSON.stringify(ids.languages)!=='["en","hi"]'||
     !Array.isArray(ids.pilotCandidateCategoryIds)||ids.pilotCandidateCategoryIds.length!==10)
    throw Error("Unapproved candidate manifest changed unexpectedly");
  return {batch:buildEditorialReviewBatch(phrases,categories,
      ids.pilotCandidateCategoryIds,2),phrases,categories};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??"--check";
  if(!["--check","--summary","--json"].includes(mode)||process.argv.length>3)
    throw Error("Usage: node scripts/editorial-phrase-proposals.mjs [--check|--summary|--json]");
  const {batch,phrases,categories}=loadPinnedEditorialBatch();
  if(validateEditorialProposal(batch,phrases,categories).length ||
     batch.proposedAliases.length===0)
    throw Error("Pinned editorial batch invalid or empty");
  if(mode==="--json")process.stdout.write(JSON.stringify(batch,null,2)+"\n");
  else if(mode==="--summary")process.stdout.write(JSON.stringify({
    pendingHumanReview:batch.proposedAliases.length,
    categoriesRepresented:new Set(batch.proposedAliases.map(x=>x.categoryId)).size,
    matcherImported:false,sourceActivated:false,
  },null,2)+"\n");
  else console.log("JODLO offline editorial suggestions: "+batch.proposedAliases.length+
    " all pending language, scope and founder review; zero runtime import.");
}
