import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {loadPinnedReviewPackets} from "./catalog-review-packets.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedCategoryExceptionRegister} from "./catalog-review-exception-register.mjs";
import {
  emptyUnifiedReviewInputs,reconcileUnifiedHumanReview,
} from "./catalog-unified-human-review.mjs";
import {makeReviewAttentionQueue} from "./catalog-review-triage.mjs";
import {emptyHumanReviewActionPacketSet} from "./catalog-human-review-progress.mjs";
import {
  AUDIT_FLAGS,auditUnresolvedHumanReviewEvidence,loadPinnedHumanReviewEvidenceAudit,
} from "./catalog-human-review-evidence-audit.mjs";

const review=loadPinnedReviewPackets(),full=loadPinnedFullCategoryServiceEvidence();
const exceptions=loadPinnedCategoryExceptionRegister();
const base=()=>{
  const unified=reconcileUnifiedHumanReview(emptyUnifiedReviewInputs(review,full),
    {review,full,exceptions});
  const queue=makeReviewAttentionQueue(unified);
  return {unified,queue,progress:emptyHumanReviewActionPacketSet(queue)};
};
const audit=x=>auditUnresolvedHumanReviewEvidence(x);
const link="https://github.com/rekixo-lab/jodlo/pull/108";

test("default evidence dossier retains 45 packets, 889 Categories, 7,267 Services and 2,667 unresolved tasks",()=>{
  const result=audit(base());
  assert.equal(result.kind,"JODLO_UNRESOLVED_ALL_TRADE_EVIDENCE_AUDIT_ONLY");
  assert.equal(result.state,"EXTERNAL_EVIDENCE_UNVERIFIED_ALL_HUMAN_SIGNOFFS_PENDING");
  assert.deepEqual(result.languages,["en","hi"]);
  assert.equal(result.summary.historicalCategories,889);
  assert.equal(result.summary.historicalServices,7267);
  assert.equal(result.summary.reviewPackets,45);
  assert.equal(result.summary.requiredReviewTasks,2667);
  assert.equal(result.summary.taskStatusCounts.NOT_STARTED,2667);
  assert.equal(result.summary.categoriesStillAwaitingQualifiedHumanReview,889);
  assert.equal(result.summary.servicesStillAwaitingQualifiedHumanReview,7267);
  assert.equal(result.summary.linkedEvidenceAuthenticationChecksPerformed,0);
  assert.equal(result.summary.distinctExternalReferencesNotChecked,0);
  assert.equal(result.unresolvedCases.length,889);
  assert.equal(new Set(result.unresolvedCases.map(c=>c.sourceCategoryId)).size,889);
  assert.equal(result.packets.reduce((n,x)=>n+x.originalCategories,0),889);
  assert.equal(result.packets.reduce((n,x)=>n+x.originalServices,0),7267);
  assert.equal(result.packets.reduce((n,x)=>n+x.tasksNotStarted,0),2667);
  assert.deepEqual(Object.keys(result.summary.categoriesByAuditFlag),AUDIT_FLAGS);
  for(const key of [
    "tasksAuthenticatedOrLegallyApproved","qualifiedLegalReviewsAuthenticated",
    "qualifiedOccupationalReviewsAuthenticated","humanBilingualReviewsAuthenticated",
    "founderCategoryApprovalsAuthenticated","categoriesAuthorizedForActivation",
    "servicesAuthorizedForActivation","approvedAliases","sqlStatementsGenerated",
  ])assert.equal(result.summary[key],0);
  assert.ok(result.unresolvedCases.every(c=>c.stillRequiresQualifiedHumanAndFounderReview&&
    c.categoriesAuthorizedForActivation===0&&c.taskReviewStatus.length===3));
});

test("valid unverified progress references and specialist handoffs remain unresolved",()=>{
  const input=base();
  const progress=input.progress[0].categories[0];
  progress.tasks[0].status="SELF_REPORTED_IN_PROGRESS";
  progress.tasks[1].status="EVIDENCE_LINKED_UNVERIFIED";
  progress.tasks[1].evidenceUrl=link;
  progress.tasks[2].status="SPECIALIST_HANDOFF_PENDING";
  progress.tasks[2].evidenceUrl=link+"#issuecomment-21";
  const result=audit(input),s=result.summary;
  assert.equal(s.taskStatusCounts.NOT_STARTED,2664);
  assert.equal(s.taskStatusCounts.SELF_REPORTED_IN_PROGRESS,1);
  assert.equal(s.taskStatusCounts.EVIDENCE_LINKED_UNVERIFIED,1);
  assert.equal(s.taskStatusCounts.SPECIALIST_HANDOFF_PENDING,1);
  assert.equal(s.distinctExternalReferencesNotChecked,2);
  const row=result.unresolvedCases.find(c=>c.sourceCategoryId===progress.sourceCategoryId);
  assert.ok(row.unresolvedAuditFlags.includes("SPECIALIST_HANDOFF_PENDING"));
  assert.ok(row.unresolvedAuditFlags.includes("TASK_IN_PROGRESS_UNVERIFIED"));
  assert.ok(row.unresolvedAuditFlags.includes("TASK_EVIDENCE_LINKED_UNVERIFIED"));
  assert.equal(row.linkedReferencesNotAuthenticated.length,2);
  assert.equal(row.taskReviewStatus[2].qualifiedHumanSignoffVerified,false);
  assert.equal(s.linkedEvidenceAuthenticationChecksPerformed,0);
  assert.equal(s.categoriesAuthorizedForActivation,0);
});

