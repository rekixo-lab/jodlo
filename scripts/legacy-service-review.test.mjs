import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyServiceReview,loadPinnedLegacyServiceReview,assertPinnedServiceReview,
} from "./legacy-service-review.mjs";
import {loadPinnedLegacySnapshot} from "./legacy-category-review.mjs";

function fixture(){
  const group={id:"home"},family={id:"repairs",groupId:"home"};
  const makeCategory=id=>({id,groupId:"home",familyId:"repairs"});
  const makeService=(id,categoryId,name_hi)=>({
    id,categoryId,groupId:"home",familyId:"repairs",
    name_en:"Water leakage repair",name_hi,sectionId:"section1",
  });
  return {
    kind:"JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED",
    languagePolicy:["en","hi"],
    collections:{
      groups:[group],families:[family],
      categories:[makeCategory("plumber"),makeCategory("ac-technician")],
      services:[
        makeService("plumber-service","plumber","पानी का रिसाव"),
        makeService("ac-service","ac-technician","वॉटर leak मरम्मत"),
      ],
    },
  };
}
test("source SHA pinned, 7267 service records are review-only with complete, stable coverage",()=>{
  const report=loadPinnedLegacyServiceReview();
  assertPinnedServiceReview(report);
  assert.equal(report.services.length,7267);
  assert.equal(new Set(report.services.map(row=>row.serviceId)).size,7267);
  assert.ok(report.services.every(row=>row.reviewState.startsWith("UNAPPROVED_")));
  assert.ok(report.services.every(row=>!Object.hasOwn(row,"categorySuggestion")));
  assert.deepEqual(report,loadPinnedLegacyServiceReview());
});
test("same service label in different categories never turns into global automatic matching",()=>{
  const report=buildLegacyServiceReview(fixture());
  assert.equal(report.summary.crossCategoryDuplicateLabelKeys,1);
  assert.equal(report.summary.categoriesWithCrossCategoryLabelCollisions,2);
  assert.equal(report.summary.categoriesWithLatinInHindiServiceLabels,1);
  const plumber=report.services.find(x=>x.categoryId==="plumber");
  const ac=report.services.find(x=>x.categoryId==="ac-technician");
  assert.deepEqual(plumber.crossCategoryLabelLocales,["en"]);
  assert.deepEqual(ac.crossCategoryLabelLocales,["en"]);
  assert.ok(ac.flags.includes("HINDI_LABEL_LATIN_SCRIPT_REVIEW"));
  assert.ok(plumber.flags.includes("SAME_SERVICE_LABEL_DIFFERENT_CATEGORIES_REVIEW"));
  assert.equal(plumber.reviewState,"UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED");
});
test("incompatibility of source service IDs is separately signaled, not silently rewritten",()=>{
  const data=fixture();
  data.collections.services[0].id="plumber-सेवा";
  const result=buildLegacyServiceReview(data);
  assert.equal(result.summary.flags.LEAF_ID_MAPPING_POLICY_REQUIRED,1);
  assert.ok(result.services.find(x=>x.categoryId==="plumber")
    .flags.includes("LEAF_ID_MAPPING_POLICY_REQUIRED"));
  assert.equal(result.services.find(x=>x.categoryId==="plumber").serviceId,"plumber-सेवा");
});
test("Hindi combining marks are retained; unrelated Devanagari labels do not collapse",()=>{
  const data=fixture();
  data.collections.services[1].name_en="Air conditioner leak";
  data.collections.services[0].name_hi="कला";
  data.collections.services[1].name_hi="किला";
  const result=buildLegacyServiceReview(data);
  assert.equal(result.summary.crossCategoryDuplicateLabelKeys,0);
  assert.equal(result.summary.categoriesWithLatinInHindiServiceLabels,0);
});
test("orphan parent, duplicate ID, blank translation, extra locale fail closed",()=>{
  const d=fixture();
  d.collections.services[0].categoryId="absent";
  assert.throws(()=>buildLegacyServiceReview(d),/ancestry/);
  const d2=fixture();
  d2.collections.services[0].id="ac-service";
  assert.throws(()=>buildLegacyServiceReview(d2),/repeated historical service ID/);
  const d3=fixture();
  d3.collections.services[0].name_hi="  ";
  assert.throws(()=>buildLegacyServiceReview(d3),/bilingual service name/);
  const d4=fixture();
  d4.languagePolicy=["en","hi","hi-Latn"];
  assert.throws(()=>buildLegacyServiceReview(d4),/language\/provenance/);
});
test("review projection excludes PII, worker fields, trust, activation or matcher seeds",()=>{
  const report=loadPinnedLegacyServiceReview();
  const allowed=[
    "serviceId","categoryId","familyId","groupId","name_en","name_hi",
    "sourceSectionId","crossCategoryLabelLocales","reviewState","flags",
  ];
  for(const row of report.services) {
    assert.deepEqual(Object.keys(row),allowed);
    assert.equal(Object.keys(row).some(x=>
      /worker|account|phone|verified|latitude|longitude|address|contact|approved|active/i.test(x)),false);
  }
  const {collections}=loadPinnedLegacySnapshot();
  assert.equal(collections.services.length,report.services.length);
});
