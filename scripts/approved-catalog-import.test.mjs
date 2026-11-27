import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {catalogScopeHash,catalogSql,validateApprovedCatalog,runCatalogTransaction,rehearseCatalog} from "./approved-catalog-import.mjs";

const now=Date.parse("2026-11-25T12:00:00.000Z");
function fixture(){
  const m={kind:"JODLO_REVIEWED_CATALOG_V1",batchId:"jodlo-synthetic-fixture",sourceSha256:"1".repeat(64),
    groups:[{id:"jodlo_g_fixture",mode:"create",sourceId:"fixture-group",nameEn:"Home work",nameHi:"घरेलू काम"}],
    families:[{id:"jodlo_f_fixture",mode:"create",sourceId:"fixture-family",nameEn:"Household services",nameHi:"घरेलू सेवाएँ",groupId:"jodlo_g_fixture"}],
    categories:[{id:"jodlo_c_fixture",mode:"create",sourceId:"fixture-category",nameEn:"Example repair",nameHi:"उदाहरण मरम्मत",familyId:"jodlo_f_fixture",slug:"jodlo-example-repair",sortOrder:1}],
    services:[{id:"jodlo_s_fixture",mode:"create",sourceId:"fixture-service",nameEn:"Example's fixture repair",nameHi:"उदाहरण की मरम्मत",categoryId:"jodlo_c_fixture"}],
    approvals:{}};
  approve(m);return m;
}
function approve(m){
  const scopeSha256=catalogScopeHash(m);
  m.approvals=Object.fromEntries(["owner","bilingual","occupational"].map((role,i)=>[role,{reviewer:role==="owner"?"rekixo-lab":"synthetic-reviewer-"+role,
    decision:"approve_publication",scopeSha256,reviewedAt:"2026-11-24T00:00:00.000Z",evidenceUrl:"https://github.com/rekixo-lab/jodlo/pull/1#issuecomment-"+(i+1)}]));
  return m;
}
function database(path=":memory:"){
  const db=new DatabaseSync(path);db.exec("PRAGMA foreign_keys=ON");
  for(const f of ["0001_public_catalog.sql","0010_approved_catalog_hierarchy.sql","0030_reviewed_catalog_imports.sql"])
    db.exec(readFileSync(new URL("../infra/migrations/"+f,import.meta.url),"utf8"));
  return db;
}
function run(db,m,op){return runCatalogTransaction(db,catalogSql(m,op,{now}));}
function snapshot(db){return Object.fromEntries(["catalog_import_batches","catalog_import_entries","catalog_groups","catalog_families","categories","catalog_family_categories","catalog_services"].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]));}

test("all reviewer evidence is bound to the exact reviewed content; draft/hash alone cannot authorize SQL",()=>{
  const m=fixture();assert.equal(validateApprovedCatalog(m,{now}).scopeSha256,catalogScopeHash(m));
  for(const change of [
    c=>{c.approvals={};},c=>{c.approvals.owner.reviewer="someone-else";},
    c=>{c.approvals.bilingual.evidenceUrl="https://example.com/approval";},
    c=>{c.approvals.occupational.decision="pending";},
    c=>{c.approvals.owner.reviewedAt="2026-11-26T00:00:00.000Z";},
    c=>{c.approvals.owner.reviewedAt="2026-02-30T00:00:00.000Z";},
    c=>{c.services[0].nameEn="Different label after approval";},
    c=>{c.categories[0].sortOrder=2;},
    c=>{c.approvals.owner.extra="silently accepted";},
  ]){const c=structuredClone(m);change(c);assert.throws(()=>catalogSql(c,"stage",{now}));}
});

test("unmapped historical IDs, invalid ancestry, duplicate IDs and unbounded input fail closed",()=>{
  for(const change of [
    c=>{c.categories[0].id="legacy-category";},c=>{c.categories[0].familyId="unknown";},
    c=>{c.categories[0].slug="unsafe'; DROP TABLE categories;";},
    c=>{c.services[0].nameHi="English only";},c=>{c.services[0].nameEn="Bad\u0000name";},
    c=>{c.services.push(structuredClone(c.services[0]));},
    c=>{c.services[0].mode="reference";},c=>{c.groups[0].sourceId=c.groups[0].id;},
    c=>{c.sourceSha256="0".repeat(64);},c=>{c.categories[0].sortOrder=1.5;},
    c=>{c.services=[];},c=>{c.services=Array(1001).fill(c.services[0]);},
  ]){const c=fixture();change(c);assert.throws(()=>catalogScopeHash(c));}
});

