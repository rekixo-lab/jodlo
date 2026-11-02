import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync,spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {
  loadPinnedHumanReviewActionQueue,emptyHumanReviewActionPacketSet,
} from "./catalog-human-review-progress.mjs";
import {selectNextHumanReviewActions} from "./catalog-review-next-actions.mjs";
import {loadPinnedCatalogMappingReadiness} from "./catalog-mapping-readiness.mjs";

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

test("each reviewer card binds historical D1 syntax issues without inventing approved IDs or slugs",()=>{
  const mapping=loadPinnedCatalogMappingReadiness().result;
  const map=new Map(mapping.categories.map(x=>[x.sourceCategoryId,x]));
  assert.equal(map.size,889);
  const sample=plan(fresh(),{limit:25});
  assert.equal(sample.page.focus,"all");
  assert.equal(sample.summary.categoriesWithHistoricalSyntaxIssues,
    mapping.categories.filter(x=>x.syntaxIssues.length>0).length);
  for(const card of sample.page.categories){
    const baseline=map.get(card.sourceCategoryId);
    assert.deepEqual(card.originalCategoryMapping,{
      categoryIdSyntaxCandidate:baseline.categoryIdCandidate,
      slugSyntaxCandidate:baseline.slugCandidate,
      syntaxIssues:baseline.syntaxIssues,
      sourceReviewFlags:baseline.historicalReviewFlags,
      reviewState:"HUMAN_ID_SLUG_LABEL_AND_SAFETY_REVIEW_REQUIRED",
    });
    assert.equal(card.categoriesAuthorizedForActivation,0);
    assert.equal(card.stillRequiresQualifiedHumanReview,true);
    assert.deepEqual(Object.keys(card.serviceReviewIssues),[
      "flaggedOriginalServiceIds","serviceNameDraftsUnverified",
      "serviceScopeDraftsUnverified","scopeConcernRowsUnverified",
      "proposedNameConflictsUnresolved","outstandingNameScopeHandoffs",
    ]);
  }
  // A historical identifier with Devanagari MUST remain a human correction
  // task, not a silently transliterated D1 ID or authorized public listing.
  const target=queue.reviewQueue.find(x=>x.sourceCategoryId==="farmer-helper-मजदूर");
  assert.ok(target);
  const card=plan(fresh(),{limit:1,after:queue.reviewQueue[
    queue.reviewQueue.indexOf(target)-1].sourceCategoryId}).page.categories[0];
  assert.equal(card.sourceCategoryId,"farmer-helper-मजदूर");
  assert.equal(card.originalCategoryMapping.categoryIdSyntaxCandidate,null);
  assert.equal(card.originalCategoryMapping.slugSyntaxCandidate,null);
  assert.ok(card.originalCategoryMapping.syntaxIssues.includes(
    "SOURCE_CATEGORY_ID_INCOMPATIBLE"));
  assert.equal(card.categoriesAuthorizedForActivation,0);
});

test("mapping focus skips unaffected source rows without silently cutting full review scope",()=>{
  const mapping=loadPinnedCatalogMappingReadiness().result;
  const issueIds=new Set(mapping.categories
    .filter(x=>x.syntaxIssues.length>0).map(x=>x.sourceCategoryId));
  assert.ok(issueIds.size>0);
  const expected=queue.reviewQueue.filter(x=>issueIds.has(x.sourceCategoryId))
    .map(x=>x.sourceCategoryId);
  const actual=[];
  const input=fresh();
  let after=null,pages=0;
  do{
    const out=plan(input,{focus:"mapping",limit:3,after});
    assert.equal(out.summary.historicalCategories,889);
    assert.equal(out.summary.historicalServices,7267);
    assert.equal(out.summary.categoriesAuthorizedForActivation,0);
    assert.equal(out.page.focus,"mapping");
    assert.ok(out.page.categories.length<=3);
    actual.push(...out.page.categories.map(x=>x.sourceCategoryId));
    after=out.page.nextCursor;
    pages++;
    assert.ok(pages<=297);
  }while(after!==null);
  assert.deepEqual(actual,expected);
  assert.equal(new Set(actual).size,actual.length);
  assert.equal(plan(input,{focus:"mapping",after:queue.reviewQueue.at(-1).sourceCategoryId})
    .page.categories.length,0);
});

