/**
 * ADR-0011 full-catalog human REVIEW EXCEPTION REGISTER, source only.
 * No automated safety determination, approved labels, SQL, alias or seed.
 * Reuses the exact 45 full-Service packets and 17 verified desk assessments.
 */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedM005ScopeReview} from "./verify-m005-first-scope-review.mjs";
import {parsePacketArg} from "./catalog-review-packets.mjs";

const SHA="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const CATEGORY_PENDING="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW";
const SERVICE_PENDING="UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED";
const DESK=["NARROW_SCOPE_RECOMMENDATION","EXTRA_REVIEW_REQUIRED","HOLD_FOR_SPECIALIST_POLICY"];
export const ISSUE_CODES=Object.freeze([
  "CATEGORY_ID_SYNTAX","CATEGORY_SLUG_SYNTAX","CATEGORY_LABEL_SYNTAX",
  "HISTORICAL_CATEGORY_FLAGS","HINDI_SERVICE_LATIN_SCRIPT",
  "SERVICE_ID_POLICY","SHARED_SERVICE_PHRASE_PARENTS",
  "UNVERIFIED_SECTION_REFERENCE","DESK_EXTRA_REVIEW","DESK_SPECIALIST_HOLD",
]);
const own=(v,key)=>Object.prototype.hasOwnProperty.call(v,key);
const cmp=(a,b)=>a<b?-1:a>b?1:0;

/**
 * Diagnostics are source facts/desk opinions, NOT a safe/unsafe classifier.
 * Every row (including one with ZERO diagnostic flags) remains review-pending.
 */
