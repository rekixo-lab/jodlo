/**
 * ADR-0011 — ALL 889 source Categories, offline correction EVIDENCE ONLY.
 * Reuses existing 45 human review packets. Never imports to Worker/Android,
 * creates seed SQL, certifies translations, or grants Category activation.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname,isAbsolute,relative,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedReviewPackets,parsePacketArg} from "./catalog-review-packets.mjs";
import {validJodloReviewUrl} from "./review-evidence-url.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SOURCE="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const KIND="JODLO_CATEGORY_CORRECTION_EVIDENCE_ONLY";
const STATE="ALL_EVIDENCE_UNVERIFIED_ZERO_CATEGORY_ACTIVATION";
const REVIEW="HUMAN_REVIEW_PENDING_NOT_APPROVED";
const SHA=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const exact=(x,keys)=>x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.keys(x).sort().join("|")===keys.slice().sort().join("|");
const ID=/^[A-Za-z0-9_-]{1,64}$/u;
const SLUG=/^[a-z][a-z0-9-]{1,63}$/u;
const CONTROL=/[\u0000-\u001f\u007f-\u009f]/u;
const LATIN=/[A-Za-z]/u;
const HINDI=/\p{Script=Devanagari}/u;
const VALUE_KEYS=["categoryId","slug","nameEn","nameHi"];
const ROW_KEYS=["sourceCategoryId","sourceCategorySha256",
  "proposedCorrections","status","evidenceUrl","reviewState"];

/** Trust only a previously full-source-validated, complete 45-packet review.
 * Normal callers pass loadPinnedReviewPackets(), which checks all source
 * hashes, category/Service lineage, ambiguous phrases and D1 mapping.
 */
function context(review) {
  const {manifest,packets}=review??{};
  if(manifest?.kind!=="JODLO_ALL_CATEGORY_REVIEW_PACKET_MANIFEST_ONLY"||
    manifest.state!=="ALL_HUMAN_REVIEWS_PENDING_NO_D1_ACTIVATION"||
    manifest.sourceJsonSha256!==SOURCE||
    JSON.stringify(manifest.languages)!=='["en","hi"]'||
    manifest.summary?.categories!==889||
    manifest.summary.packetCount!==45||
    manifest.summary.categoriesAuthorizedForActivation!==0||
    !Array.isArray(packets)||packets.length!==45)
    throw Error("Untrusted or incomplete full-Category reviewer context");
  const byPacket=new Map(),sourceIds=new Set(),usedIds=new Set(),usedSlugs=new Set();
  for(const [index,p] of packets.entries()) {
    if(p?.packetNumber!==index+1||p.kind!=="JODLO_REVIEW_PACKET_NOT_APPROVAL"||
      p.state!=="ALL_HUMAN_REVIEWS_PENDING_NO_D1_ACTIVATION"||
      p.sourceJsonSha256!==SOURCE||JSON.stringify(p.languages)!=='["en","hi"]'||
      !Array.isArray(p.categories)||p.categories.length<1||p.categories.length>20||
      p.categoryCount!==p.categories.length)
      throw Error("Untrusted reviewer packet");
    if(manifest.packets?.[index]?.packetNumber!==p.packetNumber||
      manifest.packets[index].categoryCount!==p.categoryCount)
      throw Error("Reviewer packet manifest mismatch");
    const ids=[];
    for(const row of p.categories) {
      if(typeof row?.sourceCategoryId!=="string"||!row.sourceCategoryId||
        sourceIds.has(row.sourceCategoryId)||
        row.reviewState!=="BLOCKED_PENDING_HUMAN_AND_FOUNDER_REVIEW"||
        row.mappingCompatibility?.reviewState!==
          "HUMAN_ID_SLUG_LABEL_AND_SAFETY_REVIEW_REQUIRED"||
        !Array.isArray(row.mandatoryHumanAndFounderGates)||
        row.mandatoryHumanAndFounderGates.length!==4)
        throw Error("Duplicate, approved or missing source Category");
      sourceIds.add(row.sourceCategoryId);
      ids.push(row.sourceCategoryId);
      if(row.mappingCompatibility.categoryIdCandidate!==null)
        usedIds.add(row.mappingCompatibility.categoryIdCandidate);
      if(row.mappingCompatibility.slugCandidate!==null)
        usedSlugs.add(row.mappingCompatibility.slugCandidate);
    }
    if(p.categories[0].sourceCategoryId!==
       manifest.packets[index].firstSourceCategoryId||
       p.categories.at(-1).sourceCategoryId!==
       manifest.packets[index].lastSourceCategoryId)
      throw Error("Reviewer packet boundaries changed");
    byPacket.set(p.packetNumber,p);
  }
  if(sourceIds.size!==889||
    packets.reduce((n,p)=>n+p.categories.length,0)!==889)
    throw Error("Full 889 Category coverage lost");
  return {byPacket,sourceIds,usedIds,usedSlugs};
}
function fingerprint(packet,row) {
  return SHA({sourceJsonSha256:SOURCE,
    packetNumber:packet.packetNumber,category:row});
}

