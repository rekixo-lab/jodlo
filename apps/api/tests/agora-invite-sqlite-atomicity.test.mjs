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
import { prepareSyntheticConsentEpochBoundAgoraInvite } from
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
  "0011_worker_listing_revision.sql", "0015_service_reports_and_appeals.sql",
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
      "kind TEXT NOT NULL CHECK(kind='ring_intent_only'), " +
      "status TEXT NOT NULL DEFAULT 'pending_test_only' " +
      "CHECK(status IN ('pending_test_only','claimed_test_only'," +
      "'revoked_test_only')), " +
      "claim_generation INTEGER NOT NULL DEFAULT 0 " +
      "CHECK(claim_generation>=0), " +
      "claim_lease_until_ms INTEGER DEFAULT NULL " +
      "CHECK(claim_lease_until_ms IS NULL OR claim_lease_until_ms>=0));"
    );
    // Synthetic call phase and local callback observations are test-only;
    // NEVER real provider callbacks, delivery acknowledgements, or call logs.
    a.exec(
      "CREATE TABLE synthetic_voice_mock_call_state (" +
      "call_id TEXT PRIMARY KEY REFERENCES synthetic_voice_invites(call_id)," +
      "phase TEXT NOT NULL,revision INTEGER NOT NULL);" +
      "CREATE TABLE synthetic_voice_local_observations (" +
      "call_id TEXT NOT NULL REFERENCES synthetic_voice_invites(call_id)," +
      "claim_generation INTEGER NOT NULL CHECK(claim_generation>=1)," +
      "kind TEXT NOT NULL CHECK(kind='not_provider_evidence')," +
      "PRIMARY KEY(call_id,claim_generation));"
    );
    // Strictly LOCAL, synthetic uncertainty about a hypothetical external
    // transport boundary. No real external transport is ever invoked.
    a.exec(
      "CREATE TABLE synthetic_voice_unknown_transport (" +
      "call_id TEXT PRIMARY KEY REFERENCES synthetic_voice_invites(call_id)," +
      "claim_generation INTEGER NOT NULL CHECK(claim_generation>=1)," +
      "kind TEXT NOT NULL CHECK(kind='outcome_unknown_test_only'));" +
      "CREATE TABLE synthetic_voice_unverified_hints (" +
      "call_id TEXT NOT NULL REFERENCES synthetic_voice_invites(call_id)," +
      "claim_generation INTEGER NOT NULL CHECK(claim_generation>=1)," +
      "hint_key TEXT NOT NULL,hint TEXT NOT NULL " +
      "CHECK(hint IN('maybe_accepted_test_only','maybe_rejected_test_only'))," +
      "PRIMARY KEY(call_id,claim_generation,hint_key));"
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
    const candidate=await prepareSyntheticConsentEpochBoundAgoraInvite(
      localD1Adapter(db),callerBearer,listingId,
      callId,nowMs,ringDeadlineMs,risk,
    );
    if(candidate.kind!=="prepared") {
      db.exec("ROLLBACK");
      inTransaction=false;
      return {kind:"denied"};
    }

    // The SAME D1 SELECT resolved the caller's live bearer, listing owner,
    // publication/moderation and this ORIGINAL consent epoch. The write lock
    // protects the evidence until both synthetic records commit; there is no
    // independent second read that might silently substitute a fresh epoch.
    const call=candidate.call;
    const originalEpoch=candidate.originalConsentRevision;
    const old=db.prepare("SELECT * FROM synthetic_voice_invites WHERE call_id=?")
      .get(callId);
    if(old){
      const exact=old.caller_id===call.callerAccountId &&
        old.worker_id===call.workerAccountId &&
        old.listing_id===call.listingId &&
        old.retry_key===retryKey &&
        old.ring_deadline_ms===call.ringDeadlineMs &&
        old.consent_revision===originalEpoch;
      db.exec("ROLLBACK");
      inTransaction=false;
      return {kind:exact?"replay_suppressed":"denied"};
    }

    db.prepare(
      "INSERT INTO synthetic_voice_invites VALUES(?,?,?,?,?,?,?)"
    ).run(callId,call.callerAccountId,call.workerAccountId,
      call.listingId,retryKey,call.ringDeadlineMs,originalEpoch);
    if(failAfterInsert) throw Error("synthetic failure before outbox commit");
    db.prepare("INSERT INTO synthetic_voice_outbox(call_id,kind) VALUES(?,?)")
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
  forFencedRecovery=false,
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
      "WHERE outbox.call_id=? AND outbox.kind='ring_intent_only' " +
      "AND outbox.status=?"
    ).get(callId,
      forFencedRecovery?"claimed_test_only":"pending_test_only");
    if(!row || row.consent_on!==1 ||
       !Number.isSafeInteger(row.consent_revision) ||
       row.current_revision!==row.consent_revision ||
       nowMs >= row.ring_deadline_ms) return withheld;
    const decision=await prepareSyntheticConsentEpochBoundAgoraInvite(
      localD1Adapter(db),callerBearer,row.listing_id,
      row.call_id,nowMs,row.ring_deadline_ms,risk,
    );
    if(decision.kind!=="prepared" ||
       decision.originalConsentRevision!==row.consent_revision ||
       decision.call.callerAccountId!==row.caller_id ||
       decision.call.workerAccountId!==row.worker_id ||
       decision.call.listingId!==row.listing_id) return withheld;
    return Object.freeze({kind:"rechecked_only"});
  }catch{
    return withheld;
  }
}

/**
 * A second OFFLINE SQLite-only rehearsal: an exclusive local claim of an
 * ALREADY UNSENT fake outbox record. No worker/device address is stored and
 * the result cannot be used to contact any provider.
 *
 * BEGIN IMMEDIATE protects the fresh consent/safety recheck and this local
 * pending->claimed status transition from interleaving a competing writer.
 * Caller bearer and scripted risk evidence are supplied ONLY in memory in
 * this test harness, not saved or a proposal for production async dispatch.
 * No lease, recovery, send, acknowledgment, retry, or guaranteed delivery.
 */