test("stage is invisible, publish is explicit, repeated operations are idempotent, reversal preserves rows",()=>{
  const db=database(),m=fixture();try{
    run(db,m,"stage");const staged=snapshot(db);run(db,m,"stage");assert.deepEqual(snapshot(db),staged);
    assert.equal(db.prepare("SELECT count(*) n FROM categories WHERE is_active=1").get().n,0);
    assert.equal(db.prepare("SELECT count(*) n FROM catalog_services WHERE is_active=1").get().n,0);
    assert.equal(db.prepare("SELECT name_en FROM catalog_services").get().name_en,"Example's fixture repair");
    run(db,m,"publish");const published=snapshot(db);run(db,m,"publish");assert.deepEqual(snapshot(db),published);
    assert.equal(db.prepare("SELECT count(*) n FROM catalog_services WHERE is_active=1").get().n,1);
    run(db,m,"reverse");const reversed=snapshot(db);run(db,m,"reverse");assert.deepEqual(snapshot(db),reversed);
    assert.equal(db.prepare("SELECT count(*) n FROM categories").get().n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM catalog_services").get().n,1);
    assert.equal(db.prepare("SELECT is_active FROM categories").get().is_active,0);
    assert.equal(db.prepare("SELECT state FROM catalog_import_batches").get().state,"reversed");
    assert.throws(()=>run(db,m,"publish"));assert.throws(()=>run(db,m,"stage"));
  }finally{db.close();}
});

test("stage cannot take ownership of an existing row, even with matching labels",()=>{
  const db=database(),m=fixture();try{
    db.prepare("INSERT INTO catalog_groups(id,name_en,name_hi) VALUES(?,?,?)").run(m.groups[0].id,m.groups[0].nameEn,m.groups[0].nameHi);
    const before=snapshot(db);assert.throws(()=>run(db,m,"stage"));assert.deepEqual(snapshot(db),before);
  }finally{db.close();}
});

test("late uniqueness failures roll back every insertion, not only the last statement",()=>{
  const db=database(),m=fixture();try{
    db.prepare("INSERT INTO categories(id,slug,name_en) VALUES(?,?,?)").run("other",m.categories[0].slug,"Existing");
    const before=snapshot(db);assert.throws(()=>run(db,m,"stage"));assert.deepEqual(snapshot(db),before);
  }finally{db.close();}
});

test("same batch with changed evidence or mappings cannot overwrite reviewed content",()=>{
  const db=database(),m=fixture();try{
    run(db,m,"stage");const before=snapshot(db);
    const changed=structuredClone(m);changed.services[0].nameEn="Changed";approve(changed);
    assert.throws(()=>run(db,changed,"stage"));assert.deepEqual(snapshot(db),before);
    const evidence=structuredClone(m);evidence.approvals.owner.evidenceUrl="https://github.com/rekixo-lab/jodlo/pull/2";
    assert.throws(()=>run(db,evidence,"publish"));assert.deepEqual(snapshot(db),before);
  }finally{db.close();}
});

test("publication and reversal refuse external edits and missing journal rows",()=>{
  for(const op of ["publish","reverse"]){
    const db=database(),m=fixture();try{
      run(db,m,"stage");db.exec("UPDATE catalog_services SET name_en='Externally changed'");
      const before=snapshot(db);assert.throws(()=>run(db,m,op));assert.deepEqual(snapshot(db),before);
      db.prepare("UPDATE catalog_services SET name_en=?").run(m.services[0].nameEn);
      db.exec("DELETE FROM catalog_import_entries WHERE entity_kind='service'");
      assert.throws(()=>run(db,m,op));
    }finally{db.close();}
  }
});

test("additional services can reference approved parents; reversal protects dependent batches",()=>{
  const db=database(),first=fixture();try{
    run(db,first,"stage");run(db,first,"publish");
    const second=fixture();second.batchId="jodlo-synthetic-extension";
    for(const c of ["groups","families","categories"])for(const row of second[c])row.mode="reference";
    second.services[0].id="jodlo_s_second";second.services[0].sourceId="fixture-second";approve(second);
    run(db,second,"stage");run(db,second,"publish");
    const before=snapshot(db);assert.throws(()=>run(db,first,"reverse"));assert.deepEqual(snapshot(db),before);
    run(db,second,"reverse");assert.equal(db.prepare("SELECT is_active FROM categories").get().is_active,1);
    // The dependent service is retained but already inactive. Reversing its
    // parent now has no effect on another published batch.
    run(db,first,"reverse");
    assert.equal(db.prepare("SELECT count(*) n FROM catalog_services").get().n,2);
  }finally{db.close();}
});

test("unreviewed descendants block reversal, retaining all unrelated data",()=>{
  const db=database(),m=fixture();try{
    run(db,m,"stage");run(db,m,"publish");
    db.prepare("INSERT INTO catalog_families(id,group_id,name_en,is_active,is_approved) VALUES(?,?,?,1,1)").run("unrelated",m.groups[0].id,"Other");
    const before=snapshot(db);assert.throws(()=>run(db,m,"reverse"));assert.deepEqual(snapshot(db),before);
  }finally{db.close();}
});

test("read-only backup rehearsal never changes original database and reports no live readiness",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"jodlo-backup-test-"));const p=join(dir,"source.sqlite");const db=database(p);
  try{
    const before=snapshot(db);
    const report=await rehearseCatalog(fixture(),{databasePath:p,now});
    assert.equal(report.productionChanges,0);assert.equal(report.readyToDeploy,false);
    assert.equal(report.evidenceAuthentication,"MANUAL_REVIEW_REQUIRED");
    assert.deepEqual(snapshot(db),before);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
