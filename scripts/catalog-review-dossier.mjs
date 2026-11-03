/**
 * Prioritized, complete bilingual Category/Service review dossier.
 * Non-authorizing, offline, no SQL, no D1/network access.
 */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedHumanReviewActionQueue,emptyHumanReviewActionPacketSet,loadHumanReviewActionDirectory} from "./catalog-human-review-progress.mjs";
import {selectNextHumanReviewActions} from "./catalog-review-next-actions.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";

const SOURCE="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const KIND="JODLO_HUMAN_CATEGORY_SERVICE_DOSSIER_REVIEW_ONLY";
const PENDING="UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED";
const MAX_PAGE=10;

/** Joins existing full source-verified packets with original priority/task cards. */
export function buildCategoryReviewDossier(priority,evidence) {
  const p=priority?.summary, m=evidence?.manifest;
  if(priority?.kind!=="JODLO_GLOBAL_HUMAN_REVIEW_NEXT_ACTIONS_ONLY"||
    priority.state!=="UNVERIFIED_HUMAN_TASKS_ZERO_CATALOG_AUTHORIZATION"||
    priority.sourceJsonSha256!==SOURCE||
    p?.historicalCategories!==889||p?.historicalServices!==7267||
    p?.requiredHumanReviewTasks!==2667||p?.categoriesAuthorizedForActivation!==0||
    p?.servicesAuthorizedForActivation!==0||p?.founderCategoryApprovalsAuthenticated!==0||
    !Array.isArray(priority.page?.categories)||
    priority.page.categories.length>MAX_PAGE||
    m?.kind!=="JODLO_ALL_889_FULL_SERVICE_PACKET_MANIFEST_ONLY"||
    m.state!=="ALL_7267_UNAPPROVED_ZERO_ACTIVATION"||
    m.sourceJsonSha256!==SOURCE||m.summary?.historicalCategories!==889||
    m.summary?.historicalServices!==7267||m.summary?.reviewPackets!==45||
    m.summary?.humanReviewsAuthenticated!==0||
    m.summary?.categoriesAuthorizedForActivation!==0||
    m.summary?.sqlStatementsGenerated!==0||
    !Array.isArray(evidence.packets)||evidence.packets.length!==45)
    throw Error("Catalog dossier sources incomplete or unapproved");

  const byId=new Map();
  let count=0;
  for(const packet of evidence.packets) {
    if(packet.kind!=="JODLO_FULL_CATEGORY_SERVICE_EVIDENCE_ONLY"||
      packet.state!=="ALL_SERVICE_LABELS_UNAPPROVED_NO_ALIAS_OR_CATEGORY_ACTIVATION"||
      packet.sourceJsonSha256!==SOURCE||!Array.isArray(packet.categories)||
      packet.categories.length!==packet.categoryCount)
      throw Error("Invalid source-pinned service packet");
    let inPacket=0;
    for(const c of packet.categories) {
      if(byId.has(c.sourceCategoryId)||
        c.reviewState!=="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW"||
        !Array.isArray(c.services)||c.totalHistoricalServices!==c.services.length||
        c.services.some(s=>s.reviewState!==PENDING))
        throw Error("Duplicate or unreviewed service source mismatch");
      byId.set(c.sourceCategoryId,c);
      inPacket+=c.services.length;
    }
    if(inPacket!==packet.historicalServiceCount)throw Error("Service count mismatch");
    count+=inPacket;
  }
  if(byId.size!==889||count!==7267)throw Error("Incomplete 889/7267 source coverage");

  const seen=new Set();
  const categories=priority.page.categories.map(card=>{
    const c=byId.get(card.sourceCategoryId);
    if(!c||seen.has(card.sourceCategoryId)||
      c.historicalNameEn!==card.historicalNameEn||
      c.historicalNameHi!==card.historicalNameHi||
      c.totalHistoricalServices!==card.originalServiceCount||
      JSON.stringify(c.mappingSyntaxIssues)!==
        JSON.stringify(card.originalCategoryMapping?.syntaxIssues)||
      card.categoriesAuthorizedForActivation!==0||
      card.stillRequiresQualifiedHumanReview!==true||
      !Array.isArray(card.tasks)||card.tasks.length!==3||
      card.tasks.some(t=>t.qualifiedSignoffVerified!==false||
        !["NOT_STARTED","SELF_REPORTED_IN_PROGRESS",
          "EVIDENCE_LINKED_UNVERIFIED","SPECIALIST_HANDOFF_PENDING"].includes(t.status)))
      throw Error("Mismatch between priority card and source evidence");
    seen.add(c.sourceCategoryId);
    return {
      sourceCategoryId:c.sourceCategoryId,
      sourceGroupId:c.sourceGroupId,sourceFamilyId:c.sourceFamilyId,
      historicalNameEn:c.historicalNameEn,historicalNameHi:c.historicalNameHi,
      historicalSafetyTierForReviewOnly:c.historicalSafetyTier,
      attentionLane:card.attentionLane,attentionReasonCodes:card.attentionReasonCodes,
      sourceReviewFlags:c.sourceReviewFlags,
      originalCategoryMapping:card.originalCategoryMapping,
      outstandingHumanReviewTasks:card.tasks,
      serviceCount:c.services.length,
      services:c.services.map(s=>({
        sourceServiceId:s.sourceServiceId,
        historicalNameEn:s.historicalNameEn,historicalNameHi:s.historicalNameHi,
        originalSectionId:s.sourceSectionId,sourceFlags:s.sourceFlags,
        alternativeOriginalParentsForReview:s.otherSourceCategoryChoices,
        reviewState:s.reviewState,
      })),
      qualifiedHumanReviewVerified:false,founderActivationApproved:false,
    };
  });
  return {
    kind:KIND,state:"ZERO_QUALIFIED_APPROVAL_NO_SQL_NO_ACTIVATION",
    sourceJsonSha256:SOURCE,languages:["en","hi"],
    summary:{
      historicalCategories:889,historicalServices:7267,
      requiredHumanReviewTasks:2667,selectedCategories:categories.length,
      selectedHistoricalServices:categories.reduce((n,c)=>n+c.serviceCount,0),
      qualifiedHumanSignoffsVerified:0,founderApprovalsVerified:0,
      categoriesAuthorizedForActivation:0,sqlStatementsGenerated:0,
    },
    page:{limit:priority.page.limit,after:priority.page.after,
      nextCursor:priority.page.nextCursor,categories},
  };
}

