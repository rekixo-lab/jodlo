import assert from "node:assert/strict";
import test from "node:test";
import {
  createReviewPackets,verifyReviewPackets,loadPinnedReviewPackets,parsePacketArg,
} from "./catalog-review-packets.mjs";
import {buildLegacyReview} from "./legacy-category-review.mjs";
import {buildLegacyServiceReview} from "./legacy-service-review.mjs";
import {buildLegacyPhraseReview} from "./legacy-phrase-review.mjs";
import {makeCatalogExpansionDraft,reviewCatalogExpansionDraft} from "./catalog-activation-preflight.mjs";

function sample(){
  const categories=["plumber","carpenter","painter"].map(id=>({
    id,groupId:"home",familyId:"repairs",
    name_en:"Work "+id,name_hi:"काम",safetyTier:"standard",
    status:"active",active:true,selectable:true,serviceCount:1,
  }));
  const data=[
    ["plumber","Tap repair","नल सुधार"],
    ["carpenter","Tap repair","लकड़ी सुधार"],
    ["painter","Wall painting","दीवार की पुताई"],
  ].map(([categoryId,name_en,name_hi],i)=>({
    id:"s"+i,categoryId,groupId:"home",familyId:"repairs",
    name_en,name_hi,
  }));
  const snap={kind:"JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED",
    languagePolicy:["en","hi"],collections:{
      groups:[{id:"home",active:true,status:"active"}],
      families:[{id:"repairs",groupId:"home",active:true}],
      categories,services:data,
    }};
  const cats=buildLegacyReview(snap);
  const services=buildLegacyServiceReview(snap);
  const phrases=buildLegacyPhraseReview(services);
  const preflight=reviewCatalogExpansionDraft(cats,makeCatalogExpansionDraft(
    cats,cats.categories.map(row=>row.categoryId)));
  return {preflight,services,phrases};
}
test("all 889 source Categories included exactly once in 45 packets with immutable pending state",()=>{
  const {manifest,packets}=loadPinnedReviewPackets();
  assert.equal(manifest.summary.categories,889);
  assert.equal(manifest.summary.packetCount,45);
  assert.equal(manifest.summary.categoriesAuthorizedForActivation,0);
  assert.equal(packets.length,45);
  assert.equal(packets.at(-1).categoryCount,9);
  const all=packets.flatMap(p=>p.categories);
  assert.equal(new Set(all.map(x=>x.sourceCategoryId)).size,889);
  assert.equal(all.filter(x=>x.sourceCategoryId==="farmer-helper-मजदूर").length,1);
  assert.ok(all.every(x=>x.reviewState==="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW"));
  assert.equal(packets.reduce((n,p)=>n+p.categoryCount,0),889);
  assert.equal(manifest.packets.length,45);
});
test("same phrase in two trades retains both contexts; neither is authorized",()=>{
  const {preflight,services,phrases}=sample();
  const result=createReviewPackets(preflight,services,phrases,2);
  assert.equal(result.manifest.summary.categories,3);
  assert.equal(result.packets.length,2);
  assert.deepEqual(result.packets.map(x=>x.categoryCount),[2,1]);
  const categories=result.packets.flatMap(x=>x.categories);
  for(const id of ["plumber","carpenter"]){
    const row=categories.find(x=>x.sourceCategoryId===id);
    assert.equal(row.ambiguousCrossCategoryPhraseCount,1);
    assert.deepEqual(row.ambiguousPhraseExamples[0].otherSourceCategoryIds,
      [id==="plumber"?"carpenter":"plumber"]);
    assert.ok(row.sourceReviewFlags.includes("CROSS_CATEGORY_SERVICE_LABEL_REVIEW"));
    assert.equal(row.mandatoryHumanAndFounderGates.length,4);
  }
  verifyReviewPackets(preflight,services,phrases,result);
});
test("service examples are bounded and source lineage preserved",()=>{
  const {preflight,services,phrases}=sample();
  const res=createReviewPackets(preflight,services,phrases);
  for(const item of res.packets.flatMap(x=>x.categories)){
    assert.ok(item.serviceExamples.length<=3);
    assert.ok(item.ambiguousPhraseExamples.length<=3);
    assert.equal(item.sourceGroupId,"home");
    assert.equal(item.sourceFamilyId,"repairs");
    assert.equal(item.sourceServiceCount,1);
    assert.equal(item.reviewState,"BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW");
    assert.ok(!Object.hasOwn(item,"approved"));
    assert.ok(!Object.hasOwn(item,"is_active"));
  }
});
test("modified packet or fabricated approved status cannot validate",()=>{
  const input=sample();
  const good=createReviewPackets(input.preflight,input.services,input.phrases);
  for(const change of [
    x=>{x.packets[0].categories[0].approved=true;},
    x=>{x.packets[0].categories[0].mandatoryHumanAndFounderGates=[];},
    x=>{x.packets[0].categories[0].sourceCategoryId="invented";},
    x=>{x.packets[0].categories[0].serviceExamples[0].nameHi="wrong";},
    x=>{x.manifest.summary.categoriesAuthorizedForActivation=1;},
    x=>{x.packets.pop();},
  ]){
    const bad=structuredClone(good);change(bad);
    assert.throws(()=>verifyReviewPackets(input.preflight,input.services,input.phrases,bad));
  }
});
test("mismatched Service ancestor and altered locale/provenance fail closed",()=>{
  const input=sample();
  const broken=structuredClone(input.services);
  broken.services[0].familyId="unknown";
  assert.throws(()=>createReviewPackets(input.preflight,broken,input.phrases),/parent/);
  const language=structuredClone(input.phrases);
  language.languages=["en","hi-Latn"];
  assert.throws(()=>createReviewPackets(input.preflight,input.services,language),/Untrusted/);
  const approval=structuredClone(input.preflight);
  approval.categories[0].approved=true;
  assert.throws(()=>createReviewPackets(approval,input.services,input.phrases),/authorized/);
});
test("packet sizes and index validation are strict",()=>{
  const input=sample();
  for(const size of [0,26,-1,1.5,NaN,Infinity]){
    assert.throws(()=>createReviewPackets(input.preflight,input.services,input.phrases,size));
  }
  for(const value of ["--packet=0","--packet=01","--packet=-1","--packet=46",
    "--packet=1;rm","--packet=1&debug=1","--packet=x"]){
    assert.throws(()=>parsePacketArg(value,45),undefined,value);
  }
  assert.equal(parsePacketArg("--packet=45",45),45);
  assert.equal(createReviewPackets(input.preflight,input.services,input.phrases,1).packets.length,3);
});
test("full source supports 25-item packets without missing a single Category",()=>{
  const first=loadPinnedReviewPackets();
  const ids=first.packets.flatMap(p=>p.categories.map(x=>x.sourceCategoryId));
  assert.equal(ids.length,889);
  assert.ok(first.packets.every(p=>p.categoryCount<=20));
  assert.equal(first.manifest.summary.categoriesStillNeedingHumanAndFounderReview,889);
});
