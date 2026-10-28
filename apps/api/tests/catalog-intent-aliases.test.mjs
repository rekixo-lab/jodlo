import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import {
  resolveConservativeWorkIntent, ambiguousWorkCategoryIds, validateWorkAliasRegistry, WORK_INTENT_ALIASES,
} from "../src/modules/catalog/intent-aliases.ts";

const url="https://jodlo.rekixo.com/api/v1/catalog/search";
function setup() {
  const {db,adapter}=openLocalDatabase();
  const add=db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,?,?)");
  add.run("plumber","plumber","Plumber","प्लंबर",1,1);
  add.run("carpenter","carpenter","Carpenter","बढ़ई",1,2);
  add.run("tailor-stitching","tailor-stitching","Tailor","दर्जी",1,3);
  add.run("bicycle-repairer","bicycle-repairer","Bicycle Repairer","साइकिल मरम्मत करने वाला",1,4);
  add.run("electrician","electrician","Electrician","इलेक्ट्रिशियन",0,5);
  const get=async (q,extras="") => {
    const res=await worker.fetch(new Request(url+"?q="+encodeURIComponent(q)+extras),{DB:adapter});
    return {status:res.status,data:await res.json()};
  };
  return {db,get};
}

test("conservative resolver suggests only one unambiguous Hindi/English trade",()=>{
  for(const [phrase,id] of [
    ["नल टपक रहा है","plumber"],
    ["मुझे नल ठीक करना है","plumber"],
    ["मैं लकड़ी का फर्नीचर बनाता हूँ","carpenter"],
    ["मुझे कपड़े की सिलाई चाहिए","tailor-stitching"],
    ["साइकिल की मरम्मत","bicycle-repairer"],
    ["I need tap repair","plumber"],
    ["My tap is leaking","plumber"],
    ["I need wooden furniture","carpenter"],
    ["I need dress stitching","tailor-stitching"],
    ["I need bicycle repair","bicycle-repairer"],
  ]) {
    assert.deepEqual(resolveConservativeWorkIntent(phrase),{kind:"unique",categoryId:id},phrase);
  }
});
test("ambiguity, unknown jobs, Hinglish, mixed scripts, injection and context mismatch fail closed",()=>{
  assert.deepEqual(resolveConservativeWorkIntent("नल टपक रहा है और लकड़ी का फर्नीचर"),{kind:"ambiguous"});
  assert.deepEqual(resolveConservativeWorkIntent("tap repair and wooden furniture"),{kind:"ambiguous"});
  for(const q of [
    "मुझे बिजली का काम चाहिए","मुझे जादू का काम चाहिए","my tap repair in Raipur",
    "mujhe tap repair chahiye","main tap repair ka kaam karta hu",
    "I need नल टपक रहा है","tap repair; DROP TABLE categories",
    "tap repair' OR 1=1 --","%tap repair","bicycle repair and refrigerator service",
  ]) assert.deepEqual(resolveConservativeWorkIntent(q),{kind:"none"},q);
});
test("API resolves simple problem phrases only to currently active exact category ID",async()=>{
  const f=setup();
  try {
    for(const [q,id,hi] of [
      ["नल टपक रहा है","plumber","प्लंबर"],
      ["मैं लकड़ी का फर्नीचर बनाता हूँ","carpenter","बढ़ई"],
      ["मुझे कपड़े की सिलाई चाहिए","tailor-stitching","दर्जी"],
      ["साइकिल की मरम्मत","bicycle-repairer","साइकिल मरम्मत करने वाला"],
      ["I need tap repair","plumber","प्लंबर"],
    ]) {
      const x=await f.get(q,"&lang=hi");
      assert.equal(x.status,200,q);
      assert.deepEqual(x.data.data.categories,[{id,slug:id,name:hi}],q);
      assert.equal(x.data.data.nextOffset,null);
    }
    assert.deepEqual((await f.get("I need wooden furniture","&lang=en")).data.data.categories,
      [{id:"carpenter",slug:"carpenter",name:"Carpenter"}]);
    assert.deepEqual((await f.get("मुझे बिजली का काम चाहिए")).data.data.categories,[]);
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='plumber'").run();
    assert.deepEqual((await f.get("नल टपक रहा है")).data.data.categories,[]);
  } finally {f.db.close();}
});
test("existing plain category names, existing query shape and normal pagination remain intact",async()=>{
  const f=setup();
  try {
    assert.deepEqual((await f.get("plumber")).data.data.categories,
      [{id:"plumber",slug:"plumber",name:"Plumber"}]);
    assert.deepEqual((await f.get("I need carpenter")).data.data.categories,
      [{id:"carpenter",slug:"carpenter",name:"Carpenter"}]);
    assert.deepEqual((await f.get("tap repair","&limit=1&offset=1")).data.data.categories,[]);
    assert.deepEqual((await f.get("tap repair","&limit=1")).data.data.categories,
      [{id:"plumber",slug:"plumber",name:"Plumber"}]);
    for(const q of [
      "नल टपक रहा है और लकड़ी का फर्नीचर",
      "tap repair and wooden furniture",
      "mujhe tap repair chahiye",
      "I need नल टपक रहा है",
      "mujhe plumber chahiye",
      "I need air conditioning",
    ]) assert.deepEqual((await f.get(q)).data.data.categories,[],q);
  } finally {f.db.close();}
});
test("availableOnly=1 respects published/moderation/owner/category status, no fake city availability",async()=>{
  const f=setup();
  try {
    const q="नल टपक रहा है",flag="&availableOnly=1";
    assert.deepEqual((await f.get(q,flag)).data.data.categories,[]);
    const a="account-aliased-worker";
    f.db.prepare("INSERT INTO accounts(id) VALUES(?)").run(a);
    f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES(?)").run(a);
    f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
      .run("11111111-1111-4111-8111-111111111111",a,"plumber");
    let response=await f.get(q,flag+"&lang=hi");
    assert.deepEqual(response.data.data.categories,[{id:"plumber",slug:"plumber",name:"प्लंबर"}]);
    const serialized=JSON.stringify(response);
    for(const forbidden of [a,"worker_account_id","phone","verified","latitude","longitude","contact"]) {
      assert.equal(serialized.includes(forbidden),false,forbidden);
    }
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden'").run();
    assert.deepEqual((await f.get(q,flag)).data.data.categories,[]);
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed',status='unpublished'").run();
    assert.deepEqual((await f.get(q,flag)).data.data.categories,[]);
    f.db.prepare("UPDATE worker_listings SET status='published'").run();
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(a);
    assert.deepEqual((await f.get(q,flag)).data.data.categories,[]);
    f.db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(a);
    assert.equal((await f.get(q,flag)).data.data.categories.length,1);
    // Future first worker may still find the category without active listings.
    f.db.prepare("UPDATE worker_listings SET status='unpublished'").run();
    assert.deepEqual((await f.get(q)).data.data.categories,[{id:"plumber",slug:"plumber",name:"Plumber"}]);
  } finally {f.db.close();}
});
test("SQL or missing D1 never escapes; alias lookup rejects inactive and unknown records",async()=>{
  const queryUrl=url+"?q="+encodeURIComponent("नल टपक रहा है");
  const absent=await worker.fetch(new Request(queryUrl));
  assert.equal(absent.status,503);
  const failed=await worker.fetch(new Request(queryUrl),{
    DB:{prepare(){throw Error("INTERNAL_CATALOG_SECRET");}},
  });
  assert.equal(failed.status,503);
  assert.equal((await failed.text()).includes("INTERNAL_CATALOG_SECRET"),false);
  const f=setup();
  try {
    f.db.prepare("DELETE FROM categories WHERE id='plumber'").run();
    assert.deepEqual((await f.get("नल टपक रहा है")).data.data.categories,[]);
  } finally {f.db.close();}
});


