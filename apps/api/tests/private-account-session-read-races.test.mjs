import assert from "node:assert/strict";
import test from "node:test";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {handleRequest} from "../src/http/router.ts";
import {
  OWN_SESSION_QUERY, findSessionAccount, issueSession,
  revokeSession, sessionHash,
} from "../src/modules/identity/sessions.ts";
import {recordTrustedCallCreditEvent} from
  "../src/modules/interactions/private-call-credits.ts";

const ROOT="https://api.jodlo.example";
const ALICE="private-race-alice";
const BOB="private-race-bob";
const routes=[
  {name:"own account overview",path:"/api/v1/me/overview",
    capture:query=>query.startsWith("SELECT a.id AS accountId, a.created_at AS createdAt")},
  {name:"own complete data export v1",path:"/api/v1/me/data-export",
    capture:query=>query.startsWith("SELECT overview.*, ")},
  {name:"own detailed data export v2",path:"/api/v1/me/data-export?version=2",
    capture:query=>query.startsWith("SELECT overview.*, ")},
  {name:"own detailed data export v3",path:"/api/v1/me/data-export?version=3",
    capture:query=>query.startsWith("SELECT overview.*, ")},
  {name:"own financial data export v4",path:"/api/v1/me/data-export?version=4",
    capture:query=>query.startsWith("SELECT overview.*, ")},
  {name:"Play balance/activity/refund hold overview",path:"/api/v1/me/play-overview",
    capture:query=>query.includes("LEFT JOIN play_consume_outbox AS o")},
];
const flags=adapter=>({
  DB:adapter, PLAY_CATALOG_ENABLED:"1",PLAY_ACCOUNT_VIEW_ENABLED:"1",
});
const request=(route,token)=>new Request(ROOT+route.path,{
  headers:{Authorization:"Bearer "+token},
});
const count=(db,table)=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
const privateCounts=db=>({
  credits:count(db,"call_credit_events"),
  outbox:count(db,"play_consume_outbox"),
  revocations:count(db,"play_revocation_fences"),
});

/** Simulate D1 obtaining a legitimate old row and async read delivery
 * yielding to a different device's revoke/disable/rebind before response.
 * All writes are local SQLite test-only; the app has no public grant route.
 */
function afterCapturedPrivateRow(adapter,match,mutate) {
  let captured=0;
  return {
    ...adapter,
    get captured(){return captured;},
    prepare(query) {
      const statement=adapter.prepare(query);
      if(!match(query)) return statement;
      const original=statement.all.bind(statement);
      statement.all=async()=>{
        const result=await original();
        if(++captured===1)await mutate();
        return result;
      };
      return statement;
    },
  };
}
async function setup(){
  const {db,adapter}=openLocalDatabase();
  db.exec("INSERT INTO accounts(id) VALUES ('private-race-alice'),('private-race-bob')");
  const alice=(await issueSession(adapter,ALICE)).accessToken;
  const bob=(await issueSession(adapter,BOB)).accessToken;
  assert.equal(await recordTrustedCallCreditEvent(adapter,{
    accountId:ALICE,kind:"purchase_grant",sourceKeyHash:"a".repeat(64),
    seconds:300,createdAtMs:Date.now()-2500,
  }),"applied","synthetic ledger row is not a Play purchase");
  return {db,adapter,alice,bob};
}
async function assertPrivateDenied(response,secret) {
  assert.equal(response.status,401);
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"),"nosniff");
  const text=await response.text();
  assert.match(text,/"UNAUTHORIZED"/);
  for(const forbidden of [ALICE,BOB,secret,"googleSub","accountId",
    "availableSeconds","history","holds","purchase_grant","sourceKeyHash",
    "workerEnabled","createdAt"])
    assert.ok(!text.includes(forbidden),"late private response exposed "+forbidden);
}

test("all 6 private read endpoints deny old snapshots after a second-device logout",async()=>{
  for(const route of routes) {
    const {db,adapter,alice,bob}=await setup();
    try {
      const baseline=privateCounts(db);
      const raced=afterCapturedPrivateRow(adapter,route.capture,async()=>{
        assert.equal(await revokeSession(adapter,alice),true);
      });
      const response=await handleRequest(request(route,alice),flags(raced));
      assert.equal(raced.captured,1,route.name+" must capture old D1 row before logout");
      await assertPrivateDenied(response,alice);
      assert.equal(await findSessionAccount(adapter,bob),BOB,
        "another account's bearer must remain valid");
      assert.deepEqual(privateCounts(db),baseline,
        "private reads never create Play/credit/outbox/refund records");
    }finally{db.close();}
  }
});

