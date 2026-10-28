/** 
 * Historical service-label review ONLY. The full source is pinned and read
 * locally, never imported into JODLO API, a D1 seed, UI or its matcher.
 * No service here is approved, selectable or a validated worker skill.
 */
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedLegacySnapshot} from "./legacy-category-review.mjs";

const expectedSourceSha="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const ID_SHAPE=/^[A-Za-z0-9_-]{1,64}$/u; // Comparison only: NOT an approved leaf-ID policy.
const LATIN=/[A-Za-z]/u;
const compare=(a,b)=>a<b?-1:a>b?1:0;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

function normalizeLabel(label) {
  // NFKC/casefold *without* stripping Indic combining marks. Do not globally
  // deduplicate service names across unrelated Category IDs.
  return label.normalize("NFKC").toLowerCase().trim();
}

/** A source-only, deterministic evidence queue for editorial review of EVERY
 * old leaf. No machine translation, no fuzzy matching, no category approval. */
export function buildLegacyServiceReview(snapshot) {
  if(snapshot?.kind!=="JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED" ||
     JSON.stringify(snapshot.languagePolicy)!=='["en","hi"]') {
    throw Error("Unexpected historical source language/provenance");
  }
  const {groups,families,categories,services}=snapshot.collections??{};
  if(![groups,families,categories,services].every(Array.isArray)) {
    throw Error("Missing historical catalog collections");
  }
  const groupsById=new Map(groups.map(row=>[row.id,row]));
  const familiesById=new Map(families.map(row=>[row.id,row]));
  const categoriesById=new Map(categories.map(row=>[row.id,row]));
  if(groupsById.size!==groups.length || familiesById.size!==families.length ||
     categoriesById.size!==categories.length) throw Error("Duplicate historical parent ID");

  const seenServiceIds=new Set();
  const labelCategoryOwners=new Map();
  const sectionIds=new Set();
  const raw=[];
  for(const service of services) {
    const cat=categoriesById.get(service.categoryId);
    const family=familiesById.get(service.familyId);
    const group=groupsById.get(service.groupId);
    if(!cat || !family || !group ||
       cat.familyId!==service.familyId || cat.groupId!==service.groupId ||
       family.groupId!==service.groupId) throw Error("Broken historical service ancestry");
    if(typeof service.id!=="string" || !service.id || seenServiceIds.has(service.id))
      throw Error("Missing or repeated historical service ID");
    seenServiceIds.add(service.id);
    for(const lang of ["en","hi"]) {
      const label=service["name_"+lang];
      if(typeof label!=="string" || !label.trim())throw Error("Missing bilingual service name");
      const key=lang+"\u0000"+normalizeLabel(label);
      if(!labelCategoryOwners.has(key))labelCategoryOwners.set(key,new Set());
      labelCategoryOwners.get(key).add(cat.id);
    }
    if(typeof service.sectionId==="string" && service.sectionId)
      sectionIds.add(service.sectionId);
    raw.push(service);
  }

  const ambiguousLabels=new Map();
  for(const [key,owners] of labelCategoryOwners){
    if(owners.size>1) ambiguousLabels.set(key,owners);
  }
  const flagCounts={},categoryWithMixedHi=new Set(),categoryWithSharedLabel=new Set();
  const rows=raw.map(service=>{
    const flags=[];
    const sharedLocales=[];
    if(LATIN.test(service.name_hi)) {
      flags.push("HINDI_LABEL_LATIN_SCRIPT_REVIEW");
      categoryWithMixedHi.add(service.categoryId);
    }
    for(const lang of ["en","hi"]){
      const key=lang+"\u0000"+normalizeLabel(service["name_"+lang]);
      if(ambiguousLabels.has(key)) sharedLocales.push(lang);
    }
    if(sharedLocales.length){
      flags.push("SAME_SERVICE_LABEL_DIFFERENT_CATEGORIES_REVIEW");
      categoryWithSharedLabel.add(service.categoryId);
    }
    // Historical source IDs are preserved; never rename silently. These are
    // only incompatibilities with today's *category* ID shape, not proof that
    // a final service-ID policy has been agreed.
    if(!ID_SHAPE.test(service.id))flags.push("LEAF_ID_MAPPING_POLICY_REQUIRED");
    if(typeof service.sectionId==="string" && service.sectionId)
      flags.push("HISTORICAL_SECTION_REFERENCE_UNVERIFIED");
    for(const flag of flags) flagCounts[flag]=(flagCounts[flag]??0)+1;
    return {
      serviceId:service.id,
      categoryId:service.categoryId,
      familyId:service.familyId,
      groupId:service.groupId,
      name_en:service.name_en,
      name_hi:service.name_hi,
      sourceSectionId:service.sectionId??null,
      crossCategoryLabelLocales:sharedLocales,
      reviewState:"UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED",
      flags,
    };
  });
  rows.sort((a,b)=>compare(a.categoryId,b.categoryId)||compare(a.serviceId,b.serviceId));
  return {
    kind:"JODLO_LEGACY_SERVICE_REVIEW_ONLY",
    state:"NO_LEAF_APPROVAL_NO_MATCHER_IMPORT_NO_D1_SEED",
    languages:["en","hi"],
    sourceJsonSha256:expectedSourceSha,
    summary:{
      services:rows.length,
      categories:categories.length,
      uniqueHistoricalSectionReferences:sectionIds.size,
      crossCategoryDuplicateLabelKeys:ambiguousLabels.size,
      categoriesWithCrossCategoryLabelCollisions:categoryWithSharedLabel.size,
      categoriesWithLatinInHindiServiceLabels:categoryWithMixedHi.size,
      flags:flagCounts,
    },
    services:rows,
  };
}

