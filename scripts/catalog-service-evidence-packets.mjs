/**
 * ADR-0011 — COMPLETE historical service evidence for each of 889 Categories.
 * Offline human review only: no activation, public alias, Worker, UI or SQL.
 * A three-example Category review packet is NOT exhaustive Service review.
 */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedReviewPackets,parsePacketArg} from "./catalog-review-packets.mjs";
import {loadPinnedLegacyServiceReview,assertPinnedServiceReview} from "./legacy-service-review.mjs";
import {loadPinnedLegacyPhraseReview,assertPinnedLegacyPhraseReview} from "./legacy-phrase-review.mjs";

const SHA="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const SERVICE_PENDING="UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED";
const CATEGORY_PENDING="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW";
const PHRASE_PENDING="UNAPPROVED_HUMAN_LANGUAGE_AND_PARENT_SCOPE_REQUIRED";
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const normalize=value=>value.normalize("NFKC").toLowerCase().trim();
const phraseKey=(locale,label)=>locale+"\u0000"+normalize(label);

/**
 * Reuse the existing FULL source-pinned Category, Service and phrase reviews;
 * do not make a parallel taxonomy. Human reviewers can open a whole packet or
 * one Category and see EVERY historic Service (not merely three examples).
 */
export function buildFullCategoryServiceEvidence(review,serviceReview,phraseReview){
  if(review?.manifest?.kind!=="JODLO_ALL_CATEGORY_REVIEW_PACKET_MANIFEST_ONLY"||
    review.manifest.state!=="ALL_HUMAN_REVIEWS_PENDING_NO_D1_ACTIVATION"||
    review.manifest.sourceJsonSha256!==SHA||
    review.manifest.summary?.categories!==889||
    review.manifest.summary?.packetCount!==45||
    review.manifest.summary.categoriesAuthorizedForActivation!==0||
    !Array.isArray(review.packets)||review.packets.length!==45||
    serviceReview?.kind!=="JODLO_LEGACY_SERVICE_REVIEW_ONLY"||
    serviceReview.state!=="NO_LEAF_APPROVAL_NO_MATCHER_IMPORT_NO_D1_SEED"||
    phraseReview?.kind!=="JODLO_LEGACY_PHRASE_REVIEW_ONLY"||
    phraseReview.state!=="NO_ALIAS_APPROVAL_NO_SEARCH_INDEX_NO_D1_SEED"||
    serviceReview.sourceJsonSha256!==SHA||
    phraseReview.sourceJsonSha256!==SHA||
    JSON.stringify(review.manifest.languages)!=='["en","hi"]'||
    JSON.stringify(serviceReview.languages)!=='["en","hi"]'||
    JSON.stringify(phraseReview.languages)!=='["en","hi"]'||
    !Array.isArray(serviceReview.services)||serviceReview.services.length!==7267||
    !Array.isArray(phraseReview.phrases)||
    phraseReview.summary?.languageOccurrences!==14534)
    throw Error("Untrusted or incomplete historical 889-Category Service evidence");
  const parents=new Map(),byCategory=new Map(),serviceIds=new Set();
  for(const [index,packet] of review.packets.entries()){
    if(packet.packetNumber!==index+1||packet.categoryCount!==packet.categories.length||
      review.manifest.packets[index].packetNumber!==packet.packetNumber)
      throw Error("Category reviewer packet order or count changed");
    for(const cat of packet.categories){
      if(parents.has(cat.sourceCategoryId)||cat.reviewState!==CATEGORY_PENDING||
        !Array.isArray(cat.mandatoryHumanAndFounderGates)||
        cat.mandatoryHumanAndFounderGates.length!==4)
        throw Error("Duplicate or unsafe original Category review");
      parents.set(cat.sourceCategoryId,cat);
      byCategory.set(cat.sourceCategoryId,[]);
    }
  }
  if(parents.size!==889)throw Error("Missing historical Category review");
  for(const s of serviceReview.services){
    const c=parents.get(s.categoryId);
    if(!c||serviceIds.has(s.serviceId)||
      s.reviewState!==SERVICE_PENDING||
      !Array.isArray(s.flags)||!Array.isArray(s.crossCategoryLabelLocales)||
      s.groupId!==c.sourceGroupId||s.familyId!==c.sourceFamilyId||
      typeof s.name_en!=="string"||!s.name_en||
      typeof s.name_hi!=="string"||!s.name_hi)
      throw Error("Untrusted, duplicate or orphaned historical Service");
    serviceIds.add(s.serviceId);
    byCategory.get(s.categoryId).push(s);
  }
  if(serviceIds.size!==7267)throw Error("Incomplete 7,267-Service source review");

  // Phrase index lets a Service show the OTHER affected parent Categories.
  // In particular, do not auto-map one duplicated phrase to a single trade.
  const phrases=new Map(),occurrenceKeys=new Set();
  for(const p of phraseReview.phrases){
    if(p.reviewState!==PHRASE_PENDING||!["en","hi"].includes(p.locale)||
      !Array.isArray(p.candidateCategoryIdsForHumanReview)||
      !Array.isArray(p.sourceOccurrences)||!p.sourceOccurrences.length||
      typeof p.normalizedPhrase!=="string"||
      !p.normalizedPhrase)
      throw Error("Untrusted historical phrase review");
    const key=p.locale+"\u0000"+p.normalizedPhrase;
    if(phrases.has(key))throw Error("Duplicate localized phrase");
    phrases.set(key,p);
    const cats=[...new Set(p.sourceOccurrences.map(o=>o.categoryId))].sort(cmp);
    if(JSON.stringify(cats)!==
      JSON.stringify(p.candidateCategoryIdsForHumanReview))
      throw Error("Historical phrase parent mismatch");
    for(const o of p.sourceOccurrences){
      const id=p.locale+"\u0000"+o.serviceId;
      if(occurrenceKeys.has(id)||!serviceIds.has(o.serviceId)||
        !parents.has(o.categoryId)||typeof o.sourceLabel!=="string"||
        phraseKey(p.locale,o.sourceLabel)!==key)
        throw Error("Duplicated, broken or orphaned phrase occurrence");
      occurrenceKeys.add(id);
    }
  }
  if(occurrenceKeys.size!==14534)
    throw Error("Missing bilingual Service phrase occurrences");

  const packets=[],seen=new Set();
  let totalServices=0,totalLatin=0,totalId=0,totalAmbiguous=0;
  for(const packet of review.packets){
    let count=0,latin=0,idFlags=0,ambiguous=0;
    const categories=packet.categories.map(cat=>{
      const services=byCategory.get(cat.sourceCategoryId).slice()
        .sort((a,b)=>cmp(a.serviceId,b.serviceId));
      if(seen.has(cat.sourceCategoryId)||services.length!==cat.sourceServiceCount)
        throw Error("Category Service count or coverage mismatch");
      seen.add(cat.sourceCategoryId);
      let h=0,m=0,a=0;
      const serviceDetails=services.map(s=>{
        const choices={en:[],hi:[]};
        for(const locale of ["en","hi"]){
          const sourceLabel=locale==="en"?s.name_en:s.name_hi;
          const phrase=phrases.get(phraseKey(locale,sourceLabel));
          if(!phrase||!phrase.sourceOccurrences.some(o=>
            o.serviceId===s.serviceId&&o.categoryId===s.categoryId&&
            o.familyId===s.familyId&&o.groupId===s.groupId&&
            o.sourceLabel===sourceLabel))
            throw Error("Service phrase or parent evidence diverged");
          choices[locale]=phrase.candidateCategoryIdsForHumanReview
            .filter(x=>x!==s.categoryId);
          if(choices[locale].some(other=>!parents.has(other)))
            throw Error("Unknown ambiguous Service parent");
          if(Boolean(choices[locale].length)!==
            s.crossCategoryLabelLocales.includes(locale))
            throw Error("Service collision flag disagrees with source phrases");
        }
        h+=Number(s.flags.includes("HINDI_LABEL_LATIN_SCRIPT_REVIEW"));
        m+=Number(s.flags.includes("LEAF_ID_MAPPING_POLICY_REQUIRED"));
        a+=Number(choices.en.length>0||choices.hi.length>0);
        return {
          sourceServiceId:s.serviceId,
          historicalNameEn:s.name_en,historicalNameHi:s.name_hi,
          sourceSectionId:s.sourceSectionId,
          sourceFlags:s.flags.slice(),
          otherSourceCategoryChoices:choices,
          reviewState:SERVICE_PENDING,
        };
      });
      const exampleIds=serviceDetails.slice(0,3).map(s=>s.sourceServiceId);
      if(JSON.stringify(exampleIds)!==
        JSON.stringify(cat.serviceExamples.map(s=>s.sourceServiceId))||
        h!==cat.serviceNamesWithLatinInHindi)
        throw Error("Full Service evidence disagrees with Category examples/counts");
      count+=services.length;latin+=h;idFlags+=m;ambiguous+=a;
      return {
        sourceCategoryId:cat.sourceCategoryId,
        sourceGroupId:cat.sourceGroupId,
        sourceFamilyId:cat.sourceFamilyId,
        historicalNameEn:cat.historicalNameEn,
        historicalNameHi:cat.historicalNameHi,
        historicalSafetyTier:cat.historicalSafetyTier,
        sourceReviewFlags:cat.sourceReviewFlags.slice(),
        mappingSyntaxIssues:cat.mappingCompatibility.syntaxIssues.slice(),
        totalHistoricalServices:services.length,
        hindiLatinFlaggedServices:h,
        serviceIdPolicyFlaggedServices:m,
        crossCategoryAmbiguousServices:a,
        services:serviceDetails,
        reviewState:CATEGORY_PENDING,
      };
    });
    totalServices+=count;totalLatin+=latin;totalId+=idFlags;
    totalAmbiguous+=ambiguous;
    packets.push({
      kind:"JODLO_FULL_CATEGORY_SERVICE_EVIDENCE_ONLY",
      state:"ALL_SERVICE_LABELS_UNAPPROVED_NO_ALIAS_OR_CATEGORY_ACTIVATION",
      sourceJsonSha256:SHA,languages:["en","hi"],
      packetNumber:packet.packetNumber,categoryCount:categories.length,
      historicalServiceCount:count,hindiLatinFlaggedServices:latin,
      serviceIdPolicyFlaggedServices:idFlags,
      crossCategoryAmbiguousServices:ambiguous,
      categories,
    });
  }
  if(seen.size!==889||totalServices!==7267||
    totalLatin!==serviceReview.summary.flags.HINDI_LABEL_LATIN_SCRIPT_REVIEW||
    totalId!==serviceReview.summary.flags.LEAF_ID_MAPPING_POLICY_REQUIRED)
    throw Error("Incomplete all-Category Service evidence or flag totals");
  const manifest={
    kind:"JODLO_ALL_889_FULL_SERVICE_PACKET_MANIFEST_ONLY",
    state:"ALL_7267_UNAPPROVED_ZERO_ACTIVATION",
    sourceJsonSha256:SHA,languages:["en","hi"],
    summary:{
      historicalCategories:seen.size,historicalServices:totalServices,
      reviewPackets:packets.length,
      hindiLatinFlaggedServices:totalLatin,
      serviceIdPolicyFlaggedServices:totalId,
      crossCategoryAmbiguousServices:totalAmbiguous,
      categoriesNeedingHumanReview:seen.size,
      servicesRequiringHumanReview:totalServices,
      humanReviewsAuthenticated:0,
      founderCategoryApprovalsAuthenticated:0,
      categoriesAuthorizedForActivation:0,
      approvedAliases:0,activatedServices:0,
      sqlStatementsGenerated:0,
    },
    packets:packets.map(p=>({
      packetNumber:p.packetNumber,categoryCount:p.categoryCount,
      historicalServiceCount:p.historicalServiceCount,
      hindiLatinFlaggedServices:p.hindiLatinFlaggedServices,
      serviceIdPolicyFlaggedServices:p.serviceIdPolicyFlaggedServices,
      crossCategoryAmbiguousServices:p.crossCategoryAmbiguousServices,
    })),
  };
  return {manifest,packets};
}

