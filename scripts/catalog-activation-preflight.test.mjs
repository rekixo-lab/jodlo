import assert from "node:assert/strict";
import test from "node:test";
import {
  makeCatalogExpansionDraft,reviewCatalogExpansionDraft,
  verifyCatalogExpansionPreflight,loadPinnedExpansionPreflight,
} from "./catalog-activation-preflight.mjs";
import {buildLegacyReview,loadPinnedLegacyReview} from "./legacy-category-review.mjs";

function sample(){
  const cat=(id)=>({id,groupId:"group",familyId:"family",name_en:"Work "+id,
    name_hi:"काम",safetyTier:"standard",status:"active",
    active:true,selectable:true,serviceCount:1});
  const serv=(id,categoryId)=>({
    id,categoryId,groupId:"group",familyId:"family",
    name_en:"Service "+id,name_hi:"सेवा",
  });
  const raw={kind:"JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED",
    languagePolicy:["en","hi"],collections:{
      groups:[{id:"group",status:"active",active:true}],
      families:[{id:"family",groupId:"group",active:true}],
      categories:[cat("plumber"),cat("carpenter")],
      services:[serv("s1","plumber"),serv("s2","carpenter")],
    }};
  return buildLegacyReview(raw);
}
test("all 889 historical Categories participate, including old unsafe source ID",()=>{
  const output=loadPinnedExpansionPreflight();
  assert.equal(output.categories.length,889);
  assert.equal(output.summary.requestedHistoricalCategories,889);
  assert.equal(output.summary.categoriesAuthorizedForActivation,0);
  assert.equal(output.summary.categoriesStillNeedingFounderDecision,889);
  assert.equal(output.summary.diagnosticFlags.CATEGORY_ID_MAPPING_REQUIRED,1);
  const old=output.categories.find(x=>x.sourceCategoryId==="farmer-helper-मजदूर");
  assert.ok(old.sourceReviewFlags.includes("CATEGORY_ID_MAPPING_REQUIRED"));
  assert.ok(old.mandatoryHumanAndFounderGates.includes("FOUNDER_M005_CATEGORY_ACTIVATION_PENDING"));
  assert.equal(output.state,"ZERO_APPROVAL_ZERO_SQL_ZERO_D1_MUTATION");
  verifyCatalogExpansionPreflight(loadPinnedLegacyReview(),output);
});
test("no arbitrary ten-category cap; mechanically clear still NEEDS human review",()=>{
  const report=sample();
  const draft=makeCatalogExpansionDraft(report,["plumber","carpenter"]);
  assert.deepEqual(draft.sourceCategoryIds,["carpenter","plumber"]);
  const out=reviewCatalogExpansionDraft(report,draft);
  verifyCatalogExpansionPreflight(report,out);
  assert.equal(out.summary.sourceFlaggedCategories,0);
  assert.equal(out.summary.categoriesAuthorizedForActivation,0);
  for(const row of out.categories){
    assert.equal(row.sourceReviewFlags.length,0);
    assert.equal(row.reviewState,"BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW");
    assert.equal(row.mandatoryHumanAndFounderGates.length,4);
  }
});
test("bad source ID, duplicate, missing and fabricated selection cannot pass draft gate",()=>{
  const report=sample();
  for(const ids of [[],["plumber","plumber"],["unknown"],["../plumber"],
    ["plumber",null],Array(890).fill("plumber")]){
    assert.throws(()=>makeCatalogExpansionDraft(report,ids));
  }
  const valid=makeCatalogExpansionDraft(report,["plumber"]);
  for(const mutate of [
    x=>{x.state="APPROVED";},
    x=>{x.approved=true;},
    x=>{x.sourceJsonSha256="forged";},
    x=>{x.languages=["hi-Latn","en"];},
    x=>{x.sourceCategoryIds=["plumber","plumber"];},
    x=>{x.sourceCategoryIds=["unknown"];},
  ]){
    const d=structuredClone(valid);mutate(d);
    assert.throws(()=>reviewCatalogExpansionDraft(report,d));
  }
});
test("source safety issues become review blockers, not activation exemptions",()=>{
  const report=sample();
  report.categories[0].flags.push("PARENT_GROUP_STATUS_REVIEW","HINDI_SERVICE_SCRIPT_REVIEW");
  const draft=makeCatalogExpansionDraft(report,report.categories.map(x=>x.categoryId));
  const out=reviewCatalogExpansionDraft(report,draft);
  assert.equal(out.summary.sourceFlaggedCategories,1);
  assert.equal(out.summary.diagnosticFlags.PARENT_GROUP_STATUS_REVIEW,1);
  assert.equal(out.summary.diagnosticFlags.HINDI_SERVICE_SCRIPT_REVIEW,1);
  assert.equal(out.summary.categoriesAuthorizedForActivation,0);
});
test("tampered output cannot become seed, activated category, or lose gates",()=>{
  const report=sample();
  const expected=reviewCatalogExpansionDraft(report,
    makeCatalogExpansionDraft(report,report.categories.map(x=>x.categoryId)));
  const tamper=[
    x=>{x.categories[0].approved=true;},
    x=>{x.categories[0].mandatoryHumanAndFounderGates=[];},
    x=>{x.summary.categoriesAuthorizedForActivation=1;},
    x=>{x.categories[0].sourceReviewFlags.push("FAKE_FLAG");},
    x=>{x.categories[0].historicalNameHi="FAKE";},
    x=>{x.categories.pop();},
  ];
  for(const mutate of tamper){
    const copy=structuredClone(expected);mutate(copy);
    assert.throws(()=>verifyCatalogExpansionPreflight(report,copy));
  }
});
test("report only contains legacy taxonomy, no worker PII, location or SQL plans",()=>{
  const r=loadPinnedExpansionPreflight();
  const keys=["sourceCategoryId","sourceGroupId","sourceFamilyId",
    "historicalNameEn","historicalNameHi","historicalSafetyTier",
    "sourceServiceCount","sourceReviewFlags",
    "mandatoryHumanAndFounderGates","reviewState"];
  for(const cat of r.categories){
    assert.deepEqual(Object.keys(cat),keys);
    for(const forbidden of ["approved","active","verified","phone","latitude",
      "longitude","contact","seed","sql","owner","worker"]){
      assert.equal(Object.keys(cat).some(x=>x.toLowerCase()===forbidden),false);
    }
  }
});
