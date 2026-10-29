import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync,rmSync,symlinkSync} from "node:fs";
import {join,resolve} from "node:path";
import {loadPinnedReviewPackets} from "./catalog-review-packets.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedCategoryExceptionRegister} from "./catalog-review-exception-register.mjs";
import {
  emptyUnifiedReviewInputs,reconcileUnifiedHumanReview,
} from "./catalog-unified-human-review.mjs";
import {makeReviewAttentionQueue} from "./catalog-review-triage.mjs";
import {
  makeHumanReviewActionPacket,validateHumanReviewActionPacket,
  emptyHumanReviewActionPacketSet,reconcileHumanReviewActionPackets,
  loadHumanReviewActionDirectory,
} from "./catalog-human-review-progress.mjs";

const root=resolve(import.meta.dirname,"..");
const review=loadPinnedReviewPackets();
const full=loadPinnedFullCategoryServiceEvidence();
const exceptions=loadPinnedCategoryExceptionRegister();
const queue=makeReviewAttentionQueue(reconcileUnifiedHumanReview(
  emptyUnifiedReviewInputs(review,full),{review,full,exceptions}));
const fresh=()=>emptyHumanReviewActionPacketSet(queue);
const check=(p)=>validateHumanReviewActionPacket(p,queue);
const merge=(p)=>reconcileHumanReviewActionPackets(p,queue);
const clone=x=>structuredClone(x);
const link="https://github.com/rekixo-lab/jodlo/pull/107";

test("45 packets cover all 889 original Categories, 7,267 Services and exactly 2,667 safe review tasks",()=>{
  const packets=fresh(),result=merge(packets);
  assert.equal(result.kind,"JODLO_ALL_HUMAN_REVIEW_LOCAL_PROGRESS_SUMMARY_ONLY");
  assert.equal(result.state,"SELF_REPORTED_LOCAL_PROGRESS_NO_APPROVAL");
  assert.equal(result.summary.reviewPackets,45);
  assert.equal(result.summary.historicalCategories,889);
  assert.equal(result.summary.historicalServices,7267);
  assert.equal(result.summary.humanReviewTasks,2667);
  assert.equal(result.summary.selfReportedTaskStatuses.NOT_STARTED,2667);
  assert.equal(result.summary.categoriesWithUnverifiedEvidenceLinks,0);
  assert.equal(result.summary.categoriesStillRequiringQualifiedReview,889);
  assert.equal(result.summary.servicesStillRequiringQualifiedReview,7267);
  const ids=new Set();
  let categories=0,services=0;
  for(const [i,packet] of packets.entries()){
    assert.equal(packet.packetNumber,i+1);
    assert.equal(check(packet).humanReviewTasks,packet.categoryCount*3);
    categories+=packet.categoryCount;
    services+=packet.originalServiceCount;
    for(const c of packet.categories){
      assert.equal(ids.has(c.sourceCategoryId),false);
      ids.add(c.sourceCategoryId);
      assert.equal(c.categoriesAuthorizedForActivation,0);
      assert.equal(c.tasks.length,3);
      for(const t of c.tasks){
        assert.equal(t.status,"NOT_STARTED");
        assert.equal(t.evidenceUrl,null);
        assert.match(t.reviewState,/REVIEW_REQUIRED/);
      }
    }
  }
  assert.equal(categories,889);assert.equal(ids.size,889);assert.equal(services,7267);
  for(const f of ["qualifiedLegalReviewsAuthenticated",
    "qualifiedOccupationalReviewsAuthenticated","humanBilingualReviewsAuthenticated",
    "founderCategoryApprovalsAuthenticated","categoriesAuthorizedForActivation",
    "servicesAuthorizedForActivation","approvedAliases","sqlStatementsGenerated"])
    assert.equal(result.summary[f],0);
});

test("self-reported progress, evidence and specialist handoff remain explicitly unverified",()=>{
  const packets=fresh(),first=packets[0].categories[0];
  first.tasks[0].status="SELF_REPORTED_IN_PROGRESS";
  first.tasks[1].status="EVIDENCE_LINKED_UNVERIFIED";
  first.tasks[1].evidenceUrl=link;
  first.tasks[2].status="SPECIALIST_HANDOFF_PENDING";
  first.tasks[2].evidenceUrl=link+"#issuecomment-21";
  const result=merge(packets),s=result.summary;
  assert.equal(s.selfReportedTaskStatuses.NOT_STARTED,2664);
  assert.equal(s.selfReportedTaskStatuses.SELF_REPORTED_IN_PROGRESS,1);
  assert.equal(s.selfReportedTaskStatuses.EVIDENCE_LINKED_UNVERIFIED,1);
  assert.equal(s.selfReportedTaskStatuses.SPECIALIST_HANDOFF_PENDING,1);
  assert.equal(s.categoriesWithSelfReportedWork,1);
  assert.equal(s.categoriesWithUnverifiedEvidenceLinks,1);
  assert.equal(s.qualifiedLegalReviewsAuthenticated,0);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  assert.equal(s.servicesAuthorizedForActivation,0);
});

