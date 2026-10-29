import assert from "node:assert/strict";
import test from "node:test";
import {buildLegacyReview} from "./legacy-category-review.mjs";
import {
  makeCatalogExpansionDraft,reviewCatalogExpansionDraft,
} from "./catalog-activation-preflight.mjs";
import {
  buildCatalogMappingReadiness,verifyCatalogMappingReadiness,
  loadPinnedCatalogMappingReadiness,
} from "./catalog-mapping-readiness.mjs";

function sample() {
  const group="home",family="maintenance";
  const cat=(id,name_en="Work "+id,name_hi="काम")=>({
    id,groupId:group,familyId:family,name_en,name_hi,
    safetyTier:"standard",status:"active",active:true,
    selectable:true,serviceCount:0,
  });
  const archive={
    kind:"JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED",
    languagePolicy:["en","hi"],collections:{
      groups:[{id:group,active:true,status:"active"}],
      families:[{id:family,groupId:group,active:true}],
      categories:[
        cat("plumber"),
        cat("UPPER_case"),
        cat("farmer-helper-मजदूर"),
        cat("very-long-name", "A".repeat(121),"हिंदी"),
      ],services:[],
    },
  };
  const report=buildLegacyReview(archive);
  const draft=makeCatalogExpansionDraft(report,
    report.categories.map(row=>row.categoryId));
  return reviewCatalogExpansionDraft(report,draft);
}

test("complete 889 Category mapping audit preserves 28 Groups and 206 Families",()=>{
  const {source,result}=loadPinnedCatalogMappingReadiness();
  assert.equal(result.kind,"JODLO_ALL_CATEGORY_MAPPING_COMPATIBILITY_REVIEW_ONLY");
  assert.equal(result.state,"ALL_CATEGORIES_UNAPPROVED_NO_SQL_NO_SEED");
  assert.equal(result.summary.sourceCategories,889);
  assert.equal(result.summary.representedGroups,28);
  assert.equal(result.summary.representedFamilies,206);
  assert.equal(result.summary.categoryIdsRequiringHumanMapping,1);
  assert.equal(result.summary.categoriesWithSyntaxCompatibleIdsOnly,888);
  assert.equal(result.summary.categoriesAuthorizedForActivation,0);
  assert.equal(result.summary.sqlStatementsGenerated,0);
  assert.equal(new Set(result.categories.map(x=>x.sourceCategoryId)).size,889);
  assert.equal(result.groupFamilyCoverage.reduce((sum,x)=>sum+x.categoryCount,0),889);
  assert.ok(result.categories.every(x=>x.reviewState===
    "HUMAN_ID_SLUG_LABEL_AND_SAFETY_REVIEW_REQUIRED"));
  assert.ok(result.categories.every(x=>x.mandatoryHumanAndFounderGates.length===4));
  const incompatible=result.categories.find(x=>x.sourceCategoryId==="farmer-helper-मजदूर");
  assert.equal(incompatible.categoryIdCandidate,null);
  assert.equal(incompatible.slugCandidate,null);
  assert.ok(incompatible.syntaxIssues.includes("SOURCE_CATEGORY_ID_INCOMPATIBLE"));
  assert.ok(incompatible.syntaxIssues.includes("SOURCE_CATEGORY_SLUG_INCOMPATIBLE"));
  verifyCatalogMappingReadiness(source,result);
});

