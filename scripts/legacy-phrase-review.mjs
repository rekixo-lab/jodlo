/**
 * Parent-scoped, read-only bilingual legacy SEARCH PHRASE review.
 * NO dictionary approval, NO live Search import and NO D1 mutation.
 * Each normalized label retains ALL historical service and category parents.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPinnedLegacyServiceReview,
  assertPinnedServiceReview,
} from "./legacy-service-review.mjs";

const cmp=(a,b)=>a<b?-1:a>b?1:0;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const LANGUAGES=["en","hi"];
const EXPECTED_HASH="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";

function normalizedPhrase(value){
  // KEEP every Devanagari vowel/combining mark and word boundary.
  // Do not transliterate, stem or interpret unreviewed source language.
  return value.normalize("NFKC").toLowerCase().trim();
}

/** Pure helper for disposable fixtures and the SHA-pinned full review only.
 * It never accepts authorizations, active flags, personal data or match scores.
 */
export function buildLegacyPhraseReview(serviceReview){
  if(serviceReview?.kind!=="JODLO_LEGACY_SERVICE_REVIEW_ONLY" ||
     serviceReview.state!=="NO_LEAF_APPROVAL_NO_MATCHER_IMPORT_NO_D1_SEED" ||
     JSON.stringify(serviceReview.languages)!=='["en","hi"]' ||
     typeof serviceReview.sourceJsonSha256!=="string" ||
     !Array.isArray(serviceReview.services)) {
    throw Error("Unsafe service review input");
  }
  const seenIds=new Set();
  const phrases=new Map();
  for(const service of serviceReview.services){
    if(typeof service.serviceId!=="string" || !service.serviceId ||
       seenIds.has(service.serviceId) ||
       typeof service.categoryId!=="string" || !service.categoryId ||
       typeof service.groupId!=="string" || !service.groupId ||
       typeof service.familyId!=="string" || !service.familyId ||
       service.reviewState!=="UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED" ||
       !Array.isArray(service.flags)) {
      throw Error("Unsafe historical service input");
    }
    seenIds.add(service.serviceId);
    for(const locale of LANGUAGES) {
      const sourceLabel=service["name_"+locale];
      if(typeof sourceLabel!=="string" || !sourceLabel.trim())
        throw Error("Invalid bilingual service label");
      const phrase=normalizedPhrase(sourceLabel);
      const key=locale+"\u0000"+phrase;
      if(!phrases.has(key))phrases.set(key,{
        locale,normalizedPhrase:phrase,spellings:new Set(),occurrences:[],
      });
      const group=phrases.get(key);
      group.spellings.add(sourceLabel);
      group.occurrences.push({
        serviceId:service.serviceId,
        categoryId:service.categoryId,
        familyId:service.familyId,
        groupId:service.groupId,
        sourceLabel,
        sourceFlags:service.flags.filter(flag=>
          flag==="HINDI_LABEL_LATIN_SCRIPT_REVIEW" ||
          flag==="LEAF_ID_MAPPING_POLICY_REQUIRED"),
      });
    }
  }
  const result=[];
  let ambiguous=0,sameCategoryMultipleServices=0,latinHindiPhrases=0;
  const byLocale={en:0,hi:0};
  for(const group of phrases.values()){
    const occurrences=group.occurrences.sort((a,b)=>
      cmp(a.categoryId,b.categoryId)||cmp(a.serviceId,b.serviceId));
    const uniqueCategoryIds=[...new Set(occurrences.map(x=>x.categoryId))]
      .sort(cmp);
    const flags=[];
    // Different Categories sharing the same label are always ambiguous.
    // Even if both are publicly active later, never infer one from the label.
    if(uniqueCategoryIds.length>1) {
      flags.push("MULTIPLE_DIFFERENT_PARENT_CATEGORIES");
      ambiguous++;
      byLocale[group.locale]++;
    }
    // Multiple Services under ONE parent do NOT imply a different trade.
    if(uniqueCategoryIds.length===1 && occurrences.length>1){
      flags.push("MULTIPLE_SERVICES_SAME_PARENT");
      sameCategoryMultipleServices++;
    }
    if(group.locale==="hi" && /[A-Za-z]/u.test(group.normalizedPhrase)) {
      flags.push("HINDI_LABEL_SCRIPT_REVIEW");
      latinHindiPhrases++;
    }
    if(occurrences.some(x=>x.sourceFlags.includes("LEAF_ID_MAPPING_POLICY_REQUIRED")))
      flags.push("HISTORICAL_SERVICE_ID_MAPPING_REVIEW");
    result.push({
      locale:group.locale,
      normalizedPhrase:group.normalizedPhrase,
      originalSpellings:[...group.spellings].sort(cmp),
      candidateCategoryIdsForHumanReview:uniqueCategoryIds,
      sourceOccurrences:occurrences,
      reviewState:"UNAPPROVED_HUMAN_LANGUAGE_AND_PARENT_SCOPE_REQUIRED",
      flags,
    });
  }
  result.sort((a,b)=>cmp(a.locale,b.locale)||cmp(a.normalizedPhrase,b.normalizedPhrase));
  return {
    kind:"JODLO_LEGACY_PHRASE_REVIEW_ONLY",
    state:"NO_ALIAS_APPROVAL_NO_SEARCH_INDEX_NO_D1_SEED",
    languages:["en","hi"],
    sourceJsonSha256:serviceReview.sourceJsonSha256,
    summary:{
      historicalServices:seenIds.size,
      languageOccurrences:seenIds.size*2,
      uniqueLocalizedPhraseKeys:result.length,
      labelsSharedAcrossDifferentCategories:ambiguous,
      ambiguousLabelsByLocale:byLocale,
      sameParentMultiServiceLabels:sameCategoryMultipleServices,
      latinScriptInHindiLocalizedPhraseKeys:latinHindiPhrases,
    },
    phrases:result,
  };
}

