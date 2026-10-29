import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {loadPinnedReviewPackets} from "./catalog-review-packets.mjs";
import {loadPinnedLegacyServiceReview} from "./legacy-service-review.mjs";
import {loadPinnedLegacyPhraseReview} from "./legacy-phrase-review.mjs";
import {
  buildFullCategoryServiceEvidence,loadPinnedFullCategoryServiceEvidence,
} from "./catalog-service-evidence-packets.mjs";

const review=loadPinnedReviewPackets();
const sourceServices=loadPinnedLegacyServiceReview();
const sourcePhrases=loadPinnedLegacyPhraseReview();
const build=()=>buildFullCategoryServiceEvidence(review,sourceServices,sourcePhrases);
test("complete all-Category bilingual service detail, never an approval",()=>{
  const {manifest,packets}=build();
  assert.equal(manifest.summary.historicalCategories,889);
  assert.equal(manifest.summary.historicalServices,7267);
  assert.equal(manifest.summary.reviewPackets,45);
  assert.equal(manifest.summary.hindiLatinFlaggedServices,4928);
  assert.equal(manifest.summary.serviceIdPolicyFlaggedServices,1784);
  assert.equal(manifest.summary.categoriesAuthorizedForActivation,0);
  assert.equal(manifest.summary.humanReviewsAuthenticated,0);
  assert.equal(manifest.summary.approvedAliases,0);
  assert.equal(manifest.summary.activatedServices,0);
  assert.equal(manifest.summary.sqlStatementsGenerated,0);
  assert.equal(packets[44].categoryCount,9);
  const categories=packets.flatMap(p=>p.categories);
  const services=categories.flatMap(c=>c.services);
  assert.equal(categories.length,889);
  assert.equal(new Set(categories.map(c=>c.sourceCategoryId)).size,889);
  assert.equal(services.length,7267);
  assert.equal(new Set(services.map(s=>s.sourceServiceId)).size,7267);
  assert.ok(services.every(s=>s.reviewState===
    "UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED"));
  assert.ok(categories.every(c=>c.reviewState===
    "BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW"));
  assert.ok(services.every(s=>!Object.hasOwn(s,"approved")&&
    !Object.hasOwn(s,"alias")&&!Object.hasOwn(s,"is_active")));
});
test("every Category's full rows reconcile against original all-Service parent evidence",()=>{
  const {packets}=build();
  const serviceById=new Map(sourceServices.services.map(s=>[s.serviceId,s]));
  for(const packet of packets){
    const original=review.packets[packet.packetNumber-1];
    assert.deepEqual(packet.categories.map(x=>x.sourceCategoryId),
      original.categories.map(x=>x.sourceCategoryId));
    assert.equal(packet.historicalServiceCount,
      packet.categories.reduce((n,c)=>n+c.totalHistoricalServices,0));
    for(const c of packet.categories){
      const source=original.categories.find(x=>x.sourceCategoryId===c.sourceCategoryId);
      assert.equal(c.services.length,source.sourceServiceCount);
      assert.equal(c.hindiLatinFlaggedServices,source.serviceNamesWithLatinInHindi);
      assert.deepEqual(c.services.slice(0,3).map(s=>s.sourceServiceId),
        source.serviceExamples.map(s=>s.sourceServiceId));
      for(const leaf of c.services){
        const orig=serviceById.get(leaf.sourceServiceId);
        assert.equal(orig.categoryId,c.sourceCategoryId);
        assert.equal(orig.groupId,c.sourceGroupId);
        assert.equal(orig.familyId,c.sourceFamilyId);
        assert.equal(leaf.historicalNameEn,orig.name_en);
        assert.equal(leaf.historicalNameHi,orig.name_hi);
        assert.deepEqual(leaf.sourceFlags,orig.flags);
      }
    }
  }
});
test("repeated localized phrases preserve other Category choices, never auto-choose",()=>{
  const {packets}=build();
  const services=packets.flatMap(p=>p.categories.flatMap(c=>
    c.services.map(s=>({parent:c.sourceCategoryId,...s}))));
  const cross=services.filter(s=>
    s.otherSourceCategoryChoices.en.length||
    s.otherSourceCategoryChoices.hi.length);
  assert.ok(cross.length>0);
  const parents=new Set(packets.flatMap(p=>p.categories.map(c=>c.sourceCategoryId)));
  for(const s of cross){
    assert.ok([
      ...s.otherSourceCategoryChoices.en,...s.otherSourceCategoryChoices.hi,
    ].every(other=>parents.has(other)&&other!==s.parent));
    assert.equal(s.reviewState,
      "UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED");
  }
});
test("tampered, missing or orphaned source services and phrases fail closed",()=>{
  const duplicate=structuredClone(sourceServices);
  duplicate.services[0].serviceId=duplicate.services[1].serviceId;
  assert.throws(()=>buildFullCategoryServiceEvidence(review,duplicate,sourcePhrases));
  const missing=structuredClone(sourceServices);
  missing.services.pop();
  assert.throws(()=>buildFullCategoryServiceEvidence(review,missing,sourcePhrases));
  const changedName=structuredClone(sourceServices);
  changedName.services[0].name_en="Unreviewed invented label";
  assert.throws(()=>buildFullCategoryServiceEvidence(review,changedName,sourcePhrases));
  const broken=structuredClone(sourceServices);
  broken.services[0].categoryId="nonexistent-category";
  assert.throws(()=>buildFullCategoryServiceEvidence(review,broken,sourcePhrases));
  const phrase=structuredClone(sourcePhrases);
  phrase.phrases[0].sourceOccurrences[0].serviceId="invented-service";
  assert.throws(()=>buildFullCategoryServiceEvidence(review,sourceServices,phrase));
  const approved=structuredClone(review);
  approved.packets[0].categories[0].reviewState="APPROVED";
  assert.throws(()=>buildFullCategoryServiceEvidence(approved,sourceServices,sourcePhrases));
});
test("source-compatible Category with no historical leaves remains in full review",()=>{
  const {packets}=build();
  const categories=packets.flatMap(p=>p.categories);
  const zero=categories.filter(c=>c.totalHistoricalServices===0);
  assert.equal(zero.length,
    review.packets.flatMap(p=>p.categories).filter(c=>c.sourceServiceCount===0).length);
  assert.ok(categories.some(c=>c.sourceCategoryId==="farmer-helper-मजदूर"));
  assert.equal(packets.reduce((sum,p)=>sum+p.categoryCount,0),889);
});
test("local CLI can inspect full packet and exact original Category without UI or seed",()=>{
  const {manifest,packets}=loadPinnedFullCategoryServiceEvidence();
  assert.equal(manifest.packets.length,45);
  assert.equal(packets[0].categories.length,20);
  const run=arg=>execFileSync(process.execPath,
    ["scripts/catalog-service-evidence-packets.mjs",arg],{encoding:"utf8"});
  assert.match(run("--check"),/ZERO approvals/);
  const selection=JSON.parse(run("--category=farmer-helper-मजदूर"));
  assert.equal(selection.sourceCategoryId,"farmer-helper-मजदूर");
  assert.equal(selection.reviewState,"BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW");
  assert.throws(()=>run("--category=not-an-original-category"));
});
