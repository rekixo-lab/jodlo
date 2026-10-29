import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {existsSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {
  makeServiceScopePacket,validateServiceScopePacket,
} from "./catalog-service-scope-intake.mjs";

const root=resolve(import.meta.dirname,"..");
const full=loadPinnedFullCategoryServiceEvidence();
const clone=value=>structuredClone(value);
const check=input=>validateServiceScopePacket(input,full);
function proposal(row){
  row.status="EVIDENCE_LINKED_UNVERIFIED";
  row.evidenceUrl="https://github.com/rekixo-lab/jodlo/pull/104";
  row.proposedScope={
    includedEn:"Offer a narrowly described basic service",
    includedHi:"सीमित और स्पष्ट वर्णित सेवा देना",
    excludedEn:"No specialist or high risk service work",
    excludedHi:"विशेषज्ञ या उच्च जोखिम का कार्य शामिल नहीं",
    prerequisitesEn:"Professional qualification must be reviewed",
    prerequisitesHi:"कार्य के लिए योग्यता की समीक्षा आवश्यक है",
  };
  row.concernCodes=["REGULATION_OR_LICENSING_REVIEW","SPECIALIST_QUALIFICATION_REVIEW"];
}
test("all 45 source-pinned occupational packets cover 889 Categories and 7,267 leaves",()=>{
  let count=0,n=0;
  const cat=new Set(),leaf=new Set();
  for(let i=1;i<=45;i++){
    const p=makeServiceScopePacket(full,i);
    const r=check(p);
    assert.equal(r.originalServices,p.categories.reduce((x,c)=>x+c.services.length,0));
    assert.equal(r.scopeDraftsWithUnverifiedEvidence,0);
    assert.equal(r.categoriesAuthorizedForActivation,0);
    assert.equal(r.servicesAuthorizedForActivation,0);
    assert.equal(r.sqlStatementsGenerated,0);
    for(const c of p.categories){
      assert.equal(cat.has(c.sourceCategoryId),false);
      cat.add(c.sourceCategoryId);
      for(const s of c.services){
        assert.equal(leaf.has(s.sourceServiceId),false);
        leaf.add(s.sourceServiceId);
        assert.equal(s.reviewState,"HUMAN_OCCUPATIONAL_LEGAL_AND_BILINGUAL_REVIEW_PENDING");
        assert.equal(s.status,"NOT_SUBMITTED");
        n++;
      }
    }
    count+=p.categories.length;
  }
  assert.equal(count,889);assert.equal(n,7267);
  assert.equal(cat.size,889);assert.equal(leaf.size,7267);
});
test("an evidence-linked bilingual inclusion/exclusion/qualification draft stays UNVERIFIED",()=>{
  const p=makeServiceScopePacket(full,1);
  proposal(p.categories[0].services[0]);
  const s=check(p);
  assert.equal(s.scopeDraftsWithUnverifiedEvidence,1);
  assert.equal(s.proposedConcernRowsUnverified,1);
  assert.equal(s.proposedConcernCodesUnverified,2);
  assert.equal(s.qualifiedLegalReviewsAuthenticated,0);
  assert.equal(s.qualifiedSafetyReviewsAuthenticated,0);
  assert.equal(s.humanBilingualReviewsAuthenticated,0);
  assert.equal(s.servicesAuthorizedForActivation,0);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  assert.equal(s.sqlStatementsGenerated,0);
});
test("reject tampered source, omitted, added, reordered or forged-approved Service rows",()=>{
  const original=makeServiceScopePacket(full,1);
  const mutate=[
    p=>{p.kind="PUBLIC_APPROVED_SERVICE";},
    p=>{p.state="ACTIVATED";},
    p=>{p.languages=["hi","en"];},
    p=>{p.sourceJsonSha256="bad";},
    p=>{p.reviewState="APPROVED";},
    p=>{p.packetNumber=2;},
    p=>{p.categories[0].sourceCategoryId="fake";},
    p=>{p.categories[0].historicalNameEn="False classification";},
    p=>{p.categories[0].historicalSafetyTierNotAuthorization="SAFE";},
    p=>{p.categories[0].sourceCategorySha256="fake";},
    p=>{p.categories[0].services.pop();},
    p=>{p.categories[0].services[0].sourceServiceId="fake";},
    p=>{p.categories[0].services[0].historicalNameHi="नया स्वीकृत काम";},
    p=>{p.categories[0].services[0].sourceServiceSha256="fake";},
    p=>{p.categories[0].services[0].reviewState="APPROVED";},
    p=>{p.categories[0].services[0].sourceFlags.push("TRUSTED");},
    p=>{p.categories[0].services[0].otherSourceCategoryChoices.en.push("fake");},
    p=>{p.categories[0].services[0].approved=true;},
    p=>{p.categories[0].services[0].proposedScope.approved=true;},
    p=>{p.categories[0].services[0].status="APPROVED";},
    p=>{p.categories[0].services[0].concernCodes=["SAFE_NO_CHECK_REQUIRED"];},
    p=>{p.categories[0].services[0].evidenceUrl="https://evil.invalid";},
  ];
  for(const [i,fn] of mutate.entries()){
    const p=clone(original);fn(p);
    assert.throws(()=>check(p),undefined,"source tamper #"+i);
  }
  if(original.categories[0].services.length>1){
    const p=clone(original);
    [p.categories[0].services[0],p.categories[0].services[1]]=[
      p.categories[0].services[1],p.categories[0].services[0]];
    assert.throws(()=>check(p));
  }
});
test("reject fake submitted evidence, transliteration, mixed scripts, unsafe text and concern codes",()=>{
  const original=makeServiceScopePacket(full,1);
  const mutate=[
    p=>{p.categories[0].services[0].status="EVIDENCE_LINKED_UNVERIFIED";},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].evidenceUrl="https://github.com/other/repo/pull/12";},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].evidenceUrl="https://github.com/rekixo-lab/jodlo/issues/104";},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].proposedScope.includedHi="mujhe kaam chahiye";},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].proposedScope.includedHi="मुझे work चाहिए";},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].proposedScope.includedEn="कार्य description";},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].proposedScope.excludedEn="hello\nsecret";},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].proposedScope.prerequisitesEn="https://bad.org";},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].proposedScope.includedEn="hi";},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].proposedScope.includedEn="a".repeat(301);},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].concernCodes=["PHYSICAL_SAFETY_REVIEW","PHYSICAL_SAFETY_REVIEW"];},
    p=>{proposal(p.categories[0].services[0]);p.categories[0].services[0].concernCodes=["SPECIALIST_QUALIFICATION_REVIEW","REGULATION_OR_LICENSING_REVIEW"];},
    p=>{p.categories[0].services[0].proposedScope.includedEn="Draft without evidence";},
  ];
  for(const [i,fn] of mutate.entries()){
    const p=clone(original);fn(p);
    assert.throws(()=>check(p),undefined,"review tamper #"+i);
  }
});
test("source presence does NOT let caller activate or misrepresent independent reviewer approvals",()=>{
  const p=makeServiceScopePacket(full,1);
  proposal(p.categories[0].services[0]);
  assert.throws(()=>check({...p,authorizedServices:1}));
  assert.throws(()=>check({...p,founderApproval:true}));
  p.categories[0].services[0].qualifiedSafetyReviewsAuthenticated=1;
  assert.throws(()=>check(p));
});
test("CLI check, summary and packet are deterministic and reject escaping source paths",async()=>{
  const invoke=(arg)=>execFileSync(process.execPath,
    ["scripts/catalog-service-scope-intake.mjs",arg],{
      cwd:root,encoding:"utf8",timeout:45_000,maxBuffer:6_000_000,
    });
  assert.match(invoke("--check"),/7,267 Service scope drafts/);
  const summary=JSON.parse(invoke("--summary"));
  assert.equal(summary.originalCategories,889);
  assert.equal(summary.originalServices,7267);
  assert.equal(summary.reviewPackets,45);
  assert.equal(summary.categoriesAuthorizedForActivation,0);
  const packet=JSON.parse(invoke("--packet=45"));
  assert.equal(packet.packetNumber,45);
  assert.equal(check(packet).scopeDraftsWithUnverifiedEvidence,0);
  const dir=".jodlo-scope-test-"+process.pid;
  const actual=resolve(root,dir);
  try{
    if(!existsSync(actual)){
      const {mkdirSync}=await import("node:fs");
      mkdirSync(actual);
    }
    writeFileSync(join(actual,"scope.json"),JSON.stringify(packet));
    const result=JSON.parse(invoke("--validate-file="+dir+"/scope.json"));
    assert.equal(result.originalServices,packet.categories.flatMap(c=>c.services).length);
    assert.throws(()=>invoke("--validate-file=../outside.json"));
    assert.throws(()=>invoke("--packet=46"));
  }finally{rmSync(actual,{recursive:true,force:true});}
});
