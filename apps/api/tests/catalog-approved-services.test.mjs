import assert from "node:assert/strict";
import test from "node:test";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {parseApprovedServices,readApprovedServices} from "../src/modules/catalog/approved-services.ts";
import {parseCatalogSearch,searchPublicCategories} from "../src/modules/catalog/catalog.ts";

function fixture(){
  const f=openLocalDatabase();
  f.db.exec("INSERT INTO catalog_groups(id,name_en,is_active,is_approved) VALUES('fixture','Fixture',1,1);"+
    "INSERT INTO catalog_families(id,group_id,name_en,is_active,is_approved) VALUES('fixture','fixture','Fixture',1,1);"+
    "INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES('jodlo_c_demo','fixture','Household work','घरेलू काम',1,1);"+
    "INSERT INTO catalog_family_categories(family_id,category_id,is_approved) VALUES('fixture','jodlo_c_demo',1);");
  for(let i=0;i<28;i++)f.db.prepare("INSERT INTO catalog_services(id,category_id,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run("jodlo_s_demo"+String(i).padStart(2,"0"),"jodlo_c_demo","Tap replacement "+i,"नल बदलना "+i);
  return f;
}
const options=after=>({categoryId:"jodlo_c_demo",language:"hi",limit:25,after});
test("approved service labels are bounded, bilingual, and private source evidence never enters public results",async()=>{
  const f=fixture();try{
    const first=await readApprovedServices(f.adapter,options(null));
    assert.equal(first.items.length,25);assert.equal(first.nextCursor,"jodlo_s_demo24");
    assert.deepEqual(first.items[0],{id:"jodlo_s_demo00",name:"नल बदलना 0"});
    const last=await readApprovedServices(f.adapter,options(first.nextCursor));
    assert.equal(last.items.length,3);assert.equal(last.nextCursor,null);
    assert.deepEqual(Object.keys(first).sort(),["categoryId","items","language","nextCursor"]);
    f.db.exec("UPDATE catalog_services SET is_active=0 WHERE id='jodlo_s_demo24'");
    assert.deepEqual((await readApprovedServices(f.adapter,options(first.nextCursor))).items,[]);
  }finally{f.db.close();}
});
test("every level of publication and approval is required for service-label reads",async()=>{
  for(const sql of ["UPDATE catalog_groups SET is_active=0","UPDATE catalog_groups SET is_approved=0",
    "UPDATE catalog_families SET is_active=0","UPDATE catalog_families SET is_approved=0",
    "UPDATE catalog_family_categories SET is_approved=0","UPDATE categories SET is_active=0","UPDATE catalog_services SET is_active=0"]){
    const f=fixture();try{f.db.exec(sql);assert.deepEqual((await readApprovedServices(f.adapter,options(null))).items,[],sql);}finally{f.db.close();}
  }
});
test("query refuses duplicate/unbounded/cross-category cursors and unknown fields",()=>{
  const good="categoryId=jodlo_c_demo&lang=hi&limit=25";
  assert.deepEqual(parseApprovedServices(new URLSearchParams(good)),options(null));
  for(const q of [good+"&lang=en",good+"&extra=1",good+"&after=",good+"&after=../../private",good.replace("25","26"),good.replace("hi","fr"),"lang=hi&limit=25"])
    assert.equal(parseApprovedServices(new URLSearchParams(q)),null,q);
});
test("approved service names find the canonical Category without inventing an available Worker",async()=>{
  const f=fixture();try{
    const search=async(query)=>searchPublicCategories(f.adapter,parseCatalogSearch(new URLSearchParams(query)));
    for(const q of ["q=replacement","q="+encodeURIComponent("नल बदलना"),"q=replacement&cursor=1"]){
      const found=await search(q);assert.deepEqual(found.categories,[{id:"jodlo_c_demo",slug:"fixture",name:"Household work"}]);
    }
    assert.deepEqual((await search("q=replacement&availableOnly=1")).categories,[]);
    f.db.exec("UPDATE catalog_family_categories SET is_approved=0");
    assert.deepEqual((await search("q=replacement")).categories,[]);
    f.db.exec("UPDATE catalog_family_categories SET is_approved=1;UPDATE catalog_services SET is_active=0");
    assert.deepEqual((await search("q=replacement")).categories,[]);
  }finally{f.db.close();}
});
test("service-name cursor anchors are revalidated against current approval",async()=>{
  const f=fixture();try{
    f.db.exec("INSERT INTO categories(id,slug,name_en,is_active,sort_order) VALUES('jodlo_c_second','fixture-second','Second',1,2);"+
      "INSERT INTO catalog_family_categories(family_id,category_id,is_approved) VALUES('fixture','jodlo_c_second',1);"+
      "INSERT INTO catalog_services(id,category_id,name_en,name_hi,is_active) VALUES('jodlo_s_second','jodlo_c_second','Tap replacement','नल बदलना',1);");
    const first=await searchPublicCategories(f.adapter,parseCatalogSearch(new URLSearchParams("q=replacement&cursor=1&limit=1")));
    assert.equal(first.nextCursor,"1:jodlo_c_demo");
    const next=()=>searchPublicCategories(f.adapter,parseCatalogSearch(new URLSearchParams("q=replacement&cursor=1&limit=1&after="+first.nextCursor)));
    assert.equal((await next()).categories[0].id,"jodlo_c_second");
    f.db.exec("UPDATE catalog_services SET is_active=0 WHERE category_id='jodlo_c_demo'");
    assert.deepEqual((await next()).categories,[]);
  }finally{f.db.close();}
});
