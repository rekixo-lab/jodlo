import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { issueSession, sessionHash, findSessionAccount } from "../src/modules/identity/sessions.ts";

const root = "https://jodlo.rekixo.com";
const own = "/api/v1/me/listings";
const publicPath = "/api/v1/listings?categoryId=trade-approved";
const a = "account-cross-a1111", b = "account-cross-b2222";

async function fixture() {
  const { db, adapter } = openLocalDatabase();
  for (const account of [a,b]) {
    await ensureAccount(adapter,account);
    await optInAsWorker(adapter,account);
  }
  db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)")
    .run("trade-approved","test-service","Synthetic service","परीक्षण सेवा");
  const first = (await issueSession(adapter,a))?.accessToken;
  const second = (await issueSession(adapter,a))?.accessToken;
  const other = (await issueSession(adapter,b))?.accessToken;
  assert.ok(first && second && other);
  async function send(path,method="GET",token,body) {
    const response = await worker.fetch(new Request(root+path,{
      method,
      headers:{
        ...(token?{Authorization:"Bearer "+token}:{}),
        ...(body?{"Content-Type":"application/json"}:{}),
      },
      ...(body?{body:JSON.stringify(body)}:{}),
    }),{DB:adapter});
    const json = await response.json();
    assert.equal(response.headers.get("Cache-Control"),"no-store");
    return {status:response.status,json,raw:JSON.stringify(json)};
  }
  const publish = token => send(own,"POST",token,{categoryId:"trade-approved"});
  const owner = token => send(own,"GET",token);
  const visible = () => send(publicPath);
  return {db,adapter,send,publish,owner,visible,first,second,other};
}

test("real bearer HTTP: two same-trade workers never read or unpublish each other's private listing",async()=>{
  const f=await fixture();
  try {
    const ra=await f.publish(f.first), rb=await f.publish(f.other);
    assert.equal(ra.status,200);
    assert.equal(rb.status,200);
    const idA=ra.json.data.listing.id, idB=rb.json.data.listing.id;
    assert.notEqual(idA,idB);
    const ownA=await f.owner(f.first), ownB=await f.owner(f.other);
    assert.deepEqual(ownA.json.data.listings,[{id:idA,categoryId:"trade-approved",visible:true}]);
    assert.deepEqual(ownB.json.data.listings,[{id:idB,categoryId:"trade-approved",visible:true}]);
    const forbidden=await f.send(own+"?id="+idB,"DELETE",f.first);
    assert.equal(forbidden.status,404);
    assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(idB).status,"published");
    const otherCursor=await f.send(own+"?limit=1&after="+idB,"GET",f.first);
    assert.deepEqual(otherCursor.json.data,{listings:[],nextCursor:null});
    assert.equal(otherCursor.raw.includes(b),false);
    const publicRows=(await f.visible()).json.data.listings;
    assert.deepEqual(new Set(publicRows.map(row=>row.id)),new Set([idA,idB]));
    for(const response of [ownA,ownB,otherCursor,await f.visible()]) {
      for(const privateValue of [a,b,f.first,f.second,f.other,"worker_account_id","moderation_status"]) {
        assert.equal(response.raw.includes(privateValue),false,"private value in listing response");
      }
    }
  } finally {f.db.close();}
});

test("real bearer HTTP: logout-all invalidates sibling sessions but never another account",async()=>{
  const f=await fixture();
  try {
    const itemA=(await f.publish(f.first)).json.data.listing.id;
    const itemB=(await f.publish(f.other)).json.data.listing.id;
    const loggedOut=await f.send("/api/v1/auth/logout-all","POST",f.first);
    assert.deepEqual(loggedOut.json.data,{revoked:true,allDevices:true});
    assert.equal(await findSessionAccount(f.adapter,f.first),null);
    assert.equal(await findSessionAccount(f.adapter,f.second),null);
    assert.equal(await findSessionAccount(f.adapter,f.other),b);
    assert.equal((await f.owner(f.second)).status,401);
    assert.equal((await f.send("/api/v1/me/worker-profile","GET",f.first)).status,401);
    assert.equal((await f.publish(f.second)).status,401);
    assert.equal((await f.send(own+"?id="+itemA,"DELETE",f.second)).status,401);
    assert.equal((await f.send("/api/v1/auth/logout-all","POST",f.second)).status,401);
    assert.equal((await f.owner(f.other)).status,200);
    assert.equal((await f.send(own+"?id="+itemB,"DELETE",f.other)).status,200);
    assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(itemA).status,"published");
    assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(itemB).status,"unpublished");
  } finally {f.db.close();}
});

test("real bearer HTTP: account disable blocks reads and writes after token issuance and hides only that worker",async()=>{
  const f=await fixture();
  try {
    const idA=(await f.publish(f.first)).json.data.listing.id;
    const idB=(await f.publish(f.other)).json.data.listing.id;
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(a);
    assert.equal((await f.owner(f.first)).status,401);
    assert.equal((await f.owner(f.second)).status,401);
    assert.equal((await f.send("/api/v1/me/worker-profile","GET",f.first)).status,401);
    assert.equal((await f.publish(f.first)).status,401);
    assert.equal((await f.send(own+"?id="+idA,"DELETE",f.second)).status,401);
    assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(idA).status,"published");
    assert.deepEqual((await f.visible()).json.data.listings,[{id:idB,categoryId:"trade-approved"}]);
    assert.deepEqual((await f.owner(f.other)).json.data.listings,
      [{id:idB,categoryId:"trade-approved",visible:true}]);
  } finally {f.db.close();}
});

test("real bearer HTTP: expired owner token cannot write or inspect; another account keeps access",async()=>{
  const f=await fixture();
  try {
    const idA=(await f.publish(f.first)).json.data.listing.id;
    const idB=(await f.publish(f.other)).json.data.listing.id;
    f.db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?")
      .run(await sessionHash(f.first));
    assert.equal((await f.owner(f.first)).status,401);
    assert.equal((await f.send(own+"?id="+idB,"DELETE",f.first)).status,401);
    assert.equal((await f.publish(f.first)).status,401);
    assert.equal((await f.owner(f.second)).status,200);
    assert.equal((await f.owner(f.other)).status,200);
    assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(idA).status,"published");
    assert.equal(f.db.prepare("SELECT status FROM worker_listings WHERE id=?").get(idB).status,"published");
  } finally {f.db.close();}
});

test("real bearer HTTP: moderation hides only the targeted worker and prevents self-republication",async()=>{
  const f=await fixture();
  try {
    const idA=(await f.publish(f.first)).json.data.listing.id;
    const idB=(await f.publish(f.other)).json.data.listing.id;
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?").run(idA);
    assert.equal((await f.publish(f.second)).status,403);
    assert.deepEqual((await f.visible()).json.data.listings,[{id:idB,categoryId:"trade-approved"}]);
    assert.deepEqual((await f.owner(f.first)).json.data.listings,
      [{id:idA,categoryId:"trade-approved",visible:false}]);
    assert.deepEqual((await f.owner(f.other)).json.data.listings,
      [{id:idB,categoryId:"trade-approved",visible:true}]);
    assert.equal((await f.send(own+"?id="+idB,"DELETE",f.first)).status,404);
    assert.equal(f.db.prepare("SELECT moderation_status FROM worker_listings WHERE id=?").get(idA).moderation_status,"hidden");
    assert.equal(f.db.prepare("SELECT moderation_status FROM worker_listings WHERE id=?").get(idB).moderation_status,"allowed");
  } finally {f.db.close();}
});
