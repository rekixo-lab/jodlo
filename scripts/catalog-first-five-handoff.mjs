/** Source-pinned, read-only first reviewer handoff for five complete Categories.
 * This snapshots historical evidence, NEVER real reviewer progress or approval.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedHumanReviewActionQueue,emptyHumanReviewActionPacketSet} from "./catalog-human-review-progress.mjs";
import {selectNextHumanReviewActions} from "./catalog-review-next-actions.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {buildCategoryReviewDossier,renderCategoryReviewDossierMarkdown} from "./catalog-review-dossier.mjs";

export const REVIEW_SHEET_PATH = "docs/reference/JODLO_FIRST_FIVE_FULL_SERVICE_REVIEW_2026-11-04.md";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const PIN="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const EXPECTED=[
  ["ac-technician",10],
  ["home-tutor",8],
  ["electrician",10],
  ["two-wheeler-mechanic",10],
  ["laptop-repair",10],
];

export function renderPinnedFirstFiveSheet(){
  const queue=loadPinnedHumanReviewActionQueue();
  const priority=selectNextHumanReviewActions(queue,
    emptyHumanReviewActionPacketSet(queue),{limit:5});
  const dossier=buildCategoryReviewDossier(priority,loadPinnedFullCategoryServiceEvidence());
  assert.equal(dossier.sourceJsonSha256,PIN);
  assert.equal(dossier.state,"ZERO_QUALIFIED_APPROVAL_NO_SQL_NO_ACTIVATION");
  assert.deepEqual(dossier.page.categories.map(c=>[c.sourceCategoryId,c.serviceCount]),EXPECTED);
  assert.equal(dossier.page.nextCursor,"laptop-repair");
  assert.equal(dossier.summary.selectedHistoricalServices,48);
  assert.equal(dossier.summary.requiredHumanReviewTasks,2667);
  for(const key of ["qualifiedHumanSignoffsVerified","founderApprovalsVerified",
    "categoriesAuthorizedForActivation","sqlStatementsGenerated"]){
    assert.equal(dossier.summary[key],0,key);
  }
  for(const category of dossier.page.categories){
    assert.equal(category.qualifiedHumanReviewVerified,false);
    assert.equal(category.founderActivationApproved,false);
    assert.equal(category.outstandingHumanReviewTasks.length,3);
    assert.ok(category.outstandingHumanReviewTasks.every(t=>
      t.status==="NOT_STARTED"&&t.qualifiedSignoffVerified===false&&
      (t.evidenceUrl===null||t.evidenceUrl===undefined)));
    assert.ok(category.services.every(s=>s.reviewState===
      "UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED"&&
      typeof s.historicalNameEn==="string"&&s.historicalNameEn&&
      typeof s.historicalNameHi==="string"&&s.historicalNameHi));
  }
  const markdown=renderCategoryReviewDossierMarkdown(dossier);
  assert.equal(markdown.split("| Source Service ID |").length-1,5);
  return markdown;
}
export function assertPublishedFirstFiveSheet(published,expected){
  assert.equal(typeof published,"string");
  assert.equal(published,expected,
    "Published first-five review sheet differs from pinned source; regenerate deliberately, never edit individual Services by hand");
  return true;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]??"--check";
  if(process.argv.length>3||!["--check","--emit","--summary"].includes(mode))
    throw Error("Usage: node scripts/catalog-first-five-handoff.mjs [--check|--emit|--summary]");
  const expected=renderPinnedFirstFiveSheet();
  if(mode==="--check"){
    const published=readFileSync(resolve(ROOT,REVIEW_SHEET_PATH),"utf8");
    assertPublishedFirstFiveSheet(published,expected);
    console.log("First 5 Categories/48 complete original Services match pinned reviewer sheet; 0 approvals/SQL.");
  }else if(mode==="--summary"){
    console.log("Unapproved historical source: 5 Categories, 48 Services, 15 review work-items; ZERO verified human approvals, SQL or activations.");
  }else{
    // Single bounded log line permits creating a GitHub-accessible review
    // packet without depending on a lossy, manually copied console table.
    console.log("JODLO_FIRST_FIVE_SHEET_BASE64="+Buffer.from(expected,"utf8").toString("base64"));
  }
}
