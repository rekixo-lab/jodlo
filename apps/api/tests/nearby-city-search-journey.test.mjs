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

    // The new opt-in city Search returns ONLY trades with currently public,
    // Worker-declared city Listings. Global legacy Category search still
    // works independently and must not fabricate city availability.
    const citySearch=await f.send("catalog/search?lang=hi&q="+
      encodeURIComponent("प्लंबिंग")+"&cursor=1&limit=20&availableOnly=1&city=raipur");
    assert.equal(citySearch.status,200);
    assert.deepEqual(citySearch.payload.data.categories,[category]);
    const noCityElectric=await f.send(
      "catalog/search?lang=en&q=Electrician&cursor=1&availableOnly=1&city=bilaspur");
    assert.deepEqual(noCityElectric.payload.data.categories,[]);
    const yesCityElectric=await f.send(
      "catalog/search?lang=en&q=Electrician&cursor=1&availableOnly=1&city=raipur");
    assert.deepEqual(yesCityElectric.payload.data.categories,[
      {id:"cat-electrician",slug:"cat-electrician",name:"Electrician"},
    ]);

    // Full city trade BROWSE no longer requires the Customer to type. Only
    // current approved Categories with published eligible city services appear.
    const firstCityBrowse=await f.send("catalog?lang=hi&availableOnly=1&city=raipur&limit=1");
    assert.equal(firstCityBrowse.status,200);
    assert.deepEqual(firstCityBrowse.payload.data.categories,[category]);
    assert.equal(firstCityBrowse.payload.data.nextCursor,"10:cat-plumber");
    const nextCityBrowse=await f.send("catalog?lang=hi&availableOnly=1&city=raipur&limit=1&after="+
      encodeURIComponent(firstCityBrowse.payload.data.nextCursor));
    assert.deepEqual(nextCityBrowse.payload.data.categories,[
      {id:"cat-electrician",slug:"cat-electrician",name:"इलेक्ट्रीशियन"},
    ]);
    assert.equal(nextCityBrowse.payload.data.nextCursor,null);
    const bilaspurBrowse=await f.send("catalog?lang=hi&availableOnly=1&city=bilaspur&limit=20");
    assert.deepEqual(bilaspurBrowse.payload.data.categories,[category]);
    assert.equal(bilaspurBrowse.payload.data.nextCursor,null);
    // Legacy public catalog remains global, including approved categories
    // without a matching Worker city. City-filtered browse is opt-in only.
    const globalBrowse=await f.send("catalog?lang=hi&availableOnly=1&limit=20");
    assert.equal(globalBrowse.payload.data.categories.length,2);

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
    // A formerly eligible city browse cursor can no longer skip a revoked
    // anchor: the current-city anchor and current city list are rechecked.
    const staleCityBrowse=await f.send("catalog?lang=hi&availableOnly=1&city=raipur&limit=1&after="+
      encodeURIComponent(firstCityBrowse.payload.data.nextCursor));
    assert.deepEqual(staleCityBrowse.payload.data.categories,[]);
    assert.equal(staleCityBrowse.payload.data.nextCursor,null);
    const refreshedCityBrowse=await f.send("catalog?lang=hi&availableOnly=1&city=raipur&limit=20");
    assert.deepEqual(refreshedCityBrowse.payload.data.categories,[
      {id:"cat-electrician",slug:"cat-electrician",name:"इलेक्ट्रीशियन"},
    ]);
    assert.deepEqual((await f.send("catalog/search?lang=hi&q="+
      encodeURIComponent("प्लंबिंग")+"&cursor=1&limit=20&availableOnly=1&city=raipur"))
      .payload.data.categories,[],"removed city Listing must revoke matching Category");
    assert.deepEqual((await f.send("catalog/search?lang=hi&q="+
      encodeURIComponent("प्लंबिंग")+"&cursor=1&limit=20&availableOnly=1&city=bilaspur"))
      .payload.data.categories,[category],"other city remains independent");
    assert.equal((await f.send("catalog/search?lang=en&q=plumb&cursor=1&limit=20&availableOnly=1"))
      .status,200,"other city's eligible Worker still makes Category available globally");

    // Unknown/invalid cities and private account filters fail closed.
    for (const query of [raipurFeed+"&workerId=owner-raipur",
      raipurFeed.replace("raipur","mumbai"),raipurFeed+"&city=bilaspur",
      "catalog/search?lang=en&q=Electrician&cursor=1&city=raipur",
      "catalog/search?lang=en&q=Electrician&availableOnly=1&city=raipur",
      "catalog/search?lang=en&q=Electrician&cursor=1&availableOnly=1&city=mumbai",
      "catalog/search?lang=en&q=Electrician&cursor=1&availableOnly=1&city=raipur&city=bilaspur",
      "catalog/search?lang=en&q=Electrician&cursor=1&availableOnly=1&city=raipur&accountId=private",
      "catalog?lang=hi&city=raipur",
      "catalog?lang=hi&availableOnly=1&city=raipur",
      "catalog?lang=hi&limit=20&city=raipur",
      "catalog?lang=hi&availableOnly=1&limit=20&city=delhi",
      "catalog?lang=hi&availableOnly=1&limit=20&city=raipur&city=bilaspur",
      "catalog?lang=hi&availableOnly=1&limit=20&city=raipur&workerId=private",
    ]) {
      assert.equal((await f.send(query)).status,400,query);
    }
    const blob=JSON.stringify(raipur.payload);
    for(const secret of ["owner-raipur","owner-bilaspur","owner-electric",
      "moderation_status","worker_account_id","phone","latitude"]) {
      assert.equal(blob.includes(secret),false,secret);
    }
  } finally { f.db.close(); }
});


