/**
 * ADR-0011: local-only human-review ACTION TRACKER. This is a work queue,
 * NOT authenticated human testimony, legal clearance, verification or release.
 * All 889 Categories / 7,267 historical Services remain pending final review.
 */
import {createHash} from "node:crypto";
import {lstatSync,readFileSync,readdirSync,realpathSync} from "node:fs";
import {dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {validJodloReviewUrl} from "./review-evidence-url.mjs";
import {loadPinnedReviewPackets,parsePacketArg} from "./catalog-review-packets.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedCategoryExceptionRegister} from "./catalog-review-exception-register.mjs";
import {
  emptyUnifiedReviewInputs,loadUnifiedReviewDirectory,
  reconcileUnifiedHumanReview,
} from "./catalog-unified-human-review.mjs";
import {makeReviewAttentionQueue,ATTENTION_LANES} from "./catalog-review-triage.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SOURCE="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const KIND="JODLO_45_PACKET_HUMAN_REVIEW_ACTION_TRACKER_ONLY";
const STATE="SELF_REPORTED_LOCAL_PROGRESS_NO_APPROVAL";
const REVIEW="HUMAN_LEGAL_LANGUAGE_MAPPING_AND_FOUNDER_REVIEW_REQUIRED";
const TASK_TYPES=Object.freeze([
  "HUMAN_ENGLISH_HINDI_EDITORIAL_REVIEW",
  "QUALIFIED_OCCUPATIONAL_AND_LEGAL_SCOPE_REVIEW",
  "SOURCE_CATEGORY_MAPPING_AND_PARENT_REVIEW",
]);
const TASK_STATES=Object.freeze([
  "NOT_STARTED",
  "SELF_REPORTED_IN_PROGRESS",
  "EVIDENCE_LINKED_UNVERIFIED",
  "SPECIALIST_HANDOFF_PENDING",
]);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const exact=(value,keys)=>value!==null&&typeof value==="object"&&
  !Array.isArray(value)&&Object.keys(value).sort().join("|")===
  keys.slice().sort().join("|");
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

function checkQueue(queue){
  if(queue?.kind!=="JODLO_889_CATEGORY_REVIEW_ATTENTION_ORDER_ONLY"||
    queue.state!=="HUMAN_TRIAGE_NOT_RISK_CLASSIFICATION_ZERO_APPROVAL"||
    queue.sourceJsonSha256!==SOURCE||
    JSON.stringify(queue.languages)!=='["en","hi"]'||
    queue.summary?.originalCategories!==889||
    queue.summary?.originalServices!==7267||
    queue.summary?.originalPackets!==45||
    queue.summary?.deskUnassessedCategories!==872||
    queue.summary?.originalCategoriesStillAwaitingQualifiedReview!==889||
    queue.summary?.originalServicesStillAwaitingQualifiedReview!==7267||
    !Array.isArray(queue.reviewQueue)||queue.reviewQueue.length!==889||
    !Array.isArray(queue.packets)||queue.packets.length!==45)
    throw Error("Untrusted or incomplete 889-Category human-review attention queue");
  for(const f of ["qualifiedLegalReviewsAuthenticated",
    "qualifiedOccupationalReviewsAuthenticated","humanBilingualReviewsAuthenticated",
    "founderCategoryApprovalsAuthenticated","categoriesAuthorizedForActivation",
    "servicesAuthorizedForActivation","approvedAliases","sqlStatementsGenerated"]){
    if(queue.summary[f]!==0)throw Error("Review tracking cannot authorize Categories");
  }
}
function context(queue){
  checkQueue(queue);
  const packets=Array.from({length:45},()=>[]);
  const ids=new Set(),serviceCountByPacket=new Array(45).fill(0);
  let services=0;
  for(const row of queue.reviewQueue){
    if(!Number.isInteger(row?.packetNumber)||row.packetNumber<1||
      row.packetNumber>45||
      typeof row.sourceCategoryId!=="string"||!row.sourceCategoryId||
      ids.has(row.sourceCategoryId)||
      !ATTENTION_LANES.includes(row.attentionLane)||
      row.stillRequiresHumanReview!==true||
      row.categoriesAuthorizedForActivation!==0||
      row.mandatoryReviewStatus!==
        "HUMAN_EDITORIAL_OCCUPATIONAL_LEGAL_AND_FOUNDER_REVIEW_REQUIRED"||
      !Number.isInteger(row.sourceServiceCount)||row.sourceServiceCount<0||
      !Array.isArray(row.attentionReasonCodes))
      throw Error("Untrusted original Category action queue entry");
    ids.add(row.sourceCategoryId);packets[row.packetNumber-1].push(row);
    services+=row.sourceServiceCount;
    serviceCountByPacket[row.packetNumber-1]+=row.sourceServiceCount;
  }
  if(ids.size!==889||services!==7267)throw Error("Original Category/Service coverage lost");
  for(let n=1;n<=45;n++){
    if(queue.packets[n-1]?.packetNumber!==n||
      queue.packets[n-1].sourceCategories!==packets[n-1].length||
      queue.packets[n-1].sourceServices!==serviceCountByPacket[n-1]||
      packets[n-1].length<1||packets[n-1].length>20)
      throw Error("Original Category review packet boundary changed");
    packets[n-1].sort((a,b)=>cmp(a.sourceCategoryId,b.sourceCategoryId));
  }
  return packets;
}
const sourceFingerprint=row=>hash({
  sourceJsonSha256:SOURCE,
  packetNumber:row.packetNumber,
  sourceCategoryId:row.sourceCategoryId,
  sourceGroupId:row.sourceGroupId,
  sourceFamilyId:row.sourceFamilyId,
  historicalNameEn:row.historicalNameEn,
  historicalNameHi:row.historicalNameHi,
  historicalSafetyTierNotAnAuthorization:row.historicalSafetyTierNotAnAuthorization,
  sourceServiceCount:row.sourceServiceCount,
  attentionLane:row.attentionLane,
  attentionReasonCodes:row.attentionReasonCodes,
  sourceDiagnosticCodes:row.sourceDiagnosticCodes,
  flaggedSourceServiceIds:row.flaggedSourceServiceIds,
  unresolvedProposedNameConflicts:row.unresolvedProposedNameConflicts,
  outstandingNameScopeHandoffs:row.outstandingNameScopeHandoffs,
});

/** Exactly one source-pinned work card per historical Category, three independent
 * review tasks. Edits never establish a legal signoff or public listing.
 */
export function makeHumanReviewActionPacket(queue,packetNumber){
  const packets=context(queue);
  if(!Number.isInteger(packetNumber)||packetNumber<1||packetNumber>45)
    throw Error("Expected original human review packet 1..45");
  return {
    kind:KIND,state:STATE,sourceJsonSha256:SOURCE,languages:["en","hi"],
    packetNumber,
    categoryCount:packets[packetNumber-1].length,
    originalServiceCount:packets[packetNumber-1].reduce(
      (n,r)=>n+r.sourceServiceCount,0),
    categories:packets[packetNumber-1].map(row=>({
      sourceCategoryId:row.sourceCategoryId,
      sourceCategorySha256:sourceFingerprint(row),
      attentionLane:row.attentionLane,
      originalServiceCount:row.sourceServiceCount,
      tasks:TASK_TYPES.map(taskType=>({
        taskType,status:"NOT_STARTED",evidenceUrl:null,
        reviewState:REVIEW,
      })),
      reviewState:REVIEW,
      categoriesAuthorizedForActivation:0,
    })),
  };
}
/** Validate source-protected progress. "Linked" and "in progress" are untrusted
 * self reports. Only a JODLO PR/PR-comment URL format is accepted, not identity.
 */
export function validateHumanReviewActionPacket(packet,queue){
  const originals=context(queue);
  if(!exact(packet,["kind","state","sourceJsonSha256","languages",
      "packetNumber","categoryCount","originalServiceCount","categories"])||
    packet.kind!==KIND||packet.state!==STATE||
    packet.sourceJsonSha256!==SOURCE||
    JSON.stringify(packet.languages)!=='["en","hi"]'||
    !Number.isInteger(packet.packetNumber)||
    packet.packetNumber<1||packet.packetNumber>45)
    throw Error("Untrusted or authorizing review progress packet");
  const expected=makeHumanReviewActionPacket(queue,packet.packetNumber);
  if(packet.categoryCount!==expected.categoryCount||
    packet.originalServiceCount!==expected.originalServiceCount||
    !Array.isArray(packet.categories)||
    packet.categories.length!==expected.categories.length)
    throw Error("Missing Category review progress or altered original totals");
  const totals=Object.fromEntries(TASK_STATES.map(x=>[x,0]));
  let categoriesWithSelfReportedWork=0,categoriesWithAnyLinkedEvidence=0;
  for(const [i,row] of packet.categories.entries()){
    const original=expected.categories[i];
    if(!exact(row,["sourceCategoryId","sourceCategorySha256",
      "attentionLane","originalServiceCount","tasks","reviewState",
      "categoriesAuthorizedForActivation"])||
      row.sourceCategoryId!==original.sourceCategoryId||
      row.sourceCategorySha256!==original.sourceCategorySha256||
      row.attentionLane!==original.attentionLane||
      row.originalServiceCount!==original.originalServiceCount||
      row.reviewState!==REVIEW||
      row.categoriesAuthorizedForActivation!==0||
      !Array.isArray(row.tasks)||row.tasks.length!==TASK_TYPES.length)
      throw Error("Altered Category evidence, fake approval or missing task");
    let started=0,linked=0;
    for(const [j,task] of row.tasks.entries()){
      if(!exact(task,["taskType","status","evidenceUrl","reviewState"])||
        task.taskType!==TASK_TYPES[j]||
        task.reviewState!==REVIEW||
        !TASK_STATES.includes(task.status))
        throw Error("Forged reviewer completion or malformed action");
      if(["NOT_STARTED","SELF_REPORTED_IN_PROGRESS"].includes(task.status)){
        if(task.evidenceUrl!==null)
          throw Error("Unsubmitted work cannot claim reviewer evidence");
      }else{
        if(!validJodloReviewUrl(task.evidenceUrl))
          throw Error("Unverified review evidence must be a valid JODLO PR reference");
        linked++;
      }
      started+=Number(task.status!=="NOT_STARTED");
      totals[task.status]++;
    }
    categoriesWithSelfReportedWork+=Number(started>0);
    categoriesWithAnyLinkedEvidence+=Number(linked>0);
  }
  if(Object.values(totals).reduce((n,x)=>n+x,0)!==
    expected.categoryCount*TASK_TYPES.length)
    throw Error("Incomplete reviewer action coverage");
  return {
    packetNumber:packet.packetNumber,
    historicalCategories:packet.categoryCount,
    historicalServices:packet.originalServiceCount,
    humanReviewTasks:packet.categoryCount*TASK_TYPES.length,
    selfReportedTaskStatuses:totals,
    categoriesWithSelfReportedWork,
    categoriesWithAnyLinkedEvidence,
    qualifiedLegalReviewsAuthenticated:0,
    qualifiedOccupationalReviewsAuthenticated:0,
    humanBilingualReviewsAuthenticated:0,
    founderCategoryApprovalsAuthenticated:0,
    categoriesAuthorizedForActivation:0,
    servicesAuthorizedForActivation:0,
    approvedAliases:0,sqlStatementsGenerated:0,
  };
}
export function emptyHumanReviewActionPacketSet(queue){
  return Array.from({length:45},(_,i)=>makeHumanReviewActionPacket(queue,i+1));
}
export function reconcileHumanReviewActionPackets(packets,queue){
  context(queue);
  if(!Array.isArray(packets)||packets.length!==45)
    throw Error("All 45 complete original review progress packets are mandatory");
  const totals=Object.fromEntries(TASK_STATES.map(x=>[x,0]));
  const summaries=[];
  let categories=0,services=0,withWork=0,withLinks=0;
  for(let i=0;i<45;i++){
    if(packets[i]?.packetNumber!==i+1)
      throw Error("Review progress packets must remain in original 1..45 order");
    const s=validateHumanReviewActionPacket(packets[i],queue);
    summaries.push(s);categories+=s.historicalCategories;
    services+=s.historicalServices;withWork+=s.categoriesWithSelfReportedWork;
    withLinks+=s.categoriesWithAnyLinkedEvidence;
    for(const status of TASK_STATES)totals[status]+=s.selfReportedTaskStatuses[status];
  }
  if(categories!==889||services!==7267||
    Object.values(totals).reduce((n,x)=>n+x,0)!==2667)
    throw Error("Lost all-Category reviewer work coverage");
  return {
    kind:"JODLO_ALL_HUMAN_REVIEW_LOCAL_PROGRESS_SUMMARY_ONLY",
    state:STATE,sourceJsonSha256:SOURCE,languages:["en","hi"],
    summary:{
      historicalCategories:889,historicalServices:7267,reviewPackets:45,
      humanReviewTasks:2667,taskTypes:TASK_TYPES,
      selfReportedTaskStatuses:totals,
      categoriesWithSelfReportedWork:withWork,
      categoriesWithUnverifiedEvidenceLinks:withLinks,
      categoriesStillRequiringQualifiedReview:889,
      servicesStillRequiringQualifiedReview:7267,
      qualifiedLegalReviewsAuthenticated:0,
      qualifiedOccupationalReviewsAuthenticated:0,
      humanBilingualReviewsAuthenticated:0,
      founderCategoryApprovalsAuthenticated:0,
      categoriesAuthorizedForActivation:0,
      servicesAuthorizedForActivation:0,
      approvedAliases:0,sqlStatementsGenerated:0,
    },
    packetProgress:summaries,
  };
}
function checkedProgressDirectory(relativePath){
  if(!relativePath||isAbsolute(relativePath))
    throw Error("Review progress directory must be repo-relative");
  const path=resolve(ROOT,relativePath),rel=relative(ROOT,path);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))
    throw Error("Review progress escapes source repository");
  const rootReal=realpathSync(ROOT),actual=realpathSync(path);
  if(actual===rootReal||!actual.startsWith(rootReal+sep)||
    !lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())
    throw Error("Review progress directory must be a real local folder");
  const names=Array.from({length:45},(_,i)=>
    "review-progress-"+String(i+1).padStart(2,"0")+".json");
  if(JSON.stringify(readdirSync(path).sort())!==JSON.stringify(names))
    throw Error("Exactly 45 original reviewer progress JSON files required");
  return names.map(name=>{
    const file=resolve(path,name),stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>200_000||
      !realpathSync(file).startsWith(actual+sep))
      throw Error("Review progress JSON is a symlink or untrusted large file");
    return JSON.parse(readFileSync(file,"utf8"));
  });
}
export function loadHumanReviewActionDirectory(relativePath){
  return checkedProgressDirectory(relativePath);
}
export function loadPinnedHumanReviewActionQueue(reviewRoot){
  const review=loadPinnedReviewPackets(),
    full=loadPinnedFullCategoryServiceEvidence(),
    exceptions=loadPinnedCategoryExceptionRegister();
  const inputs=reviewRoot===undefined?
    emptyUnifiedReviewInputs(review,full):
    loadUnifiedReviewDirectory(reviewRoot);
  const source=reconcileUnifiedHumanReview(inputs,{review,full,exceptions});
  return makeReviewAttentionQueue(source);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const reviewRoots=args.filter(x=>x.startsWith("--review-root="));
  const progressRoots=args.filter(x=>x.startsWith("--progress-root="));
  const modes=args.filter(x=>!x.startsWith("--review-root=")&&
    !x.startsWith("--progress-root="));
  if(reviewRoots.length>1||progressRoots.length>1||modes.length>1||
    args.length!==reviewRoots.length+progressRoots.length+modes.length)
    throw Error("Use optional --review-root, --progress-root and one output mode");
  const mode=modes[0]??(progressRoots.length?"--summary":"--check");
  if(!["--check","--summary","--all"].includes(mode)&&
    !mode.startsWith("--template-packet=")&&!mode.startsWith("--packet="))
    throw Error("Use --check, --summary, --all, --template-packet=N, --packet=N");
  const queue=loadPinnedHumanReviewActionQueue(
    reviewRoots.length?reviewRoots[0].slice("--review-root=".length):undefined);
  const progress=progressRoots.length?
    loadHumanReviewActionDirectory(progressRoots[0].slice("--progress-root=".length)):
    emptyHumanReviewActionPacketSet(queue);
  const report=reconcileHumanReviewActionPackets(progress,queue);
  if(mode==="--check")console.log(
    "JODLO 45-packet / 889 Category / 7,267 Service / 2,667 reviewer tasks: unverified local progress, ZERO approvals.");
  else if(mode==="--summary")process.stdout.write(
    JSON.stringify(report.summary,null,2)+"\n");
  else if(mode==="--all")process.stdout.write(JSON.stringify(report,null,2)+"\n");
  else if(mode.startsWith("--template-packet=")){
    const n=parsePacketArg(mode.replace("--template-packet=","--packet="),45);
    process.stdout.write(JSON.stringify(makeHumanReviewActionPacket(queue,n),null,2)+"\n");
  }else if(mode.startsWith("--packet=")){
    const n=parsePacketArg(mode,45);
    process.stdout.write(JSON.stringify({
      ...report.packetProgress[n-1],categories:progress[n-1].categories,
    },null,2)+"\n");
  }
}
