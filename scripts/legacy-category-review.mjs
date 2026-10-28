/** JODLO legacy catalog REVIEW ONLY. Never import into API or seed D1. */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {fileURLToPath} from "node:url";
import {resolve,dirname,join} from "node:path";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const GZ_SHA="c7a7e206490e191ec16ba4cf883a825018746e6e9b35ef1de8b4549d9f38c735";
const JSON_SHA="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const hash=b=>createHash("sha256").update(b).digest("hex");
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const order=(a,b)=>a<b?-1:a>b?1:0;
const publicId=/^[A-Za-z0-9_-]{1,64}$/u;
const latin=/[A-Za-z]/u;
/** Output all 889 individual unapproved review entries; no worker data,
 * activation flag, inferred skill approval, category seed or trust claim. */
export function buildLegacyReview(snapshot) {
  if(snapshot?.kind!=="JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED" ||
     JSON.stringify(snapshot.languagePolicy)!=='["en","hi"]')
    throw Error("Historical archive languages/provenance mismatch");
  const c=snapshot.collections??{};
  if(!["groups","families","categories","services"].every(k=>Array.isArray(c[k])))
    throw Error("Missing historical catalog collection");
  const groups=new Map(c.groups.map(x=>[x.id,x]));
  const families=new Map(c.families.map(x=>[x.id,x]));
  const categories=new Map(c.categories.map(x=>[x.id,x]));
  if(groups.size!==c.groups.length||families.size!==c.families.length||
     categories.size!==c.categories.length)throw Error("Duplicate source ID");
  const byCategory=new Map(),sameLabels=new Map(),sections=new Set();
  for(const service of c.services) {
    const cat=categories.get(service.categoryId);
    if(!cat||service.familyId!==cat.familyId||service.groupId!==cat.groupId)
      throw Error("Broken service ancestry");
    if(!byCategory.has(cat.id))byCategory.set(cat.id,[]);
    byCategory.get(cat.id).push(service);
    if(service.sectionId)sections.add(service.sectionId);
    for(const lang of ["en","hi"]) {
      const label=service["name_"+lang];
      if(typeof label!=="string"||!label.trim())throw Error("Missing service name");
      const key=lang+"\u0000"+label.normalize("NFKC").toLowerCase().trim();
      if(!sameLabels.has(key))sameLabels.set(key,new Set());
      sameLabels.get(key).add(cat.id);
    }
  }
  const collisions=new Map();
  let duplicateLabelKeys=0;
  for(const [label,owners] of sameLabels) {
    if(owners.size<=1)continue;
    duplicateLabelKeys++;
    for(const id of owners){
      if(!collisions.has(id))collisions.set(id,new Set());
      collisions.get(id).add(label);
    }
  }
  let mixedTotal=0;
  const tiers=new Set(),rows=[],flagCounts={};
  for(const cat of c.categories) {
    const group=groups.get(cat.groupId),family=families.get(cat.familyId);
    if(!group||!family||family.groupId!==cat.groupId)
      throw Error("Broken category ancestry");
    const leaves=byCategory.get(cat.id)??[];
    if(cat.serviceCount!==leaves.length)throw Error("Incorrect category service count");
    if(!cat.name_en?.trim()||!cat.name_hi?.trim()||
       typeof cat.safetyTier!=="string"||!cat.safetyTier)
      throw Error("Missing category review metadata");
    tiers.add(cat.safetyTier);
    const mixed=leaves.filter(x=>latin.test(x.name_hi)).length;
    mixedTotal+=mixed;
    const flags=[];
    if(!publicId.test(cat.id))flags.push("CATEGORY_ID_MAPPING_REQUIRED");
    if(group.status!=="active"||group.active!==true)
      flags.push("PARENT_GROUP_STATUS_REVIEW");
    if(family.active!==true||cat.active!==true||cat.selectable!==true||
       cat.status!=="active")flags.push("SOURCE_STATE_REVIEW");
    if(mixed)flags.push("HINDI_SERVICE_SCRIPT_REVIEW");
    const reused=collisions.get(cat.id)?.size??0;
    if(reused)flags.push("CROSS_CATEGORY_SERVICE_LABEL_REVIEW");
    for(const flag of flags)flagCounts[flag]=(flagCounts[flag]??0)+1;
    rows.push({
      categoryId:cat.id,groupId:cat.groupId,familyId:cat.familyId,
      name_en:cat.name_en,name_hi:cat.name_hi,
      historicalSafetyTier:cat.safetyTier,
      sourceServiceCount:leaves.length,
      hindiServicesWithLatin:mixed,
      crossCategoryDuplicatedLabels:reused,
      reviewState:"UNAPPROVED_HUMAN_SAFETY_AND_LANGUAGE_REVIEW_REQUIRED",
      flags,
    });
  }
  rows.sort((a,b)=>order(a.categoryId,b.categoryId));
  return {
    kind:"JODLO_LEGACY_CATEGORY_REVIEW_ONLY",
    state:"NO_APPROVAL_NO_D1_SEED",
    languages:["en","hi"],
    sourceJsonSha256:JSON_SHA,
    summary:{
      groups:groups.size,families:families.size,categories:rows.length,
      services:c.services.length,historicalSafetyTierKinds:tiers.size,
      hindiServiceLabelsWithLatin:mixedTotal,
      categoriesWithCrossCategoryLabels:collisions.size,
      crossCategoryDuplicatedLabelKeys:duplicateLabelKeys,
      unresolvedHistoricalSectionIds:sections.size,
      flags:flagCounts,
    },
    categories:rows,
  };
}
export function loadPinnedLegacySnapshot(root=ROOT) {
  const compressed=readFileSync(join(root,
    "docs/reference/data/finworkar-catalog-bilingual-2026-10-27.json.gz"));
  if(hash(compressed)!==GZ_SHA)throw Error("Reference gzip SHA mismatch");
  const raw=gunzipSync(compressed);
  if(hash(raw)!==JSON_SHA)throw Error("Reference JSON SHA mismatch");
  return JSON.parse(raw.toString("utf8"));
}
export function loadPinnedLegacyReview(root=ROOT) {
  return buildLegacyReview(loadPinnedLegacySnapshot(root));
}
export function assertPinnedReview(report) {
  const s=report.summary;
  const expected={
    groups:28,families:206,categories:889,services:7267,
    historicalSafetyTierKinds:113,hindiServiceLabelsWithLatin:4928,
    categoriesWithCrossCategoryLabels:127,
    crossCategoryDuplicatedLabelKeys:139,
    unresolvedHistoricalSectionIds:1514,
  };
  for(const [key,value] of Object.entries(expected))
    if(s[key]!==value)throw Error("Review baseline changed: "+key);
  for(const [key,value] of Object.entries({
    PARENT_GROUP_STATUS_REVIEW:51,
    CATEGORY_ID_MAPPING_REQUIRED:1,
    HINDI_SERVICE_SCRIPT_REVIEW:616,
    CROSS_CATEGORY_SERVICE_LABEL_REVIEW:127,
  }))if(s.flags[key]!==value)throw Error("Review quality flag changed: "+key);
  if(report.kind!=="JODLO_LEGACY_CATEGORY_REVIEW_ONLY"||
     report.state!=="NO_APPROVAL_NO_D1_SEED"||
     report.sourceJsonSha256!==JSON_SHA||
     JSON.stringify(report.languages)!=='["en","hi"]'||
     report.categories.length!==889||
     report.categories.some(x=>
       x.reviewState!=="UNAPPROVED_HUMAN_SAFETY_AND_LANGUAGE_REVIEW_REQUIRED"||
       own(x,"approved")||own(x,"is_active")||own(x,"seed")||own(x,"publish")))
    throw Error("Unapproved review fields or category counts");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??"--check";
  if(!["--json","--check"].includes(mode)||process.argv.length>3)
    throw Error("Usage: node scripts/legacy-category-review.mjs [--check|--json]");
  const result=loadPinnedLegacyReview();
  assertPinnedReview(result);
  if(mode==="--json")process.stdout.write(JSON.stringify(result,null,2)+"\n");
  else console.log("JODLO read-only category review: 889 unapproved; "+
    "616 Hindi-service-script, 51 parent-state, 127 cross-label, 1 ID mapping. "+
    "No seed, activation or deployment.");
}
