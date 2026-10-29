/**
 * ADR-0011: offline 45-packet Hindi/English Service proposal reconciliation.
 * Review-only: all 889 source Categories and 7,267 Services, no alias import.
 */
import {lstatSync,readFileSync,readdirSync,realpathSync} from "node:fs";
import {dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {
  makeServiceCorrectionPacket,validateServiceCorrectionPacket,
} from "./catalog-service-correction-evidence.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const COUNT=45,MAX_BYTES=1_000_000;
const fileName=n=>"service-packet-"+String(n).padStart(2,"0")+".json";
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const key=(lang,label)=>lang+"\u0000"+label.normalize("NFKC").toLowerCase().trim();
const VALID_STATES=new Set(["NOT_SUBMITTED","EVIDENCE_LINKED_UNVERIFIED"]);

/**
 * A phrase may belong to multiple original Categories. That is an unresolved
 * review case, NOT proof that either original Category is the right one.
 */
function sourcePhraseIndex(full){
  const index=new Map();
  for(const packet of full.packets){
    for(const cat of packet.categories){
      for(const leaf of cat.services){
        for(const [locale,name] of [
          ["en",leaf.historicalNameEn],["hi",leaf.historicalNameHi],
        ]){
          const k=key(locale,name);
          if(!index.has(k))index.set(k,new Set());
          index.get(k).add(cat.sourceCategoryId);
        }
      }
    }
  }
  return index;
}
/** Reconcile all submitted, source-locked packets without certifying meaning.
 * Two different Categories proposing the same phrase are a CONFLICT TO REVIEW,
 * including when proposed names are in separate packets. We deliberately do
 * not reject legitimate ambiguous trade vocabulary or auto-pick a parent.
 */
export function reconcileServiceCorrectionPackets(inputs,full){
  if(!Array.isArray(inputs)||inputs.length!==COUNT||
    !full?.manifest||full.manifest.summary?.historicalCategories!==889||
    full.manifest.summary?.historicalServices!==7267||
    full.manifest.summary?.reviewPackets!==COUNT)
    throw Error("All 45 Service correction packets and source are required");
  const originalOwners=sourcePhraseIndex(full),proposed=new Map();
  let categories=0,services=0,linked=0,en=0,hi=0,preexistingAmbiguous=0;
  const allServiceIds=new Set(),allCategoryIds=new Set();
  for(let n=1;n<=COUNT;n++){
    const packet=inputs[n-1];
    if(packet?.packetNumber!==n)
      throw Error("Service packets must be ordered exactly 1..45");
    const s=validateServiceCorrectionPacket(packet,full);
    categories+=s.originalCategories;
    services+=s.originalServices;
    linked+=s.servicesWithEvidenceLinksUnverified;
    en+=s.proposedEnglishNames;
    hi+=s.proposedHindiNames;
    preexistingAmbiguous+=s.proposalsWithOriginalAmbiguousParentChoices;
    for(const cat of packet.categories){
      if(allCategoryIds.has(cat.sourceCategoryId))
        throw Error("Category duplicated across Service packets");
      allCategoryIds.add(cat.sourceCategoryId);
      for(const leaf of cat.services){
        if(allServiceIds.has(leaf.sourceServiceId)||!VALID_STATES.has(leaf.status))
          throw Error("Service duplicated across packets or approval forged");
        allServiceIds.add(leaf.sourceServiceId);
        if(leaf.status!=="EVIDENCE_LINKED_UNVERIFIED")continue;
        for(const [locale,name] of [
          ["en",leaf.proposedNameEn],["hi",leaf.proposedNameHi],
        ]){
          if(name===null)continue;
          const k=key(locale,name);
          if(!proposed.has(k))proposed.set(k,[]);
          proposed.get(k).push({
            packetNumber:n,sourceCategoryId:cat.sourceCategoryId,
            sourceServiceId:leaf.sourceServiceId,
          });
        }
      }
    }
  }
  if(categories!==889||services!==7267||
    allCategoryIds.size!==889||allServiceIds.size!==7267)
    throw Error("Full 889 Category / 7,267 Service coverage lost");
  const conflicts=[];
  const counts={
    proposedPhraseKeys:proposed.size,
    keysCollidingWithDifferentOriginalParent:0,
    keysWithDifferentProposedParentsWithinPacket:0,
    keysWithDifferentProposedParentsAcrossPackets:0,
    totalUnresolvedPhraseKeys:0,
  };
  for(const [k,refs] of [...proposed.entries()].sort(([a],[b])=>cmp(a,b))){
    const owners=[...(originalOwners.get(k)??new Set())].sort(cmp);
    const parentIds=[...new Set(refs.map(x=>x.sourceCategoryId))].sort(cmp);
    const originalCollision=refs.some(x=>owners.some(id=>id!==x.sourceCategoryId));
    const multiProposal=parentIds.length>1;
    const packets=new Set(refs.map(x=>x.packetNumber));
    const cross=multiProposal&&packets.size>1;
    const within=multiProposal&&refs.some((x,i)=>refs.some((y,j)=>
      i!==j&&x.packetNumber===y.packetNumber&&x.sourceCategoryId!==y.sourceCategoryId));
    if(originalCollision)counts.keysCollidingWithDifferentOriginalParent++;
    if(within)counts.keysWithDifferentProposedParentsWithinPacket++;
    if(cross)counts.keysWithDifferentProposedParentsAcrossPackets++;
    if(!originalCollision&&!within&&!cross)continue;
    const [locale,normalizedPhrase]=k.split("\u0000");
    conflicts.push({
      locale,normalizedPhrase,
      sourceCategoryIdsWithOriginalPhrase:owners,
      proposedSourceCategoryIds:parentIds,
      proposedServiceReferences:refs.slice().sort((a,b)=>
        a.packetNumber-b.packetNumber||
        cmp(a.sourceCategoryId,b.sourceCategoryId)||
        cmp(a.sourceServiceId,b.sourceServiceId)),
      unresolvedReasons:[
        ...(originalCollision?["PROPOSAL_CONFLICTS_WITH_ORIGINAL_OTHER_PARENT"]:[]),
        ...(within?["DIFFERENT_PROPOSED_PARENTS_IN_SAME_PACKET"]:[]),
        ...(cross?["DIFFERENT_PROPOSED_PARENTS_ACROSS_PACKETS"]:[]),
      ],
      reviewState:"PARENT_SCOPE_AND_HUMAN_LANGUAGE_CONFIRMATION_REQUIRED",
    });
  }
  counts.totalUnresolvedPhraseKeys=conflicts.length;
  return {
    kind:"JODLO_ALL_SERVICE_CROSS_PACKET_PHRASE_REVIEW_ONLY",
    state:"UNVERIFIED_BILINGUAL_PROPOSALS_ZERO_ALIAS_ACTIVATION",
    sourceJsonSha256:full.manifest.sourceJsonSha256,
    languages:["en","hi"],
    summary:{
      reviewPacketsValidated:COUNT,
      sourceCategoriesRetained:categories,sourceServicesRetained:services,
      submittedServiceEvidenceLinksUnverified:linked,
      unsubmittedOriginalServices:services-linked,
      proposedEnglishNames:en,proposedHindiNames:hi,
      submittedServicesWithOriginalAmbiguousParentChoices:preexistingAmbiguous,
      ...counts,
      humanBilingualReviewsAuthenticated:0,
      humanOccupationalReviewsAuthenticated:0,
      founderCategoryApprovalsAuthenticated:0,
      approvedAliases:0,categoriesAuthorizedForActivation:0,
      activatedServices:0,sqlStatementsGenerated:0,
    },
    unresolvedPhraseConflicts:conflicts,
  };
}
export function emptyServiceCorrectionPacketSet(full){
  return Array.from({length:COUNT},(_,i)=>makeServiceCorrectionPacket(full,i+1));
}
function checkedDirectory(directory){
  if(!directory||isAbsolute(directory))throw Error("Need a repo-relative Service packet directory");
  const path=resolve(ROOT,directory),rel=relative(ROOT,path);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))
    throw Error("Service packet directory escapes repository");
  const realRoot=realpathSync(ROOT),real=realpathSync(path);
  if(real===realRoot||!real.startsWith(realRoot+sep)||
    !lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())
    throw Error("Service review directory must be a real directory within repository");
  return path;
}
/** The local JSON directory is not a trusted evidence-signature repository. */
export function loadServiceCorrectionDirectory(directory){
  const path=checkedDirectory(directory);
  const wanted=Array.from({length:COUNT},(_,i)=>fileName(i+1));
  const found=readdirSync(path).filter(x=>x.endsWith(".json")).sort();
  if(found.length!==COUNT||found.some((x,i)=>x!==wanted[i]))
    throw Error("Need exactly service-packet-01.json..service-packet-45.json");
  return wanted.map(name=>{
    const file=resolve(path,name),stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)
      throw Error("Untrusted/oversized Service correction file");
    return JSON.parse(readFileSync(file,"utf8"));
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=process.argv[2]??"--check";
  if(process.argv.length>3)throw Error("Use --check or --directory=REPO_RELATIVE");
  const full=loadPinnedFullCategoryServiceEvidence();
  const inputs=arg==="--check"?emptyServiceCorrectionPacketSet(full):
    arg.startsWith("--directory=")?loadServiceCorrectionDirectory(arg.slice(12)):
    (()=>{throw Error("Use --check or --directory=REPO_RELATIVE");})();
  const report=reconcileServiceCorrectionPackets(inputs,full);
  if(arg==="--check")console.log(
    "JODLO all 45 Service packets / 889 Categories / 7,267 leaves: ZERO activation.");
  else process.stdout.write(JSON.stringify(report,null,2)+"\n");
}