async function claimSyntheticUnsentOutbox(db,{
  callerBearer,callId=CALL_ID,nowMs=NOW+100,risk,
  failAfterClaim=false,
}){
  const withheld=Object.freeze({kind:"withheld"});
  let inTransaction=false;
  try{
    db.exec("BEGIN IMMEDIATE");
    inTransaction=true;
    const check=await previewSyntheticUnsentOutbox(db,{
      callerBearer,callId,nowMs,risk,
    });
    if(check.kind!=="rechecked_only"){
      db.exec("ROLLBACK");
      inTransaction=false;
      return withheld;
    }
    const changed=db.prepare(
      "UPDATE synthetic_voice_outbox SET status='claimed_test_only' " +
      "WHERE call_id=? AND status='pending_test_only' " +
      "AND kind='ring_intent_only'"
    ).run(callId);
    if(changed.changes!==1){
      db.exec("ROLLBACK");
      inTransaction=false;
      return withheld;
    }
    if(failAfterClaim) throw Error("synthetic failure before exclusive claim commit");
    db.exec("COMMIT");
    inTransaction=false;
    return Object.freeze({kind:"claimed_test_only"});
  }catch(error){
    if(inTransaction)db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * OFFLINE ONLY: a SECOND, deliberately hypothetical claim mode, independent
 * from the earlier non-recoverable claim exercise. Each claim has a LOCAL fake
 * lease deadline explicitly supplied by the test (NOT a product timeout).
 *
 * Crash recovery at/after an expired lease increments a monotonic generation.
 * A stale generation can never inspect as current. The safety gate is run
 * INSIDE BEGIN IMMEDIATE on both initial and recovered claims.
 *
 * This DOES NOT implement delivery or allow a previously claimed process
 * to send: a real provider may ignore a DB fence and still duplicate a send.
 * No provider acknowledgment, device, token, lease scheduler or real sender.
 */
async function claimSyntheticFencedOutbox(db,{
  callerBearer,callId=CALL_ID,nowMs=NOW+100,
  risk,testLeaseUntilMs,failBeforeCommit=false,
}){
  const withheld=Object.freeze({kind:"withheld"});
  if(!validOpaqueId(callId) || !Number.isSafeInteger(nowMs) ||
     nowMs<0 || !Number.isSafeInteger(testLeaseUntilMs) ||
     testLeaseUntilMs<=nowMs) return withheld;
  let inTransaction=false;
  try{
    db.exec("BEGIN IMMEDIATE");
    inTransaction=true;
    const old=db.prepare(
      "SELECT outbox.status,outbox.claim_generation," +
      "outbox.claim_lease_until_ms,invite.ring_deadline_ms " +
      "FROM synthetic_voice_outbox AS outbox " +
      "JOIN synthetic_voice_invites AS invite " +
      "ON invite.call_id=outbox.call_id " +
      "WHERE outbox.call_id=? AND outbox.kind='ring_intent_only'"
    ).get(callId);
    if(!old || !Number.isSafeInteger(old.claim_generation) ||
       old.claim_generation<0 ||
       old.claim_generation>=Number.MAX_SAFE_INTEGER ||
       testLeaseUntilMs>old.ring_deadline_ms) {
      db.exec("ROLLBACK");
      inTransaction=false;
      return withheld;
    }
    const first=old.status==="pending_test_only" &&
      old.claim_generation===0 && old.claim_lease_until_ms===null;
    const recovered=old.status==="claimed_test_only" &&
      old.claim_generation>0 &&
      Number.isSafeInteger(old.claim_lease_until_ms) &&
      old.claim_lease_until_ms<=nowMs;
    if(!first && !recovered) {
      db.exec("ROLLBACK");
      inTransaction=false;
      return withheld;
    }
    const check=await previewSyntheticUnsentOutbox(db,{
      callerBearer,callId,nowMs,risk,forFencedRecovery:recovered,
    });
    if(check.kind!=="rechecked_only"){
      db.exec("ROLLBACK");
      inTransaction=false;
      return withheld;
    }
    const newGeneration=old.claim_generation+1;
    const changed=db.prepare(
      "UPDATE synthetic_voice_outbox SET " +
      "status='claimed_test_only',claim_generation=?," +
      "claim_lease_until_ms=? WHERE call_id=? AND " +
      "status=? AND claim_generation=? AND " +
      "(claim_lease_until_ms IS ? OR claim_lease_until_ms=?)"
    ).run(newGeneration,testLeaseUntilMs,callId,old.status,
      old.claim_generation,old.claim_lease_until_ms,
      old.claim_lease_until_ms);
    if(changed.changes!==1){
      db.exec("ROLLBACK");
      inTransaction=false;
      return withheld;
    }
    if(failBeforeCommit) throw Error("synthetic crash before fenced claim commit");
    db.exec("COMMIT");
    inTransaction=false;
    return Object.freeze({kind:"fenced_claim_test_only",generation:newGeneration});
  }catch(error){
    if(inTransaction)db.exec("ROLLBACK");
    throw error;
  }
}

/** Local introspection only: never an authorization to contact a provider.
 * The same safety facts MUST be fresh even when the DB generation matches.
 * Old generations and expired leases can never be treated as current.
 */
async function inspectSyntheticFencedClaim(db,{
  callerBearer,callId=CALL_ID,nowMs=NOW+100,risk,generation,
}){
  const withheld=Object.freeze({kind:"withheld"});
  if(!validOpaqueId(callId) || !Number.isSafeInteger(nowMs) ||
     nowMs<0 || !Number.isSafeInteger(generation) || generation<1)
    return withheld;
  try {
    const row=db.prepare(
      "SELECT claim_generation,claim_lease_until_ms,status " +
      "FROM synthetic_voice_outbox WHERE call_id=?"
    ).get(callId);
    if(!row || row.status!=="claimed_test_only" ||
       row.claim_generation!==generation ||
       !Number.isSafeInteger(row.claim_lease_until_ms) ||
       row.claim_lease_until_ms<=nowMs) return withheld;
    const check=await previewSyntheticUnsentOutbox(db,{
      callerBearer,callId,nowMs,risk,forFencedRecovery:true,
    });
    return check.kind==="rechecked_only"
      ? Object.freeze({kind:"current_fence_test_only"}) : withheld;
  }catch {
    return withheld;
  }
}

/**
 * OFFLINE ONLY: tombstone one unsent fake intent that no longer belongs to
 * the worker's ORIGINAL revocable opt-in epoch. This does NOT select any
 * presence/abuse policy or revoke an in-flight real provider operation.
 *
 * This deliberately needs only a call ID and current D1 worker preference;
 * no caller bearer, synthetic risk evidence, client worker ID or device.
 * BEGIN IMMEDIATE makes a local worker consent toggle / tombstone serialized
 * across the two SQLite connections in the tests; it is NOT a distributed
 * Cloudflare D1/DO atomicity or provider cancellation guarantee.
 *
 * A tombstone is terminal in this disposable fixture. No data is deleted,
 * sent or retained in production, and no provider is told to stop ringing.
 */
async function tombstoneRevokedSyntheticOutbox(db,{
  callId=CALL_ID,failBeforeCommit=false,
}={}){
  const withheld=Object.freeze({kind:"withheld"});
  if(!validOpaqueId(callId)) return withheld;
  let inTransaction=false;
  try{
    db.exec("BEGIN IMMEDIATE");
    inTransaction=true;
    const row=db.prepare(
      "SELECT outbox.status,outbox.claim_generation, " +
      "invite.consent_revision, pref.calls_enabled AS enabled_now, " +
      "pref.revision AS revision_now " +
      "FROM synthetic_voice_outbox AS outbox " +
      "JOIN synthetic_voice_invites AS invite " +
      "ON invite.call_id=outbox.call_id " +
      "LEFT JOIN worker_agora_call_preferences AS pref " +
      "ON pref.account_id=invite.worker_id " +
      "WHERE outbox.call_id=? AND outbox.kind='ring_intent_only'"
    ).get(callId);
    if(!row || !["pending_test_only","claimed_test_only"].includes(row.status)){
      db.exec("ROLLBACK");
      inTransaction=false;
      return withheld;
    }
    if(!Number.isSafeInteger(row.consent_revision) || row.consent_revision<1 ||
       !Number.isSafeInteger(row.claim_generation) || row.claim_generation<0){
      db.exec("ROLLBACK");
      inTransaction=false;
      return withheld;
    }
    // A missing, OFF or different-version preference invalidates the old
    // call's consent epoch. OFF -> ON never resurrects that same epoch.
    if(row.enabled_now===1 && row.revision_now===row.consent_revision){
      db.exec("ROLLBACK");
      inTransaction=false;
      return Object.freeze({kind:"unchanged_test_only"});
    }
    const changed=db.prepare(
      "UPDATE synthetic_voice_outbox " +
      "SET status='revoked_test_only' " +
      "WHERE call_id=? AND status=? AND claim_generation=?"
    ).run(callId,row.status,row.claim_generation);
    if(changed.changes!==1){
      db.exec("ROLLBACK");
      inTransaction=false;
      return withheld;
    }
    if(failBeforeCommit) throw Error("synthetic crash before revocation tombstone commit");
    db.exec("COMMIT");
    inTransaction=false;
    return Object.freeze({kind:"revoked_test_only"});
  }catch(error){
    if(inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}


/**
 * FAKE callback receipt boundary: test-only local evidence after a fenced
 * claim. The callback is a locally constructed fixture, NOT a network or
 * Agora/FCM provider callback. The lease, state, worker consent epoch, own
 * caller session and scripted safety facts are freshly inspected while a
 * local BEGIN IMMEDIATE write lock is held. We NEVER call a provider here.
 *
 * Even a positive observation is NOT proof that a notification was sent,
 * displayed, acknowledged, or that RTC media began. The write lock cannot
 * fence an external network operation that was already in flight.
 */
const MOCK_OBSERVATION_FIELDS=[
  "kind","callId","generation","nowMs",
];
function seedMockRingingState(db,callId=CALL_ID){
  db.prepare(
    "INSERT INTO synthetic_voice_mock_call_state VALUES(?,?,?)"
  ).run(callId,"ringing",0);
}
function mockObservationRows(db){
  return db.prepare(
    "SELECT call_id,claim_generation,kind FROM " +
    "synthetic_voice_local_observations ORDER BY claim_generation"
  ).all().map(row=>({...row}));
}
const mockObservation=(generation,nowMs=NOW+150,callId=CALL_ID)=>({
  kind:"trusted_local_mock_only",callId,generation,nowMs,
});
async function observeMockFencedCallback(db,request,{
  callerBearer,risk,failAfterObservation=false,
}={}){
  const withheld=Object.freeze({kind:"withheld"});
  if(!request || typeof request!=="object" ||
     Array.isArray(request) ||
     Object.keys(request).length!==MOCK_OBSERVATION_FIELDS.length ||
     MOCK_OBSERVATION_FIELDS.some(k=>!Object.hasOwn(request,k)) ||
     request.kind!=="trusted_local_mock_only" ||
     !validOpaqueId(request.callId) ||
     !Number.isSafeInteger(request.generation) ||
     request.generation<1 ||
     !Number.isSafeInteger(request.nowMs) ||
     request.nowMs<0) return withheld;
  let tx=false;
  try{
    db.exec("BEGIN IMMEDIATE");tx=true;
    const phase=db.prepare(
      "SELECT phase,revision FROM synthetic_voice_mock_call_state " +
      "WHERE call_id=?"
    ).get(request.callId);
    if(!phase || phase.phase!=="ringing" || phase.revision!==0){
      db.exec("ROLLBACK");tx=false;
      return withheld;
    }
    const checked=await inspectSyntheticFencedClaim(db,{
      callerBearer,callId:request.callId,nowMs:request.nowMs,
      risk,generation:request.generation,
    });
    if(checked.kind!=="current_fence_test_only"){
      db.exec("ROLLBACK");tx=false;
      return withheld;
    }
    const recorded=db.prepare(
      "INSERT OR IGNORE INTO synthetic_voice_local_observations " +
      "(call_id,claim_generation,kind) " +
      "SELECT call_id,claim_generation,'not_provider_evidence' " +
      "FROM synthetic_voice_outbox WHERE call_id=? " +
      "AND status='claimed_test_only' AND claim_generation=?"
    ).run(request.callId,request.generation);
    if(recorded.changes!==1){
      db.exec("ROLLBACK");tx=false;
      return withheld;
    }
    if(failAfterObservation)
      throw Error("synthetic callback crash before observation commit");
    db.exec("COMMIT");tx=false;
    return Object.freeze({kind:"local_observation_only"});
  }catch(error){
    if(tx)db.exec("ROLLBACK");
    throw error;
  }
}


/**
 * D01 NOT SELECTED. The fixture records that a future external transport
 * operation might have an UNKNOWN outcome; no provider send ever happens.
 * A duplicate is still unresolved, not proof of delivery or safe retry.
 *
 * The previous fenced lease/generation, consent and caller-own safety facts
 * are rechecked while SQLite BEGIN IMMEDIATE is held. A previous unknown
 * generation is NEVER silently rebased to a later recovered lease.
 */
const UNKNOWN_ATTEMPT_FIELDS=["kind","callId","generation","nowMs"];
const UNKNOWN_HINT_FIELDS=[
  "kind","callId","generation","nowMs","hintKey","hint",
];
const unknownRequest=(generation,nowMs=NOW+150,callId=CALL_ID)=>({
  kind:"trusted_uncertainty_fixture_only",callId,generation,nowMs,
});
function unknownTransportRows(db){
  return db.prepare(
    "SELECT call_id,claim_generation,kind FROM " +
    "synthetic_voice_unknown_transport ORDER BY call_id"
  ).all().map(x=>({...x}));
}
function unverifiedHintRows(db){
  return db.prepare(
    "SELECT call_id,claim_generation,hint_key,hint FROM " +
    "synthetic_voice_unverified_hints ORDER BY hint_key"
  ).all().map(x=>({...x}));
}
function exactFixture(value,fields){
  return Boolean(value) && typeof value==="object" &&
    !Array.isArray(value) &&
    Object.keys(value).length===fields.length &&
    fields.every(field=>Object.hasOwn(value,field));
}
function phaseStillRinging(db,callId){
  const row=db.prepare(
    "SELECT phase,revision FROM synthetic_voice_mock_call_state " +
    "WHERE call_id=?"
  ).get(callId);
  return row?.phase==="ringing" && row?.revision===0;
}
async function recordUnknownTransportBoundary(db,request,{
  callerBearer,risk,failBeforeCommit=false,
}={}){
  const withheld=Object.freeze({kind:"withheld"});
  if(!exactFixture(request,UNKNOWN_ATTEMPT_FIELDS) ||
     request.kind!=="trusted_uncertainty_fixture_only" ||
     !validOpaqueId(request.callId) ||
     !Number.isSafeInteger(request.generation) ||
     request.generation<1 ||
     !Number.isSafeInteger(request.nowMs) ||
     request.nowMs<0) return withheld;
  let tx=false;
  try{
    db.exec("BEGIN IMMEDIATE");tx=true;
    if(!phaseStillRinging(db,request.callId)){
      db.exec("ROLLBACK");tx=false;return withheld;
    }
    const existing=db.prepare(
      "SELECT claim_generation FROM synthetic_voice_unknown_transport " +
      "WHERE call_id=?"
    ).get(request.callId);
    // A historical ambiguous generation cannot be promoted to a new
    // generation after hypothetical lease recovery; retry policy is pending.
    if(existing){
      db.exec("ROLLBACK");tx=false;
      return existing.claim_generation===request.generation
        ? Object.freeze({kind:"still_unresolved_test_only"}) : withheld;
    }
    const fence=await inspectSyntheticFencedClaim(db,{
      callerBearer,callId:request.callId,nowMs:request.nowMs,
      risk,generation:request.generation,
    });
    if(fence.kind!=="current_fence_test_only"){
      db.exec("ROLLBACK");tx=false;return withheld;
    }
    const changed=db.prepare(
      "INSERT INTO synthetic_voice_unknown_transport " +
      "(call_id,claim_generation,kind) " +
      "SELECT call_id,claim_generation,'outcome_unknown_test_only' " +
      "FROM synthetic_voice_outbox WHERE call_id=? " +
      "AND status='claimed_test_only' AND claim_generation=?"
    ).run(request.callId,request.generation);
    if(changed.changes!==1) throw Error("synthetic ambiguous CAS failed");
    if(failBeforeCommit)throw Error("synthetic uncertainty crash before commit");
    db.exec("COMMIT");tx=false;
    return Object.freeze({kind:"outcome_unknown_test_only"});
  }catch(error){
    if(tx)db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * A locally constructed UNVERIFIED hint, never a signed provider receipt.
 * Duplicate key+same hint is suppressed; contradictory replay cannot
 * overwrite an earlier local note. Opposing DIFFERENT hints still leave the
 * local transport status unknown. No ACK/delivered/failed state is produced.
 */
const unknownHint=(generation,hintKey,hint,nowMs=NOW+150)=>({
  kind:"trusted_unverified_hint_fixture_only",
  callId:CALL_ID,generation,nowMs,hintKey,hint,
});
async function recordUnverifiedHint(db,request,{
  callerBearer,risk,failBeforeCommit=false,
}={}){
  const withheld=Object.freeze({kind:"withheld"});
  if(!exactFixture(request,UNKNOWN_HINT_FIELDS) ||
     request.kind!=="trusted_unverified_hint_fixture_only" ||
     !validOpaqueId(request.callId) ||
     !Number.isSafeInteger(request.generation) || request.generation<1 ||
     !Number.isSafeInteger(request.nowMs) || request.nowMs<0 ||
     !validIdempotencyKey(request.hintKey) ||
     !["maybe_accepted_test_only","maybe_rejected_test_only"].includes(
       request.hint))return withheld;
  let tx=false;
  try{
    db.exec("BEGIN IMMEDIATE");tx=true;
    if(!phaseStillRinging(db,request.callId)){
      db.exec("ROLLBACK");tx=false;return withheld;
    }
    const known=db.prepare(
      "SELECT claim_generation FROM synthetic_voice_unknown_transport " +
      "WHERE call_id=? AND kind='outcome_unknown_test_only'"
    ).get(request.callId);
    if(!known || known.claim_generation!==request.generation){
      db.exec("ROLLBACK");tx=false;return withheld;
    }
    const fence=await inspectSyntheticFencedClaim(db,{
      callerBearer,callId:request.callId,nowMs:request.nowMs,
      risk,generation:request.generation,
    });
    if(fence.kind!=="current_fence_test_only"){
      db.exec("ROLLBACK");tx=false;return withheld;
    }
    const previous=db.prepare(
      "SELECT hint FROM synthetic_voice_unverified_hints " +
      "WHERE call_id=? AND claim_generation=? AND hint_key=?"
    ).get(request.callId,request.generation,request.hintKey);
    if(previous){
      db.exec("ROLLBACK");tx=false;
      return previous.hint===request.hint
        ? Object.freeze({kind:"duplicate_hint_test_only"}) : withheld;
    }
    db.prepare(
      "INSERT INTO synthetic_voice_unverified_hints VALUES(?,?,?,?)"
    ).run(request.callId,request.generation,request.hintKey,request.hint);
    if(failBeforeCommit)throw Error("synthetic hint crash before commit");
    db.exec("COMMIT");tx=false;
    return Object.freeze({kind:"unverified_hint_only"});
  }catch(error){
    if(tx)db.exec("ROLLBACK");
    throw error;
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

test("two local dispatchers can claim a staged intent at most once, without sending",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.deepEqual(outboxRows(t.a).map(x=>x.status),["pending_test_only"]);
    const request={...args(t),nowMs:NOW+100};
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.a,request),
      {kind:"claimed_test_only"});
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.b,request),
      {kind:"withheld"},"second writer never claims the same call ID");
    assert.deepEqual(await previewSyntheticUnsentOutbox(t.b,request),
      {kind:"withheld"},"claimed fake outbox cannot be re-previewed");
    assert.deepEqual(outboxRows(t.a).map(x=>x.status),["claimed_test_only"]);
    assert.equal(inviteRows(t.b).length,1);
    const stored=JSON.stringify([...inviteRows(t.b),...outboxRows(t.b)]);
    for(const secret of [t.callerBearer,t.workerBearer,t.otherBearer])
      assert.equal(stored.includes(secret),false,"no bearer or delivery address");
  });
});

test("competing local claim writer cannot interleave an existing SQLite transaction",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    t.a.exec("BEGIN IMMEDIATE");
    try{
      await assert.rejects(()=>claimSyntheticUnsentOutbox(t.b,{
        ...args(t),nowMs:NOW+100,
      }),/database is locked|SQLITE_BUSY/i);
      assert.deepEqual(outboxRows(t.a).map(x=>x.status),["pending_test_only"]);
    }finally{t.a.exec("ROLLBACK");}
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.b,{
      ...args(t),nowMs:NOW+100,
    }),{kind:"claimed_test_only"});
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.a,{
      ...args(t),nowMs:NOW+100,
    }),{kind:"withheld"});
  });
});

