import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {
  mkdirSync,writeFileSync,rmSync,symlinkSync,
} from "node:fs";
import {resolve,join} from "node:path";
import {loadPinnedReviewPackets} from "./catalog-review-packets.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedCategoryExceptionRegister} from "./catalog-review-exception-register.mjs";
import {
  emptyUnifiedReviewInputs,reconcileUnifiedHumanReview,loadUnifiedReviewDirectory,
} from "./catalog-unified-human-review.mjs";

const root=resolve(import.meta.dirname,"..");
const review=loadPinnedReviewPackets();
const full=loadPinnedFullCategoryServiceEvidence();
const exceptions=loadPinnedCategoryExceptionRegister();
const ctx={review,full,exceptions};
const fresh=()=>emptyUnifiedReviewInputs(review,full);
const report=x=>reconcileUnifiedHumanReview(x,ctx);
const evidence="https://github.com/rekixo-lab/jodlo/pull/105";
function addName(leaf,value="Unified sample work description"){
  leaf.status="EVIDENCE_LINKED_UNVERIFIED";
  leaf.evidenceUrl=evidence;leaf.proposedNameEn=value;
}
function addScope(leaf){
  leaf.status="EVIDENCE_LINKED_UNVERIFIED";
  leaf.evidenceUrl=evidence;
  leaf.proposedScope={
    includedEn:"Limited described work for qualified review",
    includedHi:"सीमित कार्य का वर्णन विशेषज्ञ समीक्षा के लिए",
    excludedEn:"No specialist or hazardous services included",
    excludedHi:"विशेषज्ञ अथवा जोखिमपूर्ण कार्य शामिल नहीं हैं",
    prerequisitesEn:"Professional qualifications require independent checks",
    prerequisitesHi:"कार्य संबंधी योग्यताओं की स्वतंत्र जाँच आवश्यक है",
  };
  leaf.concernCodes=["PHYSICAL_SAFETY_REVIEW"];
}
function addCategory(row){
  row.status="EVIDENCE_LINKED_UNVERIFIED";
  row.evidenceUrl=evidence;
  row.proposedCorrections.nameEn="Distinct reviewer proposed Category title";
}
test("joined queue preserves all 45 packets, 889 Categories, 7,267 Services and zero authorization",()=>{
  const output=report(fresh());
  assert.equal(output.kind,"JODLO_ALL_CATEGORY_SERVICE_JOINT_HUMAN_REVIEW_QUEUE_ONLY");
  assert.equal(output.state,"UNVERIFIED_EVIDENCE_ZERO_AUTHORIZATION");
  assert.deepEqual(output.languages,["en","hi"]);
  assert.equal(output.summary.packetsValidated,45);
  assert.equal(output.summary.historicalCategories,889);
  assert.equal(output.summary.historicalServices,7267);
  assert.equal(output.summary.deskAssessedCategories,17);
  assert.equal(output.summary.deskUnassessedCategories,872);
  assert.equal(output.summary.serviceNameDraftsUnverified,0);
  assert.equal(output.summary.serviceScopeDraftsUnverified,0);
  assert.equal(output.summary.categoriesAuthorizedForActivation,0);
  assert.equal(output.summary.servicesAuthorizedForActivation,0);
  assert.equal(output.summary.sqlStatementsGenerated,0);
  assert.equal(output.packets.length,45);
  const ids=output.packets.flatMap(p=>p.categories.map(c=>c.sourceCategoryId));
  assert.equal(new Set(ids).size,889);
  assert.ok(output.packets.flatMap(p=>p.categories).every(c=>
    c.stillRequiresHumanReview&&c.categoriesAuthorizedForActivation===0&&
    c.reviewState==="HUMAN_EDITORIAL_OCCUPATIONAL_LEGAL_AND_FOUNDER_REVIEW_REQUIRED"));
  assert.equal(output.packets.reduce((n,p)=>n+p.serviceCount,0),7267);
});
test("proposed Category mapping, Service name and occupational scope join strictly by original IDs",()=>{
  const inputs=fresh();
  addCategory(inputs.categoryPackets[0].categories[0]);
  addName(inputs.serviceNamePackets[0].categories[0].services[0]);
  addScope(inputs.serviceScopePackets[0].categories[0].services[0]);
  addName(inputs.serviceNamePackets[0].categories[0].services[1],
    "Second independent Service title proposal");
  const r=report(inputs);
  assert.equal(r.summary.categoryMappingDraftsUnverified,1);
  assert.equal(r.summary.serviceNameDraftsUnverified,2);
  assert.equal(r.summary.serviceScopeDraftsUnverified,1);
  assert.equal(r.summary.serviceNameAndScopeDraftsBothSubmitted,1);
  assert.equal(r.summary.serviceNameDraftsMissingScopeDraft,1);
  assert.equal(r.summary.serviceScopeDraftsMissingNameDraft,0);
  assert.equal(r.summary.categoriesWithAnyUnverifiedDraft,1);
  const c=r.packets[0].categories[0];
  assert.equal(c.categoryMappingDraftStatus,"EVIDENCE_LINKED_UNVERIFIED");
  assert.equal(c.serviceNameDraftsUnverified,2);
  assert.equal(c.serviceScopeDraftsUnverified,1);
  assert.ok(c.combinedHumanReviewChecks.includes(
    "CATEGORY_MAPPING_OR_TITLE_PROPOSAL_UNVERIFIED"));
  assert.ok(c.combinedHumanReviewChecks.includes(
    "SERVICE_NAMES_WITHOUT_SCOPE_DRAFTS"));
  assert.ok(c.combinedHumanReviewChecks.includes(
    "SERVICE_SPECIALIST_CONCERNS_SUBMITTED"));
  assert.equal(c.submittedServiceReviewHandoff.length,2);
  assert.equal(c.submittedServiceReviewHandoff[0].nameEvidenceUrlUnverified,evidence);
  assert.equal(c.submittedServiceReviewHandoff[0].scopeEvidenceUrlUnverified,evidence);
  assert.equal(c.submittedServiceReviewHandoff[1].scopeEvidenceUrlUnverified,null);
  assert.equal(r.summary.qualifiedLegalReviewsAuthenticated,0);
  assert.equal(r.summary.humanBilingualReviewsAuthenticated,0);
  assert.equal(r.summary.categoriesAuthorizedForActivation,0);
});
test("scope-only proposal is visible without demanding automatic Service-name correction",()=>{
  const inp=fresh();
  addScope(inp.serviceScopePackets[0].categories[0].services[0]);
  const r=report(inp),c=r.packets[0].categories[0];
  assert.equal(r.summary.serviceScopeDraftsMissingNameDraft,1);
  assert.ok(c.combinedHumanReviewChecks.includes("SERVICE_SCOPES_WITHOUT_NAME_DRAFTS"));
  assert.ok(c.submittedServiceReviewHandoff[0].outstandingChecks.includes(
    "SERVICE_NAME_DRAFT_MISSING_OR_NOT_REQUIRED_REVIEW"));
  assert.equal(r.summary.servicesAuthorizedForActivation,0);
});
test("two source Categories proposing same normalized name produce human ambiguity conflict, not auto-parent",()=>{
  const inp=fresh();
  const first=inp.serviceNamePackets[0].categories[0].services[0];
  const last=inp.serviceNamePackets[44].categories.at(-1).services[0];
  addName(first,"Standard shared work category review proposed phrase");
  addName(last,"Standard shared work category review proposed phrase");
  const r=report(inp);
  assert.ok(r.summary.unresolvedCrossCategoryNamePhraseKeys>=1);
  const sourceIds=[
    inp.serviceNamePackets[0].categories[0].sourceCategoryId,
    inp.serviceNamePackets[44].categories.at(-1).sourceCategoryId,
  ];
  for(const id of sourceIds){
    const c=r.packets.flatMap(p=>p.categories).find(x=>x.sourceCategoryId===id);
    assert.ok(c.combinedHumanReviewChecks.includes("CROSS_CATEGORY_PHRASE_CONFLICT"));
    assert.ok(c.unresolvedProposedNameConflicts.length>0);
  }
  assert.equal(r.summary.approvedAliases,0);
});
test("cross-stream source tampering, fake approval and incomplete packet set fail closed",()=>{
  const changes=[
    x=>x.categoryPackets.pop(),
    x=>x.serviceNamePackets.reverse(),
    x=>x.serviceScopePackets[0].categories[0].services.pop(),
    x=>x.categoryPackets[0].categories[0].sourceCategoryId="forged",
    x=>x.serviceNamePackets[0].categories[0].services[0].sourceServiceId="forged",
    x=>x.serviceScopePackets[0].categories[0].services[0].reviewState="APPROVED",
    x=>x.categoryPackets[0].categories[0].approved=true,
    x=>x.serviceNamePackets[0].categories[0].services[0].approvedAlias=true,
    x=>x.serviceScopePackets[0].categories[0].services[0].qualifiedSafetyReviewsAuthenticated=1,
  ];
  for(const [i,change] of changes.entries()){
    const inp=fresh();change(inp);
    assert.throws(()=>report(inp),undefined,"unsafe review change #"+i);
  }
  const altered=structuredClone(exceptions);
  altered.summary.categoriesAuthorizedForActivation=1;
  assert.throws(()=>reconcileUnifiedHumanReview(fresh(),{review,full,exceptions:altered}));
});
test("CLI accepts explicit offline modes and rejects made-up original Categories",()=>{
  const invoke=args=>execFileSync(process.execPath,
    ["scripts/catalog-unified-human-review.mjs",...args],{
      cwd:root,encoding:"utf8",timeout:60_000,maxBuffer:8_000_000,
    });
  assert.match(invoke(["--check"]),/889 Category\/7,267 Service/);
  const s=JSON.parse(invoke(["--summary"]));
  assert.equal(s.historicalCategories,889);
  assert.equal(s.historicalServices,7267);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  const p=JSON.parse(invoke(["--packet=45"]));
  assert.equal(p.packetNumber,45);
  const id=full.packets[0].categories[0].sourceCategoryId;
  const c=JSON.parse(invoke(["--category="+id]));
  assert.equal(c.sourceCategoryId,id);
  assert.throws(()=>invoke(["--category=NOT_AN_ORIGINAL_ID"]));
  assert.throws(()=>invoke(["--packet=46"]));
});
test("three complete local review directories must exist; never accept symlink, omissions or extra JSON",()=>{
  const dir=".jodlo-unified-review-test-"+process.pid;
  const base=join(root,dir);
  mkdirSync(base,{recursive:true});
  for(const part of ["category","service-name","service-scope"])
    mkdirSync(join(base,part));
  try{
    const inputs=fresh();
    for(let i=0;i<45;i++){
      const n=String(i+1).padStart(2,"0");
      writeFileSync(join(base,"category","packet-"+n+".json"),
        JSON.stringify(inputs.categoryPackets[i]));
      writeFileSync(join(base,"service-name","service-packet-"+n+".json"),
        JSON.stringify(inputs.serviceNamePackets[i]));
      writeFileSync(join(base,"service-scope","scope-packet-"+n+".json"),
        JSON.stringify(inputs.serviceScopePackets[i]));
    }
    let decoded=loadUnifiedReviewDirectory(dir);
    assert.equal(report(decoded).summary.historicalServices,7267);
    writeFileSync(join(base,"service-scope","unauthorized.json"),"{}");
    assert.throws(()=>loadUnifiedReviewDirectory(dir));
    rmSync(join(base,"service-scope","unauthorized.json"));
    rmSync(join(base,"service-scope","scope-packet-01.json"));
    symlinkSync(join(base,"category","packet-01.json"),
      join(base,"service-scope","scope-packet-01.json"));
    assert.throws(()=>loadUnifiedReviewDirectory(dir));
    rmSync(join(base,"service-scope","scope-packet-01.json"));
    assert.throws(()=>loadUnifiedReviewDirectory("../outside"));
    assert.throws(()=>loadUnifiedReviewDirectory("/tmp"));
  }finally{rmSync(base,{recursive:true,force:true});}
});
