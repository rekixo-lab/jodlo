import assert from "node:assert/strict";
import test from "node:test";
import {
  loadPinnedEditorialBatch,buildEditorialReviewBatch,validateEditorialProposal,
} from "./editorial-phrase-proposals.mjs";
import {buildLegacyReview} from "./legacy-category-review.mjs";
import {buildLegacyServiceReview} from "./legacy-service-review.mjs";
import {buildLegacyPhraseReview} from "./legacy-phrase-review.mjs";

function source(){
  const categories=["plumber","carpenter","ac-technician"].map(id=>({
    id,groupId:"home",familyId:"repairs",name_en:id,name_hi:"सेवा",
    safetyTier:"standard",active:true,selectable:true,status:"active",serviceCount:1,
  }));
  const services=[
    ["plumber","Tap repair","नल की मरम्मत"],
    ["carpenter","Wooden furniture","लकड़ी का फर्नीचर"],
    ["ac-technician","Water leak repair","पानी leak मरम्मत"],
  ].map(([categoryId,name_en,name_hi],i)=>({
    id:"s"+i,categoryId,groupId:"home",familyId:"repairs",name_en,name_hi,
  }));
  return {kind:"JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED",
    languagePolicy:["en","hi"],collections:{
      groups:[{id:"home",active:true,status:"active"}],
      families:[{id:"repairs",groupId:"home",active:true}],categories,services,
    }};
}
function review(data=source()){
  return {
    cat:buildLegacyReview(data),
    phrase:buildLegacyPhraseReview(buildLegacyServiceReview(data)),
  };
}
test("pinned 10-category editorial proposal batch is deterministic and ALWAYS unapproved",()=>{
  const {batch,phrases,categories}=loadPinnedEditorialBatch();
  assert.deepEqual(validateEditorialProposal(batch,phrases,categories),[]);
  assert.ok(batch.proposedAliases.length>0&&batch.proposedAliases.length<=40);
  assert.equal(batch.state,"NOT_APPROVED_NO_RUNTIME_MATCHER_NO_D1_SEED");
  assert.ok(batch.proposedAliases.every(x=>x.reviewRequired.length===3));
  assert.deepEqual(batch,loadPinnedEditorialBatch().batch);
});
test("proposes exact source IDs for one Category, never Search activation",()=>{
  const {cat,phrase}=review();
  const batch=buildEditorialReviewBatch(phrase,cat,["plumber","carpenter"],2);
  assert.ok(batch.proposedAliases.some(x=>x.categoryId==="plumber"));
  assert.ok(batch.proposedAliases.some(x=>x.categoryId==="carpenter"));
  assert.deepEqual(validateEditorialProposal(batch,phrase,cat),[]);
});
test("cross-trade identical names cannot be assigned to either Category",()=>{
  const data=source();
  data.collections.services[1].name_en="Tap repair";
  const {cat,phrase}=review(data);
  const batch=buildEditorialReviewBatch(phrase,cat,["plumber","carpenter"],2);
  assert.ok(!batch.proposedAliases.some(x=>x.phrase==="tap repair"));
  const tampered=structuredClone(batch);
  tampered.proposedAliases.push({
    locale:"en",phrase:"tap repair",categoryId:"plumber",
    sourceServiceIds:["s0"],sourceGroupId:"home",sourceFamilyId:"repairs",
    reviewRequired:["LANGUAGE_MEANING_REVIEW","TRADE_SCOPE_REVIEW","FOUNDER_M005_CATEGORY_APPROVAL"],
  });
  assert.ok(validateEditorialProposal(tampered,phrase,cat).some(x=>x.includes("Ambiguous")));
});
test("Hindi mixed script and source-state anomalies stay excluded",()=>{
  const {cat,phrase}=review();
  const batch=buildEditorialReviewBatch(phrase,cat,["ac-technician","plumber"],2);
  assert.equal(batch.proposedAliases.some(x=>x.categoryId==="ac-technician"&&x.locale==="hi"),false);
  const blocked=source();
  blocked.collections.groups[0].status="disabled_needs_population";
  const flagged=review(blocked);
  assert.deepEqual(buildEditorialReviewBatch(flagged.phrase,flagged.cat,["plumber"],2).proposedAliases,[]);
});
test("tampering service IDs, parent, category, state, language or reviewer gates fails",()=>{
  const {cat,phrase}=review();
  const original=buildEditorialReviewBatch(phrase,cat,["plumber"],2);
  for(const mutation of [
    x=>{x.proposedAliases[0].sourceServiceIds=["fake"];},
    x=>{x.proposedAliases[0].sourceGroupId="wrong";},
    x=>{x.proposedAliases[0].categoryId="carpenter";},
    x=>{x.proposedAliases[0].reviewRequired=[];},
    x=>{x.proposedAliases[0].approved=true;},
    x=>{x.state="APPROVED";},
    x=>{x.languages=["en","hi","hi-Latn"];},
    x=>{x.proposedAliases[0].phrase="mujhe tap repair";},
  ]){
    const bad=structuredClone(original);
    mutation(bad);
    assert.ok(validateEditorialProposal(bad,phrase,cat).length>0);
  }
});
test("bounds, duplicates and unknown parent IDs fail closed",()=>{
  const {cat,phrase}=review();
  for(const ids of [[],["plumber","plumber"],["no-such-trade"],Array(51).fill("plumber")])
    assert.throws(()=>buildEditorialReviewBatch(phrase,cat,ids,2));
  assert.throws(()=>buildEditorialReviewBatch(phrase,cat,["plumber"],6));
  const duplicate=buildEditorialReviewBatch(phrase,cat,["plumber"],2);
  duplicate.proposedAliases.push(structuredClone(duplicate.proposedAliases[0]));
  assert.ok(validateEditorialProposal(duplicate,phrase,cat).some(x=>x.includes("Duplicate")));
});
