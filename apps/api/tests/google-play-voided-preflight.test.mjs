import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectJodloPlayPurchaseWithVoids, PLAY_VOIDED_SAFE_WINDOW_MS,
} from "../src/modules/interactions/google-play-voided-preflight.ts";
import { jodloPlayAccountBinding } from "../src/modules/interactions/google-play-purchase-preflight.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { readOwnCallCreditBalance } from "../src/modules/interactions/private-call-credits.ts";

const NOW = 1794390000000;
const TOKEN = "synthetic.jodlo.purchase.token.001";
const ACCOUNT = "voided-test-alice";
const OTHER = "voided-test-other";
const PRODUCTS = new Map([["jodlo.synthetic5", 5]]);
const json = value => new Response(JSON.stringify(value), {
  status:200, headers:{"Content-Type":"application/json"},
});
const voided = (token=TOKEN) => ({
  kind:"androidpublisher#voidedPurchase",
  purchaseToken:token, orderId:"GPA.1234-5678-9012-34567",
  voidedTimeMillis:String(NOW-10_000),voidedQuantity:1,
});

async function purchase(purchasedAtMs=NOW-120_000) {
  return {
    kind:"androidpublisher#productPurchaseV2",
    obfuscatedExternalAccountId:await jodloPlayAccountBinding(ACCOUNT),
    purchaseStateContext:{purchaseState:"PURCHASED"},
    purchaseCompletionTime:new Date(purchasedAtMs).toISOString(),
    orderId:"GPA.1234-5678-9012-34567",
    acknowledgementState:"ACKNOWLEDGEMENT_STATE_PENDING",
    productLineItem:[{
      productId:"jodlo.synthetic5",
      productOfferDetails:{
        quantity:1,refundableQuantity:1,
        consumptionState:"CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
      },
    }],
  };
}

function harness(v2, voidHandler, extras={}) {
  const calls=[];
  const deps={
    approvedProducts:PRODUCTS,
    now:()=>NOW,
    accessToken:async()=>"synthetic-oauth-access",
    request:async(url, init)=>{
      calls.push({url,init});
      if (url.includes("/productsv2/tokens/")) return json(v2);
      return voidHandler(new URL(url),init);
    },
    ...extras,
  };
  return {calls,deps};
}

test("Play screening exhausts voided pagination without credit, checkout or data disclosure", async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('voided-test-alice'),('voided-test-other')");
    const bearer=(await issueSession(adapter,ACCOUNT)).accessToken;
    const h=harness(await purchase(),url=>{
      return json(url.searchParams.has("pageSelection.token")
        ? {voidedPurchases:[],tokenPagination:{}}
        : {voidedPurchases:[voided("unrelated-token")],
          tokenPagination:{nextPageToken:"synthetic-cursor-1"}});
    });
    const result=await inspectJodloPlayPurchaseWithVoids(ACCOUNT,TOKEN,h.deps);
    assert.equal(result.kind,"screened_candidate");
    assert.equal(result.productId,"jodlo.synthetic5");
    assert.equal(result.seconds,300);
    assert.match(result.sourceKeyHash,/^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(result).includes(TOKEN),false);
    assert.equal(JSON.stringify(result).includes("GPA."),false);
    assert.equal(h.calls.length,3,"1 product GET plus all 2 void pages");
    for(const call of h.calls) {
      assert.equal(call.init.method,"GET");
      assert.equal(call.init.body,undefined);
      assert.equal(call.init.headers.Authorization,"Bearer synthetic-oauth-access");
      assert.equal(new URL(call.url).hostname,"androidpublisher.googleapis.com");
    }
    const first=new URL(h.calls[1].url);
    const second=new URL(h.calls[2].url);
    assert.equal(first.pathname,
      "/androidpublisher/v3/applications/com.rekixo.jodlo/purchases/voidedpurchases");
    assert.equal(first.searchParams.get("type"),"0");
    assert.equal(first.searchParams.get("includeQuantityBasedPartialRefund"),"true");
    assert.equal(first.searchParams.get("pageSelection.maxResults"),"200");
    assert.equal(first.searchParams.get("startTime"),String(NOW-PLAY_VOIDED_SAFE_WINDOW_MS));
    assert.equal(first.searchParams.get("endTime"),String(NOW));
    assert.equal(first.searchParams.get("pageSelection.token"),null);
    assert.equal(second.searchParams.get("pageSelection.token"),"synthetic-cursor-1");
    assert.equal(second.searchParams.get("startTime"),null,
      "pagination must use Google's continuation instead of recomputing window");

    assert.equal((await inspectJodloPlayPurchaseWithVoids(OTHER,TOKEN,h.deps)).kind,
      "not_eligible","another JODLO account cannot claim this token");
    assert.equal(h.calls.length,4,"foreign account fails before void list");
    assert.deepEqual(await readOwnCallCreditBalance(adapter,bearer,NOW),
      {availableSeconds:0,revision:0});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM call_credit_events").get().n,0,
      "even a fully screened result cannot credit the ledger");
    const {handleRequest}=await import("../src/http/router.ts");
    const response=await handleRequest(new Request(
      "https://example.invalid/api/v1/me/voided-purchases",{
        method:"POST",headers:{Authorization:"Bearer "+bearer},
      }),{DB:adapter});
    assert.equal(response.status,404,"no user-triggered billing endpoint");
  } finally {db.close();}
});

