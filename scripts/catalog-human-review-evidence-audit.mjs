/**
 * ADR-0011 offline unresolved evidence dossier. Reuses three independently
 * source-checked streams: joint Category/Service evidence, attention queue,
 * and 45-packet local progress. PR URLs are SYNTACTIC REFERENCES ONLY.
 * Never authenticates reviewers, assesses safety or activates anything.
 */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedReviewPackets,parsePacketArg} from "./catalog-review-packets.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedCategoryExceptionRegister} from "./catalog-review-exception-register.mjs";
import {
  emptyUnifiedReviewInputs,loadUnifiedReviewDirectory,reconcileUnifiedHumanReview,
} from "./catalog-unified-human-review.mjs";
import {makeReviewAttentionQueue,ATTENTION_LANES} from "./catalog-review-triage.mjs";
import {
  emptyHumanReviewActionPacketSet,loadHumanReviewActionDirectory,
  reconcileHumanReviewActionPackets,
} from "./catalog-human-review-progress.mjs";

const SOURCE="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const PENDING="HUMAN_EDITORIAL_OCCUPATIONAL_LEGAL_AND_FOUNDER_REVIEW_REQUIRED";
export const AUDIT_FLAGS=Object.freeze([
  "TASK_NOT_STARTED",
  "TASK_IN_PROGRESS_UNVERIFIED",
  "TASK_EVIDENCE_LINKED_UNVERIFIED",
  "SPECIALIST_HANDOFF_PENDING",
  "ORIGINAL_SOURCE_DIAGNOSTIC",
  "PROPOSED_CATEGORY_MAPPING_UNVERIFIED",
  "PROPOSED_SERVICE_NAME_UNVERIFIED",
  "PROPOSED_SERVICE_SCOPE_UNVERIFIED",
  "SERVICE_DRAFT_HANDOFF_UNRESOLVED",
  "CROSS_CATEGORY_PHRASE_COLLISION",
  "SERVICE_SCOPE_CONCERN_REQUIRES_SPECIALIST",
  "EVIDENCE_REFERENCE_REUSED_NEEDS_CONTEXT",
]);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const str=(x)=>typeof x==="string"&&x.length>0;
const exact=(v,keys)=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&
  Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
const unique=a=>[...new Set(a)].sort(cmp);

/** Inputs must come from the *same* source/evidence snapshot. Progress is
 * checked through the exact existing 45-packet fingerprint validators.
 */
