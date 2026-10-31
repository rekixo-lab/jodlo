import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../src/index.ts";
import { localD1Adapter, openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { setOwnWorkerAgoraCallPreference } from "../src/modules/workers/agora-call-preference.ts";
import { prepareSyntheticSafetyCheckedAgoraInvite } from
  "../src/modules/interactions/agora-invite-safety.ts";
import { validIdempotencyKey } from "../src/modules/shared/identifiers.ts";

/**
 * OFFLINE, DISPOSABLE two-connection SQLite transaction rehearsal ONLY.
 * The test-created invite and outbox tables are NEVER a production migration,
 * a Cloudflare D1/DO atomicity guarantee, an implemented busy slot, a rate
 * reservation, a provider notification, or an approved retention scheme.
 *
 * This intentionally tests uniqueness per CALL ID only. It DOES NOT decide
 * how many simultaneous calls a worker may receive. Those rules are M-005.
 */
const CALLER="account-agora-atomic-caller1";
const WORKER="account-agora-atomic-worker1";
const OTHER="account-agora-atomic-other01";
const CATEGORY="agora-atomic-test-category";
const NOW=1_800_000_000_000;
const DEADLINE=NOW+30_000;
const CALL_ID="call-agora-atomic-000001";
const KEY="atomic-ring-key-000001";
const KEY_OTHER="atomic-ring-key-000002";
const MIGRATIONS=[
  "0001_public_catalog.sql",
  "0002_shared_accounts_worker_drafts.sql",
  "0003_google_identity_sessions.sql",
  "0004_worker_service_listings.sql",
  "0005_notification_delivery_receipts.sql",
  "0006_notification_dead_letters.sql",
  "0007_worker_agora_call_preferences.sql",
];

async function openTrial() {
  const dir=mkdtempSync(join(tmpdir(),"jodlo-agora-atomic-test-"));
  const filename=join(dir,"local.sqlite");
  const a=new DatabaseSync(filename);
  const b=new DatabaseSync(filename);
  try {
    a.exec("PRAGMA journal_mode=WAL");
    a.exec("PRAGMA foreign_keys=ON");
    b.exec("PRAGMA foreign_keys=ON");
    a.exec("PRAGMA busy_timeout=0");
    b.exec("PRAGMA busy_timeout=0");
    for(const filename of MIGRATIONS) {
      a.exec(readFileSync(new URL("../../../infra/migrations/" +
        filename,import.meta.url),"utf8"));
    }
    a.exec(
      "CREATE TABLE synthetic_voice_invites (" +
      "call_id TEXT PRIMARY KEY, caller_id TEXT NOT NULL, " +
      "worker_id TEXT NOT NULL, listing_id TEXT NOT NULL, " +
      "retry_key TEXT NOT NULL, ring_deadline_ms INTEGER NOT NULL); " +
      "CREATE TABLE synthetic_voice_outbox (" +
      "call_id TEXT PRIMARY KEY REFERENCES synthetic_voice_invites(call_id), " +
      "kind TEXT NOT NULL CHECK(kind='ring_intent_only'));"
    );
    const adapter=localD1Adapter(a);
    for(const id of [CALLER,WORKER,OTHER]) await ensureAccount(adapter,id);
    await optInAsWorker(adapter,WORKER);
    a.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active) " +
      "VALUES(?,?,?,?,1)").run(CATEGORY,CATEGORY,
      "Synthetic Agora atomic test","परीक्षण कॉल");
    const listing=await publishListing(adapter,WORKER,CATEGORY);
    assert.ok(listing);
    const callerBearer=(await issueSession(adapter,CALLER))?.accessToken;
    const workerBearer=(await issueSession(adapter,WORKER))?.accessToken;
    const otherBearer=(await issueSession(adapter,OTHER))?.accessToken;
    assert.ok(callerBearer && workerBearer && otherBearer);
    const risk=(overrides={})=>({
      kind:"synthetic_invite_risk_v1",
      callerAccountId:CALLER,workerAccountId:WORKER,listingId:listing.id,
      checkedAtMs:NOW-1,expiresAtMs:DEADLINE,
      workerPresence:"online",workerAvailability:"available",
      blockedByCaller:false,blockedByWorker:false,
      rateGate:"pass",recipientVerified:true,privacyApproved:true,
      ...overrides,
    });
    return {
      a,b,listing,callerBearer,workerBearer,otherBearer,risk,
      async enable() {return setOwnWorkerAgoraCallPreference(
        localD1Adapter(a),workerBearer,true,0);},
      async disable() {return setOwnWorkerAgoraCallPreference(
        localD1Adapter(a),workerBearer,false,1);},
      close() {
        a.close();b.close();
        rmSync(dir,{recursive:true,force:true});
      },
    };
  }catch(e){
    a.close();b.close();
    rmSync(dir,{recursive:true,force:true});
    throw e;
  }
}

