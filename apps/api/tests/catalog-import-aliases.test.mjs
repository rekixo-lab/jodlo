import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {catalogScopeHash,catalogSql,runCatalogTransaction} from "../../../scripts/approved-catalog-import.mjs";

// Disposable evidence-shaped fixture only. Nothing is written to the release
// directory or a live database, and these reviewer strings are not approvals.
function reviewedFixture(){
  const m={kind:"JODLO_REVIEWED_CATALOG_V1",batchId:"jodlo-alias-regression",sourceSha256:"1".repeat(64),
    groups:[{id:"jodlo_g_house",sourceId:"house",mode:"create",nameEn:"House",nameHi:"घर"}],
    families:[{id:"jodlo_f_repair",sourceId:"repair",mode:"create",nameEn:"Repair",nameHi:"मरम्मत",groupId:"jodlo_g_house"}],
    categories:[
      {id:"jodlo_c_pipe",sourceId:"plumber",mode:"create",nameEn:"Plumber",nameHi:"प्लंबर",slug:"plumber",sortOrder:1,familyId:"jodlo_f_repair"},
      {id:"jodlo_c_wood",sourceId:"carpenter",mode:"create",nameEn:"Carpenter",nameHi:"बढ़ई",slug:"carpenter",sortOrder:2,familyId:"jodlo_f_repair"},
    ],
    services:[
      {id:"jodlo_s_pipe",sourceId:"pipe-service",mode:"create",nameEn:"Pipe fitting",nameHi:"पाइप लगाना",categoryId:"jodlo_c_pipe"},
      {id:"jodlo_s_wood",sourceId:"wood-service",mode:"create",nameEn:"Wood fitting",nameHi:"लकड़ी लगाना",categoryId:"jodlo_c_wood"},
    ],approvals:{}};
  const scopeSha256=catalogScopeHash(m);
  m.approvals=Object.fromEntries(["owner","bilingual","occupational"].map(role=>[role,{
    reviewer:role==="owner"?"rekixo-lab":"fixture-"+role,decision:"approve_publication",scopeSha256,
    reviewedAt:"2026-11-24T00:00:00.000Z",evidenceUrl:"https://github.com/rekixo-lab/jodlo/pull/987654",
  }]));
  return m;
}
function fixture(){
  const f=openLocalDatabase(),manifest=reviewedFixture();
  const apply=operation=>runCatalogTransaction(f.db,catalogSql(manifest,operation,{now:Date.parse("2026-11-25T00:00:00.000Z")}));
  const get=async(query,extras="",adapter=f.adapter)=>{
    const response=await worker.fetch(new Request("https://jodlo.rekixo.com/api/v1/catalog/search?q="+encodeURIComponent(query)+extras),{DB:adapter});
    assert.equal(response.status,200);return (await response.json()).data;
  };
  return {...f,apply,get};
}

test("staging never enables aliases; reviewed remapped categories retain bilingual intent and reversal removes it",async()=>{
  const f=fixture();
  try{
    f.apply("stage");
    for(const suffix of ["","&cursor=1","&includeChoices=1"])
      assert.deepEqual((await f.get("नल टपक रहा है",suffix)).categories,[]);
    f.apply("publish");
    for(const phrase of ["नल टपक रहा है","I need tap repair"]){
      for(const suffix of ["","&cursor=1","&includeChoices=1"]){
        const data=await f.get(phrase,suffix+"&lang=hi");
        assert.deepEqual(data.categories,[{id:"jodlo_c_pipe",slug:"plumber",name:"प्लंबर"}]);
        assert.equal(data.needsChoice,undefined);
      }
    }
    const choices=await f.get("tap repair and wooden furniture","&includeChoices=1");
    assert.equal(choices.needsChoice,true);
    assert.deepEqual(choices.choices.map(row=>row.id),["jodlo_c_pipe","jodlo_c_wood"]);
    assert.deepEqual((await f.get("tap repair","&offset=1")).categories,[]);
    assert.deepEqual((await f.get("tap repair","&cursor=1&after=1:jodlo_c_pipe")).categories,[]);
    f.apply("reverse");
    assert.deepEqual((await f.get("tap repair","&cursor=1")).categories,[]);
    assert.deepEqual((await f.get("tap repair and wooden furniture","&includeChoices=1")).choices,[]);
  }finally{f.db.close();}
});

test("remapped alias eligibility, competing literal matches and fallback share one D1 read",async()=>{
  const f=fixture();
  try{
    f.apply("stage");f.apply("publish");
    f.db.exec("INSERT INTO accounts(id) VALUES('alias-worker'); INSERT INTO worker_profiles(account_id) VALUES('alias-worker')");
    f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id,service_city) VALUES(?,?,?,?)")
      .run("11111111-1111-4111-8111-111111111111","alias-worker","jodlo_c_pipe","raipur");
    let reads=0;
    const observed={...f.adapter,prepare(sql){reads++;return f.adapter.prepare(sql);}};
    const get=async()=>{reads=0;const result=await f.get("tap repair","&cursor=1&availableOnly=1&city=raipur",observed);assert.equal(reads,1);return result;};
    assert.deepEqual((await get()).categories.map(row=>row.id),["jodlo_c_pipe"]);
    assert.deepEqual((await f.get("tap repair","&cursor=1&availableOnly=1&city=bilaspur")).categories,[]);
    f.db.exec("UPDATE worker_listings SET moderation_status='hidden'");
    assert.deepEqual((await get()).categories,[]);
    f.db.exec("UPDATE worker_listings SET moderation_status='allowed'");
    f.db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,1,99)")
      .run("unrelated-tap","unrelated-tap","Tap Repair","नल मरम्मत");
    assert.deepEqual((await f.get("tap repair","&cursor=1")).categories,[]);
    assert.deepEqual((await get()).categories.map(row=>row.id),["jodlo_c_pipe"],"unavailable competing categories cannot override city availability");
    f.db.exec("UPDATE categories SET is_active=0 WHERE id='jodlo_c_pipe'");
    assert.deepEqual((await get()).categories,[]);
  }finally{f.db.close();}
});

test("legacy ID and remapped slug collision requires an explicit choice without silent limit-one selection",async()=>{
  const f=fixture();
  try{
    f.apply("stage");f.apply("publish");
    f.db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,1,10)")
      .run("plumber","legacy-plumber","Legacy Plumber","पुराना प्लंबर");
    for(const suffix of ["&limit=1","&cursor=1&limit=1"])
      assert.deepEqual((await f.get("tap repair",suffix)).categories,[]);
    let data=await f.get("tap repair","&includeChoices=1&limit=1");
    assert.equal(data.needsChoice,true);
    assert.deepEqual(data.choices.map(row=>row.id),["jodlo_c_pipe","plumber"]);
    f.db.exec("UPDATE categories SET name_en='Tap Repair' WHERE id='jodlo_c_pipe'");
    data=await f.get("tap repair","&includeChoices=1&limit=1");
    assert.equal(data.needsChoice,true);
    assert.deepEqual(data.choices.map(row=>row.id),["jodlo_c_pipe","plumber"]);
    assert.deepEqual((await f.get("tap repair","&cursor=1&limit=1")).categories,[]);
  }finally{f.db.close();}
});