test("failure before local claim commit rolls back, leaving one unsent pending fixture",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    const request={...args(t),nowMs:NOW+100};
    await assert.rejects(()=>claimSyntheticUnsentOutbox(t.a,{
      ...request,failAfterClaim:true,
    }),/synthetic failure before exclusive claim commit/);
    assert.deepEqual(outboxRows(t.b).map(x=>x.status),["pending_test_only"]);
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.b,request),
      {kind:"claimed_test_only"});
    assert.deepEqual(outboxRows(t.a).map(x=>x.status),["claimed_test_only"]);
  });
});

test("an old preview is NOT an authorization: recheck opt-out and unsafe state inside claim",async()=>{
  const mutations=[
    ["worker opts OFF",async t=>{assert.equal((await t.disable()).kind,"updated");}],
    ["caller disabled",async t=>{t.a.prepare(
      "UPDATE accounts SET status='disabled' WHERE id=?").run(CALLER);}],
    ["listing hidden",async t=>{t.a.prepare(
      "UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(t.listing.id);}],
    ["Category inactive",async t=>{t.a.prepare(
      "UPDATE categories SET is_active=0 WHERE id=?").run(CATEGORY);}],
  ];
  for(const [label,mutate] of mutations){
    await withTrial(async t=>{
      assert.equal((await t.enable()).kind,"updated");
      assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
      const request={...args(t),nowMs:NOW+100};
      assert.deepEqual(await previewSyntheticUnsentOutbox(t.b,request),
        {kind:"rechecked_only"},"the old preview was only a transient fact");
      await mutate(t);
      assert.deepEqual(await claimSyntheticUnsentOutbox(t.b,request),
        {kind:"withheld"},label);
      assert.deepEqual(outboxRows(t.a).map(x=>x.status),["pending_test_only"],
        "refusal neither claims nor sends a notification");
    });
  }
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.equal((await t.disable()).kind,"updated");
    assert.equal((await setOwnWorkerAgoraCallPreference(
      localD1Adapter(t.a),t.workerBearer,true,2)).kind,"updated");
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.b,{
      ...args(t),nowMs:NOW+100,
    }),{kind:"withheld"},"OFF->ON must not resurrect the old consent revision");
    assert.deepEqual(outboxRows(t.a).map(x=>x.status),["pending_test_only"]);
  });
});

