import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from "node:fs";
import {join,relative,resolve} from "node:path";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {validateServiceCorrectionPacket} from "./catalog-service-correction-evidence.mjs";
import {
  emptyServiceCorrectionPacketSet,reconcileServiceCorrectionPackets,
  loadServiceCorrectionDirectory,
} from "./catalog-service-cross-packet-reconcile.mjs";

const full=loadPinnedFullCategoryServiceEvidence();
const all=()=>emptyServiceCorrectionPacketSet(full);
const link="https://github.com/rekixo-lab/jodlo/pull/100";
const submit=(leaf,locale,name)=>{
  leaf[locale==="en"?"proposedNameEn":"proposedNameHi"]=name;
  leaf.status="EVIDENCE_LINKED_UNVERIFIED";
  leaf.evidenceUrl=link;
};
function differentCategories(inputs,firstPacket=0,secondPacket=1){
  const a=inputs[firstPacket].categories.find(x=>x.services.length);
  const b=inputs[secondPacket].categories.find(x=>x.services.length);
  assert.ok(a&&b&&a.sourceCategoryId!==b.sourceCategoryId);
  return [a,b];
}
test("45 pristine Service packets preserve all 889 Categories/7,267 originals, zero activation",()=>{
  const inputs=all();
  const out=reconcileServiceCorrectionPackets(inputs,full);
  assert.equal(inputs.length,45);
  assert.equal(out.summary.reviewPacketsValidated,45);
  assert.equal(out.summary.sourceCategoriesRetained,889);
  assert.equal(out.summary.sourceServicesRetained,7267);
  assert.equal(out.summary.unsubmittedOriginalServices,7267);
  assert.equal(out.summary.submittedServiceEvidenceLinksUnverified,0);
  assert.equal(out.summary.proposedPhraseKeys,0);
  assert.deepEqual(out.unresolvedPhraseConflicts,[]);
  assert.equal(out.summary.humanBilingualReviewsAuthenticated,0);
  assert.equal(out.summary.humanOccupationalReviewsAuthenticated,0);
  assert.equal(out.summary.founderCategoryApprovalsAuthenticated,0);
  assert.equal(out.summary.approvedAliases,0);
  assert.equal(out.summary.categoriesAuthorizedForActivation,0);
  assert.equal(out.summary.activatedServices,0);
  assert.equal(out.summary.sqlStatementsGenerated,0);
});
test("two separately valid original Service packets with identical proposals flag CROSS-packet trade ambiguity",()=>{
  const inputs=all(),[a,b]=differentCategories(inputs);
  const phrase="Audit specific bilingual occupational review example";
  submit(a.services[0],"en",phrase);submit(b.services[0],"en",phrase);
  assert.equal(validateServiceCorrectionPacket(inputs[0],full).approvedAliases,0);
  assert.equal(validateServiceCorrectionPacket(inputs[1],full).approvedAliases,0);
  const out=reconcileServiceCorrectionPackets(inputs,full);
  assert.equal(out.summary.submittedServiceEvidenceLinksUnverified,2);
  assert.equal(out.summary.proposedEnglishNames,2);
  assert.equal(out.summary.keysWithDifferentProposedParentsAcrossPackets,1);
  assert.equal(out.summary.keysWithDifferentProposedParentsWithinPacket,0);
  const c=out.unresolvedPhraseConflicts.find(x=>x.normalizedPhrase===phrase.toLowerCase());
  assert.ok(c);assert.equal(c.locale,"en");
  assert.equal(c.proposedServiceReferences.length,2);
  assert.equal(c.proposedSourceCategoryIds.length,2);
  assert.ok(c.unresolvedReasons.includes("DIFFERENT_PROPOSED_PARENTS_ACROSS_PACKETS"));
  assert.equal(c.reviewState,"PARENT_SCOPE_AND_HUMAN_LANGUAGE_CONFIRMATION_REQUIRED");
  assert.equal(out.summary.approvedAliases,0);
});
test("same-packet different Category proposals are also visibly unresolved",()=>{
  const inputs=all();
  const cats=inputs[0].categories.filter(x=>x.services.length);
  assert.ok(cats.length>=2);
  const phrase="Audited service parent ambiguity example";
  submit(cats[0].services[0],"hi","विशेष समीक्षा की साझा सेवा");
  submit(cats[1].services[0],"hi","विशेष समीक्षा की साझा सेवा");
  const out=reconcileServiceCorrectionPackets(inputs,full);
  assert.equal(out.summary.proposedHindiNames,2);
  assert.equal(out.summary.keysWithDifferentProposedParentsWithinPacket,1);
  assert.equal(out.summary.keysWithDifferentProposedParentsAcrossPackets,0);
  assert.equal(out.unresolvedPhraseConflicts[0].locale,"hi");
  assert.equal(out.summary.approvedAliases,0);
});
test("an original phrase in another Category triggers a conflict regardless of packet",()=>{
  const inputs=all();
  const a=full.packets[0].categories.find(c=>c.services.length);
  assert.ok(a);
  const original=a.services[0].historicalNameEn;
  const target=inputs.find(p=>p.categories.some(c=>
    c.sourceCategoryId!==a.sourceCategoryId&&c.services.length&&
    c.services[0].historicalNameEn!==original));
  assert.ok(target);
  const b=target.categories.find(c=>
    c.sourceCategoryId!==a.sourceCategoryId&&c.services.length&&
    c.services[0].historicalNameEn!==original);
  submit(b.services[0],"en",original);
  const out=reconcileServiceCorrectionPackets(inputs,full);
  const conflict=out.unresolvedPhraseConflicts.find(x=>x.normalizedPhrase===
    original.normalize("NFKC").toLowerCase().trim());
  assert.ok(conflict);
  assert.ok(conflict.sourceCategoryIdsWithOriginalPhrase.includes(a.sourceCategoryId));
  assert.ok(conflict.unresolvedReasons.includes("PROPOSAL_CONFLICTS_WITH_ORIGINAL_OTHER_PARENT"));
  assert.ok(out.summary.keysCollidingWithDifferentOriginalParent>=1);
  assert.equal(out.summary.approvedAliases,0);
});
test("same phrase under one parent can be proposed without false cross-Category selection",()=>{
  const inputs=all();
  const cat=inputs.flatMap(p=>p.categories).find(x=>x.services.length>=2);
  assert.ok(cat);
  const phrase="Specific duplicate within a single original category";
  submit(cat.services[0],"en",phrase);
  submit(cat.services[1],"en",phrase);
  const out=reconcileServiceCorrectionPackets(inputs,full);
  assert.equal(out.summary.submittedServiceEvidenceLinksUnverified,2);
  assert.equal(out.summary.keysWithDifferentProposedParentsAcrossPackets,0);
  assert.equal(out.summary.keysWithDifferentProposedParentsWithinPacket,0);
  assert.equal(out.summary.totalUnresolvedPhraseKeys,0);
  assert.equal(out.summary.approvedAliases,0);
});
test("en and hi remain separate keys; no Latin-script Hindi proposals",()=>{
  const inputs=all(),[a,b]=differentCategories(inputs);
  submit(a.services[0],"en","Audited test unique example for English");
  submit(b.services[0],"hi","समीक्षा हेतु अलग उदाहरण");
  const out=reconcileServiceCorrectionPackets(inputs,full);
  assert.equal(out.summary.proposedPhraseKeys,2);
  assert.equal(out.summary.keysWithDifferentProposedParentsAcrossPackets,0);
  assert.equal(out.summary.approvedAliases,0);
});
test("missing, reversed, modified, forged approved packets and Service rows all fail closed",()=>{
  const miss=all();miss.pop();
  assert.throws(()=>reconcileServiceCorrectionPackets(miss,full),/45/);
  const reverse=all();[reverse[0],reverse[1]]=[reverse[1],reverse[0]];
  assert.throws(()=>reconcileServiceCorrectionPackets(reverse,full),/ordered/);
  const dup=all();dup[1]=structuredClone(dup[0]);
  assert.throws(()=>reconcileServiceCorrectionPackets(dup,full),/ordered/);
  const partial=all();partial[15].categories[0].services.pop();
  assert.throws(()=>reconcileServiceCorrectionPackets(partial,full));
  const wrong=all();wrong[30].categories[0].sourceCategorySha256="0".repeat(64);
  assert.throws(()=>reconcileServiceCorrectionPackets(wrong,full));
  const forged=all();forged[44].categories[0].services[0].approved=true;
  assert.throws(()=>reconcileServiceCorrectionPackets(forged,full));
  const badHi=all();submit(badHi[0].categories[0].services[0],"hi","English Mixed");
  assert.throws(()=>reconcileServiceCorrectionPackets(badHi,full));
});
test("bounded repo-only 45-file directory and CLI deny extra file, symlink and traversal",()=>{
  const root=resolve(".");
  const dir=mkdtempSync(join(root,".jodlo-service-reconcile-test-"));
  const rel=relative(root,dir);
  const filename=n=>"service-packet-"+String(n).padStart(2,"0")+".json";
  try{
    const inputs=all();
    for(let n=1;n<=45;n++)writeFileSync(join(dir,filename(n)),JSON.stringify(inputs[n-1]));
    assert.equal(loadServiceCorrectionDirectory(rel).length,45);
    const output=execFileSync(process.execPath,[
      "scripts/catalog-service-cross-packet-reconcile.mjs","--directory="+rel,
    ],{cwd:root,encoding:"utf8"});
    const parsed=JSON.parse(output);
    assert.equal(parsed.summary.sourceCategoriesRetained,889);
    assert.equal(parsed.summary.sourceServicesRetained,7267);
    assert.equal(parsed.summary.approvedAliases,0);
    const extra=join(dir,"service-packet-46.json");
    writeFileSync(extra,"{}");
    assert.throws(()=>loadServiceCorrectionDirectory(rel),/exactly/);
    rmSync(extra);
    const first=join(dir,filename(1));
    rmSync(first);
    symlinkSync(join(dir,filename(2)),first);
    assert.throws(()=>loadServiceCorrectionDirectory(rel),/Untrusted/);
    assert.throws(()=>loadServiceCorrectionDirectory("../outside-review"));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