export function loadPinnedLegacyServiceReview(){
  return buildLegacyServiceReview(loadPinnedLegacySnapshot());
}

export function assertPinnedServiceReview(report){
  if(report.kind!=="JODLO_LEGACY_SERVICE_REVIEW_ONLY" ||
     report.state!=="NO_LEAF_APPROVAL_NO_MATCHER_IMPORT_NO_D1_SEED" ||
     JSON.stringify(report.languages)!=='["en","hi"]' ||
     report.sourceJsonSha256!==expectedSourceSha ||
     report.summary.services!==7267 || report.summary.categories!==889 ||
     report.summary.uniqueHistoricalSectionReferences!==1514 ||
     report.summary.crossCategoryDuplicateLabelKeys!==139 ||
     report.summary.categoriesWithCrossCategoryLabelCollisions!==127 ||
     report.summary.categoriesWithLatinInHindiServiceLabels!==616 ||
     report.summary.flags.HINDI_LABEL_LATIN_SCRIPT_REVIEW!==4928 ||
     report.summary.flags.LEAF_ID_MAPPING_POLICY_REQUIRED!==1784 ||
     report.services.length!==7267 ||
     new Set(report.services.map(row=>row.serviceId)).size!==7267 ||
     report.services.some(row=>
       row.reviewState!=="UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED" ||
       own(row,"approved") || own(row,"is_active") || own(row,"seed") ||
       own(row,"selectable") || own(row,"published") ||
       own(row,"searchKeywords") || own(row,"categorySuggestion"))){
    throw Error("Legacy service review integrity or approval gate violated");
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??"--check";
  if(!["--check","--summary","--json"].includes(mode)||process.argv.length>3)
    throw Error("Usage: node scripts/legacy-service-review.mjs [--check|--summary|--json]");
  const report=loadPinnedLegacyServiceReview();
  assertPinnedServiceReview(report);
  if(mode==="--json")process.stdout.write(JSON.stringify(report,null,2)+"\n");
  else if(mode==="--summary")process.stdout.write(JSON.stringify(report.summary,null,2)+"\n");
  else console.log("JODLO legacy service review-only: 7267 unapproved leaves; "+
    "4928 Hindi-script flags, 1784 ID-policy flags, 139 conflicting cross-category label keys; "+
    "zero matcher import, seed, or deployment.");
}
