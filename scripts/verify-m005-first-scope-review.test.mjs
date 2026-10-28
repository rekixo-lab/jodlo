import assert from "node:assert/strict";
import test from "node:test";
import {loadPinnedM005ScopeReview,validateM005ScopeReview} from "./verify-m005-first-scope-review.mjs";
import {loadPinnedLegacySnapshot} from "./legacy-category-review.mjs";
import {loadPinnedExpansionPreflight} from "./catalog-activation-preflight.mjs";
const snapshot=loadPinnedLegacySnapshot(),preflight=loadPinnedExpansionPreflight();
test("first 17 actual historical trades each have source-backed bounded scope assessments",()=>{
  const {review,summary}=loadPinnedM005ScopeReview();
  assert.deepEqual(summary,{sourceBacked:17,provisionalNarrow:10,extraReview:4,hold:3,approved:0});
  assert.equal(new Set(review.categories.map(x=>x.sourceCategoryId)).size,17);
  assert.ok(review.categories.every(x=>x.reviewState==="ALL_APPROVALS_PENDING"));
  assert.equal(review.state,"NO_HUMAN_CERTIFICATION_NO_FOUNDER_CATEGORY_APPROVAL_NO_D1_SEED");
});
test("source evidence, Group/Family, historical risk tier remain pinned",()=>{
  const {review}=loadPinnedM005ScopeReview();
  assert.deepEqual(validateM005ScopeReview(review,snapshot,preflight).approved,0);
  for(const edited of [
    x=>x.categories[0].sourceServiceEvidenceEn="invented service",
    x=>x.categories[0].sourceCategoryId="bogus",
    x=>x.categories[0].sourceSafetyTier="standard",
    x=>x.sourceJsonSha256="forged",
  ]){
    const copy=structuredClone(review);edited(copy);
    assert.throws(()=>validateM005ScopeReview(copy,snapshot,preflight));
  }
});
test("no fabricated human certification, approval or reduction of required signoffs",()=>{
  const {review}=loadPinnedM005ScopeReview();
  for(const change of [
    x=>{x.categories[0].approved=true;},
    x=>{x.categories[0].is_active=true;},
    x=>{x.categories[0].reviewState="APPROVED";},
    x=>{x.categories[0].requiredSignoffs=[];},
    x=>{x.state="APPROVED_SEED";},
    x=>{x.assessment="LEGAL_CERTIFIED";},
  ]){
    const c=structuredClone(review);change(c);
    assert.throws(()=>validateM005ScopeReview(c,snapshot,preflight));
  }
});
test("high-risk electrical and refrigerant trades cannot be classified as ordinary",()=>{
  const {review}=loadPinnedM005ScopeReview();
  for(const id of ["electrician","ac-technician"]){
    const c=structuredClone(review);
    c.categories.find(x=>x.sourceCategoryId===id).assessment="NARROW_SCOPE_RECOMMENDATION";
    assert.throws(()=>validateM005ScopeReview(c,snapshot,preflight));
  }
  const c=structuredClone(review);
  c.categories.find(x=>x.sourceCategoryId==="home-tutor").assessment="EXTRA_REVIEW_REQUIRED";
  assert.throws(()=>validateM005ScopeReview(c,snapshot,preflight));
});
test("no Romanized-Hindi or English script in suggested Hindi labels/scopes",()=>{
  const {review}=loadPinnedM005ScopeReview();
  for(const change of [
    x=>x.categories[0].suggestedNameHi="plumber",
    x=>x.categories[0].proposedScopeHi="mujhe tap repair",
    x=>x.categories[0].excludedWorkHi="unsafe wiring",
  ]){
    const c=structuredClone(review);change(c);
    assert.throws(()=>validateM005ScopeReview(c,snapshot,preflight));
  }
});
test("unknown high-risk and private data categories remain gated; no runtime seed fields",()=>{
  const {review}=loadPinnedM005ScopeReview();
  for(const row of review.categories){
    assert.equal(Object.hasOwn(row,"sql"),false);
    assert.equal(Object.hasOwn(row,"publish"),false);
    assert.equal(Object.hasOwn(row,"verified"),false);
    assert.equal(Object.hasOwn(row,"workerId"),false);
  }
  const wrong=structuredClone(review);
  wrong.categories.find(x=>x.sourceCategoryId==="laptop-repair").assessment="NARROW_SCOPE_RECOMMENDATION";
  assert.throws(()=>validateM005ScopeReview(wrong,snapshot,preflight));
});