test("City-qualified Category cursor rejects an anchor when its city Listing loses eligibility",async()=>{
  const f=fixture();
  try {
    // Both existing trades intentionally share a user-submitted Search term
    // so a one-item city page has a real second page. No worker metadata is
    // exposed and the city is chosen manually rather than inferred from GPS.
    f.db.prepare("UPDATE categories SET name_en='Repair Plumbing' WHERE id='cat-plumber'").run();
    f.db.prepare("UPDATE categories SET name_en='Repair Electrician' WHERE id='cat-electrician'").run();
    for(const [account,category,city] of owners) {
      const token=(await issueSession(f.adapter,account)).accessToken;
      assert.equal((await f.send("me/worker-profile",{method:"POST",token})).status,200);
      const created=await f.send("me/listings",{method:"POST",token,body:{categoryId:category}});
      assert.equal(created.status,200);
      const id=created.payload.data.listing.id;
      assert.equal((await f.send("me/service-area?id="+id+"&revision=0",{
        method:"PUT",token,body:{city},
      })).status,200);
    }
    const url="catalog/search?lang=en&q=Repair&cursor=1&availableOnly=1&city=raipur&limit=1";
    const first=await f.send(url);
    assert.equal(first.status,200);
    assert.deepEqual(first.payload.data.categories,[
      {id:"cat-plumber",slug:"cat-plumber",name:"Repair Plumbing"},
    ]);
    assert.equal(first.payload.data.nextCursor,"10:cat-plumber");
    const second=await f.send(url+"&after="+encodeURIComponent(first.payload.data.nextCursor));
    assert.deepEqual(second.payload.data.categories,[
      {id:"cat-electrician",slug:"cat-electrician",name:"Repair Electrician"},
    ]);
    const inBilaspur=await f.send(url.replace("city=raipur","city=bilaspur"));
    assert.deepEqual(inBilaspur.payload.data.categories,first.payload.data.categories);
    assert.equal(inBilaspur.payload.data.nextCursor,null);
    // Last allowed city Listing is removed; no stale anchor can authorize
    // skipping ahead to unrelated currently-eligible Category results.
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE category_id='cat-plumber' AND service_city='raipur'").run();
    const stale=await f.send(url+"&after="+encodeURIComponent(first.payload.data.nextCursor));
    assert.equal(stale.status,200);
    assert.deepEqual(stale.payload.data.categories,[]);
    assert.equal(stale.payload.data.nextCursor,null);
    const fresh=await f.send(url);
    assert.deepEqual(fresh.payload.data.categories,[
      {id:"cat-electrician",slug:"cat-electrician",name:"Repair Electrician"},
    ]);
    assert.equal(fresh.payload.data.nextCursor,null);
  }finally{f.db.close();}
});
