import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { issueSession } from "../src/modules/identity/sessions.ts";

/** Actual HTTP Worker router and all D1 migrations with synthetic owners.
 * No real users, Cloudflare deployment, Google, FCM or Agora connection.
 * A global approved-Category search is never proof of city availability:
 * only the fresh city+Category public Listing GET decides that.
 */
const origin = "https://jodlo.test";
const owners = [
  ["owner-raipur", "cat-plumber", "raipur"],
  ["owner-bilaspur", "cat-plumber", "bilaspur"],
  ["owner-electric", "cat-electrician", "raipur"],
];
function fixture() {
  const { db, adapter } = openLocalDatabase();
  for (const id of ["cat-plumber", "cat-electrician"]) {
    const plumber = id === "cat-plumber";
    db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,1,?)")
      .run(id, id, plumber ? "Plumbing" : "Electrician",
        plumber ? "प्लंबिंग" : "इलेक्ट्रीशियन", plumber ? 10 : 20);
  }
  for (const [account] of owners) db.prepare("INSERT INTO accounts(id) VALUES(?)").run(account);
  // Use real, expiring D1-backed synthetic session tokens, not a lenient
  // AUTH fixture: Service Area correctly rejects fake/short bearer strings.
  const env = {DB:adapter};
  async function send(path, {method="GET",token=null,body}={}) {
    const response = await worker.fetch(new Request(origin + "/api/v1/" + path, {
      method,
      headers: {
        ...(token === null ? {} : {Authorization: "Bearer " + token}),
        ...(body === undefined ? {} : {"Content-Type":"application/json"}),
      },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    }),env);
    return {status:response.status, payload:await response.json()};
  }
  return {db,adapter,send};
}

test("Worker publish -> Category Search -> explicit city+trade selection -> reviewed public detail", async () => {
  const f=fixture();
  try {
    const byCity={};
    for (const [account,category,city] of owners) {
      const issued=await issueSession(f.adapter, account);
      assert.ok(issued && issued.accessToken.length===43);
      const token=issued.accessToken;
      assert.equal((await f.send("me/worker-profile",{method:"POST",token})).status,200);
      const created=await f.send("me/listings",{method:"POST",token,body:{categoryId:category}});
      assert.equal(created.status,200);
      const listing=created.payload.data.listing;
      assert.deepEqual(Object.keys(listing),["id","categoryId"]);
      byCity[city+"-"+category]=listing;
      const write=await f.send("me/service-area?id="+listing.id+"&revision=0",{
        method:"PUT",token,body:{city}});
      assert.equal(write.status,200);
    }

    // Same read used by native Category Search: catalog result is an approved
    // *trade*, not a claim that all visible Workers cover selected city.
    const search=await f.send("catalog/search?lang=hi&q="+encodeURIComponent("प्लंबिंग")+
      "&cursor=1&limit=20");
    assert.equal(search.status,200);
    assert.deepEqual(search.payload.data.categories,
      [{id:"cat-plumber",slug:"cat-plumber",name:"प्लंबिंग"}]);
    const category=search.payload.data.categories[0];

    // Same native localizedPublicListings call after deliberate Category tap.
    const raipurFeed="listings?feed=service&limit=20&lang=hi&city=raipur&categoryId="+category.id;
    const raipur=await f.send(raipurFeed);
    assert.equal(raipur.status,200);
    assert.deepEqual(raipur.payload.data.listings,
      [byCity["raipur-cat-plumber"]]);
    assert.equal(raipur.payload.data.language,"hi");
    assert.equal(raipur.payload.data.city,"raipur");
    assert.equal(raipur.payload.data.categoryNames["cat-plumber"],"प्लंबिंग");
    assert.equal(raipur.payload.data.nextCursor,null);

    const bilaspur=await f.send(raipurFeed.replace("city=raipur","city=bilaspur"));
    assert.deepEqual(bilaspur.payload.data.listings,[byCity["bilaspur-cat-plumber"]]);
    const unmatched=await f.send(raipurFeed.replace("city=raipur","city=bilaspur")
      .replace("cat-plumber","cat-electrician"));
    assert.deepEqual(unmatched.payload.data.listings,[]);

    const selected=raipur.payload.data.listings[0];
    const detail="listings?id="+selected.id+"&view=service&lang=hi&city=raipur&profile=1";
    const exact=await f.send(detail);
    assert.equal(exact.status,200);
    assert.equal(exact.payload.data.listing.id,selected.id);
    assert.deepEqual(exact.payload.data.category,
      {id:category.id,slug:category.slug,name:category.name});
    assert.equal(exact.payload.data.profile,null);
    assert.equal(exact.payload.data.hasPhoto,false);
    assert.equal((await f.send(detail.replace("city=raipur","city=bilaspur"))).status,404);

    // Revoke current public authorization. The old Search result cannot
    // resurrect a hidden listing in city feed or reviewed detail.
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(selected.id);
    assert.deepEqual((await f.send(raipurFeed)).payload.data.listings,[]);
    assert.equal((await f.send(detail)).status,404);
    assert.equal((await f.send("catalog/search?lang=en&q=plumb&cursor=1&limit=20&availableOnly=1"))
      .status,200,"other city's eligible Worker still makes Category available globally");

    // Unknown/invalid cities and private account filters fail closed.
    for (const query of [raipurFeed+"&workerId=owner-raipur",
      raipurFeed.replace("raipur","mumbai"),raipurFeed+"&city=bilaspur"]) {
      assert.equal((await f.send(query)).status,400,query);
    }
    const blob=JSON.stringify(raipur.payload);
    for(const secret of ["owner-raipur","owner-bilaspur","owner-electric",
      "moderation_status","worker_account_id","phone","latitude"]) {
      assert.equal(blob.includes(secret),false,secret);
    }
  } finally { f.db.close(); }
});