/** One existing packet (up to 20 Categories), all untouched by default. */
export function makeCatalogCorrectionIntake(review,packetNumber) {
  const {byPacket}=context(review);
  if(!Number.isInteger(packetNumber)||!byPacket.has(packetNumber))
    throw Error("Unknown Category review packet");
  const packet=byPacket.get(packetNumber);
  return {
    kind:KIND,state:STATE,sourceJsonSha256:SOURCE,languages:["en","hi"],
    packetNumber,
    categories:packet.categories.map(row=>({
      sourceCategoryId:row.sourceCategoryId,
      sourceCategorySha256:fingerprint(packet,row),
      proposedCorrections:{categoryId:null,slug:null,nameEn:null,nameHi:null},
      status:"NOT_SUBMITTED",evidenceUrl:null,reviewState:REVIEW,
    })),
  };
}
function checkedCorrection(value,key) {
  if(value===null)return;
  if(typeof value!=="string"||!value||value!==value.trim()||
    value!==value.normalize("NFKC")||CONTROL.test(value))
    throw Error("Invalid or unnormalized Category correction");
  if(key==="categoryId" && !ID.test(value))
    throw Error("Corrected Category ID incompatible with D1");
  if(key==="slug" && !SLUG.test(value))
    throw Error("Corrected Category slug incompatible with D1");
  if(key==="nameEn" && ([...value].length>120||
      !LATIN.test(value)||HINDI.test(value)))
    throw Error("Corrected English Category title invalid");
  if(key==="nameHi" && ([...value].length>120||
      !HINDI.test(value)||LATIN.test(value)))
    throw Error("Corrected Hindi Category title invalid");
}

/** Evidence-linked means submitted for independent inspection, NEVER approved.
 * Existing source IDs/slugs in *all 889* are reserved; no automatic remapping.
 */