test("all private reads suppress previously valid data after account disable",async()=>{
  for(const route of routes){
    const {db,adapter,alice,bob}=await setup();
    try{
      const baseline=privateCounts(db);
      const raced=afterCapturedPrivateRow(adapter,route.capture,()=>{
        db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(ALICE);
      });
      const response=await handleRequest(request(route,alice),flags(raced));
      assert.equal(raced.captured,1,route.name);
      await assertPrivateDenied(response,alice);
      assert.equal(await findSessionAccount(adapter,bob),BOB);
      assert.deepEqual(privateCounts(db),baseline);
    }finally{db.close();}
  }
});

test("all private reads suppress a session that expires between D1 read and reply",async()=>{
  for(const route of routes){
    const {db,adapter,alice}=await setup();
    try{
      const baseline=privateCounts(db);
      const raced=afterCapturedPrivateRow(adapter,route.capture,async()=>{
        db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?")
          .run(await sessionHash(alice));
      });
      const response=await handleRequest(request(route,alice),flags(raced));
      assert.equal(raced.captured,1,route.name);
      await assertPrivateDenied(response,alice);
      assert.deepEqual(privateCounts(db),baseline);
    }finally{db.close();}
  }
});

test("same bearer rebound to another account cannot reveal previous owner data",async()=>{
  for(const route of routes){
    const {db,adapter,alice,bob}=await setup();
    try{
      const baseline=privateCounts(db);
      const raced=afterCapturedPrivateRow(adapter,route.capture,async()=>{
        // Corrupted/admin-rebound session simulation. Real session issuance
        // never reuses a token, but account identity still must be stable.
        db.prepare("UPDATE auth_sessions SET account_id=? WHERE token_hash=?")
          .run(BOB,await sessionHash(alice));
      });
      const response=await handleRequest(request(route,alice),flags(raced));
      assert.equal(raced.captured,1,route.name);
      await assertPrivateDenied(response,alice);
      assert.equal(await findSessionAccount(adapter,bob),BOB);
      assert.deepEqual(privateCounts(db),baseline);
    }finally{db.close();}
  }
});

test("unavailable final owner check fails closed without returning sensitive snapshot",async()=>{
  for(const route of routes){
    const {db,adapter,alice,bob}=await setup();
    try{
      let checks=0;
      const unavailable={
        ...adapter,
        prepare(query) {
          const stmt=adapter.prepare(query);
          if(query===OWN_SESSION_QUERY){
            const read=stmt.all.bind(stmt);
            stmt.all=async()=>{
              if(++checks===2)throw new Error("synthetic D1 final revalidation outage");
              return read();
            };
          }
          return stmt;
        },
      };
      const response=await handleRequest(request(route,alice),flags(unavailable));
      assert.equal(checks,2,route.name);
      assert.equal(response.status,503);
      assert.equal(response.headers.get("Cache-Control"),"no-store");
      const body=await response.text();
      for(const forbidden of [ALICE,BOB,alice,"accountId","availableSeconds",
        "googleSub","identity","services"])
        assert.ok(!body.includes(forbidden),route.name+" leaked "+forbidden);
      assert.equal(await findSessionAccount(adapter,bob),BOB);
    }finally{db.close();}
  }
});

test("valid same-owner responses remain usable, isolated and read-only",async()=>{
  const {db,adapter,alice,bob}=await setup();
  try{
    const baseline=privateCounts(db);
    for(const route of routes){
      const res=await handleRequest(request(route,alice),flags(adapter));
      assert.equal(res.status,200,route.name);
      assert.equal(res.headers.get("Cache-Control"),"no-store");
      const body=await res.json();
      assert.equal(body.ok,true);
      assert.ok(!JSON.stringify(body).includes(bob),route.name);
      if(route.path.includes("play-overview")){
        assert.equal(body.data.balance.availableSeconds,300);
        assert.equal(body.data.history.entries.length,1);
        assert.equal(body.data.catalog.purchasable,false);
      }else if(route.path.includes("data-export")){
        assert.equal(body.data.account.accountId,ALICE);
        assert.equal(body.data.schemaVersion,
          route.path.includes("version=4")?4:route.path.includes("version=3")?3:route.path.includes("version=2")?2:1);
      }else{
        assert.equal(typeof body.data.activeSessions,"number");
        assert.equal(body.data.workerEnabled,false);
      }
      const other=await handleRequest(request(route,bob),flags(adapter));
      assert.equal(other.status,200);
      const otherBody=JSON.stringify(await other.json());
      assert.ok(!otherBody.includes(ALICE),route.name+" must not leak Alice to Bob");
    }
    assert.deepEqual(privateCounts(db),baseline);
  }finally{db.close();}
});
