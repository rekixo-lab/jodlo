import assert from "node:assert/strict";
import test from "node:test";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession,revokeSession} from "../src/modules/identity/sessions.ts";
import {stageTrustedPlayConsumable,holdVoidedPlayConsume} from
  "../src/modules/interactions/play-consumable-outbox.ts";
import {recordTrustedPlayRevocation} from
  "../src/modules/interactions/google-play-rtdn-fences.ts";
import {readOwnCallCreditSnapshot} from
  "../src/modules/interactions/private-call-credits.ts";
import {handleRequest} from "../src/http/router.ts";

const PATH="https://api.jodlo.example/api/v1/me/play-overview";
const ALICE="play-hold-owner-alice";
const BOB="play-hold-owner-bob";
const EMPTY="play-hold-owner-empty";
const productId="jodlo.minutes5";
const approved=new Map([[productId,5]]);
const id=i=>i.toString(16).padStart(64,"0");
const bearer=t=>({Authorization:"Bearer "+t});
const gate=db=>({DB:db,PLAY_ACCOUNT_VIEW_ENABLED:"1",PLAY_CATALOG_ENABLED:"1"});
const count=(db,name)=>db.prepare("SELECT COUNT(*) AS n FROM "+name).get().n;
const state=(db,hash)=>db.prepare(
  "SELECT status FROM play_consume_outbox WHERE source_key_hash=?").get(hash)?.status;
const summary=db=>({
  ledger:count(db,"call_credit_events"),balances:count(db,"call_credit_balances"),
  outbox:count(db,"play_consume_outbox"),fences:count(db,"play_revocation_fences"),
});

async function stage(db,accountId,number,when){
  return stageTrustedPlayConsumable(db,{
    accountId,sourceKeyHash:id(number),productId,seconds:300,createdAtMs:when,
  },approved);
}

test("only owner-linked frozen Play outbox becomes a private, bounded hold status; refund never debits credit",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-hold-owner-alice'),"+
      "('play-hold-owner-bob'),('play-hold-owner-empty')");
    const alice=(await issueSession(adapter,ALICE)).accessToken;
    const bob=(await issueSession(adapter,BOB)).accessToken;
    const empty=(await issueSession(adapter,EMPTY)).accessToken;
    const start=Date.now()-30000;

    // Seven internal-only synthetic credits, five displayed latest. These
    // are NOT Google purchases or permission to deploy real settlement.
    for(let i=1;i<=7;i++)assert.equal(
      await stage(adapter,ALICE,i,start+i),"applied");
    for(let i=1;i<=7;i++){
      if(i%3===1){
        assert.equal(await holdVoidedPlayConsume(
          adapter,ALICE,id(i),start+20000+i),true);
      }else{
        assert.equal(await recordTrustedPlayRevocation(adapter,{
          sourceKeyHash:id(i),
          reason:i%3===2?"voided_purchase":"one_time_canceled",
          recordedAtMs:start+20000+i,
        }),"applied");
      }
      assert.equal(state(db,id(i)),"void_hold");
    }

    // A global token-hash tombstone has NO owner and may never appear in
    // Alice's, Bob's or Empty account's purchase-hold preview.
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:id(100),reason:"voided_purchase",
      recordedAtMs:start+15000,
    }),"applied");
    assert.equal(await stage(adapter,BOB,50,start+50),"applied");
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:id(50),reason:"one_time_canceled",
      recordedAtMs:start+20050,
    }),"applied");
    const before=summary(db);
    const ownResponse=await handleRequest(new Request(PATH,{headers:bearer(alice)}),
      gate(adapter));
    assert.equal(ownResponse.status,200);
    assert.equal(ownResponse.headers.get("Cache-Control"),"no-store");
    const own=(await ownResponse.json()).data;
    assert.deepEqual(own.balance,{availableSeconds:2100,revision:7},
      "a hold does not invent a refund debit or erase already spent credit");
    assert.deepEqual(own.holds,{
      entries:[
        {minutes:5,state:"review",recordedAtMs:start+20007},
        {minutes:5,state:"canceled",recordedAtMs:start+20006},
        {minutes:5,state:"voided",recordedAtMs:start+20005},
        {minutes:5,state:"review",recordedAtMs:start+20004},
        {minutes:5,state:"canceled",recordedAtMs:start+20003},
      ],hasMore:true,
    });
    assert.equal(own.holds.entries.length,5);
    assert.deepEqual(Object.keys(own.holds.entries[0]).sort(),
      ["minutes","recordedAtMs","state"]);
    const serialized=JSON.stringify(own);
    for(const secret of [ALICE,BOB,EMPTY,alice,bob,id(1),id(50),id(100),
      "sourceKeyHash","source_key_hash","accountId","account_id",
      "purchaseToken","orderId","receipt","priceInr","pricePaise","paidAmount"])
      assert.ok(!serialized.includes(secret),
        "owner-only read must not disclose "+secret.slice(0,12));

    const bobResponse=await handleRequest(new Request(PATH,{headers:bearer(bob)}),
      gate(adapter));
    assert.equal(bobResponse.status,200);
    const other=(await bobResponse.json()).data;
    assert.deepEqual(other.balance,{availableSeconds:300,revision:1});
    assert.deepEqual(other.holds,{
      entries:[{minutes:5,state:"canceled",recordedAtMs:start+20050}],
      hasMore:false,
    });
    const emptyResponse=await handleRequest(new Request(PATH,{headers:bearer(empty)}),
      gate(adapter));
    assert.equal(emptyResponse.status,200);
    assert.deepEqual((await emptyResponse.json()).data.holds,
      {entries:[],hasMore:false});
    assert.deepEqual(summary(db),before,
      "all customer holds are READ-ONLY; no ack, consume, refund, or grant");
    assert.equal(await revokeSession(adapter,alice),true);
    assert.equal((await handleRequest(new Request(PATH,{headers:bearer(alice)}),
      gate(adapter))).status,401);
  }finally{db.close();}
});

test("unrelated token fences and direct local credit events cannot invent purchase holds",async()=>{
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('play-hold-owner-alice'),"+
      "('play-hold-owner-bob')");
    const alice=(await issueSession(adapter,ALICE)).accessToken;
    const before=await readOwnCallCreditSnapshot(adapter,alice);
    assert.deepEqual(before?.holds,{entries:[],hasMore:false});
    assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:id(120),reason:"voided_purchase",
      recordedAtMs:Date.now()-1000,
    }),"applied");
    assert.deepEqual((await readOwnCallCreditSnapshot(adapter,alice))?.holds,
      {entries:[],hasMore:false},"anonymous hash cannot be attached to Alice");
    assert.equal((await handleRequest(new Request(PATH,{headers:bearer(alice)}),
      {DB:adapter})).status,404,"default OFF");
    assert.equal((await handleRequest(new Request(PATH,{headers:bearer(alice)}),
      {...gate(adapter),PLAY_CATALOG_ENABLED:"0"})).status,503);
    assert.equal((await handleRequest(new Request(PATH+"?accountId="+BOB,{
      headers:bearer(alice)}),gate(adapter))).status,400);
    for(const method of ["POST","PUT","DELETE","PATCH"]){
      const reply=await handleRequest(new Request(PATH,{
        method,headers:bearer(alice),body:'{"status":"void_hold"}',
      }),gate(adapter));
      assert.equal(reply.status,405,method);
    }
    assert.deepEqual((await readOwnCallCreditSnapshot(adapter,alice))?.holds,
      {entries:[],hasMore:false});
    assert.equal(count(db,"play_consume_outbox"),0);
    assert.equal(count(db,"call_credit_events"),0);
  }finally{db.close();}
});