function inviteRows(db) {
  return db.prepare("SELECT * FROM synthetic_voice_invites ORDER BY call_id").all();
}
function outboxRows(db) {
  return db.prepare("SELECT * FROM synthetic_voice_outbox ORDER BY call_id").all();
}

/**
 * Synthetic transactional harness, NOT a real service.
 *
 * The present caller's D1 session and worker's current default-OFF preference
 * are re-read INSIDE the same local SQLite write transaction as the fake
 * invite + outbox. The five non-consent safety facts remain scripted and
 * untrusted in production. There is NO actual provider send or quota claim.
 */
async function stageSyntheticInvite(db,options) {
  const {
    callerBearer,listingId,callId=CALL_ID,retryKey=KEY,
    nowMs=NOW,ringDeadlineMs=DEADLINE,risk,
    failAfterInsert=false,
  }=options;
  if(!validIdempotencyKey(retryKey)) return {kind:"denied"};
  let inTransaction=false;
  try {
    db.exec("BEGIN IMMEDIATE");
    inTransaction=true;
    const candidate=await prepareSyntheticSafetyCheckedAgoraInvite(
      localD1Adapter(db),callerBearer,listingId,
      callId,nowMs,ringDeadlineMs,risk,
    );
    if(candidate.kind!=="prepared") {
      db.exec("ROLLBACK");
      inTransaction=false;
      return {kind:"denied"};
    }

    const call=candidate.call;
    const old=db.prepare("SELECT * FROM synthetic_voice_invites WHERE call_id=?")
      .get(callId);
    if(old){
      const exact=old.caller_id===call.callerAccountId &&
        old.worker_id===call.workerAccountId &&
        old.listing_id===call.listingId &&
        old.retry_key===retryKey &&
        old.ring_deadline_ms===call.ringDeadlineMs;
      db.exec("ROLLBACK");
      inTransaction=false;
      return {kind:exact?"replay_suppressed":"denied"};
    }

    db.prepare(
      "INSERT INTO synthetic_voice_invites VALUES(?,?,?,?,?,?)"
    ).run(callId,call.callerAccountId,call.workerAccountId,
      call.listingId,retryKey,call.ringDeadlineMs);
    if(failAfterInsert) throw Error("synthetic failure before outbox commit");
    db.prepare("INSERT INTO synthetic_voice_outbox VALUES(?,?)")
      .run(callId,"ring_intent_only");
    db.exec("COMMIT");
    inTransaction=false;
    return {kind:"staged_intent_only"};
  }catch(e) {
    if(inTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

const withTrial=async(fn)=>{
  const t=await openTrial();
  try {await fn(t);} finally {t.close();}
};
const args=t=>({
  callerBearer:t.callerBearer,listingId:t.listing.id,risk:t.risk(),
});

test("local transaction stages ONE fake ring/outbox; identical retries cannot resend",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.deepEqual(await stageSyntheticInvite(t.a,args(t)),
      {kind:"staged_intent_only"});
    assert.deepEqual(await stageSyntheticInvite(t.b,args(t)),
      {kind:"replay_suppressed"});
    assert.equal(inviteRows(t.a).length,1);
    assert.equal(outboxRows(t.b).length,1);
    assert.equal(outboxRows(t.a)[0].kind,"ring_intent_only");
    assert.deepEqual(t.a.prepare("PRAGMA foreign_key_check").all(),[]);
    const stored=JSON.stringify([...inviteRows(t.a),...outboxRows(t.a)]);
    assert.equal(stored.includes(t.callerBearer),false);
    assert.equal(stored.includes(t.workerBearer),false);
  });
});

