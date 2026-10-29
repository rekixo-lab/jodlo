/**
 * ADR-0011: 7,267 historical Services — Hindi/English correction EVIDENCE INTAKE.
 * Same 45 reviewed Category packets, never live aliases, legal signoff or SQL.
 * No generative translation or automatic safety/parent selection.
 */
import {createHash} from "node:crypto";
import {lstatSync,readFileSync,realpathSync} from "node:fs";
import {dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {parsePacketArg} from "./catalog-review-packets.mjs";
import {validJodloReviewUrl} from "./review-evidence-url.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SOURCE="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const KIND="JODLO_ALL_SERVICE_CORRECTION_EVIDENCE_ONLY";
const STATE="UNVERIFIED_SERVICE_EDITORIAL_PROPOSALS_NO_ALIAS_IMPORT";
const ROW_STATE="HUMAN_BILINGUAL_SERVICE_REVIEW_PENDING_NOT_APPROVED";
const SHA=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const CONTROL=/[\u0000-\u001f\u007f-\u009f]/u;
const LATIN=/[A-Za-z]/u;
const HINDI=/\p{Script=Devanagari}/u;
const norm=value=>value.normalize("NFKC").toLowerCase().trim();
const exact=(x,keys)=>x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.keys(x).sort().join("|")===keys.slice().sort().join("|");
const PACKET_KEYS=["kind","state","sourceJsonSha256","languages","packetNumber","categories"];
const CATEGORY_KEYS=["sourceCategoryId","sourceGroupId","sourceFamilyId",
  "sourceCategorySha256","services"];
const SERVICE_KEYS=["sourceServiceId","sourceServiceSha256","historicalNameEn",
  "historicalNameHi","sourceFlags","otherSourceCategoryChoices",
  "proposedNameEn","proposedNameHi","status","evidenceUrl","reviewState"];
const MAX_BYTES=1_000_000;

/** Source-only context; all 889 Categories and 7,267 Services stay present. */
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
    throw Error("Untrusted/incomplete 889 Category and 7,267 Service source");
  const categories=new Set(),services=new Set(),lookup=new Map();
  const sourcePhrases=new Map();
  for(const [i,packet] of full.packets.entries()){
    if(packet.packetNumber!==i+1||
      packet.categoryCount!==packet.categories?.length||
      full.manifest.packets[i]?.packetNumber!==packet.packetNumber)
      throw Error("Missing, reordered or modified full source packet");
    for(const category of packet.categories){
      const catId=category.sourceCategoryId;
      if(categories.has(catId)||
        category.reviewState!=="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW"||
        !Array.isArray(category.services)||
        category.totalHistoricalServices!==category.services.length)
        throw Error("Duplicate, missing or approved Category");
      categories.add(catId);
      for(const leaf of category.services){
        if(services.has(leaf.sourceServiceId)||
          leaf.reviewState!=="UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED"||
          !Array.isArray(leaf.sourceFlags)||
          typeof leaf.historicalNameEn!=="string"||
          typeof leaf.historicalNameHi!=="string")
          throw Error("Duplicate, changed or approved Service");
        services.add(leaf.sourceServiceId);
        for(const [lang,label] of [["en",leaf.historicalNameEn],["hi",leaf.historicalNameHi]]){
          const key=lang+"\u0000"+norm(label);
          if(!sourcePhrases.has(key))sourcePhrases.set(key,new Set());
          sourcePhrases.get(key).add(catId);
        }
      }
    }
    lookup.set(packet.packetNumber,packet);
  }
  if(categories.size!==889||services.size!==7267)
    throw Error("Historic full-service coverage was lost");
  return {lookup,sourcePhrases};
}
const categorySha=(packet,cat)=>SHA({sourceJsonSha256:SOURCE,
  packetNumber:packet.packetNumber,category:{
    sourceCategoryId:cat.sourceCategoryId,sourceGroupId:cat.sourceGroupId,
    sourceFamilyId:cat.sourceFamilyId,historicalNameEn:cat.historicalNameEn,
    historicalNameHi:cat.historicalNameHi,
    historicalSafetyTier:cat.historicalSafetyTier,
    mappingSyntaxIssues:cat.mappingSyntaxIssues,
    sourceReviewFlags:cat.sourceReviewFlags,
    totalHistoricalServices:cat.totalHistoricalServices,
  }});
const serviceSha=(packet,cat,service)=>SHA({sourceJsonSha256:SOURCE,
  packetNumber:packet.packetNumber,
  sourceCategoryId:cat.sourceCategoryId,sourceGroupId:cat.sourceGroupId,
  sourceFamilyId:cat.sourceFamilyId,service});

