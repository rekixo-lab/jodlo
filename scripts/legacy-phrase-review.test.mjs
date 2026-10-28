import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyPhraseReview, loadPinnedLegacyPhraseReview,
  assertPinnedLegacyPhraseReview,
} from "./legacy-phrase-review.mjs";
import {buildLegacyServiceReview} from "./legacy-service-review.mjs";

function source(services) {
  const ids=[...new Set(services.map(x=>x.categoryId))];
  return {
    kind:"JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED",
    languagePolicy:["en","hi"],
    collections:{
      groups:[{id:"home"}],
      families:[{id:"repairs",groupId:"home"}],
      categories:ids.map(id=>({id,groupId:"home",familyId:"repairs"})),
      services:services.map((row,i)=>({
        id:"service-"+i,
        categoryId:row.categoryId,
        groupId:"home",
        familyId:"repairs",
        name_en:row.en,
        name_hi:row.hi,
      })),
    },
  };
}
function review(items){return buildLegacyPhraseReview(buildLegacyServiceReview(source(items)));}
test("real pinned catalog yields every localized occurrence, and never an approved synonym",()=>{
  const r=loadPinnedLegacyPhraseReview();
  assertPinnedLegacyPhraseReview(r);
  assert.equal(r.summary.historicalServices,7267);
  assert.equal(r.summary.languageOccurrences,14534);
  assert.equal(r.summary.labelsSharedAcrossDifferentCategories,139);
  assert.equal(r.phrases.reduce((n,p)=>n+p.sourceOccurrences.length,0),14534);
  assert.ok(r.phrases.every(p=>p.reviewState.startsWith("UNAPPROVED_")));
  assert.deepEqual(loadPinnedLegacyPhraseReview(),r);
});
test("homonymous work labels preserve both Category parents; never pick wrong trade",()=>{
  const r=review([
    {categoryId:"plumber",en:"Water leak repair",hi:"नल की मरम्मत"},
    {categoryId:"ac-technician",en:"Water leak repair",hi:"एसी की मरम्मत"},
  ]);
  assert.equal(r.summary.labelsSharedAcrossDifferentCategories,1);
  const entry=r.phrases.find(x=>x.locale==="en"&&x.normalizedPhrase==="water leak repair");
  assert.deepEqual(entry.candidateCategoryIdsForHumanReview,["ac-technician","plumber"]);
  assert.equal(entry.sourceOccurrences.length,2);
  assert.ok(entry.flags.includes("MULTIPLE_DIFFERENT_PARENT_CATEGORIES"));
  assert.ok(!Object.hasOwn(entry,"selectedCategoryId"));
  assert.deepEqual(r.summary.ambiguousLabelsByLocale,{en:1,hi:0});
});
test("duplicate phrase among services of SAME category is not cross-trade ambiguity",()=>{
  const r=review([
    {categoryId:"plumber",en:"Tap repair",hi:"नल की मरम्मत"},
    {categoryId:"plumber",en:"Tap repair",hi:"टोंटी ठीक करना"},
  ]);
  const entry=r.phrases.find(x=>x.normalizedPhrase==="tap repair");
  assert.deepEqual(entry.candidateCategoryIdsForHumanReview,["plumber"]);
  assert.equal(entry.sourceOccurrences.length,2);
  assert.ok(entry.flags.includes("MULTIPLE_SERVICES_SAME_PARENT"));
  assert.equal(r.summary.labelsSharedAcrossDifferentCategories,0);
});
test("Hindi distinct combining marks survive Unicode normalization",()=>{
  const r=review([
    {categoryId:"plumber",en:"Water repair",hi:"कला"},
    {categoryId:"carpenter",en:"Wood repair",hi:"किला"},
  ]);
  assert.equal(r.summary.labelsSharedAcrossDifferentCategories,0);
  assert.ok(r.phrases.some(x=>x.normalizedPhrase==="कला"));
  assert.ok(r.phrases.some(x=>x.normalizedPhrase==="किला"));
});
test("Latin-filled Hindi labels and historical incompatible IDs remain REVIEW issues",()=>{
  const snapshot=source([
    {categoryId:"plumber",en:"Tap repair",hi:"टोंटी repair"},
  ]);
  snapshot.collections.services[0].id="plumber-नल";
  const r=buildLegacyPhraseReview(buildLegacyServiceReview(snapshot));
  const entry=r.phrases.find(x=>x.locale==="hi");
  assert.ok(entry.flags.includes("HINDI_LABEL_SCRIPT_REVIEW"));
  assert.ok(entry.flags.includes("HISTORICAL_SERVICE_ID_MAPPING_REVIEW"));
  assert.equal(entry.sourceOccurrences[0].serviceId,"plumber-नल");
  assert.equal(entry.reviewState,"UNAPPROVED_HUMAN_LANGUAGE_AND_PARENT_SCOPE_REQUIRED");
});
test("malformed collection, fabricated approvals or unsupported languages are rejected",()=>{
  const original=buildLegacyServiceReview(source([
    {categoryId:"plumber",en:"Tap repair",hi:"नल ठीक"},
  ]));
  assert.throws(()=>buildLegacyPhraseReview({...original, state:"APPROVED"}),/Unsafe service review input/);
  assert.throws(()=>buildLegacyPhraseReview({...original, languages:["en","hi","hi-Latn"]}),/Unsafe service review input/);
  assert.throws(()=>buildLegacyPhraseReview({...original, services:[...original.services,{...original.services[0]}]}),/Unsafe historical service input/);
  assert.throws(()=>buildLegacyPhraseReview({...original, services:[{...original.services[0],name_en:""}]}),/Invalid bilingual service label/);
});
test("only source taxonomy fields and human review state, no private identity or activation",()=>{
  const r=review([{categoryId:"plumber",en:"Tap repair",hi:"नल की मरम्मत"}]);
  const p=r.phrases.find(x=>x.locale==="hi");
  assert.deepEqual(Object.keys(p),[
    "locale","normalizedPhrase","originalSpellings","candidateCategoryIdsForHumanReview",
    "sourceOccurrences","reviewState","flags",
  ]);
  assert.deepEqual(Object.keys(p.sourceOccurrences[0]),[
    "serviceId","categoryId","familyId","groupId","sourceLabel","sourceFlags",
  ]);
  for(const forbidden of ["ownerId","phone","contact","lat","lng","verified","approved","searchKeywords","selectedCategoryId"]) {
    assert.equal(JSON.stringify(p).includes('"'+forbidden+'":'),false,forbidden);
  }
});
