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

const KIND="JODLO_GLOBAL_HUMAN_REVIEW_NEXT_ACTIONS_ONLY";
const STATE="UNVERIFIED_HUMAN_TASKS_ZERO_CATALOG_AUTHORIZATION";
const MAX_PAGE=25;

export function selectNextHumanReviewActions(queue,progress,options={}) {
  if(!options||typeof options!=="object"||Array.isArray(options)||
     Object.keys(options).some(key=>!["limit","after"].includes(key)))
    throw Error("Invalid reviewer batch options");
  const {limit=20,after=null}=options;
  if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE||
      (after!==null&&(typeof after!=="string"||!after.length)))
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
    return {
      packetNumber:category.packetNumber,
      sourceCategoryId:category.sourceCategoryId,
      sourceCategorySha256:original.sourceCategorySha256,
      historicalNameEn:category.historicalNameEn,
      historicalNameHi:category.historicalNameHi,
      originalServiceCount:category.sourceServiceCount,
      attentionLane:category.attentionLane,
      attentionReasonCodes:category.attentionReasonCodes,
      tasks:original.tasks.map(({taskType,status,evidenceUrl})=>
        ({taskType,status,evidenceUrl,qualifiedSignoffVerified:false})),
      stillRequiresQualifiedHumanReview:true,
      categoriesAuthorizedForActivation:0,
    };
  });

  const start=after===null?0:rows.findIndex(x=>x.sourceCategoryId===after)+1;
  if(start===0&&after!==null)throw Error("Unknown reviewer batch anchor");
  const selected=rows.slice(start,start+limit);
  const last=selected.at(-1);
  return {
    kind:KIND,state:STATE,sourceJsonSha256:queue.sourceJsonSha256,
    languages:["en","hi"],
    summary:{
      historicalCategories:889,historicalServices:7267,
      reviewPackets:45,requiredHumanReviewTasks:2667,
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
      limit,after,
      nextCursor:start+selected.length<rows.length&&last
        ?last.sourceCategoryId:null,
      categories:selected,
    },
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  let mode=null,limit=20,after=null,reviewRoot,progressRoot;
  const seen=new Set();
  for(const arg of args){
    if(["--next","--summary","--check"].includes(arg)){
      if(seen.has("mode"))throw Error("Duplicate human review output mode");
      seen.add("mode");mode=arg;
    }else{
      const equals=arg.indexOf("=");
      const key=equals>=0?arg.slice(0,equals):arg;
      const value=equals>=0?arg.slice(equals+1):null;
      if(!["--limit","--after","--review-root","--progress-root"].includes(key)||
         seen.has(key)||value===null||!value)
        throw Error("Use --next|--summary|--check with optional --limit=N, --after=ORIGINAL_ID, --review-root=PATH, --progress-root=PATH");
      seen.add(key);
      if(key==="--limit"){
        if(!/^(?:[1-9]|1[0-9]|2[0-5])$/u.test(value))
          throw Error("Review batch limit must be 1..25");
        limit=Number(value);
      }else if(key==="--after")after=value;
      else if(key==="--review-root")reviewRoot=value;
      else progressRoot=value;
    }
  }
  mode??="--next";
  if(mode!=="--next"&&(seen.has("--after")||seen.has("--limit")))
    throw Error("Batch pagination options require --next");
  const queue=loadPinnedHumanReviewActionQueue(reviewRoot);
  const progress=progressRoot===undefined?
    emptyHumanReviewActionPacketSet(queue):
    loadHumanReviewActionDirectory(progressRoot);
  const plan=selectNextHumanReviewActions(queue,progress,{limit,after});
  if(mode==="--check"){
    console.log("JODLO global human review: 45 source packets, 889 Categories, 7,267 Services, 2,667 tasks checked; ZERO authorization.");
  }else if(mode==="--summary"){
    process.stdout.write(JSON.stringify(plan.summary,null,2)+"\n");
  }else{
    process.stdout.write(JSON.stringify(plan,null,2)+"\n");
  }
}