/** An editor sees every original Service; default is no correction proposal. */
export function makeServiceCorrectionPacket(full,packetNumber){
  const {lookup}=context(full);
  const packet=lookup.get(packetNumber);
  if(!Number.isInteger(packetNumber)||!packet)
    throw Error("Expected one of the original 45 review packets");
  return {
    kind:KIND,state:STATE,sourceJsonSha256:SOURCE,languages:["en","hi"],
    packetNumber,
    categories:packet.categories.map(cat=>({
      sourceCategoryId:cat.sourceCategoryId,
      sourceGroupId:cat.sourceGroupId,sourceFamilyId:cat.sourceFamilyId,
      sourceCategorySha256:categorySha(packet,cat),
      services:cat.services.map(leaf=>({
        sourceServiceId:leaf.sourceServiceId,
        sourceServiceSha256:serviceSha(packet,cat,leaf),
        historicalNameEn:leaf.historicalNameEn,
        historicalNameHi:leaf.historicalNameHi,
        sourceFlags:leaf.sourceFlags.slice(),
        otherSourceCategoryChoices:{
          en:leaf.otherSourceCategoryChoices.en.slice(),
          hi:leaf.otherSourceCategoryChoices.hi.slice(),
        },
        proposedNameEn:null,proposedNameHi:null,
        status:"NOT_SUBMITTED",evidenceUrl:null,reviewState:ROW_STATE,
      })),
    })),
  };
}
function checkProposal(label,lang){
  if(label===null)return;
  if(typeof label!=="string"||!label||label!==label.trim()||
    label!==label.normalize("NFKC")||[...label].length>120||
    CONTROL.test(label)||/[<>]/u.test(label))
    throw Error("Unnormalized, unbounded or unsafe proposed Service label");
  if(lang==="hi"&&(!HINDI.test(label)||LATIN.test(label)))
    throw Error("Proposed Hindi Service label requires Devanagari and no Latin words");
  if(lang==="en"&&(!LATIN.test(label)||HINDI.test(label)))
    throw Error("Proposed English Service label requires Latin and no Devanagari");
}

