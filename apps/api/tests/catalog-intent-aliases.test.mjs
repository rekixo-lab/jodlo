import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { resolveConservativeWorkIntent } from "../src/modules/catalog/intent-aliases.ts";

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