export function validateCatalogCorrectionIntake(input,review) {
  const ctx=context(review);
  if(!exact(input,["kind","state","sourceJsonSha256","languages",
                   "packetNumber","categories"])||
    input.kind!==KIND||input.state!==STATE||
    input.sourceJsonSha256!==SOURCE||
    JSON.stringify(input.languages)!=='["en","hi"]'||
    !Number.isInteger(input.packetNumber)||
    !ctx.byPacket.has(input.packetNumber))
    throw Error("Untrusted/authorizing Category correction intake");
  const packet=ctx.byPacket.get(input.packetNumber);
  const expected=makeCatalogCorrectionIntake(review,input.packetNumber);
  if(!Array.isArray(input.categories)||
    input.categories.length!==expected.categories.length)
    throw Error("Missing or extra Category correction records");
  let evidence=0,id=0,slug=0,en=0,hi=0;
  const ids=new Set(),slugs=new Set();
  for(const [index,row] of input.categories.entries()){
    const orig=expected.categories[index],source=packet.categories[index];
    if(!exact(row,ROW_KEYS)||
      row.sourceCategoryId!==orig.sourceCategoryId||
      row.sourceCategorySha256!==orig.sourceCategorySha256||
      row.reviewState!==REVIEW||
      !exact(row.proposedCorrections,VALUE_KEYS)||
      !["NOT_SUBMITTED","EVIDENCE_LINKED_UNVERIFIED"].includes(row.status))
      throw Error("Category source evidence, status or review gates altered");
    const changes=row.proposedCorrections;
    for(const key of VALUE_KEYS)checkedCorrection(changes[key],key);
    const changed=Object.entries(changes).some(([key,value])=>
      value!==null&&value!==({
        categoryId:source.sourceCategoryId,
        slug:source.mappingCompatibility.slugCandidate,
        nameEn:source.historicalNameEn,nameHi:source.historicalNameHi,
      })[key]);
    const hasAny=VALUE_KEYS.some(key=>changes[key]!==null);
    if((row.status==="NOT_SUBMITTED"&&
       (row.evidenceUrl!==null||hasAny))||
      (row.status==="EVIDENCE_LINKED_UNVERIFIED"&&
       (!validJodloReviewUrl(row.evidenceUrl)||!changed)))
      throw Error("Unverified evidence must be an actual correction with safe JODLO PR link");
    if(row.status==="EVIDENCE_LINKED_UNVERIFIED") evidence++;
    if(changes.categoryId!==null){
      if((ctx.sourceIds.has(changes.categoryId) &&
         changes.categoryId!==row.sourceCategoryId)||
        (ctx.usedIds.has(changes.categoryId) &&
         changes.categoryId!==source.mappingCompatibility.categoryIdCandidate)||
        ids.has(changes.categoryId))
        throw Error("Corrected Category ID collides with another source or proposal");
      ids.add(changes.categoryId);id++;
    }
    if(changes.slug!==null){
      if((ctx.usedSlugs.has(changes.slug) &&
          changes.slug!==source.mappingCompatibility.slugCandidate)||
          slugs.has(changes.slug))
        throw Error("Corrected Category slug collides with another source or proposal");
      slugs.add(changes.slug);slug++;
    }
    if(changes.nameEn!==null)en++;
    if(changes.nameHi!==null)hi++;
  }
  return {
    packetNumber:packet.packetNumber,categoriesInPacket:packet.categories.length,
    correctionLinksUnverified:evidence,
    correctedIdsProposed:id,correctedSlugsProposed:slug,
    correctedEnglishTitlesProposed:en,correctedHindiTitlesProposed:hi,
    humanReviewAuthenticated:0,founderCategoryApprovalsAuthenticated:0,
    categoriesAuthorizedForActivation:0,activatedCategories:0,
  };
}
export function loadPinnedCatalogCorrectionIntake(packetNumber=1){
  const review=loadPinnedReviewPackets();
  const intake=makeCatalogCorrectionIntake(review,packetNumber);
  return {review,intake,summary:validateCatalogCorrectionIntake(intake,review)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??"--check";
  if(process.argv.length>3)
    throw Error("Only one Category correction review option allowed");
  const review=loadPinnedReviewPackets();
  if(mode==="--check"||mode==="--summary"){
    const {manifest}=review;
    const result={categoriesInScope:manifest.summary.categories,
      reviewPackets:manifest.summary.packetCount,
      categoriesAuthorizedForActivation:0,activatedCategories:0};
    if(mode==="--check")console.log("JODLO correction intake: all 889 source Categories "+
      "in 45 packets, unverified evidence only, ZERO activation.");
    else process.stdout.write(JSON.stringify(result,null,2)+"\n");
  }else if(mode.startsWith("--packet=")){
    const n=parsePacketArg(mode,review.packets.length);
    process.stdout.write(JSON.stringify(makeCatalogCorrectionIntake(review,n),null,2)+"\n");
  }else if(mode.startsWith("--validate-file=")){
    const requested=mode.slice("--validate-file=".length);
    if(!requested||isAbsolute(requested))throw Error("Need a repo-relative JSON file");
    const path=resolve(ROOT,requested),rel=relative(ROOT,path);
    if(rel.startsWith("..")||isAbsolute(rel))throw Error("Review file outside repo");
    const bytes=readFileSync(path);
    if(bytes.length>100_000)throw Error("Review intake exceeds 100 KB limit");
    const submitted=JSON.parse(bytes.toString("utf8"));
    process.stdout.write(JSON.stringify(
      validateCatalogCorrectionIntake(submitted,review),null,2)+"\n");
  }else throw Error("Use --check, --summary, --packet=N or --validate-file=PATH");
}