test("invalid, stale or prohibited fake claim risk never changes pending status",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    const cases=[
      {workerPresence:"offline"},{workerAvailability:"busy"},
      {blockedByCaller:true},{blockedByWorker:true},
      {rateGate:"deny"},{rateGate:"unknown"},
      {recipientVerified:false},{privacyApproved:false},
      {checkedAtMs:NOW+1000},{expiresAtMs:NOW+100},
      {callerAccountId:OTHER},{workerAccountId:OTHER},
    ];
    for(const riskChange of cases){
      assert.deepEqual(await claimSyntheticUnsentOutbox(t.b,{
        ...args(t),nowMs:NOW+100,risk:t.risk(riskChange),
      }),{kind:"withheld"},JSON.stringify(riskChange));
    }
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.a,{
      ...args(t),nowMs:DEADLINE,
    }),{kind:"withheld"},"ring expired");
    assert.deepEqual(outboxRows(t.b).map(x=>x.status),["pending_test_only"]);
  });
});

test("claimed is NOT delivered: a crash has no lease, retry, sender or recovery in tests",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.a,{
      ...args(t),nowMs:NOW+100,
    }),{kind:"claimed_test_only"});
    // No "sent", "delivered", "failed" or provider ID state; do not claim
    // delivery reliability based on this exclusive test-only reservation.
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.b,{
      ...args(t),nowMs:NOW+200,
    }),{kind:"withheld"});
    assert.equal(outboxRows(t.a)[0].status,"claimed_test_only");
    assert.deepEqual(t.b.prepare("PRAGMA foreign_key_check").all(),[]);
  });
});

