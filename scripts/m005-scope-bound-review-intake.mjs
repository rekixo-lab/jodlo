/** M-005 LOCAL HUMAN-EVIDENCE INTAKE: links are UNVERIFIED, NEVER approval, D1 seed or deploy. */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve,dirname,join,relative,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedM005ScopeReview} from "./verify-m005-first-scope-review.mjs";
import {loadM005GovernmentEvidence} from "./verify-m005-official-evidence.mjs";
import {validJodloReviewUrl} from "./review-evidence-url.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const KIND="JODLO_M005_SCOPE_BOUND_EVIDENCE_INTAKE_ONLY";
const STATE="SUBMISSIONS_UNVERIFIED_ZERO_CATEGORY_ACTIVATION";
const GATES=[
 "QUALIFIED_LEGAL_AND_OCCUPATIONAL_SAFETY",
 "HUMAN_HINDI_AND_ENGLISH_EDITOR",
 "OPERATIONS_MODERATION_CONSENT_AND_COMPLAINTS",
 "FOUNDER_M005_EXACT_SCOPE_AND_CATEGORY",
];
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const exact=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
const sha=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function context(scopes,government){
 if(scopes?.kind!=="JODLO_M005_SOURCE_BACKED_SCOPE_RECOMMENDATIONS_ONLY"||
    scopes.state!=="NO_HUMAN_CERTIFICATION_NO_FOUNDER_CATEGORY_APPROVAL_NO_D1_SEED"||
    government?.kind!=="JODLO_M005_OFFICIAL_EVIDENCE_CROSSWALK_PRELIMINARY"||
    government.state!=="EXPERT_SIGNOFF_REQUIRED_ZERO_CATEGORY_APPROVAL"||
    scopes.sourceJsonSha256!==government.sourceJsonSha256||
    JSON.stringify(scopes.languages)!=='["en","hi"]'||
    JSON.stringify(government.languages)!=='["en","hi"]')
   throw Error("Untrusted original M-005 scope / regulation sources");
 const original=new Map(scopes.categories.map(v=>[v.sourceCategoryId,v]));
 const risk=new Map(government.categories.map(v=>[v.sourceCategoryId,v]));
 if(original.size!==17||risk.size!==17)throw Error("Incomplete original scope source");
 for(const [id,scope] of original){
   const row=risk.get(id);
   if(!row||row.previousAssessment!==scope.assessment||
      scope.reviewState!=="ALL_APPROVALS_PENDING"||
      row.publicActivation!=="BLOCKED"||
      row.legalSafetyReview!=="NOT_COMPLETED"||
      row.hindiEnglishHumanReview!=="NOT_COMPLETED"||
      row.founderM005Approval!=="NOT_GRANTED")
     throw Error("Existing M-005 source claims an approval");
 }
 return {original,risk,sourceSha:scopes.sourceJsonSha256};
}
const scopedHash=(id,ctx)=>sha({
 sourceJsonSha256:ctx.sourceSha,
 category:ctx.original.get(id),officialReview:ctx.risk.get(id),
});
export function makeM005EvidenceIntake(scopes,government,requestedIds){
 const ctx=context(scopes,government);
 if(!Array.isArray(requestedIds)||!requestedIds.length||requestedIds.length>17||
    new Set(requestedIds).size!==requestedIds.length||
    requestedIds.some(id=>typeof id!=="string"||!ctx.original.has(id)))
   throw Error("Require unique subset of 17 reviewed source Category IDs");
 return {
   kind:KIND,state:STATE,sourceJsonSha256:ctx.sourceSha,languages:["en","hi"],
   categories:requestedIds.slice().sort(cmp).map(id=>{
     const version=scopedHash(id,ctx);
     return {
       sourceCategoryId:id,previousAssessment:ctx.original.get(id).assessment,
       scopeSha256:version,
       pendingReviewerChecks:ctx.risk.get(id).requiredReviewerChecks.slice(),
       signoffs:GATES.map(gate=>({
         gate,status:"NOT_SUBMITTED",scopeSha256:version,evidenceUrl:null,
       })),
       decision:"NOT_AUTHORIZED_FOR_PUBLIC_CATALOG",
     };
   }),
 };
}
export function validateM005EvidenceIntake(input,scopes,government){
 const ctx=context(scopes,government);
 if(!exact(input,["kind","state","sourceJsonSha256","languages","categories"])||
    input.kind!==KIND||input.state!==STATE||
    input.sourceJsonSha256!==ctx.sourceSha||
    JSON.stringify(input.languages)!=='["en","hi"]'||
    !Array.isArray(input.categories)||!input.categories.length||
    input.categories.length>17)
   throw Error("Untrusted evidence intake or public activation attempt");
 const seen=new Set();let evidenceCount=0,allFour=0;
 for(const row of input.categories){
   const id=row?.sourceCategoryId,original=ctx.original.get(id),risk=ctx.risk.get(id);
   if(!exact(row,["sourceCategoryId","previousAssessment","scopeSha256",
       "pendingReviewerChecks","signoffs","decision"])||
      seen.has(id)||!original||!risk||
      row.previousAssessment!==original.assessment||
      row.scopeSha256!==scopedHash(id,ctx)||
      JSON.stringify(row.pendingReviewerChecks)!==JSON.stringify(risk.requiredReviewerChecks)||
      row.decision!=="NOT_AUTHORIZED_FOR_PUBLIC_CATALOG"||
      !Array.isArray(row.signoffs)||row.signoffs.length!==4)
     throw Error("Category scope, safety checks or non-approval state tampered");
   seen.add(id);let linked=0;
   for(let i=0;i<GATES.length;i++){
     const entry=row.signoffs[i];
     if(!exact(entry,["gate","status","scopeSha256","evidenceUrl"])||
        entry.gate!==GATES[i]||entry.scopeSha256!==row.scopeSha256||
        !["NOT_SUBMITTED","EVIDENCE_LINKED_UNVERIFIED"].includes(entry.status)||
        (entry.status==="NOT_SUBMITTED"&&entry.evidenceUrl!==null)||
        (entry.status==="EVIDENCE_LINKED_UNVERIFIED"&&!validJodloReviewUrl(entry.evidenceUrl)))
       throw Error("Invalid reviewer gate, untrusted link or false signoff");
     if(entry.status==="EVIDENCE_LINKED_UNVERIFIED"){linked++;evidenceCount++;}
   }
   if(linked===4)allFour++;
 }
 if(JSON.stringify(input.categories.map(x=>x.sourceCategoryId))!==
    JSON.stringify([...seen].sort(cmp)))
   throw Error("Category evidence intake must use stable source ID order");
 return {
   categoriesUnderReview:seen.size,
   evidenceLinksUnverified:evidenceCount,
   categoriesWithFourLinksAwaitingIndependentReview:allFour,
   qualifiedHumanSignoffsAuthenticated:0,founderApprovalsAuthenticated:0,
   authorizedCategories:0,activatedCategories:0,
 };
}
export function loadPinnedM005EvidenceIntake(ids){
 const scopes=loadPinnedM005ScopeReview().review;
 const government=loadM005GovernmentEvidence().report;
 const intake=makeM005EvidenceIntake(scopes,government,
   ids??scopes.categories.map(x=>x.sourceCategoryId));
 return {intake,summary:validateM005EvidenceIntake(intake,scopes,government),
   scopes,government};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2]??"--check";
 if(process.argv.length>3)throw Error("Usage: one review-intake option at a time");
 const {intake,summary,scopes,government}=loadPinnedM005EvidenceIntake();
 if(mode==="--template")process.stdout.write(JSON.stringify(intake,null,2)+"\n");
 else if(mode==="--summary")process.stdout.write(JSON.stringify(summary,null,2)+"\n");
 else if(mode==="--check")console.log("JODLO M-005 17 source-locked review intakes "+
   "validated; no human founder signoffs or activations.");
 else if(mode.startsWith("--category=")){
   const chosen=makeM005EvidenceIntake(scopes,government,[mode.slice("--category=".length)]);
   process.stdout.write(JSON.stringify(chosen,null,2)+"\n");
 }else if(mode.startsWith("--validate-file=")){
   const inputPath=mode.slice("--validate-file=".length);
   if(!inputPath||isAbsolute(inputPath))throw Error("Need a repo-relative local JSON");
   const path=resolve(ROOT,inputPath),rel=relative(ROOT,path);
   if(rel.startsWith("..")||isAbsolute(rel))throw Error("Review JSON must stay in repo");
   const bytes=readFileSync(path);
   if(bytes.length>100_000)throw Error("Evidence intake exceeds limit");
   const submitted=JSON.parse(bytes.toString("utf8"));
   process.stdout.write(JSON.stringify(
     validateM005EvidenceIntake(submitted,scopes,government),null,2)+"\n");
 }else throw Error("Use --check, --summary, --template, --category=ID, --validate-file=RELATIVE_PATH");
}
