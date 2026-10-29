/**
 * ADR-0011: deterministic *review attention* order over the existing source-
 * validated joint 45-packet queue. Not a machine safety score, legal ruling,
 * Category allowlist, moderation rule, seed or public-facing taxonomy.
 */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedReviewPackets,parsePacketArg} from "./catalog-review-packets.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedCategoryExceptionRegister} from "./catalog-review-exception-register.mjs";
import {
  emptyUnifiedReviewInputs,loadUnifiedReviewDirectory,
  reconcileUnifiedHumanReview,
} from "./catalog-unified-human-review.mjs";

const SOURCE="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const PENDING="HUMAN_EDITORIAL_OCCUPATIONAL_LEGAL_AND_FOUNDER_REVIEW_REQUIRED";
export const ATTENTION_LANES=Object.freeze([
  "SPECIALIST_HOLD_REVIEW",
  "REPORTED_SPECIALIST_OR_EXTRA_REVIEW",
  "AMBIGUOUS_PARENT_REVIEW",
  "SOURCE_AND_EDITORIAL_REPAIR",
  "BASELINE_HUMAN_REVIEW",
]);
const PRIORITY_REASON=Object.freeze({
  SPECIALIST_HOLD_REVIEW:"Existing 17-sample desk opinion explicitly held for specialist policy",
  REPORTED_SPECIALIST_OR_EXTRA_REVIEW:"Unverified Service concern or existing desk extra-review opinion",
  AMBIGUOUS_PARENT_REVIEW:"Original or proposed Service phrase has multiple possible Category parents",
  SOURCE_AND_EDITORIAL_REPAIR:"Mechanical source flags, mapping/label proposals, or draft evidence mismatch",
  BASELINE_HUMAN_REVIEW:"No earlier diagnostic signal; mandatory human review still not completed",
});
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const hasCode=(row,code)=>row.sourceDiagnostics.some(issue=>issue.code===code);
const hasCheck=(row,code)=>row.combinedHumanReviewChecks.includes(code);
const exact=(obj,keys)=>obj!==null&&typeof obj==="object"&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join("|")===keys.slice().sort().join("|");

