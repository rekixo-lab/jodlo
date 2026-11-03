import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession, revokeSession } from "../src/modules/identity/sessions.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { setOwnWorkerAgoraCallPreference } from
  "../src/modules/workers/agora-call-preference.ts";
import {
  readOwnWorkerAvailability, setOwnWorkerAvailability,
  setOwnAgoraAccountBlock, readLocalCallerAgoraSafetyFacts,
  READ_CALLER_AGORA_PRIVATE_SAFETY_QUERY,
} from "../src/modules/interactions/agora-private-safety-state.ts";

const CALLER="account-private-safety-caller";
const WORKER="account-private-safety-worker";
const OTHER="account-private-safety-other";
const CATEGORY="private-safety-category";
const DENIED={kind:"denied"};

async function fixture(){
  const {db,adapter}=openLocalDatabase();
  try{
    for(const id of [CALLER,WORKER,OTHER]) await ensureAccount(adapter,id);
    await optInAsWorker(adapter,WORKER);
    db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)"
    ).run(CATEGORY,CATEGORY,"Private safety fixture","सुरक्षित परीक्षण");
    const listing=await publishListing(adapter,WORKER,CATEGORY);
    const caller=(await issueSession(adapter,CALLER))?.accessToken;
    const worker=(await issueSession(adapter,WORKER))?.accessToken;
    const other=(await issueSession(adapter,OTHER))?.accessToken;
    assert.ok(listing&&caller&&worker&&other);
    const read=(bearer=caller,id=listing.id)=>readLocalCallerAgoraSafetyFacts(
      adapter,bearer,id);
    return {db,adapter,listing,caller,worker,other,read,
      availability:(enabled,revision,bearer=worker)=>
        setOwnWorkerAvailability(adapter,bearer,enabled,revision),
      block:(bearer,target,blocked=true)=>
        setOwnAgoraAccountBlock(adapter,bearer,target,blocked),
      consent:(on,rev)=>setOwnWorkerAgoraCallPreference(
        adapter,worker,on,rev),
      close(){db.close();}};
  }catch(e){db.close();throw e;}
}

test("migration 0008 is empty, rejects sensitive/nonminimal data and cascades references",async()=>{
  const f=await fixture();
  try{
    for(const table of [
      "worker_agora_availability_preferences",
      "agora_account_blocks",
      "agora_abuse_window_counters",
    ]){
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM "+table).get().n,0);
      const cols=f.db.prepare("PRAGMA table_info("+table+")").all()
        .map(x=>x.name).sort();
      assert.equal(cols.some(x=>/phone|gps|call_id|ip|device|payload|message|raw_token|reason|email/i.test(x)),false);
    }
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
    assert.throws(()=>f.db.prepare(
      "INSERT INTO agora_account_blocks(blocker_account_id,blocked_account_id) VALUES(?,?)"
    ).run(CALLER,CALLER),/CHECK constraint/);
    assert.throws(()=>f.db.prepare(
      "INSERT INTO worker_agora_availability_preferences(account_id,accepting_calls,revision) VALUES(?,?,?)"
    ).run(CALLER,1,1),/FOREIGN KEY/);
    assert.throws(()=>f.db.prepare(
      "INSERT INTO worker_agora_availability_preferences(account_id,accepting_calls,revision) VALUES(?,?,?)"
    ).run(WORKER,2,1),/CHECK constraint/);
    assert.throws(()=>f.db.prepare(
      "INSERT INTO agora_abuse_window_counters(actor_account_id,scope,window_start_ms,expires_at_ms,attempt_count,revision) VALUES(?,?,?,?,?,?)"
    ).run(CALLER,"invite",100,100,0,1),/CHECK constraint/);
    assert.throws(()=>f.db.prepare(
      "INSERT INTO agora_abuse_window_counters(actor_account_id,scope,window_start_ms,expires_at_ms,attempt_count,revision) VALUES(?,?,?,?,?,?)"
    ).run(CALLER,"unknown",100,200,0,1),/CHECK constraint/);
    assert.throws(()=>f.db.prepare(
      "INSERT INTO agora_abuse_window_counters(actor_account_id,scope,window_start_ms,expires_at_ms,attempt_count,revision) VALUES(?,?,?,?,?,?)"
    ).run(CALLER,"invite",100,200,-1,1),/CHECK constraint/);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM agora_abuse_window_counters").get().n,0);
  }finally{f.close();}
});