test("local fenced claim generation increases only when synthetic lease expires",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    const claim={
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+300,
    };
    assert.deepEqual(await claimSyntheticFencedOutbox(t.a,claim),
      {kind:"fenced_claim_test_only",generation:1});
    assert.deepEqual(await claimSyntheticFencedOutbox(t.b,{
      ...claim,nowMs:NOW+200,testLeaseUntilMs:NOW+400,
    }),{kind:"withheld"},"early takeover is disallowed");
    assert.deepEqual(await inspectSyntheticFencedClaim(t.b,{
      ...args(t),nowMs:NOW+200,generation:1,
    }),{kind:"current_fence_test_only"});
    assert.deepEqual(await inspectSyntheticFencedClaim(t.b,{
      ...args(t),nowMs:NOW+300,generation:1,
    }),{kind:"withheld"},"expired fence is not current");
    assert.deepEqual(await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+300,testLeaseUntilMs:NOW+500,
    }),{kind:"fenced_claim_test_only",generation:2});
    assert.deepEqual(await inspectSyntheticFencedClaim(t.a,{
      ...args(t),nowMs:NOW+400,generation:1,
    }),{kind:"withheld"},"stale owner may not reuse generation 1");
    assert.deepEqual(await inspectSyntheticFencedClaim(t.a,{
      ...args(t),nowMs:NOW+400,generation:2,
    }),{kind:"current_fence_test_only"});
    assert.equal(outboxRows(t.a)[0].status,"claimed_test_only");
    assert.equal(outboxRows(t.a)[0].claim_generation,2);
    assert.equal(outboxRows(t.a)[0].claim_lease_until_ms,NOW+500);
    assert.equal(outboxRows(t.b).length,1);
  });
});

test("two SQLite connections cannot both recover the same expired fake lease",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    t.a.exec("BEGIN IMMEDIATE");
    try{
      await assert.rejects(()=>claimSyntheticFencedOutbox(t.b,{
        ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+300,
      }),/database is locked|SQLITE_BUSY/i);
    }finally{t.a.exec("ROLLBACK");}
    assert.deepEqual(await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+300,
    }),{kind:"fenced_claim_test_only",generation:2});
    assert.deepEqual(await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+201,testLeaseUntilMs:NOW+350,
    }),{kind:"withheld"});
    assert.equal(outboxRows(t.a)[0].claim_generation,2);
  });
});

test("fenced claim crash before commit retains old generation for safe retry",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    await assert.rejects(()=>claimSyntheticFencedOutbox(t.a,{
      ...args(t),testLeaseUntilMs:NOW+200,failBeforeCommit:true,
    }),/synthetic crash before fenced claim commit/);
    assert.equal(outboxRows(t.b)[0].status,"pending_test_only");
    assert.equal(outboxRows(t.b)[0].claim_generation,0);
    assert.equal(outboxRows(t.b)[0].claim_lease_until_ms,null);
    assert.deepEqual(await claimSyntheticFencedOutbox(t.b,{
      ...args(t),testLeaseUntilMs:NOW+200,
    }),{kind:"fenced_claim_test_only",generation:1});
    await assert.rejects(()=>claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+350,
      failBeforeCommit:true,
    }),/synthetic crash before fenced claim commit/);
    assert.equal(outboxRows(t.a)[0].claim_generation,1);
    assert.deepEqual(await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+350,
    }),{kind:"fenced_claim_test_only",generation:2});
  });
});

test("recovered local claim must recheck opt-out, account, listing and synthetic policy",async()=>{
  const mutationCases=[
    ["worker opt-out",async t=>{assert.equal((await t.disable()).kind,"updated");}],
    ["worker re-opt-in new version",async t=>{
      assert.equal((await t.disable()).kind,"updated");
      assert.equal((await setOwnWorkerAgoraCallPreference(
        localD1Adapter(t.a),t.workerBearer,true,2)).kind,"updated");
    }],
    ["caller disabled",async t=>t.a.prepare(
      "UPDATE accounts SET status='disabled' WHERE id=?").run(CALLER)],
    ["listing hidden",async t=>t.a.prepare(
      "UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(t.listing.id)],
  ];
  for(const [label,mutate] of mutationCases){
    await withTrial(async t=>{
      assert.equal((await t.enable()).kind,"updated");
      assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
      assert.equal((await claimSyntheticFencedOutbox(t.a,{
        ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
      })).generation,1);
      await mutate(t);
      assert.deepEqual(await claimSyntheticFencedOutbox(t.b,{
        ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+300,
      }),{kind:"withheld"},label);
      assert.deepEqual(await inspectSyntheticFencedClaim(t.a,{
        ...args(t),nowMs:NOW+150,generation:1,
      }),{kind:"withheld"},label+" revokes old inspection too");
      assert.equal(outboxRows(t.b)[0].claim_generation,1);
    });
  }
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    for(const riskChange of [
      {workerPresence:"offline"},{workerAvailability:"busy"},
      {blockedByWorker:true},{rateGate:"unknown"},
      {privacyApproved:false},{expiresAtMs:NOW+200},
    ]){
      assert.deepEqual(await claimSyntheticFencedOutbox(t.b,{
        ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+300,
        risk:t.risk(riskChange),
      }),{kind:"withheld"},JSON.stringify(riskChange));
    }
    assert.equal(outboxRows(t.b)[0].claim_generation,1);
  });
});

test("invalid synthetic lease dates, expired ringing and legacy no-lease claims deny recovery",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    for(const testLeaseUntilMs of [
      NOW+100,NOW,DEADLINE+1,NaN,Infinity,-1,
    ]){
      assert.deepEqual(await claimSyntheticFencedOutbox(t.a,{
        ...args(t),nowMs:NOW+100,testLeaseUntilMs,
      }),{kind:"withheld"},String(testLeaseUntilMs));
    }
    assert.deepEqual(await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:DEADLINE,testLeaseUntilMs:DEADLINE+100,
    }),{kind:"withheld"});
    assert.deepEqual(outboxRows(t.b).map(r=>r.claim_generation),[0]);
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.a,{
      ...args(t),nowMs:NOW+100,
    }),{kind:"claimed_test_only"});
    assert.deepEqual(await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+1000,testLeaseUntilMs:NOW+2000,
    }),{kind:"withheld"},
      "a legacy non-fenced claim has no authenticated lease to recover");
    assert.deepEqual(await inspectSyntheticFencedClaim(t.a,{
      ...args(t),nowMs:NOW+200,generation:0,
    }),{kind:"withheld"});
  });
});