test("same call ID with another retry key or actor cannot overwrite prior intent",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.deepEqual(await stageSyntheticInvite(t.b,{
      ...args(t),retryKey:KEY_OTHER,
    }),{kind:"denied"});
    assert.deepEqual(await stageSyntheticInvite(t.b,{
      ...args(t),callerBearer:t.otherBearer,
    }),{kind:"denied"});
    assert.deepEqual(await stageSyntheticInvite(t.b,{
      ...args(t),risk:t.risk({callerAccountId:OTHER}),
    }),{kind:"denied"});
    assert.equal(inviteRows(t.b).length,1);
    assert.equal(outboxRows(t.b).length,1);
  });
});

test("injected failure before outbox commit rolls back the entire fake admission",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    await assert.rejects(()=>stageSyntheticInvite(t.a,{
      ...args(t),failAfterInsert:true,
    }),/synthetic failure before outbox commit/);
    assert.deepEqual(inviteRows(t.b),[]);
    assert.deepEqual(outboxRows(t.b),[]);
    assert.equal((await stageSyntheticInvite(t.b,args(t))).kind,
      "staged_intent_only");
    assert.equal(inviteRows(t.a).length,1);
    assert.equal(outboxRows(t.a).length,1);
  });
});

test("two independent writers cannot both admit same call while transaction is held",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    t.a.exec("BEGIN IMMEDIATE");
    try{
      await assert.rejects(()=>stageSyntheticInvite(t.b,{
        ...args(t),retryKey:KEY_OTHER,
      }),/database is locked|SQLITE_BUSY/i);
    }finally{t.a.exec("ROLLBACK");}
    assert.deepEqual(inviteRows(t.a),[]);
    assert.equal((await stageSyntheticInvite(t.b,args(t))).kind,
      "staged_intent_only");
    assert.deepEqual(await stageSyntheticInvite(t.a,{
      ...args(t),retryKey:KEY_OTHER,
    }),{kind:"denied"});
    assert.equal(outboxRows(t.a).length,1);
  });
});

test("default OFF and later worker opt-out override old scripted positive evidence",async()=>{
  await withTrial(async t=>{
    const prior=args(t);
    assert.deepEqual(await stageSyntheticInvite(t.a,prior),{kind:"denied"});
    assert.deepEqual(inviteRows(t.a),[]);
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.b,prior)).kind,
      "staged_intent_only");
    assert.equal((await t.disable()).kind,"updated");
    assert.deepEqual(await stageSyntheticInvite(t.a,prior),{kind:"denied"});
    assert.deepEqual(await stageSyntheticInvite(t.a,{
      ...prior,callId:"call-agora-atomic-000002",
    }),{kind:"denied"});
    assert.equal(inviteRows(t.b).length,1,"no new invite after opt-out");
    assert.equal(outboxRows(t.b).length,1,"existing intent is not re-sent");
  });
});

test("stale, blocked, busy and invalid fake evidence cannot create outbox rows",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    const cases=[
      t.risk({workerPresence:"offline"}),
      t.risk({workerAvailability:"busy"}),
      t.risk({blockedByCaller:true}),
      t.risk({blockedByWorker:true}),
      t.risk({rateGate:"deny"}),
      t.risk({rateGate:"unknown"}),
      t.risk({privacyApproved:false}),
      t.risk({checkedAtMs:NOW+1}),
      t.risk({expiresAtMs:NOW}),
    ];
    for(const risk of cases){
      assert.deepEqual(await stageSyntheticInvite(t.a,{
        ...args(t),risk,
      }),{kind:"denied"});
    }
    assert.deepEqual(inviteRows(t.b),[]);
    assert.deepEqual(outboxRows(t.b),[]);
  });
});

test("test-only journal creates no API, production D1 tables, Agora SDK or live call",async()=>{
  const local=openLocalDatabase();
  try{
    const names=local.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table'").all()
      .map(r=>r.name);
    for(const table of ["synthetic_voice_invites","synthetic_voice_outbox",
      "call_sessions","agora_channels","worker_presence","call_history"]){
      assert.equal(names.includes(table),false,table);
    }
    for(const path of ["/api/v1/calls","/api/v1/rtc/token",
      "/api/v1/calls/invite"]){
      const response=await worker.fetch(new Request(
        "https://jodlo.rekixo.com"+path,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({callId:CALL_ID,listingId:"untrusted-listing"}),
        }),{DB:local.adapter});
      assert.equal(response.status,404,path);
    }
  } finally {local.db.close();}
});