test("owner-only availability is OFF by absence; CAS guards stale writes and cannot enable call consent",async()=>{
  const f=await fixture();
  try{
    assert.deepEqual(await readOwnWorkerAvailability(f.adapter,f.worker),
      {acceptingCalls:false,revision:0});
    assert.equal(await readOwnWorkerAvailability(f.adapter,f.caller),null);
    assert.deepEqual(await f.availability(true,0,f.caller),DENIED);
    assert.deepEqual(await f.availability(true,0,f.other),DENIED);
    assert.deepEqual(await f.availability("true",0),DENIED);
    assert.deepEqual(await f.availability(true,-1),DENIED);
    assert.deepEqual(await f.availability(true,1),DENIED);
    assert.deepEqual(await f.availability(true,0),{
      kind:"updated",preference:{acceptingCalls:true,revision:1},
    });
    assert.equal(Object.isFrozen(
      (await readOwnWorkerAvailability(f.adapter,f.worker))),true);
    assert.deepEqual(await f.availability(false,0),DENIED);
    assert.deepEqual(await f.availability(true,0),DENIED);
    assert.deepEqual(await f.availability(false,1),{
      kind:"updated",preference:{acceptingCalls:false,revision:2},
    });
    assert.deepEqual(await f.availability(true,1),DENIED);
    assert.deepEqual(await f.availability(true,2),{
      kind:"updated",preference:{acceptingCalls:true,revision:3},
    });
    assert.equal(await f.read(),null,
      "availability alone must NOT override missing explicit Agora opt-in");
    assert.deepEqual(await f.consent(true,0),{
      kind:"updated",preference:{enabled:true,revision:1},
    });
    assert.deepEqual(await f.read(),{
      acceptingCalls:true,availabilityRevision:3,consentRevision:1,
      blockedByCaller:false,blockedByWorker:false,
      rateGate:"unknown",workerPresence:"unknown",
    });
    assert.deepEqual(await f.consent(false,1),{
      kind:"updated",preference:{enabled:false,revision:2},
    });
    assert.equal(await f.read(),null);
  }finally{f.close();}
});

test("two-way block privacy: only the caller/worker may set their OWN direction",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.consent(true,0)).kind,"updated");
    let facts=await f.read();
    assert.equal(facts.acceptingCalls,false,"missing preference is unavailable");
    assert.equal(facts.availabilityRevision,0);
    assert.equal(facts.workerPresence,"unknown");
    assert.equal(facts.rateGate,"unknown");
    assert.equal(await f.block(f.caller,CALLER),DENIED);
    assert.deepEqual(await f.block(f.caller,WORKER),{kind:"updated"});
    assert.deepEqual(await f.block(f.caller,WORKER),DENIED);
    facts=await f.read();
    assert.equal(facts.blockedByCaller,true);
    assert.equal(facts.blockedByWorker,false);
    assert.deepEqual(await f.block(f.worker,CALLER),{kind:"updated"});
    facts=await f.read();
    assert.equal(facts.blockedByCaller,true);
    assert.equal(facts.blockedByWorker,true);
    assert.deepEqual(await f.block(f.other,CALLER),{kind:"updated"},
      "other user may only set a relationship for their OWN account");
    facts=await f.read();
    assert.equal(facts.blockedByCaller,true);
    assert.equal(facts.blockedByWorker,true);
    assert.deepEqual(await f.block(f.caller,WORKER,false),{kind:"updated"});
    facts=await f.read();
    assert.equal(facts.blockedByCaller,false);
    assert.equal(facts.blockedByWorker,true);
    assert.deepEqual(await f.block(f.caller,WORKER,false),DENIED);
    assert.deepEqual(await f.block(f.worker,CALLER,false),{kind:"updated"});
    facts=await f.read();
    assert.equal(facts.blockedByCaller,false);
    assert.equal(facts.blockedByWorker,false);
    assert.equal(Object.isFrozen(facts),true);
    const rows=f.db.prepare("SELECT * FROM agora_account_blocks").all();
    assert.deepEqual(rows.map(x=>Object.keys(x).sort()),[
      ["blocked_account_id","blocker_account_id"],
    ]);
    assert.equal(rows[0].blocker_account_id,OTHER);
    assert.equal(rows[0].blocked_account_id,CALLER);
    assert.deepEqual(await f.block(f.worker,WORKER),DENIED);
    assert.deepEqual(await f.block("forged",CALLER),DENIED);
  }finally{f.close();}
});