/** Edits are syntax-checked only; even a real GitHub PR URL is UNVERIFIED. */
export function validateServiceCorrectionPacket(input,full){
  const ctx=context(full);
  if(!exact(input,PACKET_KEYS)||input.kind!==KIND||
    input.state!==STATE||input.sourceJsonSha256!==SOURCE||
    JSON.stringify(input.languages)!=='["en","hi"]'||
    !Number.isInteger(input.packetNumber)||!ctx.lookup.has(input.packetNumber))
    throw Error("Untrusted Service correction packet");
  const packet=ctx.lookup.get(input.packetNumber);
  const expected=makeServiceCorrectionPacket(full,input.packetNumber);
  if(!Array.isArray(input.categories)||
    input.categories.length!==expected.categories.length)
    throw Error("Missing original Category rows");
  let count=0,submitted=0,en=0,hi=0,newConflicts=0,originalChoices=0;
  const proposedPhrases=new Map();
  for(const [i,cat] of input.categories.entries()){
    const orig=expected.categories[i];
    if(!exact(cat,CATEGORY_KEYS)||
      cat.sourceCategoryId!==orig.sourceCategoryId||
      cat.sourceGroupId!==orig.sourceGroupId||
      cat.sourceFamilyId!==orig.sourceFamilyId||
      cat.sourceCategorySha256!==orig.sourceCategorySha256||
      !Array.isArray(cat.services)||cat.services.length!==orig.services.length)
      throw Error("Category source or 45-packet coverage changed");
    for(const [j,leaf] of cat.services.entries()){
      const source=orig.services[j];
      if(!exact(leaf,SERVICE_KEYS)||
        leaf.sourceServiceId!==source.sourceServiceId||
        leaf.sourceServiceSha256!==source.sourceServiceSha256||
        leaf.historicalNameEn!==source.historicalNameEn||
        leaf.historicalNameHi!==source.historicalNameHi||
        JSON.stringify(leaf.sourceFlags)!==JSON.stringify(source.sourceFlags)||
        !exact(leaf.otherSourceCategoryChoices,["en","hi"])||
        JSON.stringify(leaf.otherSourceCategoryChoices)!==
          JSON.stringify(source.otherSourceCategoryChoices)||
        leaf.reviewState!==ROW_STATE||
        !["NOT_SUBMITTED","EVIDENCE_LINKED_UNVERIFIED"].includes(leaf.status))
        throw Error("Changed Service source, fabricated approval or lost ambiguity");
      checkProposal(leaf.proposedNameEn,"en");
      checkProposal(leaf.proposedNameHi,"hi");
      const any=leaf.proposedNameEn!==null||leaf.proposedNameHi!==null;
      const changed=(leaf.proposedNameEn!==null&&
        leaf.proposedNameEn!==leaf.historicalNameEn)||
        (leaf.proposedNameHi!==null&&
        leaf.proposedNameHi!==leaf.historicalNameHi);
      if(leaf.status==="NOT_SUBMITTED"&&
        (leaf.evidenceUrl!==null||any))
        throw Error("Unsubmitted Service must have no corrections or URL");
      if(leaf.status==="EVIDENCE_LINKED_UNVERIFIED"&&
        (!changed||!validJodloReviewUrl(leaf.evidenceUrl)))
        throw Error("Service edit requires an actual change and JODLO PR evidence URL");
      count++;
      if(leaf.status!=="EVIDENCE_LINKED_UNVERIFIED")continue;
      submitted++;
      en+=Number(leaf.proposedNameEn!==null);
      hi+=Number(leaf.proposedNameHi!==null);
      originalChoices+=Number(
        leaf.otherSourceCategoryChoices.en.length>0||
        leaf.otherSourceCategoryChoices.hi.length>0);
      for(const [lang,proposal] of [["en",leaf.proposedNameEn],["hi",leaf.proposedNameHi]]){
        if(proposal===null)continue;
        const key=lang+"\u0000"+norm(proposal);
        if(!proposedPhrases.has(key))proposedPhrases.set(key,new Set());
        proposedPhrases.get(key).add(cat.sourceCategoryId);
        if([...(ctx.sourcePhrases.get(key)??[])].some(id=>id!==cat.sourceCategoryId))
          newConflicts++;
      }
    }
  }
  for(const [key,ids] of proposedPhrases)
    if(ids.size>1&&!ctx.sourcePhrases.has(key))newConflicts++;
  if(count!==packet.historicalServiceCount)
    throw Error("Full packet Service count diverges from source");
  return {
    kind:"JODLO_SERVICE_CORRECTION_SYNTAX_REPORT_ONLY",
    state:"HUMAN_MEANING_AND_OCCUPATIONAL_REVIEW_PENDING",
    sourceJsonSha256:SOURCE,packetNumber:input.packetNumber,
    originalCategories:input.categories.length,originalServices:count,
    servicesWithEvidenceLinksUnverified:submitted,
    proposedEnglishNames:en,proposedHindiNames:hi,
    proposalsWithOriginalAmbiguousParentChoices:originalChoices,
    newlyDetectedSourceOrProposalPhraseConflictsUnverified:newConflicts,
    humanBilingualReviewsAuthenticated:0,
    humanOccupationalReviewsAuthenticated:0,
    founderCategoryApprovalsAuthenticated:0,
    approvedAliases:0,categoriesAuthorizedForActivation:0,
    activatedServices:0,sqlStatementsGenerated:0,
  };
}
function readRepoRelativeJson(raw){
  if(!raw||isAbsolute(raw))throw Error("Expected repo-relative file path");
  const path=resolve(ROOT,raw),rel=relative(ROOT,path);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))
    throw Error("Correction file must stay inside repository");
  const rootReal=realpathSync(ROOT),fileReal=realpathSync(path);
  if(!fileReal.startsWith(rootReal+sep)||
    !lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())
    throw Error("Refuse symlink or outside-root correction file");
  if(lstatSync(path).size>MAX_BYTES)
    throw Error("Correction file exceeds 1MB review boundary");
  return JSON.parse(readFileSync(path,"utf8"));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const cmd=process.argv[2]??"--check";
  if(process.argv.length>3)throw Error("Exactly one Service correction argument allowed");
  const full=loadPinnedFullCategoryServiceEvidence();
  if(cmd==="--check"||cmd==="--summary"){
    const summary={originalCategories:889,originalServices:7267,reviewPackets:45,
      humanBilingualReviewsAuthenticated:0,approvedAliases:0,
      categoriesAuthorizedForActivation:0,activatedServices:0};
    if(cmd==="--check")console.log("All 7,267 Service labels: source-locked editor intake, ZERO approvals/activation.");
    else process.stdout.write(JSON.stringify(summary,null,2)+"\n");
  }else if(cmd.startsWith("--packet=")){
    const n=parsePacketArg(cmd,45);
    process.stdout.write(JSON.stringify(makeServiceCorrectionPacket(full,n),null,2)+"\n");
  }else if(cmd.startsWith("--validate-file=")){
    const value=readRepoRelativeJson(cmd.slice("--validate-file=".length));
    process.stdout.write(JSON.stringify(validateServiceCorrectionPacket(value,full),null,2)+"\n");
  }else throw Error("Use --check, --summary, --packet=N or --validate-file=PATH");
}
