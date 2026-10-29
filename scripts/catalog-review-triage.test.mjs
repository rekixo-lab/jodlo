import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {loadPinnedReviewPackets} from "./catalog-review-packets.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedCategoryExceptionRegister} from "./catalog-review-exception-register.mjs";
import {
  emptyUnifiedReviewInputs,reconcileUnifiedHumanReview,
} from "./catalog-unified-human-review.mjs";
import {
  ATTENTION_LANES,makeReviewAttentionQueue,
} from "./catalog-review-triage.mjs";

const review=loadPinnedReviewPackets();
const full=loadPinnedFullCategoryServiceEvidence();
const exceptions=loadPinnedCategoryExceptionRegister();
const build=()=>reconcileUnifiedHumanReview(
  emptyUnifiedReviewInputs(review,full),{review,full,exceptions},
);
const queue=()=>makeReviewAttentionQueue(build());
const copy=x=>structuredClone(x);

test("all 889 original Categories / 7,267 Services remain in exactly 45 packets",()=>{
  const q=queue();
  assert.equal(q.kind,"JODLO_889_CATEGORY_REVIEW_ATTENTION_ORDER_ONLY");
  assert.equal(q.state,"HUMAN_TRIAGE_NOT_RISK_CLASSIFICATION_ZERO_APPROVAL");
  assert.deepEqual(q.languages,["en","hi"]);
  assert.deepEqual(q.attentionLanes.map(x=>x.lane),ATTENTION_LANES);
  assert.equal(q.reviewQueue.length,889);
  assert.equal(q.packets.length,45);
  assert.equal(q.summary.originalCategories,889);
  assert.equal(q.summary.originalServices,7267);
  assert.equal(q.summary.deskAssessedCategories,17);
  assert.equal(q.summary.deskUnassessedCategories,872);
  assert.equal(q.reviewQueue.reduce((sum,x)=>sum+x.sourceServiceCount,0),7267);
  assert.equal(new Set(q.reviewQueue.map(x=>x.sourceCategoryId)).size,889);
  assert.equal(q.packets.reduce((sum,x)=>sum+x.sourceCategories,0),889);
  assert.equal(q.packets.reduce((sum,x)=>sum+x.sourceServices,0),7267);
  for(const lane of ATTENTION_LANES)
    assert.equal(q.summary.categoriesByPrimaryAttentionLane[lane],
      q.reviewQueue.filter(x=>x.attentionLane===lane).length);
  assert.equal(Object.values(q.summary.categoriesByPrimaryAttentionLane)
    .reduce((n,x)=>n+x,0),889);
  for(const field of [
    "qualifiedLegalReviewsAuthenticated","qualifiedOccupationalReviewsAuthenticated",
    "humanBilingualReviewsAuthenticated","founderCategoryApprovalsAuthenticated",
    "categoriesAuthorizedForActivation","servicesAuthorizedForActivation",
    "approvedAliases","sqlStatementsGenerated",
  ])assert.equal(q.summary[field],0);
  for(const c of q.reviewQueue){
    assert.equal(c.stillRequiresHumanReview,true);
    assert.equal(c.categoriesAuthorizedForActivation,0);
    assert.equal(c.mandatoryReviewStatus,
      "HUMAN_EDITORIAL_OCCUPATIONAL_LEGAL_AND_FOUNDER_REVIEW_REQUIRED");
    assert.equal(c.attentionOrder,ATTENTION_LANES.indexOf(c.attentionLane)+1);
  }
});

test("human-review attention order is stable, not a Category safety score or ten-trade cap",()=>{
  const q=queue(),q2=queue();
  assert.deepEqual(q,q2);
  const keys=q.reviewQueue.map(c=>[
    c.attentionOrder,c.packetNumber,c.sourceCategoryId,
  ]);
  const order=keys.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]||
    (a[2]<b[2]?-1:a[2]>b[2]?1:0));
  assert.deepEqual(keys,order);
  assert.ok(q.summary.categoriesByPrimaryAttentionLane.SPECIALIST_HOLD_REVIEW>=3);
  assert.ok(q.reviewQueue.some(x=>x.deskReviewOnly==="NOT_DESK_ASSESSED"));
  assert.ok(q.reviewQueue.some(x=>x.attentionLane==="BASELINE_HUMAN_REVIEW"));
  assert.ok(q.reviewQueue.some(x=>x.attentionLane==="SOURCE_AND_EDITORIAL_REPAIR"));
  assert.ok(q.reviewQueue.some(x=>x.attentionLane==="AMBIGUOUS_PARENT_REVIEW"));
});

test("existing specialist holds dominate, even with historical mechanical diagnostics",()=>{
  const q=queue();
  const held=q.reviewQueue.filter(x=>x.sourceDiagnosticCodes.includes(
    "DESK_SPECIALIST_HOLD"));
  assert.equal(held.length,3);
  for(const c of held){
    assert.equal(c.attentionLane,"SPECIALIST_HOLD_REVIEW");
    assert.ok(c.attentionReasonCodes.includes("DESK_SPECIALIST_HOLD"));
    assert.equal(c.categoriesAuthorizedForActivation,0);
  }
});

