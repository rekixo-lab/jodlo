/**
 * ADR-0011: source-pinned human OCCUPATIONAL SCOPE draft intake for ALL 7,267
 * historical Services in exactly 45 packets/889 Categories. No legal/safety
 * inference, human attestation, catalog approval, alias import or SQL.
 * Complements (does not duplicate) correction-only Service name packets and
 * existing M-005 first-17 legal evidence intake.
 */
import {createHash} from "node:crypto";
import {readFileSync,lstatSync,realpathSync} from "node:fs";
import {dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {parsePacketArg} from "./catalog-review-packets.mjs";
import {validJodloReviewUrl} from "./review-evidence-url.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SOURCE="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const KIND="JODLO_ALL_SERVICE_OCCUPATIONAL_SCOPE_INTAKE_ONLY";
const STATE="SOURCE_PINNED_UNVERIFIED_PROPOSALS_ZERO_AUTHORIZATION";
const REVIEW="HUMAN_OCCUPATIONAL_LEGAL_AND_BILINGUAL_REVIEW_PENDING";
const FIELDS=["includedEn","includedHi","excludedEn","excludedHi","prerequisitesEn","prerequisitesHi"];
const CONCERNS=Object.freeze([
  "REGULATION_OR_LICENSING_REVIEW","SPECIALIST_QUALIFICATION_REVIEW",
  "PHYSICAL_SAFETY_REVIEW","PRIVACY_AND_CONTACT_REVIEW",
  "UNCLEAR_WORK_BOUNDARY","OTHER_SPECIALIST_REVIEW",
]);
const exactly=(v,fields)=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&
  Object.keys(v).sort().join("|")===fields.slice().sort().join("|");
const hash=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const CODE=/[\u0000-\u001f\u007f-\u009f<>]/u;
const HI=/\p{Script=Devanagari}/u;
const EN=/[A-Za-z]/u;
const compare=(a,b)=>a<b?-1:a>b?1:0;

function context(full){
  if(full?.manifest?.kind!=="JODLO_ALL_889_FULL_SERVICE_PACKET_MANIFEST_ONLY"||
    full.manifest.state!=="ALL_7267_UNAPPROVED_ZERO_ACTIVATION"||
    full.manifest.sourceJsonSha256!==SOURCE||
    JSON.stringify(full.manifest.languages)!=='["en","hi"]'||
    full.manifest.summary?.historicalCategories!==889||
    full.manifest.summary?.historicalServices!==7267||
    full.manifest.summary?.reviewPackets!==45||
    full.manifest.summary.categoriesAuthorizedForActivation!==0||
    !Array.isArray(full.packets)||full.packets.length!==45)
    throw Error("Untrusted or incomplete full-Service source evidence");
  const packets=new Map(),ids=new Set(),leaves=new Set();
  for(const [i,p] of full.packets.entries()){
    if(p?.packetNumber!==i+1||p.kind!=="JODLO_FULL_CATEGORY_SERVICE_EVIDENCE_ONLY"||
      p.state!=="ALL_SERVICE_LABELS_UNAPPROVED_NO_ALIAS_OR_CATEGORY_ACTIVATION"||
      p.sourceJsonSha256!==SOURCE||
      !Array.isArray(p.categories)||p.categoryCount!==p.categories.length||
      p.categoryCount<1||p.categoryCount>20||
      full.manifest.packets?.[i]?.packetNumber!==p.packetNumber||
      full.manifest.packets[i].historicalServiceCount!==p.historicalServiceCount)
      throw Error("Missing or changed original source Service packet");
    let n=0;
    for(const c of p.categories){
      if(ids.has(c.sourceCategoryId)||c.reviewState!==
        "BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW"||
        !Array.isArray(c.services)||c.services.length!==c.totalHistoricalServices||
        typeof c.historicalNameEn!=="string"||
        typeof c.historicalNameHi!=="string")
        throw Error("Untrusted Category source lineage");
      ids.add(c.sourceCategoryId);
      for(const leaf of c.services){
        if(leaves.has(leaf.sourceServiceId)||leaf.reviewState!==
          "UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED"||
          typeof leaf.historicalNameEn!=="string"||
          typeof leaf.historicalNameHi!=="string"||
          !Array.isArray(leaf.sourceFlags)||
          !Array.isArray(leaf.otherSourceCategoryChoices?.en)||
          !Array.isArray(leaf.otherSourceCategoryChoices?.hi))
          throw Error("Untrusted original Service lineage or review state");
        leaves.add(leaf.sourceServiceId);n++;
      }
    }
    if(n!==p.historicalServiceCount)throw Error("Original Service count mismatch");
    packets.set(i+1,p);
  }
  if(ids.size!==889||leaves.size!==7267)
    throw Error("Full original 889 Category / 7,267 Service coverage missing");
  return packets;
}
const categoryFingerprint=(p,c)=>hash({
  sourceJsonSha256:SOURCE,packetNumber:p.packetNumber,
  id:c.sourceCategoryId,group:c.sourceGroupId,family:c.sourceFamilyId,
  historicalNameEn:c.historicalNameEn,historicalNameHi:c.historicalNameHi,
  historicalSafetyTier:c.historicalSafetyTier,sourceReviewFlags:c.sourceReviewFlags,
  mappingSyntaxIssues:c.mappingSyntaxIssues,sourceServiceCount:c.totalHistoricalServices,
});
const serviceFingerprint=(p,c,s)=>hash({
  sourceJsonSha256:SOURCE,packetNumber:p.packetNumber,
  category:c.sourceCategoryId,leaf:s,
});

/** A complete editable 1-of-45 packet. Every original Service is represented. */
export function makeServiceScopePacket(full,packetNumber){
  const packets=context(full);
  if(!Number.isInteger(packetNumber)||!packets.has(packetNumber))
    throw Error("Unknown Service occupational scope packet");
  const p=packets.get(packetNumber);
  return {
    kind:KIND,state:STATE,sourceJsonSha256:SOURCE,languages:["en","hi"],
    packetNumber,reviewState:REVIEW,
    categories:p.categories.map(c=>({
      sourceCategoryId:c.sourceCategoryId,
      sourceGroupId:c.sourceGroupId,sourceFamilyId:c.sourceFamilyId,
      historicalNameEn:c.historicalNameEn,historicalNameHi:c.historicalNameHi,
      historicalSafetyTierNotAuthorization:c.historicalSafetyTier,
      sourceCategorySha256:categoryFingerprint(p,c),
      services:c.services.map(s=>({
        sourceServiceId:s.sourceServiceId,
        sourceServiceSha256:serviceFingerprint(p,c,s),
        historicalNameEn:s.historicalNameEn,
        historicalNameHi:s.historicalNameHi,
        sourceFlags:s.sourceFlags.slice(),
        otherSourceCategoryChoices:{
          en:s.otherSourceCategoryChoices.en.slice(),
          hi:s.otherSourceCategoryChoices.hi.slice(),
        },
        proposedScope:Object.fromEntries(FIELDS.map(k=>[k,null])),
        concernCodes:[],status:"NOT_SUBMITTED",evidenceUrl:null,
        reviewState:REVIEW,
      })),
    })),
  };
}
function proposedText(value,key){
  if(typeof value!=="string"||value!==value.trim()||
    value!==value.normalize("NFKC")||[...value].length<4||
    [...value].length>300||CODE.test(value)||/https?:\/\//iu.test(value))
    throw Error("Invalid, overly long, or unnormalized occupational scope");
  if(key.endsWith("Hi")&&(!HI.test(value)||EN.test(value)))
    throw Error("Hindi scope requires Devanagari, not English or Hinglish");
  if(key.endsWith("En")&&(!EN.test(value)||HI.test(value)))
    throw Error("English scope requires English text");
}
/** The proposal is always unverified; the tool cannot attest a real human,
 * verify a licensing claim, issue approval or create public Service rows.
 */
export function validateServiceScopePacket(input,full){
  const packets=context(full);
  if(!exactly(input,["kind","state","sourceJsonSha256","languages",
    "packetNumber","reviewState","categories"])||
    input.kind!==KIND||input.state!==STATE||
    input.sourceJsonSha256!==SOURCE||
    JSON.stringify(input.languages)!=='["en","hi"]'||
    input.reviewState!==REVIEW||
    !Number.isInteger(input.packetNumber)||!packets.has(input.packetNumber))
    throw Error("Untrusted occupational scope input or attempted authorization");
  const original=makeServiceScopePacket(full,input.packetNumber);
  if(!Array.isArray(input.categories)||
    input.categories.length!==original.categories.length)
    throw Error("Missing or added occupational Category source");
  let services=0,submitted=0,concernRows=0,raised=0;
  for(const [i,cat] of input.categories.entries()){
    const orig=original.categories[i];
    if(!exactly(cat,["sourceCategoryId","sourceGroupId",
      "sourceFamilyId","historicalNameEn","historicalNameHi",
      "historicalSafetyTierNotAuthorization","sourceCategorySha256","services"])||
      Object.entries(orig).some(([k,v])=>k!=="services"&&
        JSON.stringify(cat[k])!==JSON.stringify(v))||
      !Array.isArray(cat.services)||cat.services.length!==orig.services.length)
      throw Error("Changed, reordered or forged source Category lineage");
    for(const [j,leaf] of cat.services.entries()){
      const before=orig.services[j];
      if(!exactly(leaf,["sourceServiceId","sourceServiceSha256",
        "historicalNameEn","historicalNameHi","sourceFlags",
        "otherSourceCategoryChoices","proposedScope","concernCodes",
        "status","evidenceUrl","reviewState"])||
        Object.entries(before).some(([k,v])=>
          !["proposedScope","concernCodes","status","evidenceUrl"].includes(k)&&
          JSON.stringify(leaf[k])!==JSON.stringify(v))||
        !exactly(leaf.proposedScope,FIELDS)||
        !Array.isArray(leaf.concernCodes)||
        leaf.concernCodes.length>CONCERNS.length||
        new Set(leaf.concernCodes).size!==leaf.concernCodes.length||
        leaf.concernCodes.some(x=>!CONCERNS.includes(x))||
        JSON.stringify(leaf.concernCodes)!==
          JSON.stringify(leaf.concernCodes.slice().sort(compare))||
        !["NOT_SUBMITTED","EVIDENCE_LINKED_UNVERIFIED"].includes(leaf.status))
        throw Error("Missing Service, forged approval, or unsupported concern code");
      const values=FIELDS.map(k=>leaf.proposedScope[k]);
      if(leaf.status==="NOT_SUBMITTED"){
        if(values.some(v=>v!==null)||leaf.concernCodes.length||
          leaf.evidenceUrl!==null)
          throw Error("Unsubmitted scope cannot contain review claims");
      }else{
        if(!validJodloReviewUrl(leaf.evidenceUrl))
          throw Error("Submitted scope requires an unverified JODLO PR URL");
        for(const k of FIELDS)proposedText(leaf.proposedScope[k],k);
        submitted++;
        if(leaf.concernCodes.length){concernRows++;raised+=leaf.concernCodes.length;}
      }
      services++;
    }
  }
  if(services!==packets.get(input.packetNumber).historicalServiceCount)
    throw Error("Source Service count altered");
  return {
    kind:"JODLO_SERVICE_OCCUPATIONAL_SCOPE_VALIDATION_REPORT_ONLY",
    state:"QUALIFIED_HUMAN_LEGAL_AND_LANGUAGE_REVIEW_STILL_PENDING",
    sourceJsonSha256:SOURCE,packetNumber:input.packetNumber,
    originalCategories:input.categories.length,originalServices:services,
    scopeDraftsWithUnverifiedEvidence:submitted,
    originalServicesStillWithoutDraft:services-submitted,
    proposedConcernRowsUnverified:concernRows,
    proposedConcernCodesUnverified:raised,
    qualifiedSafetyReviewsAuthenticated:0,
    qualifiedLegalReviewsAuthenticated:0,
    humanBilingualReviewsAuthenticated:0,
    founderCategoryApprovalsAuthenticated:0,
    categoriesAuthorizedForActivation:0,
    servicesAuthorizedForActivation:0,
    sqlStatementsGenerated:0,
  };
}
export function loadPinnedServiceScopePacket(packetNumber){
  const full=loadPinnedFullCategoryServiceEvidence();
  const packet=makeServiceScopePacket(full,packetNumber);
  return {packet,report:validateServiceScopePacket(packet,full)};
}
function readLocalJson(raw){
  if(!raw||isAbsolute(raw))throw Error("Require a repo-relative occupational review JSON");
  const path=resolve(ROOT,raw),rel=relative(ROOT,path);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))
    throw Error("Review input escapes repo");
  const realRoot=realpathSync(ROOT),real=realpathSync(path);
  if(real===realRoot||!real.startsWith(realRoot+sep)||
    !lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||
    lstatSync(path).size>1_500_000)
    throw Error("Refuse symlink, non-file, or oversized review JSON");
  return JSON.parse(readFileSync(path,"utf8"));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=process.argv[2]??"--check";
  if(process.argv.length>3)throw Error("Use a single occupational scope option");
  const full=loadPinnedFullCategoryServiceEvidence();
  if(arg==="--check"||arg==="--summary"){
    const reports=full.packets.map((_,i)=>validateServiceScopePacket(
      makeServiceScopePacket(full,i+1),full));
    const result={
      originalCategories:full.manifest.summary.historicalCategories,
      originalServices:reports.reduce((n,r)=>n+r.originalServices,0),
      reviewPackets:reports.length,
      scopeDraftsWithUnverifiedEvidence:0,
      qualifiedHumanReviewsAuthenticated:0,
      categoriesAuthorizedForActivation:0,servicesAuthorizedForActivation:0,
      sqlStatementsGenerated:0,
    };
    if(result.originalCategories!==889||result.originalServices!==7267||
       result.reviewPackets!==45)throw Error("Incomplete source scope coverage");
    if(arg==="--check")console.log(
      "JODLO 889 Categories / 7,267 Service scope drafts: source complete; ZERO approval.");
    else process.stdout.write(JSON.stringify(result,null,2)+"\n");
  }else if(arg.startsWith("--packet=")){
    const n=parsePacketArg(arg,45);
    process.stdout.write(JSON.stringify(makeServiceScopePacket(full,n),null,2)+"\n");
  }else if(arg.startsWith("--validate-file=")){
    const payload=readLocalJson(arg.slice("--validate-file=".length));
    process.stdout.write(JSON.stringify(
      validateServiceScopePacket(payload,full),null,2)+"\n");
  }else throw Error("Use --check, --summary, --packet=N, --validate-file=PATH");
}
