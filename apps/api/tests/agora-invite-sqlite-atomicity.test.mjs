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
import { issueSession, revokeSession } from "../src/modules/identity/sessions.ts";
import { setOwnWorkerAgoraCallPreference } from "../src/modules/workers/agora-call-preference.ts";
import { prepareSyntheticSafetyCheckedAgoraInvite } from
  "../src/modules/interactions/agora-invite-safety.ts";
import { validIdempotencyKey, validOpaqueId } from "../src/modules/shared/identifiers.ts";

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
      "retry_key TEXT NOT NULL, ring_deadline_ms INTEGER NOT NULL, " +
      "consent_revision INTEGER NOT NULL CHECK(consent_revision>=1)); " +
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
    const liveConsent=db.prepare(
      "SELECT revision FROM worker_agora_call_preferences " +
      "WHERE account_id=? AND calls_enabled=1"
    ).get(call.workerAccountId);
    if(!liveConsent || !Number.isSafeInteger(liveConsent.revision) ||
        liveConsent.revision < 1) {
      db.exec("ROLLBACK");
      inTransaction=false;
      return {kind:"denied"};
    }
    const old=db.prepare("SELECT * FROM synthetic_voice_invites WHERE call_id=?")
      .get(callId);
    if(old){
      const exact=old.caller_id===call.callerAccountId &&
        old.worker_id===call.workerAccountId &&
        old.listing_id===call.listingId &&
        old.retry_key===retryKey &&
        old.ring_deadline_ms===call.ringDeadlineMs &&
        old.consent_revision===liveConsent.revision;
      db.exec("ROLLBACK");
      inTransaction=false;
      return {kind:exact?"replay_suppressed":"denied"};
    }

    db.prepare(
      "INSERT INTO synthetic_voice_invites VALUES(?,?,?,?,?,?,?)"
    ).run(callId,call.callerAccountId,call.workerAccountId,
      call.listingId,retryKey,call.ringDeadlineMs,liveConsent.revision);
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

/**
 * OFFLINE READ-ONLY PREVIEW for an UNSENT existing test outbox.
 *
 * No provider delivery, device discovery, remote send, or durable production
 * call identity is involved. Re-read current opted-in worker consent AND its
 * version, plus the existing caller-only D1 target/risk guards. The sample
 * caller bearer is an in-memory fixture only, NEVER stored in the outbox;
 * production async deliveries must not demand or persist that bearer.
 *
 * Since no send occurs, this is NOT an atomic dispatch/outbox lease and
 * cannot rule out a mutation between recheck and a future provider send.
 * Real dispatch needs a separate M-003/M-005/M-006-approved design.
 */
async function previewSyntheticUnsentOutbox(db,{
  callerBearer,callId=CALL_ID,nowMs=NOW+100,risk,
}){
  const withheld=Object.freeze({kind:"withheld"});
  if(!validOpaqueId(callId) ||
     !Number.isSafeInteger(nowMs) || nowMs < 0) return withheld;
  try{
    const row=db.prepare(
      "SELECT i.call_id,i.caller_id,i.worker_id,i.listing_id," +
      "i.ring_deadline_ms,i.consent_revision, " +
      "pref.calls_enabled AS consent_on,pref.revision AS current_revision " +
      "FROM synthetic_voice_outbox AS outbox " +
      "JOIN synthetic_voice_invites AS i ON i.call_id=outbox.call_id " +
      "LEFT JOIN worker_agora_call_preferences AS pref " +
      "ON pref.account_id=i.worker_id " +
      "WHERE outbox.call_id=? AND outbox.kind='ring_intent_only'"
    ).get(callId);
    if(!row || row.consent_on!==1 ||
       !Number.isSafeInteger(row.consent_revision) ||
       row.current_revision!==row.consent_revision ||
       nowMs >= row.ring_deadline_ms) return withheld;
    const decision=await prepareSyntheticSafetyCheckedAgoraInvite(
      localD1Adapter(db),callerBearer,row.listing_id,
      row.call_id,nowMs,row.ring_deadline_ms,risk,
    );
    if(decision.kind!=="prepared" ||
       decision.call.callerAccountId!==row.caller_id ||
       decision.call.workerAccountId!==row.worker_id ||
       decision.call.listingId!==row.listing_id) return withheld;
    return Object.freeze({kind:"rechecked_only"});
  }catch{
    return withheld;
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


test("old unsent intent stays withheld after worker OFF then ON (new consent epoch)",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    const check=()=>previewSyntheticUnsentOutbox(t.b,{
      ...args(t),nowMs:NOW+100,
    });
    assert.deepEqual(await check(),{kind:"rechecked_only"});
    assert.equal(inviteRows(t.a)[0].consent_revision,1);
    assert.equal((await t.disable()).kind,"updated");
    assert.deepEqual(await check(),{kind:"withheld"});
    assert.equal(outboxRows(t.a).length,1,"not deleted or sent by preview");
    assert.equal((await setOwnWorkerAgoraCallPreference(
      localD1Adapter(t.b),t.workerBearer,true,2)).kind,"updated");
    assert.deepEqual(await check(),{kind:"withheld"},
      "a later opt-in cannot resurrect the old consent epoch");
    assert.deepEqual(await stageSyntheticInvite(t.b,args(t)),{kind:"denied"},
      "retry on old call ID cannot treat changed consent version as same invite");
    const fresh={...args(t),callId:"call-agora-atomic-000002"};
    assert.equal((await stageSyntheticInvite(t.a,fresh)).kind,"staged_intent_only");
    assert.equal(inviteRows(t.b)[1].consent_revision,3);
    assert.deepEqual(await previewSyntheticUnsentOutbox(t.b,{
      ...fresh,nowMs:NOW+100,
    }),{kind:"rechecked_only"},"fresh call can only pass a fresh internal rehearsal");
  });
});