export function loadPinnedFullCategoryServiceEvidence(){
  const review=loadPinnedReviewPackets();
  const services=loadPinnedLegacyServiceReview();
  const phrases=loadPinnedLegacyPhraseReview();
  assertPinnedServiceReview(services);
  assertPinnedLegacyPhraseReview(phrases);
  return buildFullCategoryServiceEvidence(review,services,phrases);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??"--check";
  if(process.argv.length>3)throw Error("Only one full Service evidence option allowed");
  const {manifest,packets}=loadPinnedFullCategoryServiceEvidence();
  if(mode==="--check")console.log(
    "JODLO all 889 Categories / 7,267 historical Services: COMPLETE local evidence, ZERO approvals, alias import or activation.");
  else if(mode==="--summary")process.stdout.write(
    JSON.stringify(manifest,null,2)+"\n");
  else if(mode.startsWith("--packet=")){
    const n=parsePacketArg(mode,packets.length);
    process.stdout.write(JSON.stringify(packets[n-1],null,2)+"\n");
  }else if(mode.startsWith("--category=")){
    const id=mode.slice(11);
    const match=packets.flatMap(p=>p.categories).find(c=>c.sourceCategoryId===id);
    if(!match)throw Error("Unknown original Category ID");
    process.stdout.write(JSON.stringify(match,null,2)+"\n");
  }else throw Error("Use --check, --summary, --packet=N, or --category=OLD_ID");
}
