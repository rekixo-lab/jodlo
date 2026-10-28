/* Offline M-005 government reference screening, never an approval or a D1 seed. */
import {readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedM005ScopeReview} from "./verify-m005-first-scope-review.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const ids=["MARKETPLACE_2020","PRIVACY_2025","CEA_2026","RAC_PRACTICES","POCSO_2012"];
const hosts=new Set(["consumeraffairs.nic.in","www.meity.gov.in","cea.nic.in","ozonecell.nic.in","www.indiacode.nic.in"]);
const mandatory={
 electrician:{source:"CEA_2026",check:"CURRENT_CEA_AND_STATE_CREDENTIAL_RULES"},
 "ac-technician":{source:"RAC_PRACTICES",check:"SPECIALIST_REFRIGERANT_TRAINING_AND_TOOLS"},
 "home-tutor":{source:"POCSO_2012",check:"CHILD_ABUSE_REPORTING_ESCALATION"},
 "mobile-repair":{source:"PRIVACY_2025",check:"CUSTOMER_DEVICE_CONSENT_AND_DATA_DELETION"},
 "laptop-repair":{source:"PRIVACY_2025",check:"CUSTOMER_DEVICE_CONSENT_AND_DATA_DELETION"},
};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function shape(obj,keys){
  return obj&&typeof obj==="object"&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join("|")===keys.slice().sort().join("|");
}
function host(url){
  try{const u=new URL(url);return u.protocol==="https:"?u.hostname:null;}
  catch{return null;}
}
export function verifyM005GovernmentEvidence(report,original){
  if(!shape(report,["kind","state","asOfDate","languages","sourceJsonSha256",
     "reviewBasis","sources","categories"]) ||
    report.kind!=="JODLO_M005_OFFICIAL_EVIDENCE_CROSSWALK_PRELIMINARY" ||
    report.state!=="EXPERT_SIGNOFF_REQUIRED_ZERO_CATEGORY_APPROVAL" ||
    report.reviewBasis!=="OFFICIAL_SOURCES_SCREENED_NO_ISSUED_CERTIFICATIONS" ||
    report.asOfDate!=="2026-10-28" ||
    JSON.stringify(report.languages)!=='["en","hi"]' ||
    report.sourceJsonSha256!==original.sourceJsonSha256 ||
    !Array.isArray(report.sources)||report.sources.length!==5 ||
    !Array.isArray(report.categories)||report.categories.length!==17)
    throw Error("M-005 evidence or approval boundary invalid");
  const found=new Set();
  for(const s of report.sources){
    if(!shape(s,["id","issuer","title","url","type","note"])||
      !ids.includes(s.id)||found.has(s.id)||!hosts.has(host(s.url))||
      !["OFFICIAL_LEGAL_TEXT","OFFICIAL_LEGAL_REFERENCE",
        "OFFICIAL_REGULATORY_INDEX","OFFICIAL_TECHNICAL_GUIDANCE"].includes(s.type)||
      ![s.title,s.issuer,s.note].every(v=>typeof v==="string"&&v.length>10))
      throw Error("Unsupported regulatory source");
    found.add(s.id);
  }
  if(found.size!==ids.length)throw Error("Missing official source");
  const prev=new Map(original.categories.map(r=>[r.sourceCategoryId,r]));
  const seen=new Set(),counts={NARROW_SCOPE_RECOMMENDATION:0,EXTRA_REVIEW_REQUIRED:0,HOLD_FOR_SPECIALIST_POLICY:0};
  for(const row of report.categories){
    if(!shape(row,["sourceCategoryId","previousAssessment","evidenceIds",
       "requiredReviewerChecks","legalSafetyReview","hindiEnglishHumanReview",
       "founderM005Approval","publicActivation"])||
      seen.has(row.sourceCategoryId)||!prev.has(row.sourceCategoryId)||
      prev.get(row.sourceCategoryId).assessment!==row.previousAssessment||
      row.legalSafetyReview!=="NOT_COMPLETED"||
      row.hindiEnglishHumanReview!=="NOT_COMPLETED"||
      row.founderM005Approval!=="NOT_GRANTED"||
      row.publicActivation!=="BLOCKED"||
      !Array.isArray(row.evidenceIds)||row.evidenceIds.length===0||
      row.evidenceIds.some(x=>!ids.includes(x))||
      new Set(row.evidenceIds).size!==row.evidenceIds.length||
      !row.evidenceIds.includes("MARKETPLACE_2020")||
      !Array.isArray(row.requiredReviewerChecks)||row.requiredReviewerChecks.length<3||
      new Set(row.requiredReviewerChecks).size!==row.requiredReviewerChecks.length||
      !row.requiredReviewerChecks.includes("REVIEW_PLATFORM_ECOMMERCE_APPLICABILITY")||
      !row.requiredReviewerChecks.includes("DEFINE_ACCURATE_SCOPE_AND_COMPLAINT_PROCESS")||
      row.requiredReviewerChecks.some(x=>typeof x!=="string"||!/^[A-Z0-9_]+$/.test(x)))
      throw Error("Unapproved Category source or reviewer checks modified");
    const required=mandatory[row.sourceCategoryId];
    if(required&&(!row.evidenceIds.includes(required.source)||
      !row.requiredReviewerChecks.includes(required.check)))
      throw Error("Mandatory specialist safeguard missing");
    seen.add(row.sourceCategoryId);
    counts[row.previousAssessment]++;
  }
  if(seen.size!==17||counts.NARROW_SCOPE_RECOMMENDATION!==10||
    counts.EXTRA_REVIEW_REQUIRED!==4||counts.HOLD_FOR_SPECIALIST_POLICY!==3)
    throw Error("Initial 17 Category coverage or risk triage changed");
  return {categoriesCrossChecked:17,officialReferences:5,
    proposedNarrow:10,extraReview:4,hold:3,
    qualifiedHumanSignoffs:0,founderApprovals:0,activatedCategories:0};
}
export function loadM005GovernmentEvidence(){
  const report=JSON.parse(readFileSync(join(ROOT,
    "docs/reference/data/jodlo-m005-official-evidence-crosswalk-2026-10-28.json"),"utf8"));
  return {report,summary:verifyM005GovernmentEvidence(report,loadPinnedM005ScopeReview().review)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=process.argv[2]??"--check";
  if(process.argv.length>3||!["--check","--summary"].includes(arg))
    throw Error("Usage: node scripts/verify-m005-official-evidence.mjs [--check|--summary]");
  const {summary}=loadM005GovernmentEvidence();
  if(arg==="--summary")process.stdout.write(JSON.stringify(summary,null,2)+"\n");
  else console.log("JODLO M-005 source screening: 17 trades, 5 official sources, "+
    "zero human/founder signoffs and zero public Category activation.");
}
