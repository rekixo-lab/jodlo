import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync,writeFileSync,symlinkSync} from "node:fs";
import {dirname,join,relative,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  reconcileCatalogCorrectionPackets,emptyCatalogCorrectionPacketSet,
  loadCatalogCorrectionDirectory,
} from "./catalog-cross-packet-reconcile.mjs";
import {
  makeCatalogCorrectionIntake,validateCatalogCorrectionIntake,
} from "./catalog-correction-evidence.mjs";
import {loadPinnedReviewPackets} from "./catalog-review-packets.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const review=loadPinnedReviewPackets();
const all=()=>emptyCatalogCorrectionPacketSet(review);
const evidence="https://github.com/rekixo-lab/jodlo/pull/96";
function change(row,key,value){
  row.proposedCorrections[key]=value;
  row.status="EVIDENCE_LINKED_UNVERIFIED";
  row.evidenceUrl=evidence;
}
test("all 889 Categories in 45 verified, non-activating original packets",()=>{
  const inputs=all(),summary=reconcileCatalogCorrectionPackets(inputs,review);
  assert.equal(inputs.length,45);
  assert.equal(inputs[44].categories.length,9);
  assert.equal(inputs.flatMap(p=>p.categories).length,889);
  assert.equal(summary.categoriesReviewedForSyntax,889);
  assert.equal(summary.reviewPacketsValidated,45);
  assert.equal(summary.evidenceLinksUnverified,0);
  assert.equal(summary.unsubmittedCategories,889);
  assert.equal(summary.categoriesAuthorizedForActivation,0);
  assert.equal(summary.activatedCategories,0);
  assert.equal(summary.sqlStatementsGenerated,0);
  assert.equal(summary.humanReviewAuthenticated,0);
});
test("one valid correction stays unverified; no implicit owner permission",()=>{
  const inputs=all();
  change(inputs[0].categories[0],"nameHi","नई सेवा");
  change(inputs[44].categories[0],"categoryId","new-reviewed-terminal-category");
  const summary=reconcileCatalogCorrectionPackets(inputs,review);
  assert.equal(summary.evidenceLinksUnverified,2);
  assert.equal(summary.correctedIdsProposed,1);
  assert.equal(summary.correctedHindiTitlesProposed,1);
  assert.equal(summary.founderCategoryApprovalsAuthenticated,0);
  assert.equal(summary.activatedCategories,0);
});
test("missing, duplicate, reversed, reordered or tampered packets fail closed",()=>{
  const short=all();short.pop();
  assert.throws(()=>reconcileCatalogCorrectionPackets(short,review),/45/);
  const reordered=all();[reordered[0],reordered[1]]=[reordered[1],reordered[0]];
  assert.throws(()=>reconcileCatalogCorrectionPackets(reordered,review),/order/);
  const duplicated=all();duplicated[1]=structuredClone(duplicated[0]);
  assert.throws(()=>reconcileCatalogCorrectionPackets(duplicated,review),/order/);
  const tampered=all();tampered[2].categories[0].sourceCategorySha256="0".repeat(64);
  assert.throws(()=>reconcileCatalogCorrectionPackets(tampered,review));
  const approval=all();approval[9].categories[3].approved=true;
  assert.throws(()=>reconcileCatalogCorrectionPackets(approval,review));
  const missingRow=all();missingRow[12].categories.pop();
  assert.throws(()=>reconcileCatalogCorrectionPackets(missingRow,review));
});
test("two individually valid proposals in different packets with same ID fail",()=>{
  const inputs=all();
  const key="cross-packet-only-unique-id";
  change(inputs[0].categories[0],"categoryId",key);
  change(inputs[1].categories[0],"categoryId",key);
  assert.equal(validateCatalogCorrectionIntake(inputs[0],review).activatedCategories,0);
  assert.equal(validateCatalogCorrectionIntake(inputs[1],review).activatedCategories,0);
  assert.throws(()=>reconcileCatalogCorrectionPackets(inputs,review),/Cross-packet proposed categoryId collision/);
});
test("two individually valid proposals in different packets with same slug fail",()=>{
  const inputs=all(),key="cross-packet-only-unique-slug";
  change(inputs[0].categories[0],"slug",key);
  change(inputs[44].categories[0],"slug",key);
  assert.equal(validateCatalogCorrectionIntake(inputs[0],review).activatedCategories,0);
  assert.equal(validateCatalogCorrectionIntake(inputs[44],review).activatedCategories,0);
  assert.throws(()=>reconcileCatalogCorrectionPackets(inputs,review),/Cross-packet proposed slug collision/);
});
test("existing 889 source IDs/slugs remain reserved across the whole batch",()=>{
  const inputs=all();
  const other=review.packets[1].categories.find(x=>x.mappingCompatibility.categoryIdCandidate);
  assert.ok(other);
  change(inputs[0].categories[0],"categoryId",other.sourceCategoryId);
  assert.throws(()=>reconcileCatalogCorrectionPackets(inputs,review),/collides/);
});
test("strict directory reads 45 local JSON files, rejects extras, tampering and symlinks",()=>{
  const folder=mkdtempSync(join(ROOT,".jodlo-correction-test-"));
  const rel=relative(ROOT,folder);
  try{
    for(let n=1;n<=45;n++){
      const path=join(folder,"packet-"+String(n).padStart(2,"0")+".json");
      writeFileSync(path,JSON.stringify(makeCatalogCorrectionIntake(review,n)));
    }
    assert.equal(loadCatalogCorrectionDirectory(rel).length,45);
    const output=execFileSync(process.execPath,[
      "scripts/catalog-cross-packet-reconcile.mjs","--directory="+rel,
    ],{cwd:ROOT,encoding:"utf8"});
    assert.equal(JSON.parse(output).categoriesReviewedForSyntax,889);
    const additional=join(folder,"packet-46.json");
    writeFileSync(additional,"{}");
    assert.throws(()=>loadCatalogCorrectionDirectory(rel),/exactly/);
    rmSync(additional);
    const first=join(folder,"packet-01.json");
    rmSync(first);
    symlinkSync(join(folder,"packet-02.json"),first);
    assert.throws(()=>loadCatalogCorrectionDirectory(rel),/Untrusted/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