export function loadPinnedLegacyPhraseReview(){
  const source=loadPinnedLegacyServiceReview();
  assertPinnedServiceReview(source);
  return buildLegacyPhraseReview(source);
}

export function assertPinnedLegacyPhraseReview(report){
  const s=report.summary;
  if(report.kind!=="JODLO_LEGACY_PHRASE_REVIEW_ONLY" ||
     report.state!=="NO_ALIAS_APPROVAL_NO_SEARCH_INDEX_NO_D1_SEED" ||
     JSON.stringify(report.languages)!=='["en","hi"]' ||
     report.sourceJsonSha256!==EXPECTED_HASH ||
     s.historicalServices!==7267 ||
     s.languageOccurrences!==14534 ||
     s.labelsSharedAcrossDifferentCategories!==139 ||
     s.ambiguousLabelsByLocale.en+s.ambiguousLabelsByLocale.hi!==139 ||
     s.uniqueLocalizedPhraseKeys<1 ||
     report.phrases.length!==s.uniqueLocalizedPhraseKeys ||
     report.phrases.reduce((n,row)=>n+row.sourceOccurrences.length,0)!==14534 ||
     report.phrases.some(row=>
       row.reviewState!=="UNAPPROVED_HUMAN_LANGUAGE_AND_PARENT_SCOPE_REQUIRED" ||
       own(row,"approved") || own(row,"searchKeywords") ||
       own(row,"selectedCategoryId") || own(row,"is_active") ||
       own(row,"seed") || own(row,"publish") || own(row,"verified"))) {
    throw Error("Historical phrase review or no-activation boundary changed");
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const mode=process.argv[2]??"--check";
  if(!["--check","--summary","--json"].includes(mode)||process.argv.length>3)
    throw Error("Usage: node scripts/legacy-phrase-review.mjs [--check|--summary|--json]");
  const report=loadPinnedLegacyPhraseReview();
  assertPinnedLegacyPhraseReview(report);
  if(mode==="--json")process.stdout.write(JSON.stringify(report,null,2)+"\n");
  else if(mode==="--summary")process.stdout.write(JSON.stringify(report.summary,null,2)+"\n");
  else console.log("JODLO 7267-service phrases: 14534 language occurrences, "+
    "139 cross-category ambiguous labels; ALL UNAPPROVED, zero matcher import.");
}
