import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync,execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {loadPinnedHumanReviewActionQueue,emptyHumanReviewActionPacketSet} from "./catalog-human-review-progress.mjs";
import {selectNextHumanReviewActions} from "./catalog-review-next-actions.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {buildCategoryReviewDossier} from "./catalog-review-dossier.mjs";

const queue=loadPinnedHumanReviewActionQueue();
const evidence=loadPinnedFullCategoryServiceEvidence();
const page=opts=>selectNextHumanReviewActions(queue,emptyHumanReviewActionPacketSet(queue),opts);

test("first five review cards include all 48 historic services, both languages, pending legal gates",()=>{
  const result=buildCategoryReviewDossier(page({limit:5}),evidence);
  assert.equal(result.kind,"JODLO_HUMAN_CATEGORY_SERVICE_DOSSIER_REVIEW_ONLY");
  assert.equal(result.summary.historicalCategories,889);
  assert.equal(result.summary.historicalServices,7267);
  assert.equal(result.summary.requiredHumanReviewTasks,2667);
  assert.equal(result.summary.selectedHistoricalServices,48);
  assert.equal(result.summary.sqlStatementsGenerated,0);
  assert.equal(result.summary.categoriesAuthorizedForActivation,0);
  assert.equal(result.page.nextCursor,"laptop-repair");
  assert.deepEqual(result.page.categories.map(x=>x.sourceCategoryId),
    ["ac-technician","home-tutor","electrician","two-wheeler-mechanic","laptop-repair"]);
  for(const c of result.page.categories){
    assert.equal(c.serviceCount,c.services.length);
    assert.equal(c.qualifiedHumanReviewVerified,false);
    assert.equal(c.founderActivationApproved,false);
    assert.equal(c.outstandingHumanReviewTasks.length,3);
    assert.ok(c.services.every(s=>s.historicalNameEn&&s.historicalNameHi&&
      s.reviewState==="UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED"));
  }
});

test("review pages preserve full 889 category coverage, including last original category",()=>{
  const last=queue.reviewQueue.at(-1).sourceCategoryId;
  const before=queue.reviewQueue.at(-2).sourceCategoryId;
  const result=buildCategoryReviewDossier(page({limit:1,after:before}),evidence);
  assert.equal(result.page.categories.length,1);
  assert.equal(result.page.categories[0].sourceCategoryId,last);
  assert.equal(result.page.nextCursor,null);
});

test("tampering with historical services, source, approval, tasks or duplicates fails closed",()=>{
  const p=page({limit:1});
  const good=buildCategoryReviewDossier(p,evidence);
  assert.equal(good.summary.selectedCategories,1);
  const missing=structuredClone(evidence);
  missing.packets[0].categories[0].services.pop();
  assert.throws(()=>buildCategoryReviewDossier(p,missing));
  const forgedTask=structuredClone(p);
  forgedTask.page.categories[0].tasks[0].qualifiedSignoffVerified=true;
  assert.throws(()=>buildCategoryReviewDossier(forgedTask,evidence));
  const forgedRelease=structuredClone(p);
  forgedRelease.summary.categoriesAuthorizedForActivation=1;
  assert.throws(()=>buildCategoryReviewDossier(forgedRelease,evidence));
  const changedSource=structuredClone(evidence);
  changedSource.manifest.sourceJsonSha256="wrong";
  assert.throws(()=>buildCategoryReviewDossier(p,changedSource));
  const duplicate=structuredClone(evidence);
  duplicate.packets[0].categories[1].sourceCategoryId=
    duplicate.packets[0].categories[0].sourceCategoryId;
  assert.throws(()=>buildCategoryReviewDossier(p,duplicate));
});

test("CLI emits read-only bilingual source dossier and rejects malformed command flags",()=>{
  const run=(...args)=>execFileSync(process.execPath,
    ["scripts/catalog-review-dossier.mjs",...args],{
      cwd:resolve(import.meta.dirname,".."),encoding:"utf8",timeout:90_000,
      maxBuffer:20_000_000,
    });
  assert.match(run("--check"),/no approvals, no SQL/);
  const summary=JSON.parse(run("--summary"));
  assert.equal(summary.selectedHistoricalServices,48);
  const first=JSON.parse(run("--next","--limit=1"));
  assert.equal(first.page.categories[0].services.length,10);
  assert.ok(first.page.categories[0].services[0].historicalNameHi);
  for(const args of [["--limit=11"],["--after=not-an-id"],["--next","--summary"],
    ["--summary","--limit=5"],["--unknown"]]) {
    const bad=spawnSync(process.execPath,
      ["scripts/catalog-review-dossier.mjs",...args],{
        cwd:resolve(import.meta.dirname,".."),encoding:"utf8",timeout:90_000,
      });
    assert.notEqual(bad.status,0,args.join(" "));
  }
});
