import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from "node:fs";
import {join,relative,resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {
  makeServiceCorrectionPacket,validateServiceCorrectionPacket,
} from "./catalog-service-correction-evidence.mjs";

const full=loadPinnedFullCategoryServiceEvidence();
const link="https://github.com/rekixo-lab/jodlo/pull/99";
const draft=n=>makeServiceCorrectionPacket(full,n);
const check=x=>validateServiceCorrectionPacket(x,full);
const findRow=(p,predicate)=>p.categories.flatMap(c=>c.services).find(predicate);
const evidence=(row,lang,value)=>{
  row[lang==="hi"?"proposedNameHi":"proposedNameEn"]=value;
  row.status="EVIDENCE_LINKED_UNVERIFIED";
  row.evidenceUrl=link;
  return row;
};

test("all 889 Category and all 7267 Service originals appear exactly once in all 45 packets",()=>{
  const allCats=[],allLeaves=[];
  for(let n=1;n<=45;n++){
    const p=draft(n);
    assert.equal(p.packetNumber,n);
    assert.equal(p.state,"UNVERIFIED_SERVICE_EDITORIAL_PROPOSALS_NO_ALIAS_IMPORT");
    const expected=full.packets[n-1];
    assert.deepEqual(p.categories.map(c=>c.sourceCategoryId),
      expected.categories.map(c=>c.sourceCategoryId));
    assert.equal(p.categories.length,expected.categoryCount);
    const sum=check(p);
    assert.equal(sum.originalServices,expected.historicalServiceCount);
    assert.equal(sum.servicesWithEvidenceLinksUnverified,0);
    assert.equal(sum.humanBilingualReviewsAuthenticated,0);
    assert.equal(sum.approvedAliases,0);
    assert.equal(sum.categoriesAuthorizedForActivation,0);
    assert.equal(sum.activatedServices,0);
    for(const c of p.categories){
      allCats.push(c.sourceCategoryId);
      for(const s of c.services){
        allLeaves.push(s.sourceServiceId);
        assert.equal(s.status,"NOT_SUBMITTED");
        assert.equal(s.proposedNameEn,null);
        assert.equal(s.proposedNameHi,null);
        assert.equal(s.evidenceUrl,null);
        assert.equal(s.reviewState,
          "HUMAN_BILINGUAL_SERVICE_REVIEW_PENDING_NOT_APPROVED");
      }
    }
  }
  assert.equal(allCats.length,889);
  assert.equal(new Set(allCats).size,889);
  assert.equal(allLeaves.length,7267);
  assert.equal(new Set(allLeaves).size,7267);
});
test("valid Hindi/English human proposals retain original text and no approval",()=>{
  const p=draft(1),leaf=findRow(p,()=>true);
  const oldEn=leaf.historicalNameEn,oldHi=leaf.historicalNameHi;
  evidence(leaf,"hi","घरेलू मरम्मत");
  leaf.proposedNameEn="Household repair support";
  const s=check(p);
  assert.equal(s.servicesWithEvidenceLinksUnverified,1);
  assert.equal(s.proposedEnglishNames,1);
  assert.equal(s.proposedHindiNames,1);
  assert.equal(s.humanBilingualReviewsAuthenticated,0);
  assert.equal(s.humanOccupationalReviewsAuthenticated,0);
  assert.equal(s.founderCategoryApprovalsAuthenticated,0);
  assert.equal(s.approvedAliases,0);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  assert.equal(s.sqlStatementsGenerated,0);
  assert.equal(leaf.historicalNameEn,oldEn);
  assert.equal(leaf.historicalNameHi,oldHi);
});
test("retains other parent ambiguity choices for all existing collisions",()=>{
  const coll=full.packets.flatMap(p=>p.categories.flatMap(c=>c.services))
    .find(s=>s.otherSourceCategoryChoices.en.length||
      s.otherSourceCategoryChoices.hi.length);
  assert.ok(coll);
  const packet=full.packets.find(p=>p.categories.some(c=>
    c.services.some(s=>s.sourceServiceId===coll.sourceServiceId)));
  const p=draft(packet.packetNumber),leaf=findRow(p,s=>s.sourceServiceId===coll.sourceServiceId);
  assert.deepEqual(leaf.otherSourceCategoryChoices,coll.otherSourceCategoryChoices);
  evidence(leaf,"en","Editorial evidence context check");
  const result=check(p);
  assert.equal(result.proposalsWithOriginalAmbiguousParentChoices,1);
  assert.equal(result.approvedAliases,0);
});
test("new phrase matching an existing DIFFERENT parent is only reported, not published",()=>{
  const first=full.packets.flatMap(p=>p.categories.flatMap(c=>
    c.services.map(s=>({category:c.sourceCategoryId,name:s.historicalNameEn}))))[0];
  const other=full.packets.find(p=>p.categories.some(c=>
    c.sourceCategoryId!==first.category&&c.services.length));
  assert.ok(other);
  const p=draft(other.packetNumber);
  const category=p.categories.find(c=>c.sourceCategoryId!==first.category&&c.services.length);
  const leaf=category.services[0];
  if(leaf.historicalNameEn===first.name){
    evidence(leaf,"hi","नई तकनीकी सेवा");
    // another original cross-category collision is still a review issue.
  }else evidence(leaf,"en",first.name);
  const report=check(p);
  assert.equal(report.servicesWithEvidenceLinksUnverified,1);
  if(leaf.proposedNameEn!==null)
    assert.ok(report.newlyDetectedSourceOrProposalPhraseConflictsUnverified>=1);
  assert.equal(report.approvedAliases,0);
});
test("missing source Service, duplicate Service, tampered ancestry or source fingerprint denies",()=>{
  const f=(mutate)=>{const p=draft(1);mutate(p);assert.throws(()=>check(p));};
  f(p=>p.categories[0].services.pop());
  f(p=>p.categories[0].services.reverse());
  f(p=>p.categories[0].sourceGroupId="fake-group");
  f(p=>p.categories[0].sourceCategorySha256="a".repeat(64));
  f(p=>p.categories[0].services[0].sourceServiceId="new-invented-service");
  f(p=>p.categories[0].services[0].sourceServiceSha256="a".repeat(64));
  f(p=>p.categories[0].services[0].historicalNameEn="invented old English label");
  f(p=>p.categories[0].services[0].historicalNameHi="बदला हुआ पुराना नाम");
  f(p=>p.categories[0].services[0].sourceFlags.push("FAKE_CERTIFIED");
  f(p=>p.categories[0].services[0].otherSourceCategoryChoices.en.push("invented"));
  f(p=>p.categories[0].services[0].reviewState="APPROVED");
  f(p=>p.categories[0].services[0].approved=true);
  f(p=>p.categories[0].services[0].is_active=true);
  f(p=>p.languages=["hi-Latn","en"]);
  f(p=>p.state="READY_TO_IMPORT");
});
test("no proposal without evidence or evidence without a genuine name change",()=>{
  const f=(mutate)=>{const p=draft(1);mutate(p);assert.throws(()=>check(p));};
  f(p=>{p.categories[0].services[0].proposedNameHi="नया नाम";});
  f(p=>{p.categories[0].services[0].status="EVIDENCE_LINKED_UNVERIFIED";});
  f(p=>{const s=p.categories[0].services[0];s.status="EVIDENCE_LINKED_UNVERIFIED";s.evidenceUrl=link;});
  f(p=>{const s=p.categories[0].services[0];evidence(s,"en",s.historicalNameEn);});
  f(p=>{const s=p.categories[0].services[0];evidence(s,"hi",s.historicalNameHi);});
  f(p=>{p.categories[0].services[0].evidenceUrl=link;});
});
test("invalid Hindi/English, overlength, malformed URL, XSS-like controls denied",()=>{
  const bad=[
    ["hi","Mixed English शब्द"],["hi","English only"],["hi","नाम\nलाइन"],
    ["hi"," नाम"],["hi","नाम".repeat(62)],["hi","नाम\u0000"],
    ["en","केवल हिंदी"],["en","Painting सेवा"],["en"," A repair"],
    ["en","Repair\nwork"],["en","R".repeat(121)],
    ["en","<script>bad</script>"],
  ];
  for(const [lang,value] of bad){
    const p=draft(1),s=p.categories[0].services[0];
    evidence(s,lang,value);
    assert.throws(()=>check(p),lang+" "+value.slice(0,12));
  }
  for(const url of [
    "http://github.com/rekixo-lab/jodlo/pull/99",
    "https://github.com/not-jodlo/other/pull/99",
    "https://github.com/rekixo-lab/jodlo/issues/99",
    "https://github.com/rekixo-lab/jodlo/pull/99?secret=x",
  ]){
    const p=draft(1),s=p.categories[0].services[0];
    evidence(s,"hi","नई नाम समीक्षा");s.evidenceUrl=url;
    assert.throws(()=>check(p));
  }
});
test("packet CLI reports zero authorization; symlink & outside-root read blocked",()=>{
  const root=resolve(".");
  const dir=mkdtempSync(join(root,".jodlo-service-correction-test-"));
  const json=join(dir,"review.json");
  const linkPath=join(dir,"linked.json");
  try{
    const p=draft(1);
    writeFileSync(json,JSON.stringify(p));
    const run=arg=>execFileSync(process.execPath,
      ["scripts/catalog-service-correction-evidence.mjs",arg],
      {encoding:"utf8",cwd:root});
    assert.match(run("--check"),/ZERO approvals/);
    const summary=JSON.parse(run("--summary"));
    assert.equal(summary.originalServices,7267);
    assert.equal(summary.approvedAliases,0);
    const report=JSON.parse(run("--validate-file="+relative(root,json)));
    assert.equal(report.originalServices,p.categories.reduce((n,c)=>n+c.services.length,0));
    symlinkSync(json,linkPath);
    assert.throws(()=>run("--validate-file="+relative(root,linkPath)));
    assert.throws(()=>run("--validate-file=../outside.json"));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
