import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedM005ScopeReview} from "./verify-m005-first-scope-review.mjs";
import {
  ISSUE_CODES,makeAllCategoryExceptionRegister,loadPinnedCategoryExceptionRegister,
} from "./catalog-review-exception-register.mjs";

const full=loadPinnedFullCategoryServiceEvidence();
const review=loadPinnedM005ScopeReview().review;
const build=()=>makeAllCategoryExceptionRegister(full,review);
const getRows=r=>r.packets.flatMap(p=>p.categories);
test("all 889 Category rows retained with 7267 Services and absolutely zero approvals",()=>{
  const r=build(),s=r.summary,rows=getRows(r);
  assert.equal(r.packets.length,45);
  assert.equal(s.historicalCategories,889);
  assert.equal(s.historicalServices,7267);
  assert.equal(s.allCategoriesStillNeedingHumanSafetyAndLanguageReview,889);
  assert.equal(s.allServicesStillNeedingHumanLanguageAndScopeReview,7267);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  assert.equal(s.activatedCategories,0);
  assert.equal(s.activatedServices,0);
  assert.equal(s.approvedServiceAliases,0);
  assert.equal(s.sqlStatementsGenerated,0);
  assert.equal(s.humanReviewsAuthenticated,0);
  assert.equal(s.founderCategoryApprovalsAuthenticated,0);
  assert.equal(rows.length,889);
  assert.equal(new Set(rows.map(x=>x.sourceCategoryId)).size,889);
  assert.deepEqual(rows.map(x=>x.sourceCategoryId),
    full.packets.flatMap(p=>p.categories).map(x=>x.sourceCategoryId));
  assert.equal(rows.reduce((n,c)=>n+c.totalHistoricalServices,0),7267);
  assert.ok(rows.every(row=>row.categoriesAuthorizedForActivation===0&&
    row.reviewState==="HUMAN_LANGUAGE_SAFETY_MAPPING_AND_FOUNDER_REVIEW_PENDING"));
});
test("mechanical issues are original source evidence and all affected Service IDs exist",()=>{
  const r=build();
  const bySource=new Map(full.packets.flatMap(p=>p.categories).map(x=>[
    x.sourceCategoryId,x,
  ]));
  const seenIssueCounts=Object.fromEntries(ISSUE_CODES.map(code=>[code,0]));
  for(const row of getRows(r)){
    const source=bySource.get(row.sourceCategoryId);
    const ids=new Set(source.services.map(s=>s.sourceServiceId));
    for(const issue of row.issues){
      assert.ok(ISSUE_CODES.includes(issue.code));
      assert.ok(issue.sourceDetails.every(s=>typeof s==="string"));
      assert.ok(issue.affectedServiceIds.every(id=>ids.has(id)));
      assert.equal(new Set(issue.affectedServiceIds).size,issue.affectedServiceIds.length);
      seenIssueCounts[issue.code]++;
    }
  }
  assert.equal(seenIssueCounts.HINDI_SERVICE_LATIN_SCRIPT,
    r.summary.issueDiagnostics.HINDI_SERVICE_LATIN_SCRIPT.categories);
  assert.equal(r.summary.issueDiagnostics.HINDI_SERVICE_LATIN_SCRIPT.affectedServiceRows,4928);
  assert.equal(r.summary.issueDiagnostics.SERVICE_ID_POLICY.affectedServiceRows,1784);
  assert.equal(r.summary.issueDiagnostics.CATEGORY_ID_SYNTAX.categories,1);
  assert.equal(r.summary.issueDiagnostics.DESK_EXTRA_REVIEW.categories,4);
  assert.equal(r.summary.issueDiagnostics.DESK_SPECIALIST_HOLD.categories,3);
  assert.ok(r.summary.issueDiagnostics.SHARED_SERVICE_PHRASE_PARENTS.categories>0);
});
test("17 historical desk assessments only, 872 are explicitly unassessed",()=>{
  const r=build(),rows=getRows(r);
  assert.equal(r.summary.deskReviewedCategories,17);
  assert.equal(r.summary.deskUnassessedCategories,872);
  const samples=rows.filter(x=>x.deskReviewOnly.assessment!=="NOT_DESK_ASSESSED");
  assert.equal(samples.length,17);
  const outcomes=new Map();
  for(const row of samples){
    const k=row.deskReviewOnly.assessment;
    outcomes.set(k,(outcomes.get(k)??0)+1);
    assert.equal(row.deskReviewOnly.reviewState,"ALL_APPROVALS_PENDING");
    assert.ok(row.deskReviewOnly.riskReason);
  }
  assert.equal(outcomes.get("NARROW_SCOPE_RECOMMENDATION"),10);
  assert.equal(outcomes.get("EXTRA_REVIEW_REQUIRED"),4);
  assert.equal(outcomes.get("HOLD_FOR_SPECIALIST_POLICY"),3);
  const held=rows.find(x=>x.sourceCategoryId==="electrician");
  assert.equal(held.deskReviewOnly.assessment,"HOLD_FOR_SPECIALIST_POLICY");
  assert.ok(held.issues.some(x=>x.code==="DESK_SPECIALIST_HOLD"));
  const unknown=rows.filter(x=>x.deskReviewOnly.assessment==="NOT_DESK_ASSESSED");
  assert.equal(unknown.length,872);
  assert.ok(unknown.every(x=>x.deskReviewOnly.riskReason===null&&
    x.reviewState==="HUMAN_LANGUAGE_SAFETY_MAPPING_AND_FOUNDER_REVIEW_PENDING"));
});
test("source incompatibility remains in register, never silently remapped",()=>{
  const r=build();
  const row=getRows(r).find(x=>x.sourceCategoryId==="farmer-helper-मजदूर");
  assert.ok(row);
  assert.ok(row.issues.some(x=>x.code==="CATEGORY_ID_SYNTAX"));
  assert.ok(row.issues.some(x=>x.code==="CATEGORY_SLUG_SYNTAX"));
  assert.equal(row.categoriesAuthorizedForActivation,0);
});
test("fail closed on missing/duplicate Categories and Services or forged review statuses",()=>{
  const missing=structuredClone(full);
  missing.packets[0].categories.pop();
  assert.throws(()=>makeAllCategoryExceptionRegister(missing,review));
  const old=structuredClone(full);
  old.packets[0].categories[0].reviewState="APPROVED";
  assert.throws(()=>makeAllCategoryExceptionRegister(old,review));
  const fake=structuredClone(full);
  const some=fake.packets.flatMap(p=>p.categories).find(c=>c.services.length);
  some.services[0].reviewState="APPROVED";
  assert.throws(()=>makeAllCategoryExceptionRegister(fake,review));
  const repeated=structuredClone(full);
  const categories=repeated.packets.flatMap(p=>p.categories).filter(c=>c.services.length);
  categories[1].services[0].sourceServiceId=categories[0].services[0].sourceServiceId;
  assert.throws(()=>makeAllCategoryExceptionRegister(repeated,review),/Service/);
  const hold=structuredClone(review);
  hold.categories.find(c=>c.sourceCategoryId==="electrician").reviewState="APPROVED";
  assert.throws(()=>makeAllCategoryExceptionRegister(full,hold));
  const dropped=structuredClone(review);
  dropped.categories.pop();
  assert.throws(()=>makeAllCategoryExceptionRegister(full,dropped));
  const alteredTier=structuredClone(review);
  alteredTier.categories[0].sourceSafetyTier="UNVERIFIED";
  assert.throws(()=>makeAllCategoryExceptionRegister(full,alteredTier));
});
test("offline CLI lets reviewers inspect exact risk flags and never claims approvals",()=>{
  const verified=loadPinnedCategoryExceptionRegister();
  assert.equal(verified.summary.categoriesAuthorizedForActivation,0);
  const run=arg=>execFileSync(process.execPath,
    ["scripts/catalog-review-exception-register.mjs",arg],{encoding:"utf8"});
  assert.match(run("--check"),/ZERO activation/);
  const summary=JSON.parse(run("--summary"));
  assert.equal(summary.historicalCategories,889);
  assert.equal(summary.allServicesStillNeedingHumanLanguageAndScopeReview,7267);
  const category=JSON.parse(run("--category=farmer-helper-मजदूर"));
  assert.equal(category.sourceCategoryId,"farmer-helper-मजदूर");
  assert.equal(category.categoriesAuthorizedForActivation,0);
  assert.throws(()=>run("--issue=INVENTED_APPROVAL"));
  assert.throws(()=>run("--category=not-a-real-category"));
});