test("service focus brings unverified source anomalies and name/scope handoffs together",()=>{
  const input=fresh();
  const expected=queue.reviewQueue.filter(x=>
    x.flaggedSourceServiceIds.length>0||
    x.serviceNameDraftsUnverified>0||
    x.serviceScopeDraftsUnverified>0||
    x.serviceScopeConcernRowsUnverified>0||
    x.unresolvedProposedNameConflicts.length>0||
    x.outstandingNameScopeHandoffs.length>0);
  assert.ok(expected.length>0);
  const page=plan(input,{focus:"service",limit:5});
  assert.equal(page.page.focus,"service");
  assert.deepEqual(page.page.categories.map(x=>x.sourceCategoryId),
    expected.slice(0,5).map(x=>x.sourceCategoryId));
  assert.equal(page.summary.categoriesWithServiceReviewSignals,expected.length);
  for(const c of page.page.categories){
    const source=queue.reviewQueue.find(x=>x.sourceCategoryId===c.sourceCategoryId);
    assert.deepEqual(c.serviceReviewIssues.flaggedOriginalServiceIds,
      source.flaggedSourceServiceIds);
    assert.equal(c.serviceReviewIssues.serviceNameDraftsUnverified,
      source.serviceNameDraftsUnverified);
    assert.equal(c.serviceReviewIssues.scopeConcernRowsUnverified,
      source.serviceScopeConcernRowsUnverified);
    assert.ok(c.tasks.every(t=>t.qualifiedSignoffVerified===false));
  }
  if(expected.length>5){
    const continuation=plan(input,{focus:"service",limit:5,
      after:page.page.nextCursor});
    assert.deepEqual(continuation.page.categories.map(x=>x.sourceCategoryId),
      expected.slice(5,10).map(x=>x.sourceCategoryId));
  }
});

test("unknown focus or altered mapping lineage fails closed before issuing reviewer action cards",()=>{
  const input=fresh();
  for(const focus of ["safety-approved","ten-categories",1,null,"M005_DONE"]){
    assert.throws(()=>plan(input,{focus}),/Invalid reviewer batch/);
  }
  const altered=structuredClone(queue);
  altered.reviewQueue[0].historicalNameEn="Invented approved trade";
  assert.throws(()=>selectNextHumanReviewActions(altered,input),
    /diverged|mismatch|changed|Invalid/);
  const manipulated=structuredClone(queue);
  manipulated.reviewQueue[0].sourceGroupId="fake-unreviewed-parent";
  assert.throws(()=>selectNextHumanReviewActions(manipulated,input),
    /diverged|mismatch|changed|Invalid/);
});

test("CLI focus rejects unknown modes and never creates activation or source aliases",()=>{
  const cwd=resolve(import.meta.dirname,"..");
  const run=(...args)=>execFileSync(process.execPath,
    ["scripts/catalog-review-next-actions.mjs",...args],{
      cwd,encoding:"utf8",timeout:90_000,maxBuffer:20_000_000,
      stdio:["ignore","pipe","pipe"],
    });
  for(const focus of ["mapping","service"]){
    const out=JSON.parse(run("--next","--focus="+focus,"--limit=2"));
    assert.equal(out.page.focus,focus);
    assert.ok(out.page.categories.length<=2);
    assert.equal(out.summary.categoriesAuthorizedForActivation,0);
    assert.equal(out.summary.servicesAuthorizedForActivation,0);
    assert.equal(out.summary.sqlStatementsGenerated,0);
    assert.equal(out.summary.approvedAliases,0);
  }
  for(const args of [
    ["--next","--focus=approved"],
    ["--summary","--focus=mapping"],
    ["--next","--focus=all","--focus=service"],
  ])assert.notEqual(spawnSync(process.execPath,
      ["scripts/catalog-review-next-actions.mjs",...args],{cwd,timeout:90_000})
      .status,0,args.join(" "));
});
