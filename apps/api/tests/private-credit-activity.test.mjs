import assert from "node:assert/strict";
import test from "node:test";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession,revokeSession} from "../src/modules/identity/sessions.ts";
import {readOwnCallCreditBalance,readOwnCallCreditSnapshot,
  recordTrustedCallCreditEvent} from "../src/modules/interactions/private-call-credits.ts";
import {handleRequest} from "../src/http/router.ts";

const PATH="https://api.jodlo.example/api/v1/me/play-overview";
const OWNER="credit-activity-alice";
const OTHER="credit-activity-bob";
const flags=db=>({DB:db,PLAY_ACCOUNT_VIEW_ENABLED:"1",PLAY_CATALOG_ENABLED:"1"});
const auth=token=>({Authorization:"Bearer "+token});
const digest=i=>i.toString(16).padStart(64,"0");
const counts=db=>({
  events:db.prepare("SELECT count(*) AS n FROM call_credit_events").get().n,
  balances:db.prepare("SELECT count(*) AS n FROM call_credit_balances").get().n,
  consume:db.prepare("SELECT count(*) AS n FROM play_consume_outbox").get().n,
  voids:db.prepare("SELECT count(*) AS n FROM play_revocation_fences").get().n,
});

test("one owner-scoped D1 snapshot gives exact descending activity capped at 10 without exposing digests",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('credit-activity-alice'),('credit-activity-bob')");
    const alice=(await issueSession(adapter,OWNER)).accessToken;
    const bob=(await issueSession(adapter,OTHER)).accessToken;
    assert.deepEqual(await readOwnCallCreditSnapshot(adapter,alice),{
      availableSeconds:0,revision:0,history:{entries:[],hasMore:false},
      holds:{entries:[],hasMore:false},
    });
    const when=Date.now()-25000;
    for(let i=1;i<=13;i++){
      assert.equal(await recordTrustedCallCreditEvent(adapter,{
        accountId:OWNER,kind:"purchase_grant",seconds:300,
        sourceKeyHash:digest(i),createdAtMs:when+i,
      }),"applied");
    }
    // A usage event has a different kind and real-seconds precision. It is
    // an INTERNAL synthetic fixture, not proof of a real provider purchase.
    assert.equal(await recordTrustedCallCreditEvent(adapter,{
      accountId:OWNER,kind:"verified_usage",seconds:17,
      sourceKeyHash:digest(99),createdAtMs:when+99,
    }),"applied");
    const before=counts(db);
    const result=await handleRequest(new Request(PATH,{headers:auth(alice)}),flags(adapter));
    assert.equal(result.status,200);
    assert.equal(result.headers.get("Cache-Control"),"no-store");
    const data=(await result.json()).data;
    assert.deepEqual(data.balance,{availableSeconds:3883,revision:14});
    assert.equal(data.history.entries.length,10);
    assert.equal(data.history.hasMore,true);
    assert.deepEqual(data.holds,{entries:[],hasMore:false},
      "plain credit events are NOT Play purchase holds");
    assert.deepEqual(data.history.entries[0],{
      change:"used",seconds:17,occurredAtMs:when+99,
    });
    assert.deepEqual(data.history.entries[1],{
      change:"added",seconds:300,occurredAtMs:when+13,
    });
    assert.deepEqual(data.history.entries[9],{
      change:"added",seconds:300,occurredAtMs:when+5,
    });
    assert.ok(data.history.entries.every(x=>Object.keys(x).sort().join(",")===
      "change,occurredAtMs,seconds"));
    assert.ok(data.history.entries.every((v,i,a)=>i===0||
      a[i-1].occurredAtMs>=v.occurredAtMs));
    const text=JSON.stringify(data);
    for(const secret of [OWNER,OTHER,alice,bob,digest(1),digest(99),
      "source_key_hash","purchaseToken","orderId","priceInr","account_id",
      "email","razorpay","checkoutUrl"])
      assert.ok(!text.includes(secret),"private credit audit leaked "+secret.slice(0,12));
    assert.deepEqual(await readOwnCallCreditBalance(adapter,alice),
      {availableSeconds:3883,revision:14});
    const other=await handleRequest(new Request(PATH,{headers:auth(bob)}),flags(adapter));
    assert.equal(other.status,200);
    assert.deepEqual((await other.json()).data.history,{entries:[],hasMore:false});
    assert.deepEqual((await (await handleRequest(new Request(PATH,{
      headers:auth(bob)}),flags(adapter))).json()).data.holds,
      {entries:[],hasMore:false});
    assert.deepEqual(counts(db),before,"GET must never edit private D1 ledger");
    assert.equal(await revokeSession(adapter,alice),true);
    assert.equal((await handleRequest(new Request(PATH,{headers:auth(alice)}),
      flags(adapter))).status,401);
  }finally{db.close();}
});

test("read-only private credit activity refuses disabled flags, forbidden methods and foreign identities",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    db.exec("INSERT INTO accounts(id) VALUES ('credit-activity-alice'),('credit-activity-bob')");
    const alice=(await issueSession(adapter,OWNER)).accessToken;
    const bob=(await issueSession(adapter,OTHER)).accessToken;
    assert.equal(await recordTrustedCallCreditEvent(adapter,{
      accountId:OTHER,kind:"purchase_grant",seconds:600,
      sourceKeyHash:digest(77),createdAtMs:Date.now(),
    }),"applied");
    const before=counts(db);
    const without=await handleRequest(new Request(PATH,{headers:auth(alice)}),
      {DB:adapter});
    assert.equal(without.status,404);
    assert.equal((await handleRequest(new Request(PATH,{headers:auth(alice)}),
      {...flags(adapter),PLAY_CATALOG_ENABLED:"0"})).status,503);
    for(const p of ["?accountId="+OTHER,"?after=0","?includeTokens=1"]){
      assert.equal((await handleRequest(new Request(PATH+p,{headers:auth(alice)}),
        flags(adapter))).status,400);
    }
    for(const method of ["POST","PATCH","PUT","DELETE"]) {
      const response=await handleRequest(new Request(PATH,{
        method,headers:auth(alice),body:JSON.stringify({kind:"purchase_grant",
          source_key_hash:digest(88),seconds:600,accountId:OTHER}),
      }),flags(adapter));
      assert.equal(response.status,405,method);
    }
    assert.equal((await handleRequest(new Request(PATH,{headers:auth("invalid")}),
      flags(adapter))).status,401);
    assert.equal((await handleRequest(new Request(PATH,{headers:auth(bob)}),
      flags(adapter))).status,200);
    assert.deepEqual((await (await handleRequest(new Request(PATH,{
      headers:auth(alice)}),flags(adapter))).json()).data.history,
      {entries:[],hasMore:false},"other account's 600 seconds must not appear");
    assert.equal(await readOwnCallCreditSnapshot(adapter,"invalid"),null);
    assert.deepEqual(counts(db),before);
  }finally{db.close();}
});
