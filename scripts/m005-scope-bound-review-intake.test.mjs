import assert from "node:assert/strict";
import test from "node:test";
import {loadPinnedM005EvidenceIntake,makeM005EvidenceIntake,
 validateM005EvidenceIntake} from "./m005-scope-bound-review-intake.mjs";
const {intake,summary,scopes,government}=loadPinnedM005EvidenceIntake();
function assertDenied(mutate){
 const copy=structuredClone(intake);mutate(copy);
 assert.throws(()=>validateM005EvidenceIntake(copy,scopes,government));
}
test("all 17 scope-bound review intakes start with four independent pending gates",()=>{
 assert.equal(intake.categories.length,17);
 assert.deepEqual(summary,{categoriesUnderReview:17,evidenceLinksUnverified:0,
   categoriesWithFourLinksAwaitingIndependentReview:0,
   qualifiedHumanSignoffsAuthenticated:0,founderApprovalsAuthenticated:0,
   authorizedCategories:0,activatedCategories:0});
 assert.ok(intake.categories.every(row=>row.signoffs.length===4 &&
   row.signoffs.every(s=>s.status==="NOT_SUBMITTED")));
});
test("one Category can be prepared without arbitrary ten-category restriction",()=>{
 const one=makeM005EvidenceIntake(scopes,government,["plumber"]);
 assert.equal(one.categories.length,1);
 assert.match(one.categories[0].scopeSha256,/^[0-9a-f]{64}$/);
 assert.equal(validateM005EvidenceIntake(one,scopes,government).authorizedCategories,0);
 assert.throws(()=>makeM005EvidenceIntake(scopes,government,["invented"]));
 assert.throws(()=>makeM005EvidenceIntake(scopes,government,["plumber","plumber"]));
});
test("even four linked reviews are always UNVERIFIED and cannot activate electrician",()=>{
 const one=makeM005EvidenceIntake(scopes,government,["electrician"]);
 for(const entry of one.categories[0].signoffs){
   entry.status="EVIDENCE_LINKED_UNVERIFIED";
   entry.evidenceUrl="https://github.com/rekixo-lab/jodlo/pull/55#issuecomment-6459051434";
 }
 const s=validateM005EvidenceIntake(one,scopes,government);
 assert.equal(s.categoriesWithFourLinksAwaitingIndependentReview,1);
 assert.equal(s.founderApprovalsAuthenticated,0);
 assert.equal(s.activatedCategories,0);
});
test("forged signoffs, stale scope digest, altered gates and permission fields fail closed",()=>{
 assertDenied(x=>{x.categories[0].scopeSha256="0".repeat(64);});
 assertDenied(x=>{x.categories[0].pendingReviewerChecks=[];});
 assertDenied(x=>{x.categories[0].signoffs[0].status="SIGNED_OFF";});
 assertDenied(x=>{x.categories[0].signoffs[0].gate="FOUNDER_APPROVED";});
 assertDenied(x=>{x.categories[0].decision="ACTIVE";});
 assertDenied(x=>{x.categories[0].approved=true;});
 // A partial subset is a supported reviewer workflow; never equate it with
 // the full 17-category coverage or with activation approval.
 const partial=structuredClone(intake);
 partial.categories.pop();
 const partialSummary=validateM005EvidenceIntake(partial,scopes,government);
 assert.equal(partialSummary.categoriesUnderReview,16);
 assert.equal(partialSummary.authorizedCategories,0);
 assertDenied(x=>{x.categories.reverse();});
 assertDenied(x=>{x.languages=["en","hi-Latn"];});
});
test("review links from foreign accounts, phishing domains and changed schema are rejected",()=>{
 for(const url of ["https://github.com.evil.example/rekixo-lab/jodlo/pull/4",
   "http://github.com/rekixo-lab/jodlo/pull/4",
   "https://github.com/other/jodlo/pull/5",
   "https://github.com/rekixo-lab/jodlo/issues/5",
   "https://github.com/rekixo-lab/jodlo/pull/0",
   "javascript:alert(1)"]){
   const one=makeM005EvidenceIntake(scopes,government,["plumber"]);
   one.categories[0].signoffs[0].status="EVIDENCE_LINKED_UNVERIFIED";
   one.categories[0].signoffs[0].evidenceUrl=url;
   assert.throws(()=>validateM005EvidenceIntake(one,scopes,government),url);
 }
});
test("changing old bilingual scopes invalidates previously generated review evidence",()=>{
 const changed=structuredClone(scopes);
 changed.categories.find(x=>x.sourceCategoryId==="plumber").proposedScopeHi+=" नया";
 assert.throws(()=>validateM005EvidenceIntake(intake,changed,government));
});
