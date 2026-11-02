import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync,spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {
  loadPinnedHumanReviewActionQueue,emptyHumanReviewActionPacketSet,
} from "./catalog-human-review-progress.mjs";
import {selectNextHumanReviewActions} from "./catalog-review-next-actions.mjs";

const queue=loadPinnedHumanReviewActionQueue();
const fresh=()=>emptyHumanReviewActionPacketSet(queue);
const plan=(progress=fresh(),options={})=>
  selectNextHumanReviewActions(queue,progress,options);

test("globally prioritized batch bridges source-locked 45 packets with all 2,667 human tasks",()=>{
  const result=plan(),s=result.summary,page=result.page;
  assert.equal(result.kind,"JODLO_GLOBAL_HUMAN_REVIEW_NEXT_ACTIONS_ONLY");
  assert.equal(result.state,"UNVERIFIED_HUMAN_TASKS_ZERO_CATALOG_AUTHORIZATION");
  assert.deepEqual(result.languages,["en","hi"]);
  assert.equal(s.historicalCategories,889);
  assert.equal(s.historicalServices,7267);
  assert.equal(s.reviewPackets,45);
  assert.equal(s.requiredHumanReviewTasks,2667);
  assert.equal(s.selfReportedTaskStatuses.NOT_STARTED,2667);
  assert.equal(s.categoriesStillRequiringQualifiedHumanReview,889);
  assert.equal(s.servicesStillRequiringQualifiedHumanReview,7267);
  assert.equal(s.founderCategoryApprovalsAuthenticated,0);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  assert.equal(s.servicesAuthorizedForActivation,0);
  assert.equal(s.sqlStatementsGenerated,0);
  assert.equal(page.categories.length,20);
  assert.equal(page.limit,20);
  assert.equal(page.after,null);
  assert.equal(page.nextCursor,page.categories.at(-1).sourceCategoryId);
  assert.deepEqual(page.categories.map(x=>x.sourceCategoryId),
    queue.reviewQueue.slice(0,20).map(x=>x.sourceCategoryId));
  for(const row of page.categories){
    assert.equal(row.categoriesAuthorizedForActivation,0);
    assert.equal(row.stillRequiresQualifiedHumanReview,true);
    assert.equal(row.tasks.length,3);
    assert.ok(row.tasks.every(x=>
      x.status==="NOT_STARTED"&&x.evidenceUrl===null&&
      x.qualifiedSignoffVerified===false));
    assert.match(row.sourceCategorySha256,/^[0-9a-f]{64}$/u);
    assert.ok(row.packetNumber>=1&&row.packetNumber<=45);
  }
  const exposed=JSON.stringify(result);
  for(const leaked of ["latitude","longitude","phoneNumber","worker_account_id",
    "accessToken","ACTIVATE_CATALOG"]){
    assert.equal(exposed.includes(leaked),false,leaked);
  }
});

test("reviewer actions page across global attention order with original ID anchor, no ten-trade cap",()=>{
  const progress=fresh();
  const first=plan(progress,{limit:25});
  const second=plan(progress,{limit:25,after:first.page.nextCursor});
  assert.equal(first.page.categories.length,25);
  assert.equal(second.page.categories.length,25);
  assert.deepEqual(second.page.categories.map(x=>x.sourceCategoryId),
    queue.reviewQueue.slice(25,50).map(x=>x.sourceCategoryId));
  assert.equal(new Set([...first.page.categories,...second.page.categories]
    .map(x=>x.sourceCategoryId)).size,50);
  const last=plan(progress,{limit:25,
    after:queue.reviewQueue[queue.reviewQueue.length-2].sourceCategoryId});
  assert.deepEqual(last.page.categories.map(x=>x.sourceCategoryId),
    [queue.reviewQueue.at(-1).sourceCategoryId]);
  assert.equal(last.page.nextCursor,null);
  const end=plan(progress,{after:queue.reviewQueue.at(-1).sourceCategoryId});
  assert.deepEqual(end.page.categories,[]);
  assert.equal(end.page.nextCursor,null);
});

test("priority output retains unverified progress and specialist handoffs rather than pretending approval",()=>{
  const progress=fresh(),focus=queue.reviewQueue[0];
  const packet=progress[focus.packetNumber-1];
  const category=packet.categories.find(x=>x.sourceCategoryId===focus.sourceCategoryId);
  assert.ok(category);
  category.tasks[0].status="SELF_REPORTED_IN_PROGRESS";
  category.tasks[1].status="EVIDENCE_LINKED_UNVERIFIED";
  category.tasks[1].evidenceUrl="https://github.com/rekixo-lab/jodlo/pull/108";
  category.tasks[2].status="SPECIALIST_HANDOFF_PENDING";
  category.tasks[2].evidenceUrl="https://github.com/rekixo-lab/jodlo/pull/108#issuecomment-21";
  const result=plan(progress,{limit:1});
  assert.equal(result.summary.selfReportedTaskStatuses.NOT_STARTED,2664);
  assert.deepEqual(result.page.categories[0].tasks.map(t=>t.status),
    ["SELF_REPORTED_IN_PROGRESS","EVIDENCE_LINKED_UNVERIFIED",
      "SPECIALIST_HANDOFF_PENDING"]);
  assert.ok(result.page.categories[0].tasks.every(t=>!t.qualifiedSignoffVerified));
  assert.equal(result.summary.qualifiedLegalReviewsAuthenticated,0);
  assert.equal(result.summary.categoriesAuthorizedForActivation,0);
});

test("bad anchors, incomplete coverage, forged signoff and unsafe progress all fail closed",()=>{
  const p=fresh();
  for(const options of [
    {limit:0},{limit:26},{limit:1.5},{limit:"25"},
    {after:"unknown-original-category"},{after:""},{after:42},
    {limit:2,authorized:true},null,[],
  ])assert.throws(()=>plan(p,options),undefined,JSON.stringify(options));

  const incomplete=fresh();incomplete.pop();
  assert.throws(()=>plan(incomplete),/45/);
  const spoof=fresh();
  spoof[0].categories[0].tasks[0].status="APPROVED";
  assert.throws(()=>plan(spoof),/Forged|malformed/);
  const authorized=fresh();
  authorized[0].categories[0].categoriesAuthorizedForActivation=1;
  assert.throws(()=>plan(authorized),/fake approval|Altered/);
  assert.equal(queue.summary.categoriesAuthorizedForActivation,0);
});

test("read-only CLI: short next page, summary/check and invalid batch arguments",()=>{
  const run=(...args)=>execFileSync(process.execPath,
    ["scripts/catalog-review-next-actions.mjs",...args],{
      cwd:resolve(import.meta.dirname,".."),encoding:"utf8",timeout:90_000,
      maxBuffer:20_000_000,stdio:["ignore","pipe","pipe"],
    });
  assert.match(run("--check"),/889 Categories, 7,267 Services, 2,667 tasks/);
  const summary=JSON.parse(run("--summary"));
  assert.equal(summary.requiredHumanReviewTasks,2667);
  assert.equal(summary.categoriesAuthorizedForActivation,0);
  const selected=JSON.parse(run("--next","--limit=2"));
  assert.equal(selected.page.categories.length,2);
  assert.equal(selected.page.nextCursor,selected.page.categories[1].sourceCategoryId);
  const invalid=spawnSync(process.execPath,[
    "scripts/catalog-review-next-actions.mjs","--next","--limit=26",
  ],{cwd:resolve(import.meta.dirname,".."),encoding:"utf8",timeout:90_000});
  assert.notEqual(invalid.status,0);
});
