import assert from "node:assert/strict";
import test from "node:test";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession, revokeSession} from "../src/modules/identity/sessions.ts";
import {
  JODLO_PLAY_MINUTE_PACKS, jodloPlayMinuteProductMap,
  priceIndependentPlayCatalog,
} from "../src/modules/interactions/play-minute-packs.ts";
import {handleRequest} from "../src/http/router.ts";

const ENDPOINT = "https://api.jodlo.example/api/v1/me/play-packs";
const account="play-pack-owner";
const bearer = token => ({Authorization:"Bearer "+token});
const count=(db, table)=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;

test("single price-independent Play catalog reuses the existing Finworkar minute quantities",()=>{
  const minutes=[5,20,50,100,300,500];
  assert.deepEqual(JODLO_PLAY_MINUTE_PACKS.map(x=>x.minutes),minutes);
  assert.deepEqual(JODLO_PLAY_MINUTE_PACKS.map(x=>x.productId),
    minutes.map(m=>"jodlo.minutes"+m));
  assert.deepEqual([...jodloPlayMinuteProductMap().entries()],
    JODLO_PLAY_MINUTE_PACKS.map(p=>[p.productId,p.minutes]));
  assert.deepEqual(priceIndependentPlayCatalog(),{
    packs:JODLO_PLAY_MINUTE_PACKS,priceSource:"google_play",purchasable:false,
  });
  const raw=JSON.stringify(priceIndependentPlayCatalog());
  for(const forbidden of ["amount","priceInr","pricePaise","razorpay","wallet",
    "cash","token","purchaseToken","orderId","checkout","discount"]) {
    assert.equal(raw.toLowerCase().includes(forbidden.toLowerCase()),false,
      "read-only catalog must not fabricate payment or reveal credentials");
  }
});

test("pack preview is off by default and signed-in GET only when explicitly enabled",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    db.exec("INSERT INTO accounts(id) VALUES ('play-pack-owner')");
    const session=(await issueSession(adapter,account)).accessToken;
    let response=await handleRequest(new Request(ENDPOINT,{
      method:"GET",headers:bearer(session),
    }),{DB:adapter});
    assert.equal(response.status,404,"no Play catalog in normal configuration");
    assert.equal(count(db,"call_credit_events"),0);
    const live={DB:adapter,PLAY_CATALOG_ENABLED:"1"};

    for(const [method,expected] of [["POST",405],["PUT",405],["DELETE",405]]) {
      response=await handleRequest(new Request(ENDPOINT,{method,headers:bearer(session)}),live);
      assert.equal(response.status,expected);
    }
    response=await handleRequest(new Request(ENDPOINT+"?price=5",{
      headers:bearer(session),
    }),live);
    assert.equal(response.status,400,"no user-injected prices or product IDs");

    for(const authorization of [{}, {Authorization:"Bearer invalid"},
      {Authorization:"Bearer "+"x".repeat(43)}]) {
      response=await handleRequest(new Request(ENDPOINT,{headers:authorization}),live);
      assert.equal(response.status,401,"no anonymous, malformed or forged session");
    }

    response=await handleRequest(new Request(ENDPOINT,{headers:bearer(session)}),
      {PLAY_CATALOG_ENABLED:"1"});
    assert.equal(response.status,503,"cannot skip account check when DB is missing");

    response=await handleRequest(new Request(ENDPOINT,{headers:bearer(session)}),live);
    assert.equal(response.status,200);
    assert.equal(response.headers.get("Cache-Control"),"no-store");
    assert.deepEqual(await response.json(),{ok:true,data:priceIndependentPlayCatalog()});
    assert.equal(count(db,"call_credit_events"),0);
    assert.equal(count(db,"play_consume_outbox"),0);
    assert.equal(count(db,"play_revocation_fences"),0);
    assert.equal(await revokeSession(adapter,session),true);
    response=await handleRequest(new Request(ENDPOINT,{headers:bearer(session)}),live);
    assert.equal(response.status,401,"logout must cut off even the preview catalog");
  }finally{db.close();}
});

test("no preview flag activates a live checkout, purchase submission or any credit",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-pack-owner')");
    const session=(await issueSession(adapter,account)).accessToken;
    const config={DB:adapter,PLAY_CATALOG_ENABLED:"1"};
    for(const route of ["/api/v1/me/play-purchase","/api/v1/me/billing",
      "/api/v1/me/play-consume","/api/v1/me/credit-grant"]) {
      const response=await handleRequest(new Request("https://api.jodlo.example"+route,{
        method:"POST",headers:bearer(session),
      }),config);
      assert.equal(response.status,404,"catalog preview never opens money path: "+route);
    }
    assert.equal(count(db,"call_credit_events"),0);
    assert.equal(count(db,"play_consume_outbox"),0);
  }finally{db.close();}
});