test("generation is not a provider delivery or token grant and never stores bearers",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    assert.equal((await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+300,
    })).generation,2);
    const saved=JSON.stringify([...inviteRows(t.a),...outboxRows(t.b)]);
    for(const secret of [t.callerBearer,t.workerBearer,t.otherBearer]){
      assert.equal(saved.includes(secret),false);
    }
    for(const forbidden of ["provider_token","phone_number",
      "recipient_device","delivered_at","sent_at","credential"]){
      assert.equal(saved.includes(forbidden),false);
    }
    assert.equal(outboxRows(t.a)[0].status,"claimed_test_only");
    assert.equal(inviteRows(t.a).length,1);
  });
});

test("worker opt-out tombstones an unclaimed fake ring and OFF->ON cannot resurrect",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b),
      {kind:"unchanged_test_only"},"still enabled at matching consent revision");
    assert.equal(outboxRows(t.a)[0].status,"pending_test_only");
    assert.equal((await t.disable()).kind,"updated");
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b),
      {kind:"revoked_test_only"});
    assert.equal(outboxRows(t.a)[0].status,"revoked_test_only");
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.a),
      {kind:"withheld"},"terminalized row cannot be changed twice");
    assert.equal((await setOwnWorkerAgoraCallPreference(
      localD1Adapter(t.b),t.workerBearer,true,2)).kind,"updated");
    assert.deepEqual(await previewSyntheticUnsentOutbox(t.a,{
      ...args(t),nowMs:NOW+100,
    }),{kind:"withheld"},"old queued intent must not reappear");
    assert.deepEqual(await claimSyntheticUnsentOutbox(t.a,{
      ...args(t),nowMs:NOW+100,
    }),{kind:"withheld"});
    assert.deepEqual(await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    }),{kind:"withheld"});
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.a),
      {kind:"withheld"},"test fixture terminal state remains terminal");
    const fresh={...args(t),callId:"call-agora-atomic-000002"};
    assert.equal((await stageSyntheticInvite(t.b,fresh)).kind,"staged_intent_only",
      "only a new call ID under the current opt-in epoch is permitted in the fixture");
    assert.equal(outboxRows(t.a).length,2);
    assert.deepEqual(outboxRows(t.a).map(r=>r.status),
      ["revoked_test_only","pending_test_only"]);
  });
});

test("an already claimed or recovered test-only ring can be tombstoned on opt-out",async()=>{
  for(const recover of [false,true]){
    await withTrial(async t=>{
      assert.equal((await t.enable()).kind,"updated");
      assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
      assert.deepEqual(await claimSyntheticFencedOutbox(t.a,{
        ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
      }),{kind:"fenced_claim_test_only",generation:1});
      if(recover) assert.deepEqual(await claimSyntheticFencedOutbox(t.b,{
        ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+300,
      }),{kind:"fenced_claim_test_only",generation:2});
      assert.equal((await t.disable()).kind,"updated");
      assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b),
        {kind:"revoked_test_only"});
      assert.equal(outboxRows(t.a)[0].status,"revoked_test_only");
      assert.deepEqual(await inspectSyntheticFencedClaim(t.a,{
        ...args(t),nowMs:NOW+150,generation:1,
      }),{kind:"withheld"},"tombstone invalidates old local fence inspection");
      assert.deepEqual(await claimSyntheticFencedOutbox(t.a,{
        ...args(t),nowMs:NOW+300,testLeaseUntilMs:NOW+400,
      }),{kind:"withheld"},"expired local lease cannot recover terminal tombstone");
      assert.equal(outboxRows(t.b)[0].claim_generation,recover?2:1);
      assert.equal(outboxRows(t.a)[0].claim_lease_until_ms,
        recover?NOW+300:NOW+200);
      // No actual provider send is represented by an old claimed status.
    });
  }
});

test("tombstone crash rolls back; another local connection can retry once",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.equal((await t.disable()).kind,"updated");
    await assert.rejects(()=>tombstoneRevokedSyntheticOutbox(t.a,{
      failBeforeCommit:true,
    }),/synthetic crash before revocation tombstone commit/);
    assert.equal(outboxRows(t.b)[0].status,"pending_test_only",
      "the crash did not partially mark the row");
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b),
      {kind:"revoked_test_only"});
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.a),
      {kind:"withheld"});
    assert.equal(outboxRows(t.a)[0].status,"revoked_test_only");
    assert.deepEqual(t.b.prepare("PRAGMA foreign_key_check").all(),[]);
  });
});

test("competing local writer cannot race worker opt-out tombstone transaction",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.equal((await t.disable()).kind,"updated");
    t.a.exec("BEGIN IMMEDIATE");
    try{
      await assert.rejects(()=>tombstoneRevokedSyntheticOutbox(t.b),
        /database is locked|SQLITE_BUSY/i);
      assert.equal(outboxRows(t.a)[0].status,"pending_test_only");
    }finally{t.a.exec("ROLLBACK");}
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b),
      {kind:"revoked_test_only"});
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.a),
      {kind:"withheld"});
    assert.deepEqual(await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    }),{kind:"withheld"});
  });
});

test("invalid or unknown ID cannot tombstone unrelated fake outbox records",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    assert.equal((await t.disable()).kind,"updated");
    for(const callId of [
      "",null,"wrong id","call-agora-nonexistent-000001",CALLER,
    ]){
      assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b,{callId}),
        {kind:"withheld"},String(callId));
    }
    assert.equal(outboxRows(t.a)[0].status,"pending_test_only");
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b,{callId:CALL_ID}),
      {kind:"revoked_test_only"});
    assert.equal(outboxRows(t.a)[0].status,"revoked_test_only");
    const saved=JSON.stringify([...outboxRows(t.a),...inviteRows(t.a)]);
    for(const secret of [t.callerBearer,t.workerBearer,t.otherBearer]){
      assert.equal(saved.includes(secret),false);
    }
    assert.equal(saved.includes("recipient_device"),false);
  });
});


test("mock fenced callback gets at most one LOCAL observation; never provider delivery",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.deepEqual(await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    }),{kind:"fenced_claim_test_only",generation:1});
    const input=mockObservation(1);
    assert.deepEqual(await observeMockFencedCallback(t.b,input,args(t)),
      {kind:"local_observation_only"});
    assert.deepEqual(await observeMockFencedCallback(t.a,input,args(t)),
      {kind:"withheld"},"same fake callback cannot double-write its generation");
    assert.deepEqual(mockObservationRows(t.b),[{
      call_id:CALL_ID,claim_generation:1,kind:"not_provider_evidence",
    }]);
    assert.equal(outboxRows(t.a)[0].status,"claimed_test_only");
    assert.equal(JSON.stringify(mockObservationRows(t.a)).includes("delivered"),false);
    assert.equal(JSON.stringify(mockObservationRows(t.a)).includes("provider"),true,
      "the ONLY kind explicitly denies external-provider evidence");
  });
});

test("revoke then stale fake callback: old fence denies even after OFF->ON",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+250,
    })).generation,1);
    const old=mockObservation(1,NOW+150);
    assert.equal((await t.disable()).kind,"updated");
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b),
      {kind:"revoked_test_only"});
    assert.deepEqual(await observeMockFencedCallback(t.a,old,args(t)),
      {kind:"withheld"});
    assert.deepEqual(mockObservationRows(t.b),[]);
    assert.equal((await setOwnWorkerAgoraCallPreference(
      localD1Adapter(t.b),t.workerBearer,true,2)).kind,"updated");
    assert.deepEqual(await observeMockFencedCallback(t.b,old,args(t)),
      {kind:"withheld"},"old original epoch remains invalid");
    assert.equal(outboxRows(t.a)[0].status,"revoked_test_only");
    assert.equal(outboxRows(t.b)[0].claim_generation,1);
  });
});

