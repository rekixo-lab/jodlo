import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { issueSession } from "../src/modules/identity/sessions.ts";
import {
  MAX_CREDIT_EVENT_SECONDS, readOwnCallCreditBalance,
  recordTrustedCallCreditEvent,
} from "../src/modules/interactions/private-call-credits.ts";

const hash = (namespace, id) =>
  createHash("sha256").update("jodlo:test:" + namespace + ":" + id).digest("hex");

test("private minute credit journal is owner-scoped, atomic, idempotent and unavailable on HTTP", async () => {
  const {db,adapter} = openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('credit-alice'),('credit-bob'),('credit-disabled')");
    db.exec("UPDATE accounts SET status='disabled' WHERE id='credit-disabled'");
    const aliceBearer = (await issueSession(adapter,"credit-alice")).accessToken;
    const bobBearer = (await issueSession(adapter,"credit-bob")).accessToken;
    const balance = (token) => readOwnCallCreditBalance(adapter,token);
    const event = (accountId,source,kind,seconds) => ({
      accountId,sourceKeyHash:hash(kind,source),kind,seconds,
      createdAtMs:Date.now(),
    });
    assert.deepEqual(await balance(aliceBearer),{availableSeconds:0,revision:0});
    assert.deepEqual(await balance(bobBearer),{availableSeconds:0,revision:0});
    assert.equal(await balance("not-a-session"),null);
    assert.equal(MAX_CREDIT_EVENT_SECONDS,30000);

    const purchase = event("credit-alice","provider-order-1","purchase_grant",5*60);
    const [one,two] = await Promise.all([
      recordTrustedCallCreditEvent(adapter,purchase),
      recordTrustedCallCreditEvent(adapter,purchase),
    ]);
    assert.deepEqual([one,two].sort(),["applied","replay"]);
    assert.deepEqual(await balance(aliceBearer),{availableSeconds:300,revision:1});
    assert.deepEqual(await balance(bobBearer),{availableSeconds:0,revision:0});
    assert.equal(await recordTrustedCallCreditEvent(adapter,{
      ...purchase,accountId:"credit-bob",
    }),"denied","same purchase digest can never fund another account");
    assert.equal(await recordTrustedCallCreditEvent(adapter,{
      ...purchase,seconds:600,
    }),"denied","replay quantity cannot be rewritten");

    const usage=event("credit-alice","verified-media-call-1","verified_usage",122);
    assert.equal(await recordTrustedCallCreditEvent(adapter,usage),"applied");
    assert.equal(await recordTrustedCallCreditEvent(adapter,usage),"replay");
    assert.deepEqual(await balance(aliceBearer),{availableSeconds:178,revision:2});

    const overdraft=event("credit-alice","verified-media-call-2","verified_usage",200);
    await assert.rejects(recordTrustedCallCreditEvent(adapter,overdraft),
      /CHECK constraint failed/);
    assert.deepEqual(await balance(aliceBearer),{availableSeconds:178,revision:2});
    assert.equal(db.prepare("SELECT count(*) AS n FROM call_credit_events WHERE source_key_hash=?")
      .get(overdraft.sourceKeyHash).n,0,"failed usage event rolls back with its balance");
    const validLater=event("credit-alice","verified-media-call-2","verified_usage",100);
    assert.equal(await recordTrustedCallCreditEvent(adapter,validLater),"applied");
    assert.deepEqual(await balance(aliceBearer),{availableSeconds:78,revision:3});
    assert.equal(await recordTrustedCallCreditEvent(adapter,{
      ...validLater,accountId:"credit-bob",
    }),"denied");

    for(const invalid of [
      {...purchase,sourceKeyHash:"raw-payment-token"},
      {...purchase,sourceKeyHash:"F".repeat(64)},
      {...purchase,accountId:"other"},
      {...purchase,seconds:0}, {...purchase,seconds:-1},
      {...purchase,seconds:MAX_CREDIT_EVENT_SECONDS+60},
      {...purchase,seconds:61},
      {...purchase,createdAtMs:0},
      {...purchase,kind:"refund"},
    ]) assert.equal(await recordTrustedCallCreditEvent(adapter,invalid),"denied");

    assert.equal(await recordTrustedCallCreditEvent(adapter,
      event("credit-disabled","disabled-grant","purchase_grant",300)),"denied");
    assert.equal(await recordTrustedCallCreditEvent(adapter,
      event("unknown-account","foreign-grant","purchase_grant",300)),"denied");
    assert.equal(await readOwnCallCreditBalance(adapter,"not-a-real-bearer"),null);

    const {handleRequest} = await import("../src/http/router.ts");
    assert.equal((await handleRequest(new Request(
      "https://example.invalid/api/v1/me/credit-purchase",{
        method:"POST",headers:{Authorization:"Bearer "+aliceBearer},
      }),{DB:adapter})).status,404,"no purchase or credit mutation API");
    assert.equal((await handleRequest(new Request(
      "https://example.invalid/api/v1/me/call-credits",{
        headers:{Authorization:"Bearer "+aliceBearer},
      }),{DB:adapter})).status,404,"private balance read is not yet a released route");

    db.prepare("DELETE FROM accounts WHERE id='credit-alice'").run();
    assert.equal(await balance(aliceBearer),null);
    assert.equal(db.prepare("SELECT count(*) AS n FROM call_credit_events").get().n,0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM call_credit_balances").get().n,0);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  } finally {
    db.close();
  }
});

test("ledger bounds and trigger cannot be bypassed by duplicate/fabricated SQL", async () => {
  const {db,adapter}=openLocalDatabase();
  try {
    db.exec("INSERT INTO accounts(id) VALUES ('credit-owner')");
    const grant=(key,sec)=>recordTrustedCallCreditEvent(adapter,{
      accountId:"credit-owner",sourceKeyHash:hash("grant",key),
      kind:"purchase_grant",seconds:sec,createdAtMs:Date.now(),
    });
    assert.equal(await grant("first",30000),"applied");
    assert.equal(await grant("second",30000),"applied");
    assert.equal(db.prepare("SELECT available_seconds FROM call_credit_balances").get().available_seconds,60000);
    const replay=hash("grant","first");
    assert.throws(()=>db.prepare("INSERT INTO call_credit_events VALUES (?,?,?,?,?,?)")
      .run(crypto.randomUUID(),"credit-owner",replay,"purchase_grant",300,Date.now()),
      /UNIQUE constraint failed/);
    assert.throws(()=>db.prepare("INSERT INTO call_credit_events VALUES (?,?,?,?,?,?)")
      .run(crypto.randomUUID(),"credit-owner","not-a-digest","purchase_grant",300,Date.now()),
      /CHECK constraint failed/);
    assert.throws(()=>db.prepare("INSERT INTO call_credit_events VALUES (?,?,?,?,?,?)")
      .run(crypto.randomUUID(),"credit-owner",hash("usage","too-much"),"verified_usage",30001,Date.now()),
      /CHECK constraint failed/);
    assert.equal(db.prepare("SELECT available_seconds FROM call_credit_balances").get().available_seconds,60000);
  } finally {
    db.close();
  }
});