export function makeAllCategoryExceptionRegister(full,scope){
  if(full?.manifest?.kind!=="JODLO_ALL_889_FULL_SERVICE_PACKET_MANIFEST_ONLY"||
    full.manifest.state!=="ALL_7267_UNAPPROVED_ZERO_ACTIVATION"||
    full.manifest.sourceJsonSha256!==SHA||
    JSON.stringify(full.manifest.languages)!=='["en","hi"]'||
    full.manifest.summary?.historicalCategories!==889||
    full.manifest.summary?.historicalServices!==7267||
    full.manifest.summary?.reviewPackets!==45||
    full.manifest.summary.categoriesAuthorizedForActivation!==0||
    full.manifest.summary.approvedAliases!==0||
    !Array.isArray(full.packets)||full.packets.length!==45||
    scope?.kind!=="JODLO_M005_SOURCE_BACKED_SCOPE_RECOMMENDATIONS_ONLY"||
    scope.state!=="NO_HUMAN_CERTIFICATION_NO_FOUNDER_CATEGORY_APPROVAL_NO_D1_SEED"||
    scope.sourceJsonSha256!==SHA||
    JSON.stringify(scope.languages)!=='["en","hi"]'||
    !Array.isArray(scope.categories)||scope.categories.length!==17)
    throw Error("Incomplete, changed or authorizing full source or M-005 desk evidence");
  const desk=new Map(),deskCounts=Object.fromEntries(DESK.map(s=>[s,0]));
  for(const row of scope.categories){
    if(typeof row?.sourceCategoryId!=="string"||desk.has(row.sourceCategoryId)||
      !DESK.includes(row.assessment)||row.reviewState!=="ALL_APPROVALS_PENDING"||
      typeof row.riskReason!=="string"||!row.riskReason||
      typeof row.sourceSafetyTier!=="string"||!row.sourceSafetyTier||
      !Array.isArray(row.requiredSignoffs)||row.requiredSignoffs.length!==4||
      own(row,"approved")||own(row,"is_active"))
      throw Error("Untrusted, duplicated or approved desk assessment");
    desk.set(row.sourceCategoryId,row);deskCounts[row.assessment]++;
  }
  if(deskCounts.NARROW_SCOPE_RECOMMENDATION!==10||
    deskCounts.EXTRA_REVIEW_REQUIRED!==4||
    deskCounts.HOLD_FOR_SPECIALIST_POLICY!==3)
    throw Error("Historical 17-trade desk review changed");
  const seenCategories=new Set(),seenServices=new Set(),usedDesk=new Set();
  const totals=Object.fromEntries(ISSUE_CODES.map(code=>[code,{
    categories:0,affectedServiceRows:0,
  }]));
  const packets=[];
  let serviceCount=0,latinCount=0,idPolicyCount=0,noMechanicalFlags=0;
  for(const [index,p] of full.packets.entries()){
    if(p.packetNumber!==index+1||p.categoryCount!==p.categories.length||
      full.manifest.packets[index]?.packetNumber!==p.packetNumber||
      p.categoryCount<1||p.categoryCount>20)
      throw Error("Changed, missing or reordered full-Service packet");
    const categories=p.categories.map(cat=>{
      if(typeof cat.sourceCategoryId!=="string"||
        seenCategories.has(cat.sourceCategoryId)||
        cat.reviewState!==CATEGORY_PENDING||
        !Array.isArray(cat.services)||!Array.isArray(cat.sourceReviewFlags)||
        !Array.isArray(cat.mappingSyntaxIssues)||
        typeof cat.historicalSafetyTier!=="string"||!cat.historicalSafetyTier||
        cat.services.length!==cat.totalHistoricalServices||
        own(cat,"approved")||own(cat,"is_active"))
        throw Error("Duplicate, modified or approved historical Category");
      seenCategories.add(cat.sourceCategoryId);
      const flags=new Map();
      const categoryFlag=(code,detail)=>{
        flags.set(code,{code,sourceDetails:detail,affectedServiceIds:[]});
      };
      if(cat.mappingSyntaxIssues.includes("SOURCE_CATEGORY_ID_INCOMPATIBLE"))
        categoryFlag("CATEGORY_ID_SYNTAX",cat.mappingSyntaxIssues.filter(x=>x.includes("CATEGORY_ID")));
      if(cat.mappingSyntaxIssues.includes("SOURCE_CATEGORY_SLUG_INCOMPATIBLE"))
        categoryFlag("CATEGORY_SLUG_SYNTAX",cat.mappingSyntaxIssues.filter(x=>x.includes("SLUG")));
      if(cat.mappingSyntaxIssues.some(x=>x.includes("LABEL")))
        categoryFlag("CATEGORY_LABEL_SYNTAX",cat.mappingSyntaxIssues.filter(x=>x.includes("LABEL")));
      if(cat.sourceReviewFlags.length)
        categoryFlag("HISTORICAL_CATEGORY_FLAGS",cat.sourceReviewFlags.slice());
      const markService=(code,id)=>{
        if(!flags.has(code))categoryFlag(code,[]);
        flags.get(code).affectedServiceIds.push(id);
      };
      let latin=0,idPolicy=0,shared=0;
      for(const s of cat.services){
        if(typeof s.sourceServiceId!=="string"||!s.sourceServiceId||
          seenServices.has(s.sourceServiceId)||
          s.reviewState!==SERVICE_PENDING||
          !Array.isArray(s.sourceFlags)||
          !s.otherSourceCategoryChoices||
          !Array.isArray(s.otherSourceCategoryChoices.en)||
          !Array.isArray(s.otherSourceCategoryChoices.hi)||
          own(s,"approved")||own(s,"is_active")||own(s,"searchKeywords"))
          throw Error("Missing/duplicate/approved historical Service");
        seenServices.add(s.sourceServiceId);
        if(s.sourceFlags.includes("HINDI_LABEL_LATIN_SCRIPT_REVIEW")){
          markService("HINDI_SERVICE_LATIN_SCRIPT",s.sourceServiceId);latin++;
        }
        if(s.sourceFlags.includes("LEAF_ID_MAPPING_POLICY_REQUIRED")){
          markService("SERVICE_ID_POLICY",s.sourceServiceId);idPolicy++;
        }
        if(s.otherSourceCategoryChoices.en.length||s.otherSourceCategoryChoices.hi.length){
          markService("SHARED_SERVICE_PHRASE_PARENTS",s.sourceServiceId);shared++;
        }
        if(s.sourceFlags.includes("HISTORICAL_SECTION_REFERENCE_UNVERIFIED")){
          if(typeof s.sourceSectionId!=="string"||!s.sourceSectionId)
            throw Error("Section diagnostic lacks original reference");
          markService("UNVERIFIED_SECTION_REFERENCE",s.sourceServiceId);
        }else if(s.sourceSectionId!==null)
          throw Error("Unflagged historical section reference");
      }
      if(latin!==cat.hindiLatinFlaggedServices||
        idPolicy!==cat.serviceIdPolicyFlaggedServices||
        shared!==cat.crossCategoryAmbiguousServices)
        throw Error("Diagnostic totals differ from source full-Service packet");
      serviceCount+=cat.services.length;latinCount+=latin;idPolicyCount+=idPolicy;
      const sample=desk.get(cat.sourceCategoryId)??null;
      if(sample){
        usedDesk.add(cat.sourceCategoryId);
        if(sample.sourceSafetyTier!==cat.historicalSafetyTier)
          throw Error("Prior M-005 desk review source tier changed");
        if(sample.assessment==="EXTRA_REVIEW_REQUIRED")
          categoryFlag("DESK_EXTRA_REVIEW",[sample.riskReason]);
        if(sample.assessment==="HOLD_FOR_SPECIALIST_POLICY")
          categoryFlag("DESK_SPECIALIST_HOLD",[sample.riskReason]);
      }
      const issues=ISSUE_CODES.filter(code=>flags.has(code)).map(code=>{
        const issue=flags.get(code);
        const total=totals[code];
        total.categories++;
        total.affectedServiceRows+=issue.affectedServiceIds.length;
        return issue;
      });
      if(!issues.length)noMechanicalFlags++;
      return {
        packetNumber:p.packetNumber,sourceCategoryId:cat.sourceCategoryId,
        sourceGroupId:cat.sourceGroupId,sourceFamilyId:cat.sourceFamilyId,
        historicalNameEn:cat.historicalNameEn,
        historicalNameHi:cat.historicalNameHi,
        historicalSafetyTierNotAnAuthorization:cat.historicalSafetyTier,
        totalHistoricalServices:cat.services.length,
        deskReviewOnly:sample?{
          assessment:sample.assessment,riskReason:sample.riskReason,
          reviewState:sample.reviewState,
        }:{assessment:"NOT_DESK_ASSESSED",riskReason:null,
          reviewState:"HUMAN_OCCUPATIONAL_ASSESSMENT_PENDING"},
        issues,
        reviewState:"HUMAN_LANGUAGE_SAFETY_MAPPING_AND_FOUNDER_REVIEW_PENDING",
        categoriesAuthorizedForActivation:0,
      };
    });
    packets.push({packetNumber:index+1,categoryCount:categories.length,categories});
  }
  if(seenCategories.size!==889||seenServices.size!==7267||serviceCount!==7267||
    latinCount!==4928||idPolicyCount!==1784||usedDesk.size!==17)
    throw Error("Full 889/7267 coverage or original flag counts changed");
  return {
    kind:"JODLO_ALL_889_REVIEW_EXCEPTION_REGISTER_ONLY",
    state:"DIAGNOSTICS_NOT_LEGAL_OR_EDITORIAL_APPROVAL",
    sourceJsonSha256:SHA,languages:["en","hi"],
    summary:{
      historicalCategories:889,historicalServices:7267,
      packets:45,deskReviewedCategories:17,
      deskUnassessedCategories:872,
      categoriesWithNoMechanicalException:noMechanicalFlags,
      allCategoriesStillNeedingHumanSafetyAndLanguageReview:889,
      allServicesStillNeedingHumanLanguageAndScopeReview:7267,
      issueDiagnostics:totals,
      humanReviewsAuthenticated:0,founderCategoryApprovalsAuthenticated:0,
      categoriesAuthorizedForActivation:0,approvedServiceAliases:0,
      activatedCategories:0,activatedServices:0,sqlStatementsGenerated:0,
    },
    packets,
  };
}
export function loadPinnedCategoryExceptionRegister(){
  const full=loadPinnedFullCategoryServiceEvidence();
  const desk=loadPinnedM005ScopeReview();
  return makeAllCategoryExceptionRegister(full,desk.review);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??"--check";
  if(process.argv.length>3)
    throw Error("Use exactly one exception review option");
  const register=loadPinnedCategoryExceptionRegister(),rows=register.packets.flatMap(p=>p.categories);
  if(mode==="--check")console.log(
    "JODLO 889 Category / 7,267 Service diagnostic exceptions: human review pending, ZERO activation.");
  else if(mode==="--summary")process.stdout.write(JSON.stringify(register.summary,null,2)+"\n");
  else if(mode==="--all")process.stdout.write(JSON.stringify(register,null,2)+"\n");
  else if(mode==="--issues")process.stdout.write(JSON.stringify(
    rows.filter(r=>r.issues.length>0),null,2)+"\n");
  else if(mode.startsWith("--packet=")){
    const n=parsePacketArg(mode,register.packets.length);
    process.stdout.write(JSON.stringify(register.packets[n-1],null,2)+"\n");
  }else if(mode.startsWith("--category=")){
    const c=rows.find(r=>r.sourceCategoryId===mode.slice(11));
    if(!c)throw Error("Unknown source Category");
    process.stdout.write(JSON.stringify(c,null,2)+"\n");
  }else if(mode.startsWith("--issue=")){
    const issue=mode.slice(8);
    if(!ISSUE_CODES.includes(issue))throw Error("Unknown diagnostic issue");
    process.stdout.write(JSON.stringify(
      rows.filter(r=>r.issues.some(x=>x.code===issue)),null,2)+"\n");
  }else throw Error("Use --check, --summary, --all, --issues, --packet=N, --category=ID, --issue=CODE");
}