function checkUnified(source){
  if(source?.kind!=="JODLO_ALL_CATEGORY_SERVICE_JOINT_HUMAN_REVIEW_QUEUE_ONLY"||
    source.state!=="UNVERIFIED_EVIDENCE_ZERO_AUTHORIZATION"||
    source.sourceJsonSha256!==SOURCE||
    JSON.stringify(source.languages)!=='["en","hi"]'||
    source.summary?.packetsValidated!==45||
    source.summary?.historicalCategories!==889||
    source.summary?.historicalServices!==7267||
    source.summary?.deskAssessedCategories!==17||
    source.summary?.deskUnassessedCategories!==872||
    source.summary?.allCategoriesStillRequiringQualifiedReview!==889||
    source.summary?.allServicesStillRequiringQualifiedReview!==7267||
    !Array.isArray(source.packets)||source.packets.length!==45)
    throw Error("Incomplete or authorizing joint human review source");
  for(const field of [
    "qualifiedLegalReviewsAuthenticated","qualifiedOccupationalReviewsAuthenticated",
    "humanBilingualReviewsAuthenticated","founderCategoryApprovalsAuthenticated",
    "approvedCategoryIds","approvedAliases","categoriesAuthorizedForActivation",
    "servicesAuthorizedForActivation","sqlStatementsGenerated",
  ])if(source.summary[field]!==0)
    throw Error("Priority queue cannot accept Category approval or SQL");
}
function reasonCodes(row){
  const reasons=[];
  if(hasCode(row,"DESK_SPECIALIST_HOLD"))reasons.push("DESK_SPECIALIST_HOLD");
  if(hasCode(row,"DESK_EXTRA_REVIEW"))reasons.push("DESK_EXTRA_REVIEW");
  if(row.serviceScopeConcernRowsUnverified>0)reasons.push("UNVERIFIED_SERVICE_SCOPE_CONCERN");
  if(hasCode(row,"SHARED_SERVICE_PHRASE_PARENTS"))
    reasons.push("HISTORICAL_SHARED_SERVICE_PARENT");
  if(row.unresolvedProposedNameConflicts.length)
    reasons.push("PROPOSED_PHRASE_PARENT_COLLISION");
  for(const issue of row.sourceDiagnostics){
    if(!["DESK_SPECIALIST_HOLD","DESK_EXTRA_REVIEW",
      "SHARED_SERVICE_PHRASE_PARENTS"].includes(issue.code))
      reasons.push("SOURCE_"+issue.code);
  }
  if(row.categoryMappingDraftStatus==="EVIDENCE_LINKED_UNVERIFIED")
    reasons.push("CATEGORY_MAPPING_DRAFT_UNVERIFIED");
  if(row.serviceNameDraftsUnverified||row.serviceScopeDraftsUnverified)
    reasons.push("SERVICE_DRAFT_EVIDENCE_UNVERIFIED");
  if(row.serviceNamesWithoutScopeDrafts)
    reasons.push("SCOPE_DRAFT_NOT_LINKED_FOR_NAME_PROPOSAL");
  if(row.serviceScopesWithoutNameDrafts)
    reasons.push("NAME_CORRECTION_NOT_LINKED_OR_NOT_NEEDED");
  return [...new Set(reasons)].sort(cmp);
}
function chooseLane(reasons){
  if(reasons.includes("DESK_SPECIALIST_HOLD"))return ATTENTION_LANES[0];
  if(reasons.includes("DESK_EXTRA_REVIEW")||
    reasons.includes("UNVERIFIED_SERVICE_SCOPE_CONCERN"))return ATTENTION_LANES[1];
  if(reasons.includes("HISTORICAL_SHARED_SERVICE_PARENT")||
    reasons.includes("PROPOSED_PHRASE_PARENT_COLLISION"))return ATTENTION_LANES[2];
  if(reasons.length)return ATTENTION_LANES[3];
  return ATTENTION_LANES[4];
}
/** Strict references only; a priority position never conveys legal risk level,
 * safety, verified expertise or qualification. Source claims remain pending.
 */
