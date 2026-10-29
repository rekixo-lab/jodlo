/** Offline-only Category reviewer packets. No D1 activation, alias import or deployment. */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedExpansionPreflight} from "./catalog-activation-preflight.mjs";
import {buildCatalogMappingReadiness} from "./catalog-mapping-readiness.mjs";
import {loadPinnedLegacyServiceReview,assertPinnedServiceReview} from "./legacy-service-review.mjs";
import {loadPinnedLegacyPhraseReview,assertPinnedLegacyPhraseReview} from "./legacy-phrase-review.mjs";

const SHA="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const STATE="ALL_HUMAN_REVIEWS_PENDING_NO_D1_ACTIVATION";
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const own=(a,b)=>Object.prototype.hasOwnProperty.call(a,b);
function checkSource(preflight,leaves,phrases){
  if(preflight?.kind!=="JODLO_CATALOG_ACTIVATION_PREFLIGHT_REVIEW_ONLY" ||
    preflight.state!=="ZERO_APPROVAL_ZERO_SQL_ZERO_D1_MUTATION" ||
    leaves?.kind!=="JODLO_LEGACY_SERVICE_REVIEW_ONLY" ||
    leaves.state!=="NO_LEAF_APPROVAL_NO_MATCHER_IMPORT_NO_D1_SEED" ||
    phrases?.kind!=="JODLO_LEGACY_PHRASE_REVIEW_ONLY" ||
    phrases.state!=="NO_ALIAS_APPROVAL_NO_SEARCH_INDEX_NO_D1_SEED" ||
    [preflight,leaves,phrases].some(x=>x.sourceJsonSha256!==SHA ||
      JSON.stringify(x.languages)!=='["en","hi"]') ||
    !Array.isArray(preflight.categories)||!Array.isArray(leaves.services)||
    !Array.isArray(phrases.phrases))throw Error("Untrusted or authorized review evidence");
}
export function createReviewPackets(preflight,leaves,phrases,packetSize=20){
  if(!Number.isInteger(packetSize)||packetSize<1||packetSize>25)
    throw Error("Review packet size must be 1..25");
  checkSource(preflight,leaves,phrases);
  // Reuse the existing full-889 D1 compatibility audit. It validates the
  // source-pinned preflight and cannot grant any category approval or seed.
  const mapping=buildCatalogMappingReadiness(preflight);
  const mappingById=new Map(mapping.categories.map(row=>[row.sourceCategoryId,row]));
  const parents=new Map();
  for(const row of preflight.categories){
    if(typeof row.sourceCategoryId!=="string"||!row.sourceCategoryId ||
      parents.has(row.sourceCategoryId) ||
      row.reviewState!=="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW" ||
      !Array.isArray(row.mandatoryHumanAndFounderGates)||
      row.mandatoryHumanAndFounderGates.length!==4||
      own(row,"approved")||own(row,"is_active")||own(row,"seed"))
      throw Error("Duplicate or deceptively authorized Category");
    parents.set(row.sourceCategoryId,row);
  }
  const services=new Map([...parents.keys()].map(id=>[id,[]]));
  for(const leaf of leaves.services){
    const parent=parents.get(leaf.categoryId);
    if(!parent||leaf.groupId!==parent.sourceGroupId ||
      leaf.familyId!==parent.sourceFamilyId ||
      leaf.reviewState!=="UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED" ||
      !Array.isArray(leaf.flags)||
      own(leaf,"approved")||own(leaf,"is_active")||own(leaf,"seed"))
      throw Error("Unsafe historical Service parent or approval state");
    services.get(leaf.categoryId).push(leaf);
  }
  const collisions=new Map([...parents.keys()].map(id=>[id,[]]));
  for(const phrase of phrases.phrases){
    if(phrase.reviewState!=="UNAPPROVED_HUMAN_LANGUAGE_AND_PARENT_SCOPE_REQUIRED"||
      !Array.isArray(phrase.candidateCategoryIdsForHumanReview))
      throw Error("Unsafe historical phrase review status");
    if(phrase.candidateCategoryIdsForHumanReview.length<2)continue;
    for(const id of phrase.candidateCategoryIdsForHumanReview){
      if(!parents.has(id))throw Error("Phrase references missing Category");
      collisions.get(id).push({
        locale:phrase.locale,normalizedPhrase:phrase.normalizedPhrase,
        otherSourceCategoryIds:phrase.candidateCategoryIdsForHumanReview
          .filter(other=>other!==id).slice().sort(cmp),
      });
    }
  }
  const ordered=[...parents.values()].sort((a,b)=>
    cmp(a.sourceGroupId,b.sourceGroupId)||
    cmp(a.sourceFamilyId,b.sourceFamilyId)||
    cmp(a.sourceCategoryId,b.sourceCategoryId));
  const packets=[],seen=new Set();
  for(let start=0;start<ordered.length;start+=packetSize){
    const categories=ordered.slice(start,start+packetSize).map(parent=>{
      const id=parent.sourceCategoryId;
      const compatibility=mappingById.get(id);
      if(!compatibility||
        compatibility.sourceGroupId!==parent.sourceGroupId||
        compatibility.sourceFamilyId!==parent.sourceFamilyId||
        compatibility.historicalNameEn!==parent.historicalNameEn||
        compatibility.historicalNameHi!==parent.historicalNameHi||
        JSON.stringify(compatibility.historicalReviewFlags)!==
          JSON.stringify(parent.sourceReviewFlags)||
        JSON.stringify(compatibility.mandatoryHumanAndFounderGates)!==
          JSON.stringify(parent.mandatoryHumanAndFounderGates)||
        compatibility.reviewState!=="HUMAN_ID_SLUG_LABEL_AND_SAFETY_REVIEW_REQUIRED")
        throw Error("Mapping review must match exact source Category and human gates");
      if(seen.has(id))throw Error("Duplicate Category across packets");
      seen.add(id);
      const leavesFor=services.get(id).slice().sort((a,b)=>cmp(a.serviceId,b.serviceId));
      if(leavesFor.length!==parent.sourceServiceCount)
        throw Error("Category Service source count mismatch");
      const clashes=collisions.get(id).slice().sort((a,b)=>
        cmp(a.locale,b.locale)||cmp(a.normalizedPhrase,b.normalizedPhrase));
      return {
        sourceCategoryId:id,sourceGroupId:parent.sourceGroupId,
        sourceFamilyId:parent.sourceFamilyId,
        historicalNameEn:parent.historicalNameEn,
        historicalNameHi:parent.historicalNameHi,
        historicalSafetyTier:parent.historicalSafetyTier,
        sourceServiceCount:parent.sourceServiceCount,
        sourceReviewFlags:parent.sourceReviewFlags.slice(),
        // Syntax-only candidates; NEVER a final, approved JODLO ID/slug.
        mappingCompatibility:{
          categoryIdCandidate:compatibility.categoryIdCandidate,
          slugCandidate:compatibility.slugCandidate,
          syntaxIssues:compatibility.syntaxIssues.slice(),
          reviewState:compatibility.reviewState,
        },
        serviceNamesWithLatinInHindi:leavesFor.filter(x=>
          x.flags.includes("HINDI_LABEL_LATIN_SCRIPT_REVIEW")).length,
        ambiguousCrossCategoryPhraseCount:clashes.length,
        serviceExamples:leavesFor.slice(0,3).map(x=>({
          sourceServiceId:x.serviceId,nameEn:x.name_en,nameHi:x.name_hi,
          reviewFlags:x.flags.slice(),
        })),
        ambiguousPhraseExamples:clashes.slice(0,3),
        mandatoryHumanAndFounderGates:parent.mandatoryHumanAndFounderGates.slice(),
        reviewState:"BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW",
      };
    });
    packets.push({
      kind:"JODLO_REVIEW_PACKET_NOT_APPROVAL",state:STATE,
      sourceJsonSha256:SHA,languages:["en","hi"],
      packetNumber:packets.length+1,categoryCount:categories.length,
      groupIds:[...new Set(categories.map(x=>x.sourceGroupId))].sort(cmp),
      flaggedCategoryCount:categories.filter(x=>x.sourceReviewFlags.length>0).length,
      categoriesWithIdSyntaxIssues:categories.filter(x=>
        x.mappingCompatibility.categoryIdCandidate===null).length,
      categoriesWithSlugSyntaxIssues:categories.filter(x=>
        x.mappingCompatibility.slugCandidate===null).length,
      categoriesWithLabelSyntaxIssues:categories.filter(x=>
        x.mappingCompatibility.syntaxIssues.some(issue=>issue.includes("LABEL"))).length,
      categoriesWithMappingSyntaxIssues:categories.filter(x=>
        x.mappingCompatibility.syntaxIssues.length>0).length,
      categoriesWithAmbiguousPhrases:categories.filter(x=>
        x.ambiguousCrossCategoryPhraseCount>0).length,
      categories,
    });
  }
  if(seen.size!==parents.size||seen.size!==mapping.summary.sourceCategories)
    throw Error("Incomplete Category/mapping review coverage");
  const issueTotals={
    id:packets.reduce((n,p)=>n+p.categoriesWithIdSyntaxIssues,0),
    slug:packets.reduce((n,p)=>n+p.categoriesWithSlugSyntaxIssues,0),
    label:packets.reduce((n,p)=>n+p.categoriesWithLabelSyntaxIssues,0),
  };
  if(issueTotals.id!==mapping.summary.categoryIdsRequiringHumanMapping||
    issueTotals.slug!==mapping.summary.slugsRequiringHumanMapping||
    issueTotals.label!==mapping.summary.categoryLabelsRequiringHumanCorrection)
    throw Error("Review packet mapping totals diverge from source compatibility");
  const manifest={
    kind:"JODLO_ALL_CATEGORY_REVIEW_PACKET_MANIFEST_ONLY",state:STATE,
    sourceJsonSha256:SHA,languages:["en","hi"],
    summary:{
      categories:seen.size,packetSize,packetCount:packets.length,
      categoriesWithIdSyntaxIssues:issueTotals.id,
      categoriesWithSlugSyntaxIssues:issueTotals.slug,
      categoriesWithLabelSyntaxIssues:issueTotals.label,
      categoriesWithMappingSyntaxIssues:packets.reduce(
        (n,p)=>n+p.categoriesWithMappingSyntaxIssues,0),
      categoriesAuthorizedForActivation:0,
      categoriesStillNeedingHumanAndFounderReview:seen.size,
    },
    packets:packets.map(p=>({
      packetNumber:p.packetNumber,categoryCount:p.categoryCount,
      groupIds:p.groupIds,flaggedCategoryCount:p.flaggedCategoryCount,
      categoriesWithIdSyntaxIssues:p.categoriesWithIdSyntaxIssues,
      categoriesWithSlugSyntaxIssues:p.categoriesWithSlugSyntaxIssues,
      categoriesWithLabelSyntaxIssues:p.categoriesWithLabelSyntaxIssues,
      categoriesWithMappingSyntaxIssues:p.categoriesWithMappingSyntaxIssues,
      categoriesWithAmbiguousPhrases:p.categoriesWithAmbiguousPhrases,
      firstSourceCategoryId:p.categories[0].sourceCategoryId,
      lastSourceCategoryId:p.categories.at(-1).sourceCategoryId,
    })),
  };
  return {manifest,packets};
}
export function verifyReviewPackets(preflight,leaves,phrases,output){
  const expected=createReviewPackets(
    preflight,leaves,phrases,output?.manifest?.summary?.packetSize);
  if(JSON.stringify(output)!==JSON.stringify(expected))
    throw Error("Review packet source, scope, examples or pending status changed");
}
export function loadPinnedReviewPackets(){
  const preflight=loadPinnedExpansionPreflight();
  const leaves=loadPinnedLegacyServiceReview();
  const phrases=loadPinnedLegacyPhraseReview();
  assertPinnedServiceReview(leaves);assertPinnedLegacyPhraseReview(phrases);
  const result=createReviewPackets(preflight,leaves,phrases);
  verifyReviewPackets(preflight,leaves,phrases,result);
  if(result.manifest.summary.categories!==889||
     result.manifest.summary.packetCount!==45||
     result.manifest.summary.categoriesWithIdSyntaxIssues!==1||
     result.manifest.summary.categoriesAuthorizedForActivation!==0)
    throw Error("Pinned 889-Category review boundary changed");
  return result;
}
export function parsePacketArg(raw,count){
  if(typeof raw!=="string"||!/^--packet=[1-9][0-9]*$/u.test(raw))
    throw Error("Expected --packet=N");
  const n=Number(raw.slice(9));
  if(!Number.isSafeInteger(n)||n>count)throw Error("Review packet out of range");
  return n;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const cmd=process.argv[2]??"--check";
  if(process.argv.length>3)throw Error("Only one packet output mode allowed");
  const {manifest,packets}=loadPinnedReviewPackets();
  if(cmd==="--manifest")process.stdout.write(JSON.stringify(manifest,null,2)+"\n");
  else if(cmd==="--summary")process.stdout.write(JSON.stringify(manifest.summary,null,2)+"\n");
  else if(cmd.startsWith("--packet="))process.stdout.write(
    JSON.stringify(packets[parsePacketArg(cmd,packets.length)-1],null,2)+"\n");
  else if(cmd==="--check")console.log("JODLO offline reviewer packets: 889 historical "+
    "Categories in 45 batches, ALL pending human+founder review, zero activation.");
  else throw Error("Use --check, --manifest, --summary or --packet=N");
}
