import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

const ORIGIN="https://api.jodlo.rekixo.com";
function fixture(){
  const {db,adapter}=openLocalDatabase();
  const sql=db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)");
  sql.run("plumber","plumber","Plumber","प्लंबर",1,1);
  sql.run("carpenter","carpenter","Carpenter","बढ़ई",1,2);
  sql.run("inactive","inactive","Private unpublished name","प्रकाशित नहीं",0,3);
  return {db,adapter};
}
async function get(adapter,path,method="GET"){
  const r=await worker.fetch(new Request(ORIGIN+path,{method}),{DB:adapter});
  return {status:r.status,data:await r.json(),headers:r.headers};
}

test("exact public Category label lookup returns only approved active bilingual names",async()=>{
  const f=fixture();
  try{
    for(const [lang,names] of [["en",["Carpenter","Plumber"]],["hi",["बढ़ई","प्लंबर"]]]){
      const r=await get(f.adapter,"/api/v1/catalog?lang="+lang+"&ids=carpenter,plumber,inactive,absent");
      assert.equal(r.status,200);
      assert.equal(r.headers.get("Cache-Control"),"no-store");
      assert.deepEqual(r.data,{ok:true,data:{
        language:lang,
        categories:[
          {id:"plumber",slug:"plumber",name:names[1]},
          {id:"carpenter",slug:"carpenter",name:names[0]},
        ],
        nextCursor:null,
      }});
      assert.doesNotMatch(JSON.stringify(r.data),/Private unpublished name|प्रकाशित नहीं|worker|phone|account/);
    }
    const inactive=await get(f.adapter,"/api/v1/catalog?lang=en&ids=inactive");
    assert.deepEqual(inactive.data.data.categories,[]);
    const missing=await get(f.adapter,"/api/v1/catalog?lang=en&ids=absent");
    assert.deepEqual(missing.data.data.categories,[]);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='plumber'").run();
    const after=await get(f.adapter,"/api/v1/catalog?lang=hi&ids=plumber,carpenter");
    assert.deepEqual(after.data.data.categories,[{id:"carpenter",slug:"carpenter",name:"बढ़ई"}]);
  }finally{f.db.close()}
});

test("bounded ID lookup rejects repeated, injected, mixed browse and oversized input before SQL",async()=>{
  const bad=[
    "?lang=en&ids=", "?lang=en&ids=plumber,,carpenter",
    "?lang=en&ids=plumber,plumber", "?lang=en&ids=plumber&ids=carpenter",
    "?lang=hi&lang=en&ids=plumber", "?ids=plumber", "?lang=xx&ids=plumber",
    "?lang=en&ids=plumber&limit=20", "?lang=en&ids=plumber&availableOnly=1",
    "?lang=en&ids=plumber&after=0%3Aplumber", "?lang=en&ids=plumber&workerId=somebody",
    "?lang=en&ids=plumber%20", "?lang=en&ids=plumb%2Fer",
    "?lang=en&ids=%25", "?lang=en&ids=plumber%0Asecret",
    "?lang=en&ids="+Array.from({length:21},(_,i)=>"cat"+i).join(","),
    "?lang=en&ids="+"a".repeat(1300),
  ];
  const DB={prepare(){throw Error("SQL MUST NOT RUN ON INVALID INPUT")}};
  for(const p of bad){
    const r=await get(DB,"/api/v1/catalog"+p);
    assert.equal(r.status,400,p);
    assert.equal(r.data.error.code,"INVALID_QUERY",p);
    assert.doesNotMatch(JSON.stringify(r.data),/SQL MUST NOT RUN/);
  }
});

test("batch lookup cannot be used for writes, private accounts or binding errors",async()=>{
  const f=fixture();
  try{
    for(const method of ["POST","PUT","PATCH","DELETE"]){
      const r=await get(f.adapter,"/api/v1/catalog?lang=hi&ids=plumber",method);
      assert.equal(r.status,405);
      assert.equal(r.headers.get("Allow"),"GET");
    }
    const noD1=await worker.fetch(new Request(
      ORIGIN+"/api/v1/catalog?lang=en&ids=plumber"));
    assert.equal(noD1.status,503);
    const error=await get({prepare(){throw Error("NO_DB_SECRET_EXPOSURE")}},
      "/api/v1/catalog?lang=en&ids=plumber");
    assert.equal(error.status,503);
    assert.doesNotMatch(JSON.stringify(error.data),/NO_DB_SECRET_EXPOSURE/);
    const regular=await get(f.adapter,"/api/v1/catalog?lang=hi&limit=1");
    assert.equal(regular.status,200);
    assert.equal(regular.data.data.categories.length,1);
    assert.ok(regular.data.data.nextCursor);
  }finally{f.db.close()}
});