test("private safety read denies stale sessions, disabled accounts and unpublished listings",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.consent(true,0)).kind,"updated");
    assert.ok(await f.read());
    assert.equal(await f.read("forged"),null);
    assert.equal(await f.read(f.worker),null,
      "worker cannot self-call through its own worker listing");
    assert.equal((await f.read(f.other))?.blockedByCaller,false,
      "second caller gets a separate private relationship state");
    assert.equal(await revokeSession(f.adapter,f.caller),true);
    assert.equal(await f.read(),null);
    const another=(await issueSession(f.adapter,CALLER))?.accessToken;
    assert.ok(another);
    f.db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(f.listing.id);
    assert.equal(await f.read(another),null);
    f.db.prepare("UPDATE worker_listings SET moderation_status='allowed' WHERE id=?")
      .run(f.listing.id);
    f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(WORKER);
    assert.equal(await f.read(another),null);
    assert.deepEqual(await f.availability(false,0),DENIED);
    assert.deepEqual(await f.block(f.worker,CALLER),DENIED);
  }finally{f.close();}
});

test("invalid or spoofed fake-D1 read rows fail closed; block facts are not public API",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.consent(true,0)).kind,"updated");
    const base=await f.read();
    assert.ok(base);
    const brokenField=[
      {consentRevision:0},{consentRevision:"1"},
      {blockedByCaller:2},{blockedByWorker:null},
      {acceptingCalls:1,availabilityRevision:null},
      {acceptingCalls:true,availabilityRevision:1},
      {acceptingCalls:null,availabilityRevision:1},
    ];
    for(const tamper of brokenField){
      const fake={prepare:()=>({bind:()=>({all:async()=>({
        results:[{
          consentRevision:1,acceptingCalls:null,availabilityRevision:null,
          blockedByCaller:0,blockedByWorker:0,...tamper,
        }],
      })})})};
      assert.equal(await readLocalCallerAgoraSafetyFacts(fake,f.caller,f.listing.id),null,
        JSON.stringify(tamper));
    }
    const duplicate={prepare:()=>({bind:()=>({all:async()=>({
      results:[base,base],
    })})})};
    assert.equal(await readLocalCallerAgoraSafetyFacts(
      duplicate,f.caller,f.listing.id),null);
    assert.ok(READ_CALLER_AGORA_PRIVATE_SAFETY_QUERY.includes("EXISTS("));
    assert.ok(READ_CALLER_AGORA_PRIVATE_SAFETY_QUERY.includes("pref.calls_enabled=1"));
    assert.equal(READ_CALLER_AGORA_PRIVATE_SAFETY_QUERY.includes("auth_sessions"),true);
    assert.deepEqual(Object.keys(base).sort(),[
      "acceptingCalls","availabilityRevision","blockedByCaller",
      "blockedByWorker","consentRevision","rateGate","workerPresence",
    ]);
    assert.equal(JSON.stringify(base).includes(f.caller),false);
    assert.equal(JSON.stringify(base).includes(f.worker),false);
    assert.equal(JSON.stringify(base).includes("phone"),false);
  }finally{f.close();}
});

test("account deletion cascades private blocks/availability/aggregate counters in disposable D1",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.availability(true,0)).kind,"updated");
    assert.deepEqual(await f.block(f.caller,WORKER),{kind:"updated"});
    assert.deepEqual(await f.block(f.worker,CALLER),{kind:"updated"});
    // Aggregate fixture only: no policy-defined ingest, retention or rate limit.
    f.db.prepare(
      "INSERT INTO agora_abuse_window_counters(actor_account_id,scope,window_start_ms,expires_at_ms,attempt_count,revision) VALUES(?,?,?,?,?,?)"
    ).run(CALLER,"invite",100,200,1,1);
    f.db.prepare("DELETE FROM accounts WHERE id=?").run(CALLER);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM agora_account_blocks").get().n,0);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM agora_abuse_window_counters").get().n,0);
    f.db.prepare("DELETE FROM accounts WHERE id=?").run(WORKER);
    assert.equal(f.db.prepare(
      "SELECT count(*) AS n FROM worker_agora_availability_preferences"
    ).get().n,0);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{f.close();}
});