test("progress is pinned to the exact original Category and review-evidence snapshot",()=>{
  const originals=fresh(),packet=originals[0];
  const changed=[
    p=>{p.kind="JODLO_APPROVED_CATALOG";},
    p=>{p.state="COMPLETE";},
    p=>{p.languages=["hi","en"];},
    p=>{p.sourceJsonSha256="bad";},
    p=>{p.packetNumber=2;},
    p=>{p.categoryCount--;},
    p=>{p.originalServiceCount=0;},
    p=>{p.categories.pop();},
    p=>{p.categories[0].sourceCategoryId="forged";},
    p=>{p.categories[0].sourceCategorySha256="forged";},
    p=>{p.categories[0].attentionLane="SAFE_AND_VERIFIED";},
    p=>{p.categories[0].originalServiceCount=0;},
    p=>{p.categories[0].reviewState="APPROVED";},
    p=>{p.categories[0].categoriesAuthorizedForActivation=1;},
    p=>{p.categories[0].tasks.pop();},
    p=>{p.categories[0].tasks[0].taskType="RELEASE_PUBLIC";},
    p=>{p.categories[0].tasks[0].reviewState="CERTIFIED";},
    p=>{p.categories[0].tasks[0].status="APPROVED";},
    p=>{p.categories[0].tasks[0].reviewer="invented";},
    p=>{p.categories[0].tasks[0].qualifiedLegalSignoff=true;},
    p=>{p.categories[0].tasks[0].evidenceUrl=link;},
  ];
  for(const [i,fn] of changed.entries()){
    const p=clone(packet);fn(p);
    assert.throws(()=>check(p),undefined,"forged change #"+i);
  }
  const other=clone(originals);other[0]=other[1];
  assert.throws(()=>merge(other));
  assert.throws(()=>merge(originals.slice(0,44)));
});

test("bad URLs, missing evidence, fake completion and invalid status transitions fail closed",()=>{
  const p=fresh()[0];
  const mutate=[
    t=>{t.status="EVIDENCE_LINKED_UNVERIFIED";},
    t=>{t.status="SPECIALIST_HANDOFF_PENDING";},
    t=>{t.status="EVIDENCE_LINKED_UNVERIFIED";t.evidenceUrl="https://example.com/review";},
    t=>{t.status="SPECIALIST_HANDOFF_PENDING";t.evidenceUrl="https://github.com/rekixo-lab/jodlo/issues/107";},
    t=>{t.status="SELF_REPORTED_IN_PROGRESS";t.evidenceUrl=link;},
    t=>{t.status="HUMAN_SIGNED_OFF";t.evidenceUrl=link;},
    t=>{t.status="ACTIVATED";},
  ];
  for(const [i,fn] of mutate.entries()){
    const input=clone(p);fn(input.categories[0].tasks[0]);
    assert.throws(()=>check(input),undefined,"unsafe state #"+i);
  }
});

test("changed source review snapshot invalidates stored progress rather than silently transferring it",()=>{
  const packet=makeHumanReviewActionPacket(queue,1);
  const synthetic=clone(queue);
  synthetic.reviewQueue.find(r=>r.sourceCategoryId===
    packet.categories[0].sourceCategoryId).attentionReasonCodes.push("NEW_SOURCE_DIAGNOSTIC");
  assert.throws(()=>validateHumanReviewActionPacket(packet,synthetic));
  assert.equal(check(packet).categoriesWithAnyLinkedEvidence,0);
});

test("local progress folder requires all 45 real files and rejects symlinks, extras and path escapes",()=>{
  const name=".jodlo-review-progress-test-"+process.pid;
  const base=join(root,name);
  mkdirSync(base,{recursive:true});
  try{
    for(const packet of fresh()){
      writeFileSync(join(base,"review-progress-"+
        String(packet.packetNumber).padStart(2,"0")+".json"),JSON.stringify(packet));
    }
    const read=loadHumanReviewActionDirectory(name);
    assert.equal(merge(read).summary.humanReviewTasks,2667);
    writeFileSync(join(base,"extra.json"),"{}");
    assert.throws(()=>loadHumanReviewActionDirectory(name));
    rmSync(join(base,"extra.json"));
    const path=join(base,"review-progress-01.json");
    rmSync(path);
    symlinkSync(join(base,"review-progress-02.json"),path);
    assert.throws(()=>loadHumanReviewActionDirectory(name));
    rmSync(path);
    assert.throws(()=>loadHumanReviewActionDirectory("../outside"));
    assert.throws(()=>loadHumanReviewActionDirectory("/tmp"));
  }finally{rmSync(base,{recursive:true,force:true});}
});

test("review progress CLI reports all tasks without generating SQL or approvals",()=>{
  const invoke=(...args)=>execFileSync(process.execPath,
    ["scripts/catalog-human-review-progress.mjs",...args],{
      cwd:root,encoding:"utf8",timeout:90000,maxBuffer:8_000_000,
      stdio:["ignore","pipe","pipe"],
    });
  assert.match(invoke("--check"),/2,667 reviewer tasks/);
  const s=JSON.parse(invoke("--summary"));
  assert.equal(s.humanReviewTasks,2667);
  assert.equal(s.selfReportedTaskStatuses.NOT_STARTED,2667);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  const p=JSON.parse(invoke("--template-packet=45"));
  assert.equal(p.packetNumber,45);
  assert.equal(check(p).historicalCategories,p.categoryCount);
  assert.throws(()=>invoke("--template-packet=46"));
  assert.throws(()=>invoke("--review-root=../outside"));
});