test("unverified explicit occupational concern receives attention without granting safety approval",()=>{
  const x=build();
  const row=x.packets[0].categories[0];
  row.serviceScopeConcernRowsUnverified=1;
  row.serviceScopeConcernCodesUnverified=1;
  if(!row.combinedHumanReviewChecks.includes("SERVICE_SPECIALIST_CONCERNS_SUBMITTED"))
    row.combinedHumanReviewChecks.push("SERVICE_SPECIALIST_CONCERNS_SUBMITTED");
  const q=makeReviewAttentionQueue(x);
  const entry=q.reviewQueue.find(r=>r.sourceCategoryId===row.sourceCategoryId);
  if(!entry.sourceDiagnosticCodes.includes("DESK_SPECIALIST_HOLD"))
    assert.equal(entry.attentionLane,"REPORTED_SPECIALIST_OR_EXTRA_REVIEW");
  assert.ok(entry.attentionReasonCodes.includes("UNVERIFIED_SERVICE_SCOPE_CONCERN"));
  assert.equal(q.summary.categoriesAuthorizedForActivation,0);
});

test("original shared Service parents take precedence over non-urgent text cleanup",()=>{
  const q=queue();
  const ambiguous=q.reviewQueue.filter(x=>
    x.sourceDiagnosticCodes.includes("SHARED_SERVICE_PHRASE_PARENTS"));
  assert.ok(ambiguous.length>0);
  for(const entry of ambiguous){
    assert.ok([
      "SPECIALIST_HOLD_REVIEW","REPORTED_SPECIALIST_OR_EXTRA_REVIEW",
      "AMBIGUOUS_PARENT_REVIEW",
    ].includes(entry.attentionLane));
    assert.ok(entry.attentionReasonCodes.includes("HISTORICAL_SHARED_SERVICE_PARENT"));
  }
});

test("no mechanical exception never means safe or completed",()=>{
  const q=queue(),baseline=q.reviewQueue.filter(x=>
    x.attentionLane==="BASELINE_HUMAN_REVIEW");
  assert.ok(baseline.length>0);
  for(const row of baseline){
    assert.equal(row.stillRequiresHumanReview,true);
    assert.equal(row.categoriesAuthorizedForActivation,0);
    assert.equal(row.attentionReasonCodes.length,0);
  }
});

test("source corruption, fake reviewer approvals, duplicate records or missing packets are rejected",()=>{
  const orig=build();
  const modifications=[
    x=>{x.summary.historicalCategories=10;},
    x=>{x.summary.categoriesAuthorizedForActivation=1;},
    x=>{x.summary.qualifiedLegalReviewsAuthenticated=1;},
    x=>{x.summary.approvedAliases=1;},
    x=>{x.state="SAFE_TO_PUBLISH";},
    x=>{x.packets.pop();},
    x=>{x.packets[0].categories[0].sourceCategoryId=
      x.packets[0].categories[1].sourceCategoryId;},
    x=>{x.packets[0].categories[0].reviewState="APPROVED";},
    x=>{x.packets[0].categories[0].stillRequiresHumanReview=false;},
    x=>{x.packets[0].categories[0].categoriesAuthorizedForActivation=1;},
    x=>{x.packets[0].categories[0].sourceServiceCount=0;},
    x=>{x.packets[0].categories[0].unexpectedPrivateData="bad";},
  ];
  for(const [i,fn] of modifications.entries()){
    const fake=copy(orig);fn(fake);
    assert.throws(()=>makeReviewAttentionQueue(fake),undefined,
      "tampered review #"+i);
  }
});

test("offline CLI check/summary/packet/lane and invalid inputs",()=>{
  const invoke=(...args)=>execFileSync(process.execPath,
    ["scripts/catalog-review-triage.mjs",...args],{
      cwd:new URL("..",import.meta.url),encoding:"utf8",timeout:90000,
      maxBuffer:20_000_000,stdio:["ignore","pipe","pipe"],
    });
  assert.match(invoke("--check"),/889-Category\/7,267-Service/);
  const s=JSON.parse(invoke("--summary"));
  assert.equal(s.originalCategories,889);
  assert.equal(s.originalServices,7267);
  assert.equal(s.servicesAuthorizedForActivation,0);
  const packets=JSON.parse(invoke("--packets"));
  assert.equal(packets.length,45);
  const last=JSON.parse(invoke("--packet=45"));
  assert.equal(last.packetNumber,45);
  assert.equal(last.categories.length,last.sourceCategories);
  for(const lane of ATTENTION_LANES){
    const result=JSON.parse(invoke("--lane="+lane));
    assert.equal(result.attentionLane,lane);
    assert.equal(result.categories.length,s.categoriesByPrimaryAttentionLane[lane]);
  }
  assert.throws(()=>invoke("--packet=46"));
  assert.throws(()=>invoke("--lane=SAFE_TO_PUBLISH"));
  assert.throws(()=>invoke("--review-root=../outside"));
  assert.throws(()=>invoke("--summary","--packets"));
});