test("all trade IDs retained; no inferred lowercasing, transliteration or unsafe slug",()=>{
  const out=buildCatalogMappingReadiness(sample());
  assert.equal(out.summary.sourceCategories,4);
  assert.equal(out.summary.representedGroups,1);
  assert.equal(out.summary.representedFamilies,1);
  assert.equal(out.summary.categoryIdsRequiringHumanMapping,1);
  const rows=new Map(out.categories.map(row=>[row.sourceCategoryId,row]));
  assert.equal(rows.get("plumber").categoryIdCandidate,"plumber");
  assert.equal(rows.get("plumber").slugCandidate,"plumber");
  assert.deepEqual(rows.get("plumber").syntaxIssues,[]);
  assert.equal(rows.get("UPPER_case").categoryIdCandidate,"UPPER_case");
  assert.equal(rows.get("UPPER_case").slugCandidate,null);
  assert.ok(rows.get("UPPER_case").syntaxIssues.includes("SOURCE_CATEGORY_SLUG_INCOMPATIBLE"));
  assert.equal(rows.get("farmer-helper-मजदूर").categoryIdCandidate,null);
  assert.equal(rows.get("farmer-helper-मजदूर").slugCandidate,null);
  assert.equal(rows.get("very-long-name").categoryIdCandidate,"very-long-name");
  assert.ok(rows.get("very-long-name").syntaxIssues.includes(
    "EN_LABEL_NEEDS_D1_LENGTH_OR_CONTROL_REVIEW"));
  assert.equal(out.summary.categoryLabelsRequiringHumanCorrection,1);
  assert.equal(out.summary.categoriesAuthorizedForActivation,0);
  assert.equal(out.groupFamilyCoverage[0].categoryCount,4);
});

test("review output cannot grant approval or silently omit Category or human gate",()=>{
  const src=sample(),good=buildCatalogMappingReadiness(src);
  for(const modify of [
    x=>{x.state="APPROVED";},
    x=>{x.summary.categoriesAuthorizedForActivation=1;},
    x=>{x.summary.sqlStatementsGenerated=1;},
    x=>{x.categories[0].approved=true;},
    x=>{x.categories[0].is_active=1;},
    x=>{x.categories[0].categoryIdCandidate="plumber";},
    x=>{x.categories[0].mandatoryHumanAndFounderGates=[];},
    x=>{x.categories.pop();},
    x=>{x.categories[0].sourceCategoryId="invented";},
    x=>{x.groupFamilyCoverage.pop();},
  ]) {
    const altered=structuredClone(good);modify(altered);
    assert.throws(()=>verifyCatalogMappingReadiness(src,altered));
  }
});

test("untrusted, reordered, authorizing or incomplete preflight fails closed",()=>{
  const valid=sample();
  for(const modify of [
    x=>{x.state="M005_DONE";},
    x=>{x.languages=["hi-Latn","en"];},
    x=>{x.sourceJsonSha256="unverified";},
    x=>{x.categories[0].seed=true;},
    x=>{x.categories[0].reviewState="APPROVED";},
    x=>{x.categories[0].mandatoryHumanAndFounderGates=[];},
    x=>{x.categories.push(x.categories[0]);},
    x=>{x.categories.reverse();},
    x=>{x.summary.categoriesAuthorizedForActivation=1;},
  ]) {
    const altered=structuredClone(valid);modify(altered);
    assert.throws(()=>buildCatalogMappingReadiness(altered));
  }
  // The existing source review's ID flag is compulsory, not self-certified.
  const invalid=structuredClone(valid);
  const row=invalid.categories.find(x=>x.sourceCategoryId==="farmer-helper-मजदूर");
  row.sourceReviewFlags=[];
  assert.throws(()=>buildCatalogMappingReadiness(invalid));
});

test("mapping audit never emits PII, location, contact, actual D1 mutation or approval",()=>{
  const out=buildCatalogMappingReadiness(sample());
  const keys=["sourceCategoryId","sourceGroupId","sourceFamilyId",
    "historicalNameEn","historicalNameHi","categoryIdCandidate","slugCandidate",
    "syntaxIssues","historicalReviewFlags","mandatoryHumanAndFounderGates",
    "reviewState"];
  for(const row of out.categories){
    assert.deepEqual(Object.keys(row),keys);
    for(const forbidden of ["phone","owner","worker","latitude","longitude",
      "address","contact","sql","seed","is_active","verified","approved"]){
      assert.ok(!Object.hasOwn(row,forbidden),forbidden);
    }
  }
});
