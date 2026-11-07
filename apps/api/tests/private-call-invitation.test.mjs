import assert from "node:assert/strict";
import test from "node:test";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { claimPrivateCallDispatch } from "../src/modules/interactions/private-call-dispatch.ts";
import { preparePrivateCallInvitation, purgeExpiredPrivateInvitations } from "../src/modules/interactions/private-call-invitation.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

test("private invitation commits with quota, deduplicates retries and rolls back on failure", async () => {
  const {db, adapter} = openLocalDatabase();
  try {
    const caller = "invite-caller";
    const receiver = "invite-worker";
    const listing = crypto.randomUUID();
    const alternate = crypto.randomUUID();
    const now = Date.now();
    db.exec(`
      INSERT INTO accounts(id) VALUES ('invite-caller'),('invite-worker');
      INSERT INTO categories(id,slug,name_en,is_active)
        VALUES ('repair','repair','Repair',1),('craft','craft','Craft',1);
      INSERT INTO worker_profiles(account_id,status) VALUES ('invite-worker','draft');
      INSERT INTO worker_agora_call_preferences VALUES ('invite-worker',1,1);
      INSERT INTO worker_agora_availability_preferences VALUES ('invite-worker',1,1);
    `);
    const addListing = db.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id,status) VALUES(?,?,?,'published')");
    addListing.run(listing, receiver, "repair");
    addListing.run(alternate, receiver, "craft");
    const {accessToken} = await issueSession(adapter, caller);
    const prepare = (key, listingId = listing) =>
      preparePrivateCallInvitation(adapter, accessToken, listingId, key, now);
    const counters = () => db.prepare("SELECT attempt_count FROM call_attempt_windows ORDER BY counter_key")
      .all().map(row => row.attempt_count);
    const rows = () => db.prepare("SELECT count(*) AS count FROM private_call_invitations").get().count;

    db.exec("CREATE TRIGGER fail_quota BEFORE INSERT ON call_attempt_windows BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
    await assert.rejects(prepare("first-attempt-key"), /injected failure/);
    assert.equal(rows(), 0);
    assert.deepEqual(counters(), []);
    db.exec("DROP TRIGGER fail_quota");

    const concurrent = await Promise.all([prepare("first-attempt-key"), prepare("first-attempt-key")]);
    assert.deepEqual(concurrent.map(x => x.kind).sort(), ["created", "replay"]);
    assert.equal(concurrent[0].invitationId, concurrent[1].invitationId);
    assert.equal(concurrent[0].ringDeadlineMs, now + 90_000);
    assert.equal(rows(), 1);
    assert.deepEqual(counters(), [1, 1, 1]);
    assert.deepEqual(await prepare("first-attempt-key", alternate), {kind:"denied"});
    assert.deepEqual(counters(), [1, 1, 1]);

    db.prepare("INSERT INTO agora_account_blocks(blocker_account_id,blocked_account_id) VALUES(?,?)")
      .run(receiver, caller);
    assert.deepEqual(await prepare("blocked-new-attempt"), {kind:"denied"});
    assert.deepEqual(counters(), [1, 1, 1]);
    db.exec("DELETE FROM agora_account_blocks");

    const revokeBeforeWrite = {
      ...adapter,
      batch(statements) {
        db.exec("UPDATE worker_agora_call_preferences SET calls_enabled=0");
        return adapter.batch(statements);
      },
    };
    assert.deepEqual(await preparePrivateCallInvitation(revokeBeforeWrite, accessToken,
      listing, "consent-race-key", now), {kind:"denied"});
    assert.equal(rows(), 1);
    assert.deepEqual(counters(), [1, 1, 1]);
    db.exec("UPDATE worker_agora_call_preferences SET calls_enabled=1, revision=revision+1");

    for (let i = 1; i < 8; i++) assert.equal((await prepare(`another-attempt-${i}`)).kind, "created");
    assert.deepEqual(await prepare("ninth-attempt"), {kind:"denied"});
    assert.equal((await prepare("first-attempt-key")).kind, "replay");
    assert.equal(rows(), 8);
    assert.deepEqual(counters(), [8, 8, 8]);

    const staleId = concurrent[0].invitationId;
    const [freshId, otherFreshId] = db.prepare(
      "SELECT id FROM private_call_invitations WHERE consent_revision=2 ORDER BY id LIMIT 2",
    ).all().map(row => row.id);
    const claim = (id, reachable = receiver, time = now, token = accessToken) =>
      claimPrivateCallDispatch(adapter, token, id, reachable, time);
    assert.equal(await claim(staleId), null, "consent OFF then ON invalidates old invitations");
    assert.equal(await claim(freshId, null), null, "availability alone is not reachability");
    assert.equal(await claim(freshId, caller), null);
    const {accessToken:receiverToken} = await issueSession(adapter, receiver);
    assert.equal(await claim(freshId, receiver, now, receiverToken), null);
    for (const [blocker, blocked] of [[caller, receiver], [receiver, caller]]) {
      db.prepare("INSERT INTO agora_account_blocks(blocker_account_id,blocked_account_id) VALUES(?,?)")
        .run(blocker, blocked);
      assert.equal(await claim(freshId), null, "a new block denies dispatch in either direction");
      db.exec("DELETE FROM agora_account_blocks");
    }
    db.exec("UPDATE worker_listings SET report_hold=1");
    assert.equal(await claim(freshId), null);
    db.exec("UPDATE worker_listings SET report_hold=0");
    const claims = await Promise.all([claim(freshId), claim(otherFreshId)]);
    const granted = claims.filter(Boolean);
    assert.equal(granted.length, 1);
    assert.deepEqual(granted[0], {
      invitationId:granted[0].invitationId, ringDeadlineMs:now + 90_000,
    });
    assert.equal(await claim(granted[0].invitationId), null, "duplicate claim cannot dispatch");
    assert.equal(await claim(freshId, receiver, now + 90_000), null);
    assert.deepEqual(counters(), [8, 8, 8], "dispatch does not reserve quota again");

    db.exec("INSERT INTO accounts(id) VALUES ('second-caller')");
    const {accessToken:secondToken} = await issueSession(adapter, "second-caller");
    const next = await preparePrivateCallInvitation(adapter, secondToken, alternate,
      "second-caller-attempt", now + 90_000);
    assert.equal(next.kind, "created");
    assert.deepEqual(await claim(next.invitationId, receiver, now + 90_000, secondToken), {
      invitationId:next.invitationId, ringDeadlineMs:now + 180_000,
    });
    await purgeExpiredPrivateInvitations(adapter, now + 390_000);
    assert.equal(rows(), 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM private_call_dispatch_slots").get().count, 0);
  } finally {
    db.close();
  }
});
