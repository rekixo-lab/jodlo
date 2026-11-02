/**
 * ADR-0011: SMALL, REVIEWER-ACTIONABLE windows over the existing GLOBAL
 * attention queue + 45 source-protected progress packets.
 *
 * This is an OFFLINE work allocator, NOT an eligibility / legal review engine,
 * approval, public Category feed, SQL generator or JODLO Worker import.
 * No reviewer identity/authentication can be inferred from PR references.
 */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  loadPinnedHumanReviewActionQueue,emptyHumanReviewActionPacketSet,
  loadHumanReviewActionDirectory,reconcileHumanReviewActionPackets,
} from "./catalog-human-review-progress.mjs";
import {loadPinnedCatalogMappingReadiness} from "./catalog-mapping-readiness.mjs";

const KIND="JODLO_GLOBAL_HUMAN_REVIEW_NEXT_ACTIONS_ONLY";
const STATE="UNVERIFIED_HUMAN_TASKS_ZERO_CATALOG_AUTHORIZATION";
const MAX_PAGE=25;
const FOCUSES=["all","mapping","service"];

// Baseline D1 syntax-only candidates are independently source-verified, never
// inferred from unverified reviewer declarations. One immutable archive read
// per local process prevents repeated decompression during batch pagination.
let cachedOriginalMappings=null;
function originalMappings() {
  if(cachedOriginalMappings!==null)return cachedOriginalMappings;
  const {result}=loadPinnedCatalogMappingReadiness();
  if(result.kind!=="JODLO_ALL_CATEGORY_MAPPING_COMPATIBILITY_REVIEW_ONLY"||
     result.state!=="ALL_CATEGORIES_UNAPPROVED_NO_SQL_NO_SEED"||
     result.summary?.sourceCategories!==889||
     result.summary?.categoriesAuthorizedForActivation!==0||
     result.summary?.sqlStatementsGenerated!==0||
     !Array.isArray(result.categories)||result.categories.length!==889)
    throw Error("Untrusted original category mapping evidence");
  const byId=new Map();
  for(const category of result.categories){
    if(byId.has(category.sourceCategoryId))
      throw Error("Duplicate historical category mapping evidence");
    byId.set(category.sourceCategoryId,category);
  }
  cachedOriginalMappings={sourceJsonSha256:result.sourceJsonSha256,byId};
  return cachedOriginalMappings;
}