test("registry quality gate rejects duplicate, cross-trade overlap, malformed ID and unsupported scripts",()=>{
  assert.equal(WORK_INTENT_ALIASES.length,24);
  assert.deepEqual(validateWorkAliasRegistry(WORK_INTENT_ALIASES),[]);
  const sample={categoryId:"plumber",locale:"en",phrase:"tap repair"};
  assert.ok(validateWorkAliasRegistry([sample,sample]).some(x=>x.includes("Duplicate")));
  const overlap=[
    sample,
    {categoryId:"carpenter",locale:"en",phrase:"urgent tap repair"},
  ];
  assert.ok(validateWorkAliasRegistry(overlap).some(x=>x.includes("Conflicting")));
  const noOverlap=[
    sample,
    {categoryId:"carpenter",locale:"en",phrase:"wooden furniture"},
  ];
  assert.deepEqual(validateWorkAliasRegistry(noOverlap),[]);
  for(const bad of [
    {categoryId:"../electrician",locale:"en",phrase:"wiring repair"},
    {categoryId:"plumber",locale:"hi",phrase:"nal tap repair"},
    {categoryId:"plumber",locale:"hi",phrase:"नल tap repair"},
    {categoryId:"plumber",locale:"en",phrase:"mujhe tap repair"},
    {categoryId:"plumber",locale:"en",phrase:"Tap Repair"},
    {categoryId:"plumber",locale:"en",phrase:"tap  repair"},
    {categoryId:"plumber",locale:"en",phrase:"tap repair; drop"},
    {categoryId:"plumber",locale:"en",phrase:"x".repeat(70)+" repair"},
  ]) {
    assert.ok(validateWorkAliasRegistry([bad]).length>0,JSON.stringify(bad));
    if (bad.phrase==="mujhe tap repair") {
      assert.deepEqual(resolveConservativeWorkIntent(bad.phrase),{kind:"none"});
    }
  }
  assert.ok(validateWorkAliasRegistry([]).length>0);
  assert.ok(validateWorkAliasRegistry(Array(513).fill(sample)).length>0);
});
test("ten proposed routine trade IDs have a tested Hindi and English phrase; no activation",()=>{
  for(const [hi,en,expected] of [
    ["दीवार की पुताई","wall painting","house-painter"],
    ["घर की सफाई","house cleaning","house-cleaner-maid"],
    ["सोफे की सफाई","sofa cleaning","sofa-carpet-cleaner"],
    ["बगीचे की देखभाल","garden maintenance","gardener"],
    ["घड़ी की मरम्मत","watch repair","watch-repairer"],
    ["टायर का पंचर","tyre puncture","tyre-puncture-technician"],
  ]) {
    assert.deepEqual(resolveConservativeWorkIntent("मुझे "+hi+" चाहिए"),
      {kind:"unique",categoryId:expected});
    assert.deepEqual(resolveConservativeWorkIntent("I need "+en),
      {kind:"unique",categoryId:expected});
  }
});
test("ten-trade ambiguous and unrelated work stays fail-closed",()=>{
  for(const phrase of [
    "दीवार की पुताई और घर की सफाई",
    "sofa cleaning and house cleaning",
    "watch repair and tyre puncture",
    "घड़ी की मरम्मत और टायर का पंचर",
  ]) assert.deepEqual(resolveConservativeWorkIntent(phrase),{kind:"ambiguous"},phrase);
  for(const phrase of [
    "बिजली की मरम्मत","दवाइयों की सलाह",
    "I need medical advice","I need tyre puncture in Bilaspur",
    "mujhe watch repair chahiye","मुझे house cleaning चाहिए",
    "watch repair; DROP TABLE categories",
    "I need watch repair for car brakes",
  ]) assert.deepEqual(resolveConservativeWorkIntent(phrase),{kind:"none"},phrase);
});
test("new phrases require an actual active category in D1 and honor existing availability check",async()=>{
  const f=setup();
  try {
    const aliases=[
      ["house-painter","house-painter","House Painter","घर पेंटर","दीवार की पुताई","wall painting"],
      ["house-cleaner-maid","house-cleaner-maid","House Cleaner","घरेलू सफाईकर्मी","घर की सफाई","house cleaning"],
      ["sofa-carpet-cleaner","sofa-carpet-cleaner","Sofa Cleaner","सोफा क्लीनर","सोफे की सफाई","sofa cleaning"],
      ["gardener","gardener","Gardener","माली","बगीचे की देखभाल","garden maintenance"],
      ["watch-repairer","watch-repairer","Watch Repairer","घड़ी मरम्मतकर्ता","घड़ी की मरम्मत","watch repair"],
      ["tyre-puncture-technician","tyre-puncture-technician","Tyre Puncture Technician","टायर पंचर तकनीशियन","टायर का पंचर","tyre puncture"],
    ];
    const add=f.db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)");
    // No API/data seeding by this test: disposable local database only.
    for(const [id,slug,en,hi,hindi,english] of aliases) {
      assert.deepEqual((await f.get(hindi,"&lang=hi")).data.data.categories,[]);
      add.run(id,slug,en,hi);
      for(const [q,display] of [[hindi,hi],["I need "+english,hi]]) {
        const found=(await f.get(q,"&lang=hi")).data.data.categories;
        assert.deepEqual(found,[{id,slug,name:display}],q);
      }
      assert.deepEqual((await f.get(hindi,"&availableOnly=1")).data.data.categories,[]);
      f.db.prepare("UPDATE categories SET is_active=0 WHERE id=?").run(id);
      assert.deepEqual((await f.get(hindi)).data.data.categories,[]);
    }
  } finally { f.db.close(); }
});


