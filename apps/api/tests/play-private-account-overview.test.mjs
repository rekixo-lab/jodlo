import assert from "node:assert/strict";
import test from "node:test";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession, revokeSession} from "../src/modules/identity/sessions.ts";
import {recordTrustedCallCreditEvent} from "../src/modules/interactions/private-call-credits.ts";
import {priceIndependentPlayCatalog} from "../src/modules/interactions/play-minute-packs.ts";
import {handleRequest} from "../src/http/router.ts";

const PATH="https://api.jodlo.example/api/v1/me/play-overview";
const ALICE="play-owner-account-a";
const BOB="play-owner-account-b";
const bearer=token=>({Authorization:"Bearer "+token});
const count=(db,table)=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
const gate=adapter=>({DB:adapter,PLAY_ACCOUNT_VIEW_ENABLED:"1",PLAY_CATALOG_ENABLED:"1"});

test("private minute dashboard shows only the active account ledger and one canonical non-purchasable catalog",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-owner-account-a'),('play-owner-account-b')");
    const a=(await issueSession(adapter,ALICE)).accessToken;
    const b=(await issueSession(adapter,BOB)).accessToken;
    const grantedAt = Date.now();
    assert.equal(await recordTrustedCallCreditEvent(adapter,{
      accountId:ALICE,kind:"purchase_grant",sourceKeyHash:"a".repeat(64),
      seconds:20*60,createdAtMs:grantedAt,
    }),"applied","synthetic internal-only test fixture, not an API payment");
    const before={
      events:count(db,"call_credit_events"),
      outbox:count(db,"play_consume_outbox"),
      fences:count(db,"play_revocation_fences"),
    };
    let response=await handleRequest(new Request(PATH,{headers:bearer(a)}),gate(adapter));
    assert.equal(response.status,200);
    assert.equal(response.headers.get("Cache-Control"),"no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"),"nosniff");
    const alice=(await response.json());
    assert.deepEqual(alice,{
      ok:true,data:{
        balance:{availableSeconds:1200,revision:1},
        history:{entries:[{change:"added",seconds:1200,occurredAtMs:grantedAt}],
          hasMore:false},
        holds:{entries:[],hasMore:false},
        catalog:priceIndependentPlayCatalog(),
      },
    });
    assert.equal(alice.data.catalog.purchasable,false);
    assert.equal(alice.data.catalog.priceSource,"google_play");
    const serialized=JSON.stringify(alice);
    for(const secret of [ALICE,BOB,a,b,"purchaseToken","orderId","priceInr","pricePaise",
      "Razorpay","email","checkoutUrl"])
      assert.ok(!serialized.includes(secret),"preview must not disclose "+secret.slice(0,12));
    assert.deepEqual(alice.data.catalog.packs.map(p=>p.minutes),
      [5,20,50,100,300,500]);

    response=await handleRequest(new Request(PATH,{headers:bearer(b)}),gate(adapter));
    assert.equal(response.status,200);
    const bob=(await response.json()).data;
    assert.deepEqual(bob.balance,{availableSeconds:0,revision:0},
      "different signed-in account never sees paid seconds");
    assert.deepEqual(bob.history,{entries:[],hasMore:false},
      "different signed-in account never sees another account's activity");
    assert.deepEqual(bob.holds,{entries:[],hasMore:false},
      "other owner never inherits a canceled or voided token-hash fence");
    assert.equal(await revokeSession(adapter,a),true);
    assert.equal((await handleRequest(new Request(PATH,{headers:bearer(a)}),gate(adapter))).status,401);
    assert.deepEqual({
      events:count(db,"call_credit_events"),
      outbox:count(db,"play_consume_outbox"),
      fences:count(db,"play_revocation_fences"),
    },before,"read-only UI cannot mint, consume, revoke or mutate credits");
  }finally{db.close();}
});

test("owner-only dashboard fails closed on all independent feature/session/method/query gates",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-owner-account-a')");
    const token=(await issueSession(adapter,ALICE)).accessToken;
    const current=gate(adapter);
    assert.equal((await handleRequest(new Request(PATH,{headers:bearer(token)}),
      {DB:adapter})).status,404);
    assert.equal((await handleRequest(new Request(PATH,{headers:bearer(token)}),
      {...current,PLAY_ACCOUNT_VIEW_ENABLED:"0"})).status,404);
    assert.equal((await handleRequest(new Request(PATH,{headers:bearer(token)}),
      {...current,PLAY_CATALOG_ENABLED:"0"})).status,503);
    assert.equal((await handleRequest(new Request(PATH,{headers:bearer(token)}),
      {...current,DB:undefined})).status,503);
    assert.equal((await handleRequest(new Request(PATH),current)).status,401);
    assert.equal((await handleRequest(new Request(PATH,{headers:bearer("invalid")}),current)).status,401);
    assert.equal((await handleRequest(new Request(PATH+"?accountId="+ALICE,{
      headers:bearer(token),
    }),current)).status,400);
    assert.equal((await handleRequest(new Request(PATH,{
      method:"GET",headers:bearer(token),body:undefined,
    }),current)).status,200);
    for(const method of ["POST","PUT","PATCH","DELETE"]) {
      const reply=await handleRequest(new Request(PATH,{method,headers:bearer(token)}),current);
      assert.equal(reply.status,405,method);
      assert.equal(reply.headers.get("Allow"),"GET");
    }
    for(const mutation of ["/api/v1/me/play-checkout","/api/v1/me/play-grant",
      "/api/v1/me/play-consume"]) {
      assert.equal((await handleRequest(new Request("https://api.jodlo.example"+mutation,{
        method:"POST",headers:bearer(token),
      }),current)).status,404);
    }
    assert.equal(count(db,"call_credit_events"),0);
    assert.equal(count(db,"play_consume_outbox"),0);
  }finally{db.close();}
});