test("same PR cited across separate Categories is a context hint, never automatic invalidation",()=>{
  const input=base(),a=input.progress[0].categories[0],
    b=input.progress[0].categories[1];
  for(const c of [a,b]){
    c.tasks[0].status="EVIDENCE_LINKED_UNVERIFIED";
    c.tasks[0].evidenceUrl=link;
  }
  const result=audit(input);
  assert.equal(result.summary.distinctExternalReferencesNotChecked,1);
  assert.equal(result.summary.externalReferencesSharedAcrossMultipleCategories,1);
  for(const c of [a,b]){
    const row=result.unresolvedCases.find(x=>x.sourceCategoryId===c.sourceCategoryId);
    assert.ok(row.unresolvedAuditFlags.includes(
      "EVIDENCE_REFERENCE_REUSED_NEEDS_CONTEXT"));
    assert.deepEqual(row.linkedReferencesSharedAcrossCategories,[link]);
  }
  assert.equal(result.summary.founderCategoryApprovalsAuthenticated,0);
});

test("submitted original Service name proposals remain unverified and expose outstanding scope handoffs",()=>{
  const inputs=emptyUnifiedReviewInputs(review,full);
  const service=inputs.serviceNamePackets[0].categories[0].services[0];
  service.status="EVIDENCE_LINKED_UNVERIFIED";
  service.evidenceUrl=link;
  service.proposedNameEn="Reviewer proposed unique Service name for an offline test";
  const unified=reconcileUnifiedHumanReview(inputs,{review,full,exceptions});
  const queue=makeReviewAttentionQueue(unified);
  const result=audit({unified,queue,progress:emptyHumanReviewActionPacketSet(queue)});
  const id=inputs.serviceNamePackets[0].categories[0].sourceCategoryId;
  const row=result.unresolvedCases.find(x=>x.sourceCategoryId===id);
  assert.ok(row.unresolvedAuditFlags.includes("PROPOSED_SERVICE_NAME_UNVERIFIED"));
  assert.ok(row.unresolvedAuditFlags.includes("SERVICE_DRAFT_HANDOFF_UNRESOLVED"));
  assert.equal(row.unverifiedServiceNameDrafts,1);
  assert.equal(row.outstandingNameScopeServiceHandoffs.length,1);
  assert.equal(row.outstandingNameScopeServiceHandoffs[0].sourceServiceId,
    service.sourceServiceId);
  assert.ok(row.linkedReferencesNotAuthenticated.includes(link));
  assert.equal(result.summary.servicesAuthorizedForActivation,0);
});

test("edited source, fake progress approvals, incomplete coverage and changed source evidence are rejected",()=>{
  const originals=base();
  const changes=[
    x=>{x.unified.summary.categoriesAuthorizedForActivation=1;},
    x=>{x.unified.packets.pop();},
    x=>{x.queue.summary.qualifiedLegalReviewsAuthenticated=1;},
    x=>{x.progress.pop();},
    x=>{x.progress[0].categories[0].reviewState="APPROVED";},
    x=>{x.progress[0].categories[0].tasks[0].status="APPROVED";},
    x=>{x.progress[0].categories[0].tasks[0].verifiedExpert=true;},
    x=>{x.progress[0].categories[0].sourceCategorySha256="bad";},
    x=>{x.unified.packets[0].categories[0].sourceCategoryId="forged";},
  ];
  for(const [i,fn] of changes.entries()){
    const input=structuredClone(originals);fn(input);
    assert.throws(()=>audit(input),undefined,"fake audit "+i);
  }
  const renamed=structuredClone(originals);
  renamed.queue.reviewQueue[0].historicalNameEn="altered";
  assert.throws(()=>audit(renamed));
});

test("read-only CLI supports all 45 review packets and rejects invented original IDs/flags",()=>{
  const run=(...args)=>execFileSync(process.execPath,
    ["scripts/catalog-human-review-evidence-audit.mjs",...args],{
      cwd:resolve(import.meta.dirname,".."),encoding:"utf8",
      timeout:90_000,maxBuffer:30_000_000,stdio:["ignore","pipe","pipe"],
    });
  assert.match(run("--check"),/889 Categories \/ 7,267 Services \/ 2,667 tasks/);
  const s=JSON.parse(run("--summary"));
  assert.equal(s.historicalCategories,889);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  const packets=JSON.parse(run("--packets"));
  assert.equal(packets.length,45);
  const last=JSON.parse(run("--packet=45"));
  assert.equal(last.packetNumber,45);
  assert.equal(last.cases.length,last.originalCategories);
  const id=base().unified.packets[0].categories[0].sourceCategoryId;
  const single=JSON.parse(run("--category="+id));
  assert.equal(single.sourceCategoryId,id);
  assert.throws(()=>run("--category=NON_EXISTENT"));
  assert.throws(()=>run("--flag=APPROVED"));
  assert.throws(()=>run("--packet=46"));
  assert.throws(()=>run("--review-root=../outside","--summary"));
});
