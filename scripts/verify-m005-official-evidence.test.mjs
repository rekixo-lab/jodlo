import assert from "node:assert/strict";
import test from "node:test";
import {loadM005GovernmentEvidence,verifyM005GovernmentEvidence} from "./verify-m005-official-evidence.mjs";
import {loadPinnedM005ScopeReview} from "./verify-m005-first-scope-review.mjs";
const original=loadPinnedM005ScopeReview().review;
const {report,summary}=loadM005GovernmentEvidence();
const bad=fn=>{
  const copy=structuredClone(report);fn(copy);
  assert.throws(()=>verifyM005GovernmentEvidence(copy,original));
};
test("exact 17 Category screening, all official checks pending",()=>{
  assert.deepEqual(summary,{categoriesCrossChecked:17,officialReferences:5,
    proposedNarrow:10,extraReview:4,hold:3,qualifiedHumanSignoffs:0,
    founderApprovals:0,activatedCategories:0});
});
test("tampered provenance, fake government sources and unsupported locales denied",()=>{
  bad(x=>{x.sourceJsonSha256="fake";});
  bad(x=>{x.languages=["en","hi-Latn"];});
  bad(x=>{x.sources[0].url="https://evil.example/approved";});
  bad(x=>{x.sources[0].id=x.sources[1].id;});
});
test("no legal/founder/bilingual approvals or activation can be claimed",()=>{
  bad(x=>{x.categories[0].legalSafetyReview="CERTIFIED";});
  bad(x=>{x.categories[0].founderM005Approval="GRANTED";});
  bad(x=>{x.categories[0].hindiEnglishHumanReview="SIGNED_OFF";});
  bad(x=>{x.categories[0].publicActivation="ACTIVE";});
  bad(x=>{x.categories[0].is_active=true;});
});
test("electrical, AC refrigerant, child protection, device privacy cannot be omitted",()=>{
  for(const [id,source] of [["electrician","CEA_2026"],["ac-technician","RAC_PRACTICES"],
    ["home-tutor","POCSO_2012"],["mobile-repair","PRIVACY_2025"]]){
    bad(x=>{const row=x.categories.find(z=>z.sourceCategoryId===id);
      row.evidenceIds=row.evidenceIds.filter(v=>v!==source);});
  }
  bad(x=>{x.categories.find(z=>z.sourceCategoryId==="laptop-repair").requiredReviewerChecks=[];});
});
test("all 17 categories need consumer applicability and complaint scope review",()=>{
  bad(x=>{x.categories[0].requiredReviewerChecks=[];});
  bad(x=>{x.categories[0].sourceCategoryId="unknown";});
  bad(x=>{x.categories.pop();});
});