function parseArgs(args) {
  let mode="--next",limit=5,after=null,progressRoot=null;
  const seen=new Set();
  for(const arg of args) {
    if(["--next","--summary","--check"].includes(arg)) {
      if(seen.has("mode"))throw Error("Duplicate mode");
      seen.add("mode");mode=arg;continue;
    }
    const pos=arg.indexOf("=");
    const key=arg.slice(0,pos),value=arg.slice(pos+1);
    if(pos<1||!["--limit","--after","--progress-root"].includes(key)||
      seen.has(key)||!value)
      throw Error("Use --next|--summary|--check [--limit=1..10] [--after=SOURCE_ID] [--progress-root=PATH]");
    seen.add(key);
    if(key==="--limit") {
      if(!/^(?:[1-9]|10)$/.test(value))throw Error("Limit must be 1..10");
      limit=Number(value);
    } else if(key==="--after")after=value;
    else progressRoot=value;
  }
  if(mode!=="--next"&&(seen.has("--limit")||seen.has("--after")))
    throw Error("Pagination requires --next");
  return {mode,limit,after,progressRoot};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {mode,limit,after,progressRoot}=parseArgs(process.argv.slice(2));
  const queue=loadPinnedHumanReviewActionQueue();
  const progress=progressRoot===null?emptyHumanReviewActionPacketSet(queue):
    loadHumanReviewActionDirectory(progressRoot);
  const page=selectNextHumanReviewActions(queue,progress,{limit,after});
  const dossier=buildCategoryReviewDossier(page,loadPinnedFullCategoryServiceEvidence());
  if(mode==="--check")console.log("889 Categories / 7267 original Services checked; no approvals, no SQL.");
  else if(mode==="--summary")process.stdout.write(JSON.stringify(dossier.summary,null,2)+"\n");
  else process.stdout.write(JSON.stringify(dossier,null,2)+"\n");
}