export function makeReviewAttentionQueue(source){
  checkUnified(source);
  const byLane=Object.fromEntries(ATTENTION_LANES.map(x=>[x,0]));
  const byPacket=Array.from({length:45},(_,i)=>({
    packetNumber:i+1,
    sourceCategories:0,sourceServices:0,
    counts:Object.fromEntries(ATTENTION_LANES.map(x=>[x,0])),
    sourceCategoryIds:[],
  }));
  const ids=new Set(),rows=[];
  let serviceTotal=0,deskCount=0,unassessedCount=0;
  for(let i=0;i<45;i++){
    const packet=source.packets[i];
    if(packet?.packetNumber!==i+1||
      !Array.isArray(packet.categories)||
      packet.categoryCount!==packet.categories.length||
      packet.categoryCount<1||packet.categoryCount>20)
      throw Error("Missing or reordered source review packet");
    for(const row of packet.categories){
      if(!exact(row,[
        "packetNumber","sourceCategoryId","sourceGroupId","sourceFamilyId",
        "historicalNameEn","historicalNameHi",
        "historicalSafetyTierNotAnAuthorization","deskReviewOnly",
        "sourceServiceCount","categoryMappingDraftStatus",
        "categoryMappingProposalUnverified","categoryMappingEvidenceUrlUnverified",
        "serviceNameDraftsUnverified","serviceScopeDraftsUnverified",
        "serviceNamesWithoutScopeDrafts","serviceScopesWithoutNameDrafts",
        "serviceScopeConcernRowsUnverified","serviceScopeConcernCodesUnverified",
        "sourceDiagnostics","combinedHumanReviewChecks",
        "unresolvedProposedNameConflicts","submittedServiceReviewHandoff",
        "stillRequiresHumanReview","reviewState","categoriesAuthorizedForActivation",
      ])||row.packetNumber!==i+1||
        typeof row.sourceCategoryId!=="string"||!row.sourceCategoryId||
        ids.has(row.sourceCategoryId)||
        typeof row.historicalNameEn!=="string"||
        typeof row.historicalNameHi!=="string"||
        !Number.isSafeInteger(row.sourceServiceCount)||row.sourceServiceCount<0||
        !row.stillRequiresHumanReview||row.reviewState!==PENDING||
        row.categoriesAuthorizedForActivation!==0||
        !Array.isArray(row.sourceDiagnostics)||
        !Array.isArray(row.combinedHumanReviewChecks)||
        !Array.isArray(row.unresolvedProposedNameConflicts)||
        !Array.isArray(row.submittedServiceReviewHandoff)||
        !row.deskReviewOnly||
        !["NOT_DESK_ASSESSED","NARROW_SCOPE_RECOMMENDATION",
          "EXTRA_REVIEW_REQUIRED","HOLD_FOR_SPECIALIST_POLICY"]
          .includes(row.deskReviewOnly.assessment)||
        !Number.isSafeInteger(row.serviceScopeConcernRowsUnverified)||
        row.serviceScopeConcernRowsUnverified<0)
        throw Error("Changed, incomplete, approved or duplicate Category queue row");
      ids.add(row.sourceCategoryId);serviceTotal+=row.sourceServiceCount;
      if(row.deskReviewOnly.assessment==="NOT_DESK_ASSESSED")unassessedCount++;
      else deskCount++;
      const reasons=reasonCodes(row),lane=chooseLane(reasons);
      const index=ATTENTION_LANES.indexOf(lane);
      byLane[lane]++;
      byPacket[i].sourceCategories++;byPacket[i].sourceServices+=row.sourceServiceCount;
      byPacket[i].counts[lane]++;byPacket[i].sourceCategoryIds.push(row.sourceCategoryId);
      rows.push({
        packetNumber:i+1,sourceCategoryId:row.sourceCategoryId,
        sourceGroupId:row.sourceGroupId,sourceFamilyId:row.sourceFamilyId,
        historicalNameEn:row.historicalNameEn,
        historicalNameHi:row.historicalNameHi,
        historicalSafetyTierNotAnAuthorization:row.historicalSafetyTierNotAnAuthorization,
        sourceServiceCount:row.sourceServiceCount,
        deskReviewOnly:row.deskReviewOnly.assessment,
        attentionLane:lane,attentionOrder:index+1,
        attentionReasonCodes:reasons,
        sourceDiagnosticCodes:row.sourceDiagnostics.map(x=>x.code),
        flaggedSourceServiceIds:[...new Set(
          row.sourceDiagnostics.flatMap(issue=>issue.affectedServiceIds),
        )].sort(cmp),
        unresolvedProposedNameConflicts:row.unresolvedProposedNameConflicts,
        serviceScopeConcernRowsUnverified:row.serviceScopeConcernRowsUnverified,
        serviceNameDraftsUnverified:row.serviceNameDraftsUnverified,
        serviceScopeDraftsUnverified:row.serviceScopeDraftsUnverified,
        outstandingNameScopeHandoffs:row.submittedServiceReviewHandoff
          .filter(x=>x.outstandingChecks.length)
          .map(x=>({sourceServiceId:x.sourceServiceId,
            outstandingChecks:x.outstandingChecks})),
        mandatoryReviewStatus:PENDING,
        stillRequiresHumanReview:true,
        categoriesAuthorizedForActivation:0,
      });
    }
  }
  if(ids.size!==889||serviceTotal!==7267||
    deskCount!==17||unassessedCount!==872||
    byPacket.some((p,i)=>p.sourceServices!==source.packets[i].serviceCount)||
    Object.values(byLane).reduce((n,x)=>n+x,0)!==889)
    throw Error("Priority queue lost Category, Service or packet coverage");
  rows.sort((a,b)=>a.attentionOrder-b.attentionOrder||
    a.packetNumber-b.packetNumber||cmp(a.sourceCategoryId,b.sourceCategoryId));
  const sortPacket=(p)=>({
    ...p,sourceCategoryIds:p.sourceCategoryIds.slice().sort(cmp),
  });
  return {
    kind:"JODLO_889_CATEGORY_REVIEW_ATTENTION_ORDER_ONLY",
    state:"HUMAN_TRIAGE_NOT_RISK_CLASSIFICATION_ZERO_APPROVAL",
    sourceJsonSha256:SOURCE,languages:["en","hi"],
    attentionLanes:ATTENTION_LANES.map((lane,i)=>({
      attentionOrder:i+1,lane,
      rationale:PRIORITY_REASON[lane],
      categories:byLane[lane],
      humanReviewStillMandatory:true,
    })),
    summary:{
      originalCategories:889,originalServices:7267,
      originalPackets:45,deskAssessedCategories:17,deskUnassessedCategories:872,
      categoriesByPrimaryAttentionLane:byLane,
      originalCategoriesStillAwaitingQualifiedReview:889,
      originalServicesStillAwaitingQualifiedReview:7267,
      qualifiedLegalReviewsAuthenticated:0,
      qualifiedOccupationalReviewsAuthenticated:0,
      humanBilingualReviewsAuthenticated:0,
      founderCategoryApprovalsAuthenticated:0,
      categoriesAuthorizedForActivation:0,
      servicesAuthorizedForActivation:0,
      approvedAliases:0,sqlStatementsGenerated:0,
    },
    packets:byPacket.map(sortPacket),reviewQueue:rows,
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const roots=args.filter(x=>x.startsWith("--review-root="));
  const modes=args.filter(x=>!x.startsWith("--review-root="));
  if(roots.length>1||modes.length>1||
    args.length!==roots.length+modes.length)
    throw Error("Use at most one --review-root=PATH and one output mode");
  const mode=modes[0]??(roots.length?"--all":"--check");
  if(!["--check","--summary","--all","--packets"].includes(mode)&&
     !mode.startsWith("--packet=")&&!mode.startsWith("--lane="))
    throw Error("Use --check, --summary, --packets, --all, --packet=N, --lane=LANE");
  const review=loadPinnedReviewPackets(),
    full=loadPinnedFullCategoryServiceEvidence(),
    exceptions=loadPinnedCategoryExceptionRegister();
  const inputs=roots.length?
    loadUnifiedReviewDirectory(roots[0].slice("--review-root=".length)):
    emptyUnifiedReviewInputs(review,full);
  const source=reconcileUnifiedHumanReview(inputs,{review,full,exceptions});
  const result=makeReviewAttentionQueue(source);
  if(mode==="--check")console.log(
    "JODLO 45-packet 889-Category/7,267-Service attention queue: ALL pending qualified review, ZERO activation.");
  else if(mode==="--summary")process.stdout.write(
    JSON.stringify(result.summary,null,2)+"\n");
  else if(mode==="--packets")process.stdout.write(
    JSON.stringify(result.packets,null,2)+"\n");
  else if(mode==="--all")process.stdout.write(JSON.stringify(result,null,2)+"\n");
  else if(mode.startsWith("--packet=")){
    const n=parsePacketArg(mode,45);
    process.stdout.write(JSON.stringify({
      ...result.packets[n-1],
      categories:result.reviewQueue.filter(x=>x.packetNumber===n),
    },null,2)+"\n");
  }else if(mode.startsWith("--lane=")){
    const lane=mode.slice("--lane=".length);
    if(!ATTENTION_LANES.includes(lane))throw Error("Unknown reviewer attention lane");
    process.stdout.write(JSON.stringify({
      attentionLane:lane,
      humanReviewStillMandatory:true,
      categories:result.reviewQueue.filter(x=>x.attentionLane===lane),
    },null,2)+"\n");
  }
}
