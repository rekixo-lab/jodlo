import assert from "node:assert/strict";
import test from "node:test";
import {
  scanJodloPlayVoidedPurchases, MAX_PLAY_VOIDED_PAGES,
} from "../src/modules/interactions/play-voided-purchase-scan.ts";

const TOKEN = "synthetic.jodlo.voided.shared.token.0001";
const OTHER = "synthetic.jodlo.voided.other.token.0002";
const NOW = 1795400000000;
const START = NOW - 24 * 60 * 60 * 1000;
const row = purchaseToken => ({
  kind: "androidpublisher#voidedPurchase", purchaseToken,
});

test("both Play callers share exactly one bounded, cursor-safe refund scan", async () => {
  const urls = [];
  const result = await scanJodloPlayVoidedPurchases(TOKEN,START,NOW,async u => {
    const url = new URL(u);
    urls.push(url);
    return urls.length === 1
      ? {voidedPurchases:[row(OTHER)],
          tokenPagination:{nextPageToken:"page-2"}}
      : {voidedPurchases:[row(TOKEN)]};
  });
  assert.equal(result,"matched");
  assert.equal(urls.length,2);
  for(const url of urls) {
    assert.equal(url.origin,"https://androidpublisher.googleapis.com");
    assert.equal(url.pathname,
      "/androidpublisher/v3/applications/com.rekixo.jodlo/purchases/voidedpurchases");
    assert.equal(url.searchParams.get("type"),"0");
    assert.equal(url.searchParams.get("includeQuantityBasedPartialRefund"),"true");
    assert.equal(url.searchParams.get("pageSelection.maxResults"),"200");
  }
  assert.equal(urls[0].searchParams.get("startTime"),String(START));
  assert.equal(urls[0].searchParams.get("endTime"),String(NOW));
  assert.equal(urls[1].searchParams.get("startTime"),null);
  assert.equal(urls[1].searchParams.get("endTime"),null);
  assert.equal(urls[1].searchParams.get("pageSelection.token"),"page-2");
});

test("clean recent scan is distinct from matching void and incomplete history",async()=>{
  assert.equal(await scanJodloPlayVoidedPurchases(TOKEN,START,NOW,
    async()=>({voidedPurchases:[row(OTHER)]})),"clear");
  assert.equal(await scanJodloPlayVoidedPurchases(TOKEN,START,NOW,
    async()=>({voidedPurchases:[row(TOKEN)]})),"matched");
  let called=0;
  assert.equal(await scanJodloPlayVoidedPurchases("invalid",START,NOW,
    async()=>{called++;return {}; }),"incomplete");
  assert.equal(called,0,"invalid purchase token causes no provider call");
  assert.equal(await scanJodloPlayVoidedPurchases(TOKEN,NOW,NOW,
    async()=>{called++;return {}; }),"incomplete");
  assert.equal(called,0);
});

test("malformed, truncated and contradictory pagination always fails closed",async()=>{
  const invalid=[
    null,[],{voidedPurchases:"wrong"},
    {voidedPurchases:[{}]},
    {voidedPurchases:[row(OTHER)],tokenPagination:null},
    {voidedPurchases:[row(OTHER)],tokenPagination:{nextPageToken:"bad cursor"}},
    {voidedPurchases:[],tokenPagination:{nextPageToken:"more"}},
    {voidedPurchases:[],pageInfo:{totalResults:1}},
    {voidedPurchases:[row(OTHER)],pageInfo:{totalResults:2}},
    {voidedPurchases:[],pageInfo:{totalResults:"1"}},
    {voidedPurchases:[],pageInfo:"not-an-object"},
    {voidedPurchases:Array.from({length:201},()=>row(OTHER))},
  ];
  for(const payload of invalid)
    assert.equal(await scanJodloPlayVoidedPurchases(TOKEN,START,NOW,
      async()=>payload),"incomplete");
  const repeated=await scanJodloPlayVoidedPurchases(TOKEN,START,NOW,
    async()=>({voidedPurchases:[row(OTHER)],
      tokenPagination:{nextPageToken:"repeat"}}));
  assert.equal(repeated,"incomplete");
  let pages=0;
  const tooLong=await scanJodloPlayVoidedPurchases(TOKEN,START,NOW,
    async()=>({voidedPurchases:[row(OTHER)],
      tokenPagination:{nextPageToken:"page-"+(++pages)}}));
  assert.equal(tooLong,"incomplete");
  assert.equal(pages,MAX_PLAY_VOIDED_PAGES);
});
