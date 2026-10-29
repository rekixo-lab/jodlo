/**
 * ADR-0011: offline 45-packet Category correction reconciliation.
 * All 889 historical Categories remain human-review-only. No D1/API/UI/deploy.
 */
import {lstatSync,readFileSync,readdirSync,realpathSync} from "node:fs";
import {dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {
  makeCatalogCorrectionIntake,validateCatalogCorrectionIntake,
} from "./catalog-correction-evidence.mjs";
import {loadPinnedReviewPackets} from "./catalog-review-packets.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const COUNT=45,MAX_BYTES=100_000;
const fileName=n=>"packet-"+String(n).padStart(2,"0")+".json";

/** Refuse partial, reordered, modified or colliding packet evidence.
 * This is a source-locked syntax reconciliation, not a human approval.
 */
export function reconcileCatalogCorrectionPackets(inputs,review){
  if(!Array.isArray(inputs)||inputs.length!==COUNT)
    throw Error("All 45 Category correction packets are required");
  const proposalsIds=new Map(),proposalsSlugs=new Map();
  let coverage=0,unverified=0,ids=0,slugs=0,english=0,hindi=0;
  for(let n=1;n<=COUNT;n++){
    const packet=inputs[n-1];
    if(packet?.packetNumber!==n)
      throw Error("Category correction packets must be in exact 1..45 order");
    const summary=validateCatalogCorrectionIntake(packet,review);
    coverage+=summary.categoriesInPacket;
    unverified+=summary.correctionLinksUnverified;
    ids+=summary.correctedIdsProposed;
    slugs+=summary.correctedSlugsProposed;
    english+=summary.correctedEnglishTitlesProposed;
    hindi+=summary.correctedHindiTitlesProposed;
    for(const row of packet.categories){
      for(const [field,seen] of [
        ["categoryId",proposalsIds],["slug",proposalsSlugs],
      ]){
        const proposed=row.proposedCorrections[field];
        if(proposed===null)continue;
        const prior=seen.get(proposed);
        if(prior!==undefined)
          throw Error("Cross-packet proposed "+field+
            " collision between packets "+prior+" and "+n);
        seen.set(proposed,n);
      }
    }
  }
  if(coverage!==889||review?.manifest?.summary?.categories!==889)
    throw Error("Full 889 Category coverage changed");
  return {
    kind:"JODLO_ALL_CATEGORY_CORRECTION_RECONCILIATION_ONLY",
    state:"FULL_SOURCE_REVIEW_PENDING_ZERO_ACTIVATION",
    sourceJsonSha256:review.manifest.sourceJsonSha256,
    reviewPacketsValidated:COUNT,categoriesReviewedForSyntax:coverage,
    evidenceLinksUnverified:unverified,unsubmittedCategories:coverage-unverified,
    correctedIdsProposed:ids,correctedSlugsProposed:slugs,
    correctedEnglishTitlesProposed:english,correctedHindiTitlesProposed:hindi,
    crossPacketProposedIdCollisions:0,crossPacketProposedSlugCollisions:0,
    humanReviewAuthenticated:0,founderCategoryApprovalsAuthenticated:0,
    categoriesAuthorizedForActivation:0,activatedCategories:0,
    sqlStatementsGenerated:0,
  };
}
export function emptyCatalogCorrectionPacketSet(review){
  return Array.from({length:COUNT},(_,i)=>makeCatalogCorrectionIntake(review,i+1));
}
function insideRoot(value){
  if(!value||isAbsolute(value))throw Error("Need a repo-relative packet directory");
  const p=resolve(ROOT,value),rel=relative(ROOT,p);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))
    throw Error("Category correction directory must be inside repository");
  const rootReal=realpathSync(ROOT),actual=realpathSync(p);
  if(actual!==rootReal&&!actual.startsWith(rootReal+sep))
    throw Error("Category correction directory escapes repository");
  if(!lstatSync(p).isDirectory())
    throw Error("Category correction directory must not be a symlink");
  return p;
}
export function loadCatalogCorrectionDirectory(directory){
  const path=insideRoot(directory);
  const expected=Array.from({length:COUNT},(_,i)=>fileName(i+1));
  const files=readdirSync(path).filter(name=>name.endsWith(".json")).sort();
  if(files.length!==COUNT||files.some((name,i)=>name!==expected[i]))
    throw Error("Directory must contain exactly packet-01.json..packet-45.json");
  return expected.map(name=>{
    const full=resolve(path,name),stat=lstatSync(full);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)
      throw Error("Untrusted or oversized Category correction packet file");
    return JSON.parse(readFileSync(full,"utf8"));
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??"--check";
  if(process.argv.length>3)
    throw Error("Use exactly --check or --directory=REPO_RELATIVE_PATH");
  const review=loadPinnedReviewPackets();
  const inputs=mode==="--check"
    ?emptyCatalogCorrectionPacketSet(review)
    :mode.startsWith("--directory=")
      ?loadCatalogCorrectionDirectory(mode.slice("--directory=".length))
      :(()=>{throw Error("Use --check or --directory=REPO_RELATIVE_PATH");})();
  const summary=reconcileCatalogCorrectionPackets(inputs,review);
  if(mode==="--check")
    console.log("JODLO full 889 / 45-packet cross-review guard: ZERO activation.");
  else process.stdout.write(JSON.stringify(summary,null,2)+"\n");
}