test("known void/chargeback/partial refund blocks before further pages",async()=>{
  for(const entryPage of [0,1]) {
    let pages=0;
    const h=harness(await purchase(),url=>{
      const page=pages++;
      return json(page===entryPage
        ? {voidedPurchases:[voided()],tokenPagination:{nextPageToken:"unused-cursor"}}
        : {voidedPurchases:[voided("unrelated")],
          tokenPagination:{nextPageToken:"next-cursor"}});
    });
    const res=await inspectJodloPlayPurchaseWithVoids(ACCOUNT,TOKEN,h.deps);
    assert.deepEqual(res,{kind:"not_eligible"});
    assert.equal(pages,entryPage+1,"positive void record is enough to refuse");
    assert.equal(res.sourceKeyHash,undefined);
  }
});

test("older than safe 29-day purchase cannot be cleared by 30-day Google history",async()=>{
  for(const age of [PLAY_VOIDED_SAFE_WINDOW_MS+1,
    31*24*60*60*1000,90*24*60*60*1000]) {
    const h=harness(await purchase(NOW-age),()=>json({voidedPurchases:[]}));
    assert.deepEqual(await inspectJodloPlayPurchaseWithVoids(ACCOUNT,TOKEN,h.deps),
      {kind:"unavailable"});
    assert.equal(h.calls.length,1,"must not mistake an incomplete historic window for clean");
  }
  const exactly=harness(await purchase(NOW-PLAY_VOIDED_SAFE_WINDOW_MS),
    ()=>json({voidedPurchases:[]}));
  assert.equal((await inspectJodloPlayPurchaseWithVoids(ACCOUNT,TOKEN,exactly.deps)).kind,
    "screened_candidate");
});

test("incomplete/malformed/failed/oversized voided pages never clear a purchase",async()=>{
  const v2=await purchase();
  const cases=[
    () => new Response("{}",{status:403}),
    () => new Response("{}",{status:429}),
    () => new Response("{}",{status:500}),
    () => new Response("{broken",{status:200}),
    () => new Response("x".repeat(130000),{status:200}),
    () => new Response("{}",{status:200,headers:{"Content-Length":"99999999"}}),
    () => json({voidedPurchases:"not-array"}),
    () => json({voidedPurchases:[{kind:"androidpublisher#voidedPurchase"}]}),
    () => json({voidedPurchases:[{purchaseToken:"unrelated"}]}),
    () => json({voidedPurchases:[],tokenPagination:{nextPageToken:"bad cursor spaces"}}),
    () => json({voidedPurchases:[],tokenPagination:"not-an-object"}),
    () => json({voidedPurchases:[],pageInfo:{totalResults:15}}),
    () => json({voidedPurchases:[voided("unrelated")],pageInfo:{totalResults:10}}),
    () => json({voidedPurchases:[voided("unrelated")],pageInfo:{totalResults:"not-a-number"}}),
    () => json({voidedPurchases:Array.from({length:201},()=>voided("unrelated"))}),
  ];
  for(const reply of cases) {
    const h=harness(v2,reply);
    assert.deepEqual(await inspectJodloPlayPurchaseWithVoids(ACCOUNT,TOKEN,h.deps),
      {kind:"unavailable"});
    assert.equal(h.calls.length,2);
  }
  const repeated=harness(v2,()=>json({voidedPurchases:[],
    tokenPagination:{nextPageToken:"same-page"}}));
  assert.equal((await inspectJodloPlayPurchaseWithVoids(ACCOUNT,TOKEN,repeated.deps)).kind,
    "unavailable","repeating a page is not full reconciliation");
  assert.equal(repeated.calls.length,3);
  let count=0;
  const overLimit=harness(v2,()=>json({voidedPurchases:[voided("unrelated")],
    tokenPagination:{nextPageToken:"page-"+(++count)}}));
  assert.equal((await inspectJodloPlayPurchaseWithVoids(ACCOUNT,TOKEN,overLimit.deps)).kind,
    "unavailable","page-count budget must fail closed");
  assert.equal(overLimit.calls.length,9,"one V2 GET and 8 voided pages");
});

test("voided OAuth/provider/body stalls honor a short per-stage deadline",async()=>{
  const v2=await purchase();
  for(const step of ["oauth","request","body"]) {
    const pending=new Promise(()=>{});
    let authCalls=0;
    const h=harness(v2,()=>step==="request"?pending:
      step==="body" ? new Response(new ReadableStream({start(){}})) :
      json({voidedPurchases:[]}),{
      timeoutMs:80,
      accessToken:async()=>{
        authCalls++;
        return step==="oauth"&&authCalls===2 ? pending : "synthetic-oauth-access";
      },
    });
    const started=performance.now();
    assert.deepEqual(await inspectJodloPlayPurchaseWithVoids(ACCOUNT,TOKEN,h.deps),
      {kind:"unavailable"},step);
    assert.ok(performance.now()-started<2000,step+" must not stall the billing backend");
  }
});