export function auditUnresolvedHumanReviewEvidence({unified,queue,progress}={}){
  if(unified?.kind!=="JODLO_ALL_CATEGORY_SERVICE_JOINT_HUMAN_REVIEW_QUEUE_ONLY"||
    unified.state!=="UNVERIFIED_EVIDENCE_ZERO_AUTHORIZATION"||
    unified.sourceJsonSha256!==SOURCE||
    unified.summary?.historicalCategories!==889||
    unified.summary?.historicalServices!==7267||
    unified.summary?.categoriesAuthorizedForActivation!==0||
    unified.summary?.servicesAuthorizedForActivation!==0||
    !Array.isArray(unified.packets)||unified.packets.length!==45||
    queue?.kind!=="JODLO_889_CATEGORY_REVIEW_ATTENTION_ORDER_ONLY"||
    queue.state!=="HUMAN_TRIAGE_NOT_RISK_CLASSIFICATION_ZERO_APPROVAL"||
    queue.sourceJsonSha256!==SOURCE||
    !Array.isArray(queue.reviewQueue)||queue.reviewQueue.length!==889||
    !Array.isArray(progress)||progress.length!==45)
    throw Error("Untrusted/incomplete all-trade review evidence audit input");
  const validated=reconcileHumanReviewActionPackets(progress,queue);
  if(validated.summary?.categoriesAuthorizedForActivation!==0||
    validated.summary?.servicesAuthorizedForActivation!==0||
    validated.summary?.humanReviewTasks!==2667||
    validated.summary?.qualifiedLegalReviewsAuthenticated!==0)
    throw Error("Cannot audit authorizing or missing human tasks");
  const bySource=new Map(),byProgress=new Map();
  for(let i=0;i<45;i++){
    const p=unified.packets[i],t=progress[i];
    if(p?.packetNumber!==i+1||t?.packetNumber!==i+1||
      p.categories.length!==t.categories.length)
      throw Error("Original joint/progress packet order diverged");
    // The source packets retain original archive order; progress cards are
    // intentionally sorted by Category ID. Join by immutable ID, NEVER index.
    const progressById=new Map(t.categories.map(a=>[a.sourceCategoryId,a]));
    if(progressById.size!==t.categories.length)
      throw Error("Duplicate Category in original progress packet");
    for(const u of p.categories){
      const id=u.sourceCategoryId,a=progressById.get(id);
      if(!str(id)||bySource.has(id)||!a||
        u.packetNumber!==i+1||
        u.sourceServiceCount!==a.originalServiceCount||
        a.categoriesAuthorizedForActivation!==0||u.categoriesAuthorizedForActivation!==0)
        throw Error("Original Category is missing, duplicated or not aligned");
      bySource.set(id,u);byProgress.set(id,a);
    }
  }
  if(bySource.size!==889||byProgress.size!==889)
    throw Error("All 889 original source Category rows are mandatory");

  const occurrences=new Map(),refForCategory=new Map();
  for(const [id,row] of bySource){
    const pr=byProgress.get(id);
    const refs=unique([
      row.categoryMappingEvidenceUrlUnverified,
      ...row.submittedServiceReviewHandoff.flatMap(x=>[
        x.nameEvidenceUrlUnverified,x.scopeEvidenceUrlUnverified,
      ]),
      ...pr.tasks.map(x=>x.evidenceUrl),
    ].filter(x=>x!==null));
    refForCategory.set(id,refs);
    for(const url of refs){
      if(!occurrences.has(url))occurrences.set(url,new Set());
      occurrences.get(url).add(id);
    }
  }
  const reused=[...occurrences.entries()].filter(([,ids])=>ids.size>1);
  const reusedSet=new Set(reused.map(([url])=>url));

  const counts=Object.fromEntries(AUDIT_FLAGS.map(x=>[x,0]));
  const categoriesByFlag=Object.fromEntries(AUDIT_FLAGS.map(x=>[x,0]));
  const packets=Array.from({length:45},(_,i)=>({
    packetNumber:i+1,originalCategories:0,originalServices:0,
    tasksNotStarted:0,tasksInProgressUnverified:0,
    tasksWithUnverifiedEvidence:0,tasksRequiringSpecialistHandoff:0,
    categoriesWithUnresolvedDiagnosticFlags:0,
    categoriesWithAnyUnverifiedReference:0,
    categoriesAwaitingQualifiedReview:0,
  }));
  const rows=[];
  for(const attention of queue.reviewQueue){
    const id=attention.sourceCategoryId,u=bySource.get(id),p=byProgress.get(id);
    if(!u||!p||u.packetNumber!==attention.packetNumber||
      u.sourceServiceCount!==attention.sourceServiceCount||
      u.historicalNameEn!==attention.historicalNameEn||
      u.historicalNameHi!==attention.historicalNameHi||
      !ATTENTION_LANES.includes(attention.attentionLane)||
      p.attentionLane!==attention.attentionLane||
      attention.stillRequiresHumanReview!==true||
      attention.categoriesAuthorizedForActivation!==0)
      throw Error("Progress and reviewer attention have different original Categories");
    const refs=refForCategory.get(id);
    const evidenceReused=refs.filter(x=>reusedSet.has(x));
    const flags=new Set(),tasks=p.tasks.map(task=>{
      const status=task.status;
      const flag=status==="NOT_STARTED"?"TASK_NOT_STARTED":
        status==="SELF_REPORTED_IN_PROGRESS"?"TASK_IN_PROGRESS_UNVERIFIED":
        status==="EVIDENCE_LINKED_UNVERIFIED"?"TASK_EVIDENCE_LINKED_UNVERIFIED":
        "SPECIALIST_HANDOFF_PENDING";
      flags.add(flag);counts[flag]++;
      return {
        taskType:task.taskType,reportedStatus:status,
        evidenceReferenceUnverified:task.evidenceUrl,
        authenticationVerified:false,qualifiedHumanSignoffVerified:false,
        stillRequiresHumanReview:true,
      };
    });
    if(u.sourceDiagnostics.length)flags.add("ORIGINAL_SOURCE_DIAGNOSTIC");
    if(u.categoryMappingDraftStatus==="EVIDENCE_LINKED_UNVERIFIED")
      flags.add("PROPOSED_CATEGORY_MAPPING_UNVERIFIED");
    if(u.serviceNameDraftsUnverified)flags.add("PROPOSED_SERVICE_NAME_UNVERIFIED");
    if(u.serviceScopeDraftsUnverified)flags.add("PROPOSED_SERVICE_SCOPE_UNVERIFIED");
    if(u.serviceNamesWithoutScopeDrafts||u.serviceScopesWithoutNameDrafts)
      flags.add("SERVICE_DRAFT_HANDOFF_UNRESOLVED");
    if(u.unresolvedProposedNameConflicts.length)
      flags.add("CROSS_CATEGORY_PHRASE_COLLISION");
    if(u.serviceScopeConcernRowsUnverified)
      flags.add("SERVICE_SCOPE_CONCERN_REQUIRES_SPECIALIST");
    if(evidenceReused.length)flags.add("EVIDENCE_REFERENCE_REUSED_NEEDS_CONTEXT");
    for(const flag of flags)categoriesByFlag[flag]++;
    const packet=packets[u.packetNumber-1];
    packet.originalCategories++;packet.originalServices+=u.sourceServiceCount;
    packet.categoriesAwaitingQualifiedReview++;
    packet.tasksNotStarted+=tasks.filter(t=>t.reportedStatus==="NOT_STARTED").length;
    packet.tasksInProgressUnverified+=tasks.filter(t=>
      t.reportedStatus==="SELF_REPORTED_IN_PROGRESS").length;
    packet.tasksWithUnverifiedEvidence+=tasks.filter(t=>
      t.reportedStatus==="EVIDENCE_LINKED_UNVERIFIED").length;
    packet.tasksRequiringSpecialistHandoff+=tasks.filter(t=>
      t.reportedStatus==="SPECIALIST_HANDOFF_PENDING").length;
    packet.categoriesWithUnresolvedDiagnosticFlags+=Number(
      u.sourceDiagnostics.length>0);
    packet.categoriesWithAnyUnverifiedReference+=Number(refs.length>0);
    rows.push({
      packetNumber:u.packetNumber,sourceCategoryId:id,
      sourceGroupId:u.sourceGroupId,sourceFamilyId:u.sourceFamilyId,
      historicalNameEn:u.historicalNameEn,historicalNameHi:u.historicalNameHi,
      originalServiceCount:u.sourceServiceCount,
      attentionLane:attention.attentionLane,
      attentionOrder:attention.attentionOrder,
      attentionReasons:attention.attentionReasonCodes,
      sourceDiagnosticCodes:u.sourceDiagnostics.map(x=>x.code),
      originalFlaggedServiceIds:attention.flaggedSourceServiceIds,
      unverifiedCategoryMappingProposal:u.categoryMappingProposalUnverified,
      unverifiedServiceNameDrafts:u.serviceNameDraftsUnverified,
      unverifiedServiceScopeDrafts:u.serviceScopeDraftsUnverified,
      unverifiedServiceScopeConcernRows:u.serviceScopeConcernRowsUnverified,
      outstandingNameScopeServiceHandoffs:u.submittedServiceReviewHandoff
        .filter(x=>x.outstandingChecks.length)
        .map(x=>({sourceServiceId:x.sourceServiceId,
          outstandingChecks:x.outstandingChecks})),
      unresolvedPhraseConflicts:u.unresolvedProposedNameConflicts,
      linkedReferencesNotAuthenticated:refs,
      linkedReferencesSharedAcrossCategories:evidenceReused,
      taskReviewStatus:tasks,
      unresolvedAuditFlags:[...flags].sort(cmp),
      reviewsAuthenticated:0,
      categoriesAuthorizedForActivation:0,
      stillRequiresQualifiedHumanAndFounderReview:true,
      reviewState:PENDING,
    });
  }
  if(rows.length!==889||packets.some((p,i)=>
    p.originalCategories!==queue.packets[i].sourceCategories||
    p.originalServices!==queue.packets[i].sourceServices)||
    Object.values(counts).reduce((x,y)=>x+y,0)!==2667||
    counts.TASK_NOT_STARTED!==validated.summary.selfReportedTaskStatuses.NOT_STARTED||
    counts.SPECIALIST_HANDOFF_PENDING!==
      validated.summary.selfReportedTaskStatuses.SPECIALIST_HANDOFF_PENDING)
    throw Error("Unresolved evidence audit lost tasks, original Services or Categories");
  return {
    kind:"JODLO_UNRESOLVED_ALL_TRADE_EVIDENCE_AUDIT_ONLY",
    state:"EXTERNAL_EVIDENCE_UNVERIFIED_ALL_HUMAN_SIGNOFFS_PENDING",
    sourceJsonSha256:SOURCE,languages:["en","hi"],
    summary:{
      historicalCategories:889,historicalServices:7267,reviewPackets:45,
      requiredReviewTasks:2667,
      taskStatusCounts:validated.summary.selfReportedTaskStatuses,
      categoriesWithDiagnosticFlags:categoriesByFlag.ORIGINAL_SOURCE_DIAGNOSTIC,
      categoriesWithUnverifiedEvidenceReferences:
        rows.filter(x=>x.linkedReferencesNotAuthenticated.length).length,
      distinctExternalReferencesNotChecked:occurrences.size,
      externalReferencesSharedAcrossMultipleCategories:reused.length,
      linkedEvidenceAuthenticationChecksPerformed:0,
      tasksAuthenticatedOrLegallyApproved:0,
      categoriesByAuditFlag:categoriesByFlag,
      categoriesStillAwaitingQualifiedHumanReview:889,
      servicesStillAwaitingQualifiedHumanReview:7267,
      qualifiedLegalReviewsAuthenticated:0,
      qualifiedOccupationalReviewsAuthenticated:0,
      humanBilingualReviewsAuthenticated:0,
      founderCategoryApprovalsAuthenticated:0,
      categoriesAuthorizedForActivation:0,
      servicesAuthorizedForActivation:0,
      approvedAliases:0,sqlStatementsGenerated:0,
    },
    packets,unresolvedCases:rows,
  };
}
export function loadPinnedHumanReviewEvidenceAudit({reviewRoot,progressRoot}={}){
  const review=loadPinnedReviewPackets(),
    full=loadPinnedFullCategoryServiceEvidence(),
    exceptions=loadPinnedCategoryExceptionRegister();
  const inputs=reviewRoot===undefined?
    emptyUnifiedReviewInputs(review,full):loadUnifiedReviewDirectory(reviewRoot);
  const unified=reconcileUnifiedHumanReview(inputs,{review,full,exceptions});
  const queue=makeReviewAttentionQueue(unified);
  const progress=progressRoot===undefined?
    emptyHumanReviewActionPacketSet(queue):loadHumanReviewActionDirectory(progressRoot);
  return auditUnresolvedHumanReviewEvidence({unified,queue,progress});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const roots=args.filter(x=>x.startsWith("--review-root="));
  const progress=args.filter(x=>x.startsWith("--progress-root="));
  const modes=args.filter(x=>!x.startsWith("--review-root=")&&
    !x.startsWith("--progress-root="));
  if(roots.length>1||progress.length>1||modes.length>1||
    roots.length+progress.length+modes.length!==args.length)
    throw Error("Use optional --review-root, --progress-root and one output mode");
  const mode=modes[0]??((roots.length||progress.length)?"--summary":"--check");
  if(!["--check","--summary","--packets","--all"].includes(mode)&&
    !mode.startsWith("--packet=")&&!mode.startsWith("--category=")&&
    !mode.startsWith("--flag="))
    throw Error("Use --check, --summary, --packets, --all, --packet=N, --category=ID, --flag=CODE");
  const report=loadPinnedHumanReviewEvidenceAudit({
    reviewRoot:roots.length?roots[0].slice("--review-root=".length):undefined,
    progressRoot:progress.length?progress[0].slice("--progress-root=".length):undefined,
  });
  if(mode==="--check")console.log(
    "JODLO all 889 Categories / 7,267 Services / 2,667 tasks: all evidence unresolved and unverified, ZERO activation.");
  else if(mode==="--summary")process.stdout.write(
    JSON.stringify(report.summary,null,2)+"\n");
  else if(mode==="--packets")process.stdout.write(
    JSON.stringify(report.packets,null,2)+"\n");
  else if(mode==="--all")process.stdout.write(JSON.stringify(report,null,2)+"\n");
  else if(mode.startsWith("--packet=")){
    const n=parsePacketArg(mode,45);
    process.stdout.write(JSON.stringify({
      ...report.packets[n-1],
      cases:report.unresolvedCases.filter(x=>x.packetNumber===n),
    },null,2)+"\n");
  }else if(mode.startsWith("--category=")){
    const id=mode.slice("--category=".length);
    const row=report.unresolvedCases.find(x=>x.sourceCategoryId===id);
    if(!row)throw Error("Unknown original source Category");
    process.stdout.write(JSON.stringify(row,null,2)+"\n");
  }else if(mode.startsWith("--flag=")){
    const flag=mode.slice("--flag=".length);
    if(!AUDIT_FLAGS.includes(flag))throw Error("Unknown audit flag");
    process.stdout.write(JSON.stringify({
      unresolvedAuditFlag:flag,
      cases:report.unresolvedCases.filter(x=>x.unresolvedAuditFlags.includes(flag)),
    },null,2)+"\n");
  }
}