test("an unsent outbox row is withheld after status, listing or Category revocation",async()=>{
  const mutations=[
    ["caller disabled",db=>db.prepare(
      "UPDATE accounts SET status='disabled' WHERE id=?").run(CALLER)],
    ["worker disabled",db=>db.prepare(
      "UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER)],
    ["listing hidden",(_,t)=>t.a.prepare(
      "UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(t.listing.id)],
    ["listing unpublished",(_,t)=>t.a.prepare(
      "UPDATE worker_listings SET status='unpublished' WHERE id=?")
      .run(t.listing.id)],
    ["Category inactive",db=>db.prepare(
      "UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY)],
  ];
  for(const [label,mutate] of mutations){
    await withTrial(async t=>{
      assert.equal((await t.enable()).kind,"updated");
      assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
      mutate(t.a,t);
      assert.deepEqual(await previewSyntheticUnsentOutbox(t.b,{
        ...args(t),nowMs:NOW+100,
      }),{kind:"withheld"},label);
      assert.equal(outboxRows(t.a).length,1,label+" remains UNSENT");
    });
  }
});

test("expired, offline, blocked or rate-denied fresh evidence withholds unsent intent",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    const preview=(risk,nowMs=NOW+100)=>previewSyntheticUnsentOutbox(
      t.b,{callerBearer:t.callerBearer,callId:CALL_ID,risk,nowMs});
    for(const change of [
      {workerPresence:"offline"},{workerAvailability:"busy"},
      {blockedByCaller:true},{blockedByWorker:true},
      {rateGate:"deny"},{rateGate:"unknown"},
      {recipientVerified:false},{privacyApproved:false},
      {checkedAtMs:NOW+1000},{expiresAtMs:NOW+100},
      {callerAccountId:OTHER},{workerAccountId:OTHER},
    ]){
      assert.deepEqual(await preview(t.risk(change)),{kind:"withheld"},
        JSON.stringify(change));
    }
    assert.deepEqual(await preview(t.risk(),DEADLINE),{kind:"withheld"},
      "expired ringing deadline never reactivates an unsent intent");
    assert.deepEqual(await preview(t.risk(),NaN),{kind:"withheld"});
    assert.deepEqual(await preview(t.risk(),-1),{kind:"withheld"});
    assert.deepEqual(await previewSyntheticUnsentOutbox(t.b,{
      callerBearer:t.callerBearer,callId:"call-agora-nonexistent-000001",
      nowMs:NOW+100,risk:t.risk(),
    }),{kind:"withheld"},"unknown outbox call ID");
    assert.deepEqual(await preview(t.risk()),{kind:"rechecked_only"});
    assert.equal(outboxRows(t.a).length,1);
  });
});

test("caller session revocation and outbox removal also withhold an old preview",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.equal(await revokeSession(localD1Adapter(t.a),t.callerBearer),true);
    assert.deepEqual(await previewSyntheticUnsentOutbox(t.b,{
      ...args(t),
    }),{kind:"withheld"});
    t.a.prepare("DELETE FROM synthetic_voice_outbox WHERE call_id=?").run(CALL_ID);
    assert.deepEqual(await previewSyntheticUnsentOutbox(t.b,{
      ...args(t),
    }),{kind:"withheld"});
  });
});

test("distinct call IDs STILL can stage for one worker; no busy slot was reserved",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    const second={...args(t),callId:"call-agora-atomic-000002",retryKey:KEY_OTHER};
    assert.equal((await stageSyntheticInvite(t.b,second)).kind,
      "staged_intent_only");
    assert.equal(inviteRows(t.a).length,2,
      "per-call uniqueness is NOT a worker-level concurrency guard");
    assert.equal(outboxRows(t.b).length,2,
      "these are UNSENT offline fixtures, not authorized simultaneous rings");
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