test("recovered lease fences stale callback generation, accepting only current local observation",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    assert.equal((await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+300,
    })).generation,2);
    assert.deepEqual(await observeMockFencedCallback(t.a,
      mockObservation(1,NOW+250),args(t)),{kind:"withheld"});
    assert.deepEqual(await observeMockFencedCallback(t.a,
      mockObservation(2,NOW+300),args(t)),{kind:"withheld"},
      "a lease valid only before 300 expires at the exact boundary");
    assert.deepEqual(await observeMockFencedCallback(t.a,
      mockObservation(2,NOW+250),args(t)),
      {kind:"local_observation_only"});
    assert.deepEqual(mockObservationRows(t.b),[{
      call_id:CALL_ID,claim_generation:2,kind:"not_provider_evidence",
    }]);
  });
});

test("terminal or forged fake call phase cannot be used as a delayed callback",async()=>{
  for(const [phase,revision] of [
    ["cancelled",1],["missed",1],["ended",2],["accepted",1],
    ["ringing",1],["nonsense",0],
  ]){
    await withTrial(async t=>{
      assert.equal((await t.enable()).kind,"updated");
      assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
      seedMockRingingState(t.a);
      assert.equal((await claimSyntheticFencedOutbox(t.b,{
        ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
      })).generation,1);
      t.a.prepare(
        "UPDATE synthetic_voice_mock_call_state " +
        "SET phase=?,revision=? WHERE call_id=?"
      ).run(phase,revision,CALL_ID);
      assert.deepEqual(await observeMockFencedCallback(t.b,
        mockObservation(1),args(t)),{kind:"withheld"},phase+"/"+revision);
      assert.deepEqual(mockObservationRows(t.a),[]);
    });
  }
});

test("callback invalid payload or unsafe current risk cannot create local observation",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    const input=mockObservation(1);
    for(const malformed of [
      null,{},input.kind,
      {...input,kind:"client_says_sent"},
      {...input,workerAccountId:WORKER},
      {...input,providerReceipt:"fake"},
      {...input,claimedConsentRevision:1},
      {...input,callId:"bad id"},
      {...input,generation:0},
      {...input,generation:1.5},
      {...input,generation:Number.MAX_SAFE_INTEGER},
      {...input,nowMs:-1},
      {...input,nowMs:NaN},
    ]){
      assert.deepEqual(await observeMockFencedCallback(t.a,malformed,args(t)),
        {kind:"withheld"});
    }
    for(const overrides of [
      {blockedByCaller:true},{workerPresence:"offline"},
      {workerAvailability:"busy"},{rateGate:"deny"},
      {recipientVerified:false},{privacyApproved:false},
    ]){
      assert.deepEqual(await observeMockFencedCallback(t.b,input,{
        ...args(t),risk:t.risk(overrides),
      }),{kind:"withheld"},JSON.stringify(overrides));
    }
    assert.deepEqual(mockObservationRows(t.a),[]);
  });
});

test("callback local crash rollback and competing writer lock preserve observation consistency",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    const input=mockObservation(1);
    await assert.rejects(()=>observeMockFencedCallback(t.b,input,{
      ...args(t),failAfterObservation:true,
    }),/synthetic callback crash before observation commit/);
    assert.deepEqual(mockObservationRows(t.a),[]);
    t.a.exec("BEGIN IMMEDIATE");
    try{
      await assert.rejects(()=>observeMockFencedCallback(t.b,input,args(t)),
        /database is locked|SQLITE_BUSY/i);
      assert.deepEqual(mockObservationRows(t.a),[]);
    }finally{t.a.exec("ROLLBACK");}
    assert.deepEqual(await observeMockFencedCallback(t.b,input,args(t)),
      {kind:"local_observation_only"});
    assert.deepEqual(mockObservationRows(t.a).map(x=>x.claim_generation),[1]);
    assert.deepEqual(t.b.prepare("PRAGMA foreign_key_check").all(),[]);
  });
});

test("local observations survive later OFF only as unverified historical test facts",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+250,
    })).generation,1);
    assert.equal((await observeMockFencedCallback(t.a,
      mockObservation(1),args(t))).kind,"local_observation_only");
    assert.equal((await t.disable()).kind,"updated");
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b),
      {kind:"revoked_test_only"});
    assert.deepEqual(await observeMockFencedCallback(t.a,
      mockObservation(1),args(t)),{kind:"withheld"});
    assert.deepEqual(mockObservationRows(t.b),[{
      call_id:CALL_ID,claim_generation:1,kind:"not_provider_evidence",
    }]);
    const persisted=JSON.stringify(mockObservationRows(t.b));
    for(const forbidden of [
      t.callerBearer,t.workerBearer,t.otherBearer,
      "sent_at","delivered_at","phone_number","channelName",
      "deviceToken","agoraToken","providerAck",
    ])assert.equal(persisted.includes(forbidden),false);
  });
});


test("unknown transport outcome cannot be promoted to delivered or safe retry",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    const request=unknownRequest(1);
    assert.deepEqual(await recordUnknownTransportBoundary(t.a,request,args(t)),
      {kind:"outcome_unknown_test_only"});
    assert.deepEqual(await recordUnknownTransportBoundary(t.b,request,args(t)),
      {kind:"still_unresolved_test_only"});
    assert.deepEqual(unknownTransportRows(t.b),[{
      call_id:CALL_ID,claim_generation:1,kind:"outcome_unknown_test_only",
    }]);
    assert.deepEqual(unverifiedHintRows(t.a),[]);
    assert.equal(outboxRows(t.a)[0].status,"claimed_test_only");
    assert.equal(JSON.stringify(unknownTransportRows(t.a)).includes("delivered"),
      false);
    assert.equal(JSON.stringify(unknownTransportRows(t.a)).includes("sent_at"),
      false);
  });
});

test("unknown-attempt crash rolls back; another local connection may record UNKNOWN once",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    const input=unknownRequest(1);
    await assert.rejects(()=>recordUnknownTransportBoundary(t.a,input,{
      ...args(t),failBeforeCommit:true,
    }),/synthetic uncertainty crash/);
    assert.deepEqual(unknownTransportRows(t.b),[]);
    assert.deepEqual(await recordUnknownTransportBoundary(t.b,input,args(t)),
      {kind:"outcome_unknown_test_only"});
    assert.equal(unknownTransportRows(t.a).length,1);
    assert.deepEqual(t.b.prepare("PRAGMA foreign_key_check").all(),[]);
  });
});

test("concurrent SQLite writers cannot create duplicate UNKNOWN attempt after a lock",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    t.a.exec("BEGIN IMMEDIATE");
    try{
      await assert.rejects(()=>recordUnknownTransportBoundary(
        t.b,unknownRequest(1),args(t)),
      /database is locked|SQLITE_BUSY/i);
      assert.deepEqual(unknownTransportRows(t.a),[]);
    }finally{t.a.exec("ROLLBACK");}
    assert.deepEqual(await recordUnknownTransportBoundary(
      t.b,unknownRequest(1),args(t)),
      {kind:"outcome_unknown_test_only"});
    assert.deepEqual(await recordUnknownTransportBoundary(
      t.a,unknownRequest(1),args(t)),
      {kind:"still_unresolved_test_only"});
    assert.equal(unknownTransportRows(t.b).length,1);
  });
});