export function selectNextHumanReviewActions(queue,progress,options={}) {
  if(!options||typeof options!=="object"||Array.isArray(options)||
     Object.keys(options).some(key=>!["limit","after","focus"].includes(key)))
    throw Error("Invalid reviewer batch options");
  const {limit=20,after=null,focus="all"}=options;
  if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE||
      (after!==null&&(typeof after!=="string"||!after.length))||
      !FOCUSES.includes(focus))
    throw Error("Invalid reviewer batch limit or anchor");

  // Existing strict validators protect all 889 original Category IDs,
  // every source fingerprint, all 2,667 tasks and 45 original packets.
  const checked=reconcileHumanReviewActionPackets(progress,queue);
  if(queue.reviewQueue?.length!==889||
     checked.summary.historicalCategories!==889||
     checked.summary.historicalServices!==7267||
     checked.summary.humanReviewTasks!==2667||
     checked.summary.categoriesAuthorizedForActivation!==0||
     checked.summary.servicesAuthorizedForActivation!==0)
    throw Error("Incomplete or authorizing human review source");

  const mapping=originalMappings();
  if(mapping.sourceJsonSha256!==queue.sourceJsonSha256||
     mapping.byId.size!==checked.summary.historicalCategories)
    throw Error("Mapping reference differs from reviewed source");

  // Join by immutable original Category ID. Never assume packet ordering
  // matches review-priority ordering; never silently drop the 889th item.
  const byId=new Map();
  for(const packet of progress) {
    for(const category of packet.categories) {
      if(byId.has(category.sourceCategoryId))
        throw Error("Duplicate human review progress Category");
      byId.set(category.sourceCategoryId,category);
    }
  }
  if(byId.size!==889)throw Error("Incomplete human review progress");

  const rows=queue.reviewQueue.map(category=>{
    const original=byId.get(category.sourceCategoryId);
    if(!original||original.attentionLane!==category.attentionLane||
       original.originalServiceCount!==category.sourceServiceCount||
       original.categoriesAuthorizedForActivation!==0||
       category.categoriesAuthorizedForActivation!==0)
      throw Error("Human review attention/progress mismatch");
    const baseline=mapping.byId.get(category.sourceCategoryId);
    if(!baseline||
       baseline.historicalNameEn!==category.historicalNameEn||
       baseline.historicalNameHi!==category.historicalNameHi||
       baseline.sourceGroupId!==category.sourceGroupId||
       baseline.sourceFamilyId!==category.sourceFamilyId||
       baseline.reviewState!=="HUMAN_ID_SLUG_LABEL_AND_SAFETY_REVIEW_REQUIRED"||
       !Array.isArray(baseline.syntaxIssues)||
       !Array.isArray(category.flaggedSourceServiceIds)||
       !Array.isArray(category.outstandingNameScopeHandoffs)||
       !Array.isArray(category.unresolvedProposedNameConflicts)||
       !Number.isSafeInteger(category.serviceNameDraftsUnverified)||
       !Number.isSafeInteger(category.serviceScopeDraftsUnverified)||
       !Number.isSafeInteger(category.serviceScopeConcernRowsUnverified))
      throw Error("Category mapping and Service review evidence diverged");
    return {
      packetNumber:category.packetNumber,
      sourceCategoryId:category.sourceCategoryId,
      sourceCategorySha256:original.sourceCategorySha256,
      historicalNameEn:category.historicalNameEn,
      historicalNameHi:category.historicalNameHi,
      originalServiceCount:category.sourceServiceCount,
      attentionLane:category.attentionLane,
      attentionReasonCodes:category.attentionReasonCodes,
      // A valid syntax candidate is NEVER approval, even with no syntax issues.
      originalCategoryMapping:{
        categoryIdSyntaxCandidate:baseline.categoryIdCandidate,
        slugSyntaxCandidate:baseline.slugCandidate,
        syntaxIssues:[...baseline.syntaxIssues],
        sourceReviewFlags:[...baseline.historicalReviewFlags],
        reviewState:baseline.reviewState,
      },
      // These are human-review diagnostics, not verified Service eligibility.
      serviceReviewIssues:{
        flaggedOriginalServiceIds:[...category.flaggedSourceServiceIds],
        serviceNameDraftsUnverified:category.serviceNameDraftsUnverified,
        serviceScopeDraftsUnverified:category.serviceScopeDraftsUnverified,
        scopeConcernRowsUnverified:category.serviceScopeConcernRowsUnverified,
        proposedNameConflictsUnresolved:structuredClone(
          category.unresolvedProposedNameConflicts),
        outstandingNameScopeHandoffs:structuredClone(
          category.outstandingNameScopeHandoffs),
      },
      tasks:original.tasks.map(({taskType,status,evidenceUrl})=>
        ({taskType,status,evidenceUrl,qualifiedSignoffVerified:false})),
      stillRequiresQualifiedHumanReview:true,
      categoriesAuthorizedForActivation:0,
    };
  });

  const start=after===null?0:rows.findIndex(x=>x.sourceCategoryId===after)+1;
  if(start===0&&after!==null)throw Error("Unknown reviewer batch anchor");
  const serviceSignal=row=>(
    row.serviceReviewIssues.flaggedOriginalServiceIds.length>0||
    row.serviceReviewIssues.serviceNameDraftsUnverified>0||
    row.serviceReviewIssues.serviceScopeDraftsUnverified>0||
    row.serviceReviewIssues.scopeConcernRowsUnverified>0||
    row.serviceReviewIssues.proposedNameConflictsUnresolved.length>0||
    row.serviceReviewIssues.outstandingNameScopeHandoffs.length>0);
  const matches=row=>focus==="all"||
    (focus==="mapping"&&row.originalCategoryMapping.syntaxIssues.length>0)||
    (focus==="service"&&serviceSignal(row));
  // Continue through the GLOBAL attention order, including filtered-out rows.
  // An unchanged original Category ID, never a filtered index, is the cursor.
  const selected=[];
  let position=start;
  for(;position<rows.length;position++){
    if(matches(rows[position]))selected.push(rows[position]);
    if(selected.length===limit){position++;break;}
  }
  const last=selected.at(-1);
  const more=last&&rows.slice(position).some(matches);
  return {
    kind:KIND,state:STATE,sourceJsonSha256:queue.sourceJsonSha256,
    languages:["en","hi"],
    summary:{
      historicalCategories:889,historicalServices:7267,
      reviewPackets:45,requiredHumanReviewTasks:2667,
      categoriesWithHistoricalSyntaxIssues:rows.filter(x=>
        x.originalCategoryMapping.syntaxIssues.length>0).length,
      categoriesWithServiceReviewSignals:rows.filter(serviceSignal).length,
      selfReportedTaskStatuses:checked.summary.selfReportedTaskStatuses,
      categoriesStillRequiringQualifiedHumanReview:889,
      servicesStillRequiringQualifiedHumanReview:7267,
      qualifiedLegalReviewsAuthenticated:0,
      qualifiedOccupationalReviewsAuthenticated:0,
      humanBilingualReviewsAuthenticated:0,
      founderCategoryApprovalsAuthenticated:0,
      categoriesAuthorizedForActivation:0,
      servicesAuthorizedForActivation:0,
      approvedAliases:0,sqlStatementsGenerated:0,
    },
    page:{
      limit,after,focus,
      nextCursor:more?last.sourceCategoryId:null,
      categories:selected,
    },
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  let mode=null,limit=20,after=null,focus="all",reviewRoot,progressRoot;
  const seen=new Set();
  for(const arg of args){
    if(["--next","--summary","--check"].includes(arg)){
      if(seen.has("mode"))throw Error("Duplicate human review output mode");
      seen.add("mode");mode=arg;
    }else{
      const equals=arg.indexOf("=");
      const key=equals>=0?arg.slice(0,equals):arg;
      const value=equals>=0?arg.slice(equals+1):null;
      if(!["--limit","--after","--focus","--review-root","--progress-root"].includes(key)||
         seen.has(key)||value===null||!value)
        throw Error("Use --next|--summary|--check with optional --limit=N, --after=ORIGINAL_ID, --focus=all|mapping|service, --review-root=PATH, --progress-root=PATH");
      seen.add(key);
      if(key==="--limit"){
        if(!/^(?:[1-9]|1[0-9]|2[0-5])$/u.test(value))
          throw Error("Review batch limit must be 1..25");
        limit=Number(value);
      }else if(key==="--after")after=value;
      else if(key==="--focus"){
        if(!FOCUSES.includes(value))throw Error("Unknown reviewer focus");
        focus=value;
      }else if(key==="--review-root")reviewRoot=value;
      else progressRoot=value;
    }
  }
  mode??="--next";
  if(mode!=="--next"&&(seen.has("--after")||seen.has("--limit")||
     seen.has("--focus")))
    throw Error("Batch pagination options require --next");
  const queue=loadPinnedHumanReviewActionQueue(reviewRoot);
  const progress=progressRoot===undefined?
    emptyHumanReviewActionPacketSet(queue):
    loadHumanReviewActionDirectory(progressRoot);
  const plan=selectNextHumanReviewActions(queue,progress,{limit,after,focus});
  if(mode==="--check"){
    console.log("JODLO global human review: 45 source packets, 889 Categories, 7,267 Services, 2,667 tasks checked; ZERO authorization.");
  }else if(mode==="--summary"){
    process.stdout.write(JSON.stringify(plan.summary,null,2)+"\n");
  }else{
    process.stdout.write(JSON.stringify(plan,null,2)+"\n");
  }
}