test("opt-in ambiguity returns all D1-active trades while old DTO stays unchanged",async()=>{
  const f=setup();
  try {
    for(const [q,ids] of [
      ["I need tap repair and wooden furniture",["plumber","carpenter"]],
      ["मुझे नल टपक रहा है और लकड़ी का फर्नीचर चाहिए",["plumber","carpenter"]],
    ]){
      assert.deepEqual(ambiguousWorkCategoryIds(q),ids.slice().sort());
      const old=(await f.get(q)).data.data;
      assert.deepEqual(old,{language:"en",query:q,categories:[],nextOffset:null});
      const fresh=(await f.get(q,"&includeChoices=1&lang=hi")).data.data;
      assert.deepEqual(fresh.categories,[]);
      assert.equal(fresh.needsChoice,true);
      assert.deepEqual(fresh.choices.map(x=>x.id),ids);
      assert.deepEqual(fresh.choices.map(x=>x.name),["प्लंबर","बढ़ई"]);
      assert.ok(fresh.choices.every(x=>Object.keys(x).sort().join(",")==="id,name,slug"));
    }
    assert.equal((await f.get("I need tap repair","&includeChoices=1")).data.data.needsChoice,undefined);
  } finally { f.db.close(); }
});
test("choices require confirmation even when just one active or published eligible trade remains",async()=>{
  const f=setup();
  try {
    const q="I need tap repair and wooden furniture",suffix="&includeChoices=1";
    f.db.prepare("UPDATE categories SET is_active=0 WHERE id='carpenter'").run();
    let x=(await f.get(q,suffix)).data.data;
    assert.equal(x.needsChoice,true);
    assert.deepEqual(x.choices.map(c=>c.id),["plumber"]);
    f.db.prepare("UPDATE categories SET is_active=1 WHERE id='carpenter'").run();
    assert.deepEqual((await f.get(q,suffix+"&availableOnly=1")).data.data.choices,[]);
    f.db.prepare("INSERT INTO accounts(id) VALUES('worker-ambiguity-test')").run();
    f.db.prepare("INSERT INTO worker_profiles(account_id) VALUES('worker-ambiguity-test')").run();
    f.db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
      .run("99999999-9999-4999-8999-999999999999","worker-ambiguity-test","plumber");
    x=(await f.get(q,suffix+"&availableOnly=1")).data.data;
    assert.equal(x.needsChoice,true);
    assert.deepEqual(x.choices,[{id:"plumber",slug:"plumber",name:"Plumber"}]);
    for(const forbidden of ["worker-ambiguity-test","worker_account_id","phone","lat","lng",
      "location","verified","moderation_status","owner"]) {
      assert.equal(JSON.stringify(x).includes(forbidden),false,forbidden);
    }
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden'").run();
    assert.deepEqual((await f.get(q,suffix+"&availableOnly=1")).data.data.choices,[]);
  } finally {f.db.close();}
});
test("unrelated context, mixed script and suspicious SQL never result in choices",async()=>{
  const f=setup();
  try {
    for(const q of [
      "I need tap repair and wooden furniture medical advice",
      "tap repair and wooden furniture in Raipur",
      "mujhe tap repair and wooden furniture chahiye",
      "I need नल टपक रहा है and wooden furniture",
      "tap repair and wooden furniture' OR 1=1",
      "tap repair; wooden furniture",
    ]){
      assert.deepEqual(ambiguousWorkCategoryIds(q),[],q);
      const result=(await f.get(q,"&includeChoices=1")).data.data;
      assert.deepEqual(result.categories,[],q);
      assert.equal(Object.hasOwn(result,"choices"),false,q);
    }
  } finally {f.db.close();}
});
test("opt-in choice flag rejects bad values, duplicates, paginated choices",async()=>{
  const f=setup();
  try {
    for(const suffix of [
      "&includeChoices=0","&includeChoices=true","&includeChoices=1&includeChoices=1",
      "&includeChoices=1&offset=1","&includeChoices=1&offset=100",
      "&includeChoices=1&extra=1",
    ]){
      const x=await f.get("I need tap repair and wooden furniture",suffix);
      assert.equal(x.status,400,suffix);
      assert.equal(x.data.error.code,"INVALID_QUERY",suffix);
    }
    assert.equal((await f.get("plumber","&includeChoices=1&offset=0")).status,200);
    const x=(await f.get("plumber")).data.data;
    assert.deepEqual(x.categories,[{id:"plumber",slug:"plumber",name:"Plumber"}]);
    assert.equal(Object.hasOwn(x,"needsChoice"),false);
    const post=await worker.fetch(new Request(url+"?q=plumber&includeChoices=1",
      {method:"POST"}),{DB:f.db});
    assert.equal(post.status,405);
  } finally {f.db.close();}
});
test("missing D1 or SQL exception fails closed and never leaks internal data",async()=>{
  const uri=url+"?q="+encodeURIComponent("tap repair and wooden furniture")+"&includeChoices=1";
  const noDb=await worker.fetch(new Request(uri));
  assert.equal(noDb.status,503);
  const fail=await worker.fetch(new Request(uri),{
    DB:{prepare(){throw new Error("SECRET_CATEGORY_JOIN");}},
  });
  assert.equal(fail.status,503);
  assert.equal((await fail.text()).includes("SECRET_CATEGORY_JOIN"),false);
});