test("recovered local lease cannot relabel old uncertain attempt as new transport success",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+200,
    })).generation,1);
    assert.equal((await recordUnknownTransportBoundary(
      t.a,unknownRequest(1),args(t))).kind,"outcome_unknown_test_only");
    assert.equal((await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+200,testLeaseUntilMs:NOW+300,
    })).generation,2);
    assert.deepEqual(await recordUnknownTransportBoundary(
      t.b,unknownRequest(2,NOW+250),args(t)),
      {kind:"withheld"},"new local generation must not silently retry unknown external action");
    assert.deepEqual(await recordUnverifiedHint(t.a,unknownHint(
      1,"unknown-feedback-one-001","maybe_accepted_test_only",NOW+250),
      args(t)),{kind:"withheld"},"old local fence cannot accept late callback");
    assert.deepEqual(unknownTransportRows(t.b),[{
      call_id:CALL_ID,claim_generation:1,kind:"outcome_unknown_test_only",
    }]);
    assert.deepEqual(unverifiedHintRows(t.b),[]);
  });
});

test("OFF, tombstone and OFF->ON leave old UNKNOWN unresolved but reject new hints",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+250,
    })).generation,1);
    assert.equal((await recordUnknownTransportBoundary(t.b,
      unknownRequest(1),args(t))).kind,"outcome_unknown_test_only");
    assert.equal((await t.disable()).kind,"updated");
    assert.deepEqual(await tombstoneRevokedSyntheticOutbox(t.b),
      {kind:"revoked_test_only"});
    assert.deepEqual(await recordUnverifiedHint(t.a,unknownHint(
      1,"unknown-feedback-two-001","maybe_accepted_test_only"),args(t)),
      {kind:"withheld"});
    assert.equal((await setOwnWorkerAgoraCallPreference(
      localD1Adapter(t.b),t.workerBearer,true,2)).kind,"updated");
    assert.deepEqual(await recordUnknownTransportBoundary(
      t.a,unknownRequest(1),args(t)),
      {kind:"still_unresolved_test_only"},
      "the historical local fact remains unresolved, never proof of fresh delivery");
    assert.deepEqual(await recordUnverifiedHint(t.b,unknownHint(
      1,"unknown-feedback-two-001","maybe_accepted_test_only"),args(t)),
      {kind:"withheld"});
    assert.equal(outboxRows(t.a)[0].status,"revoked_test_only");
    assert.equal(unknownTransportRows(t.a)[0].kind,"outcome_unknown_test_only");
    assert.deepEqual(unverifiedHintRows(t.a),[]);
  });
});

test("duplicate and conflicting mock hint keys never establish delivered or failed",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.a,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+250,
    })).generation,1);
    assert.equal((await recordUnknownTransportBoundary(t.a,
      unknownRequest(1),args(t))).kind,"outcome_unknown_test_only");
    const first=unknownHint(1,
      "unknown-feedback-three-001","maybe_accepted_test_only");
    const conflict={...first,hint:"maybe_rejected_test_only"};
    const independent=unknownHint(1,
      "unknown-feedback-three-002","maybe_rejected_test_only");
    assert.deepEqual(await recordUnverifiedHint(t.a,first,args(t)),
      {kind:"unverified_hint_only"});
    assert.deepEqual(await recordUnverifiedHint(t.b,first,args(t)),
      {kind:"duplicate_hint_test_only"});
    assert.deepEqual(await recordUnverifiedHint(t.b,conflict,args(t)),
      {kind:"withheld"},"conflict cannot rewrite already recorded local note");
    assert.deepEqual(await recordUnverifiedHint(t.b,independent,args(t)),
      {kind:"unverified_hint_only"});
    assert.equal(unverifiedHintRows(t.a).length,2);
    assert.deepEqual(unverifiedHintRows(t.b).map(r=>r.hint),[
      "maybe_accepted_test_only","maybe_rejected_test_only",
    ]);
    assert.equal(unknownTransportRows(t.a)[0].kind,
      "outcome_unknown_test_only");
    const data=JSON.stringify([...unknownTransportRows(t.a),
      ...unverifiedHintRows(t.b)]);
    for(const forbidden of ["delivered_at","sent_at","provider_ack",
      t.callerBearer,t.workerBearer,t.otherBearer,"agoraToken","deviceToken"])
      assert.equal(data.includes(forbidden),false,forbidden);
  });
});

test("hint crash rollback and unsafe or malformed fake reports fail closed",async()=>{
  await withTrial(async t=>{
    assert.equal((await t.enable()).kind,"updated");
    assert.equal((await stageSyntheticInvite(t.a,args(t))).kind,"staged_intent_only");
    seedMockRingingState(t.a);
    assert.equal((await claimSyntheticFencedOutbox(t.b,{
      ...args(t),nowMs:NOW+100,testLeaseUntilMs:NOW+250,
    })).generation,1);
    const input=unknownHint(1,
      "unknown-feedback-four-001","maybe_accepted_test_only");
    assert.deepEqual(await recordUnverifiedHint(t.a,input,args(t)),
      {kind:"withheld"},"no fabricated provider feedback without local unknown boundary");
    assert.equal((await recordUnknownTransportBoundary(t.b,
      unknownRequest(1),args(t))).kind,"outcome_unknown_test_only");
    await assert.rejects(()=>recordUnverifiedHint(t.a,input,{
      ...args(t),failBeforeCommit:true,
    }),/synthetic hint crash before commit/);
    assert.deepEqual(unverifiedHintRows(t.b),[]);
    for(const bad of [
      null,{},input.kind,
      {...input,kind:"client_says_delivered"},
      {...input,providerSignature:"forged"},
      {...input,workerAccountId:WORKER},
      {...input,generation:0},
      {...input,generation:2},
      {...input,hint:"delivered"},
      {...input,hintKey:"bad id"},
      {...input,nowMs:NOW+250},
    ])assert.deepEqual(await recordUnverifiedHint(t.b,bad,args(t)),
      {kind:"withheld"});
    for(const unsafe of [{workerPresence:"offline"},
      {blockedByWorker:true},{privacyApproved:false},
      {rateGate:"deny"},{recipientVerified:false}]){
      assert.deepEqual(await recordUnverifiedHint(t.a,input,{
        ...args(t),risk:t.risk(unsafe),
      }),{kind:"withheld"});
    }
    t.a.prepare("UPDATE synthetic_voice_mock_call_state " +
      "SET phase='cancelled',revision=1 WHERE call_id=?").run(CALL_ID);
    assert.deepEqual(await recordUnverifiedHint(t.b,input,args(t)),
      {kind:"withheld"},"terminal fake call cannot accept late hint");
    assert.equal(unknownTransportRows(t.b)[0].kind,
      "outcome_unknown_test_only");
    assert.deepEqual(unverifiedHintRows(t.b),[]);
  });
});

test("test-only UNKNOWN transport ledger never appears in production migrations",()=>{
  const real=openLocalDatabase();
  try{
    const names=real.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table'"
    ).all().map(r=>r.name);
    for(const name of ["synthetic_voice_unknown_transport",
      "synthetic_voice_unverified_hints"])
      assert.equal(names.includes(name),false);
  }finally{real.db.close();}
});

test("test-only journal creates no API, production D1 tables, Agora SDK or live call",async()=>{
  const local=openLocalDatabase();
  try{
    const names=local.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table'").all()
      .map(r=>r.name);
    for(const table of ["synthetic_voice_invites","synthetic_voice_outbox",
      "call_sessions","agora_channels","worker_presence"]){
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
