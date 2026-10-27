import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyReview,loadPinnedLegacyReview,assertPinnedReview,
} from "./legacy-category-review.mjs";

function example(){
  const cat=(id)=>({id,groupId:"home",familyId:"repairs",name_en:"Service "+id,
    name_hi:"सेवा",active:true,selectable:true,status:"active",
    safetyTier:"standard",serviceCount:1});
  const svc=(id,categoryId,hi)=>({
    id,categoryId,groupId:"home",familyId:"repairs",
    name_en:"Water leak repair",name_hi:hi,sectionId:"section-"+id,
  });
  return {
    kind:"JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED",languagePolicy:["en","hi"],
    collections:{
      groups:[{id:"home",active:true,status:"active"}],
      families:[{id:"repairs",groupId:"home",active:true}],
      categories:[cat("plumber"),cat("ac-technician")],
      services:[svc("s1","plumber","पानी का रिसाव"),
        svc("s2","ac-technician","वॉटर लीक repair")],
    },
  };
}
test("full immutable reference yields 889 individually unapproved review entries",()=>{
  const report=loadPinnedLegacyReview();
  assertPinnedReview(report);
  assert.equal(report.categories.length,889);
  assert.equal(new Set(report.categories.map(x=>x.categoryId)).size,889);
  assert.ok(report.categories.every(x=>x.reviewState.startsWith("UNAPPROVED_")));
  const malformed=report.categories.find(x=>x.categoryId==="farmer-helper-मजदूर");
  assert.ok(malformed.flags.includes("CATEGORY_ID_MAPPING_REQUIRED"));
  assert.deepEqual(report,loadPinnedLegacyReview());
});
test("duplicate labels in different categories are REVIEW issues, not merged trades",()=>{
  const report=buildLegacyReview(example());
  assert.equal(report.summary.categories,2);
  assert.equal(report.summary.crossCategoryDuplicatedLabelKeys,1);
  assert.equal(report.summary.categoriesWithCrossCategoryLabels,2);
  assert.equal(report.summary.hindiServiceLabelsWithLatin,1);
  assert.ok(report.categories.every(x=>x.flags.includes("CROSS_CATEGORY_SERVICE_LABEL_REVIEW")));
  assert.ok(report.categories.find(x=>x.categoryId==="ac-technician")
    .flags.includes("HINDI_SERVICE_SCRIPT_REVIEW"));
  assert.equal(report.state,"NO_APPROVAL_NO_D1_SEED");
});
test("unsafe IDs and parent state contradictions are tracked without approval",()=>{
  const d=example();
  d.collections.groups[0].status="disabled_needs_population";
  d.collections.categories[0].id="plumber-मजदूर";
  d.collections.services[0].categoryId="plumber-मजदूर";
  const r=buildLegacyReview(d);
  assert.equal(r.summary.flags.PARENT_GROUP_STATUS_REVIEW,2);
  assert.equal(r.summary.flags.CATEGORY_ID_MAPPING_REQUIRED,1);
  assert.ok(r.categories.every(x=>!Object.hasOwn(x,"approved")));
});
test("orphan category, bad count or unsupported languages fail closed",()=>{
  const orphan=example();orphan.collections.categories[0].familyId="missing";
  assert.throws(()=>buildLegacyReview(orphan),/ancestry/);
  const wrong=example();wrong.collections.categories[0].serviceCount=17;
  assert.throws(()=>buildLegacyReview(wrong),/service count/);
  const mixed=example();mixed.languagePolicy=["en","hi","hi-Latn"];
  assert.throws(()=>buildLegacyReview(mixed),/provenance/);
});
test("review output projection never exposes worker, contact, trust or GPS data",()=>{
  const report=loadPinnedLegacyReview();
  const allowed=[
    "categoryId","groupId","familyId","name_en","name_hi",
    "historicalSafetyTier","sourceServiceCount","hindiServicesWithLatin",
    "crossCategoryDuplicatedLabels","reviewState","flags",
  ];
  for(const row of report.categories){
    assert.deepEqual(Object.keys(row),allowed);
    assert.equal(Object.keys(row).some(x=>/worker|phone|verified|location|contact|address/i.test(x)),false);
  }
});
