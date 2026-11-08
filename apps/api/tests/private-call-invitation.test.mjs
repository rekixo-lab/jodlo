import assert from "node:assert/strict";
import test from "node:test";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { ownPrivateCallSignal } from "../src/modules/interactions/private-call-signaling.ts";
import { claimPrivateCallDispatch } from "../src/modules/interactions/private-call-dispatch.ts";
import { sendPrivateCallRing } from "../src/modules/interactions/private-call-ring.ts";
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
    const ringAt = now + 180_000;
    const ring = await preparePrivateCallInvitation(adapter, secondToken, alternate,
      "delivery-attempt-key", ringAt);
    assert.equal(ring.kind, "created");
    const requests = [];
    const deps = {
      projectId:"jodlo-test",
      accessToken:async () => "test-access-token",
      resolveReachableDevice:async () => ({accountId:receiver, registrationToken:"synthetic-device-token"}),
      request:async (url, init) => {
        requests.push({url, body:JSON.parse(init.body)});
        return new Response("{}", {status:200});
      },
      now:() => ringAt,
    };
    assert.equal(await sendPrivateCallRing(adapter, receiverToken, ring.invitationId, deps), "not_sent");
    assert.equal(await sendPrivateCallRing(adapter, secondToken, ring.invitationId,
      {...deps, resolveReachableDevice:async () => null}), "not_sent");
    const sends = await Promise.all([
      sendPrivateCallRing(adapter, secondToken, ring.invitationId, deps),
      sendPrivateCallRing(adapter, secondToken, ring.invitationId, deps),
    ]);
    assert.deepEqual(sends.sort(), ["not_sent", "provider_accepted"]);
    assert.deepEqual(requests, [{
      url:"https://fcm.googleapis.com/v1/projects/jodlo-test/messages:send",
      body:{message:{
        token:"synthetic-device-token",
        android:{ttl:"90s",priority:"HIGH",restricted_package_name:"com.rekixo.jodlo"},
        data:{eventId:ring.invitationId,eventType:"call_ring",expiresAtMs:String(ringAt + 90_000)},
      }},
    }]);

    const uncertainAt = ringAt + 90_000;
    const uncertain = await preparePrivateCallInvitation(adapter, secondToken, alternate,
      "uncertain-attempt-key", uncertainAt);
    assert.equal(uncertain.kind, "created");
    const uncertainDeps = {...deps, now:() => uncertainAt, request:async () => {
      throw new Error("synthetic transport failure");
    }};
    assert.equal(await sendPrivateCallRing(adapter, secondToken, uncertain.invitationId,
      uncertainDeps), "delivery_unconfirmed");
    assert.equal(await sendPrivateCallRing(adapter, secondToken, uncertain.invitationId,
      uncertainDeps), "not_sent");

    await purgeExpiredPrivateInvitations(adapter, uncertainAt + 300_000);
    assert.equal(rows(), 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM private_call_dispatch_slots").get().count, 0);
  } finally {
    db.close();
  }
});

test("call device registration requires a current opted-in session and removes tokens on opt-out", async () => {
  const {db, adapter} = openLocalDatabase();
  try {
    const {handleRequest} = await import("../src/http/router.ts");
    db.exec(`
      INSERT INTO accounts(id) VALUES ('device-worker'),('other-worker');
      INSERT INTO worker_profiles(account_id,status) VALUES ('device-worker','draft'),('other-worker','draft');
      INSERT INTO worker_agora_call_preferences VALUES ('device-worker',0,1),('other-worker',1,1);
    `);
    const first = (await issueSession(adapter, "device-worker")).accessToken;
    const second = (await issueSession(adapter, "other-worker")).accessToken;
    const send = (bearer, registrationToken, enabled = "1") => handleRequest(
      new Request("https://example.invalid/api/v1/me/call-device", {
        method: registrationToken === undefined ? "DELETE" : "PUT",
        headers: {Authorization: `Bearer ${bearer}`, "Content-Type": "application/json"},
        body: registrationToken === undefined ? undefined : JSON.stringify({registrationToken}),
      }),
      {DB:adapter,CALL_DEVICES_ENABLED:enabled},
    );
    assert.equal((await send(first, "synthetic:device", "0")).status, 404);
    assert.equal((await send(first, "synthetic:device")).status, 403);
    db.exec("UPDATE worker_agora_call_preferences SET calls_enabled=1 WHERE account_id='device-worker'");
    assert.equal((await send(first, "synthetic:device")).status, 200);
    assert.equal((await send(second, "synthetic:device")).status, 403);
    assert.equal((await send(first, "synthetic:rotated")).status, 200);
    assert.equal((await send(second, "synthetic:device")).status, 200);
    assert.equal((await send(second)).status, 200);
    db.exec("UPDATE worker_agora_call_preferences SET calls_enabled=0 WHERE account_id='device-worker'");
    assert.equal(db.prepare("SELECT count(*) AS total FROM private_call_devices").get().total, 0);
    assert.equal((await send(second, "synthetic:device")).status, 200);
    db.exec("DELETE FROM auth_sessions WHERE account_id='other-worker'");
    assert.equal(db.prepare("SELECT count(*) AS total FROM private_call_devices").get().total, 0);
    assert.equal((await send(second, "synthetic:device")).status, 401);
  } finally {
    db.close();
  }
});

test("call signaling enforces participant roles, dispatch, current consent, and terminal states", async () => {
  const {db, adapter} = openLocalDatabase();
  try {
    db.exec(`
      INSERT INTO accounts(id) VALUES ('signal-caller'),('signal-worker'),('signal-outsider');
      INSERT INTO categories(id,slug,name_en,is_active) VALUES ('repair','repair','Repair',1);
      INSERT INTO worker_profiles(account_id,status) VALUES ('signal-worker','draft');
      INSERT INTO worker_listings(id,worker_account_id,category_id,status)
        VALUES ('d23e2000-d7e3-4a55-8eea-3328e2292526','signal-worker','repair','published');
      INSERT INTO worker_agora_call_preferences VALUES ('signal-worker',1,1);
      INSERT INTO worker_agora_availability_preferences VALUES ('signal-worker',1,1);
    `);
    const [caller, worker, outsider] = await Promise.all(["signal-caller","signal-worker","signal-outsider"]
      .map(async account => (await issueSession(adapter, account)).accessToken));
    const now = Date.now();
    const start = key => preparePrivateCallInvitation(adapter, caller, "d23e2000-d7e3-4a55-8eea-3328e2292526", key, now);
    const first = await start("first-signal-key");
    const act = (token, action, time = now) =>
      ownPrivateCallSignal(adapter, token, first.invitationId, action, time);
    assert.equal((await act(caller)).phase, "pending");
    assert.equal(await act(worker), null);
    assert.ok(await claimPrivateCallDispatch(adapter, caller, first.invitationId, "signal-worker", now));
    assert.equal((await act(worker)).phase, "ringing");
    const {handleRequest} = await import("../src/http/router.ts");
    const url = `https://example.invalid/api/v1/me/call?id=${first.invitationId}`;
    const request = new Request(url, {headers:{Authorization:`Bearer ${worker}`}});
    assert.equal((await handleRequest(request, {DB:adapter})).status, 404);
    const reply = await handleRequest(request, {DB:adapter,CALL_SIGNALING_ENABLED:"1"});
    assert.deepEqual(await reply.json(), {ok:true,data:{
      role:"receiver",phase:"ringing",ringDeadlineMs:first.ringDeadlineMs,
    }});
    assert.equal(await act(worker, "ack"), null, "a device binding is needed to acknowledge delivery");
    const {registerOwnCallDevice} = await import("../src/modules/notifications/private-call-devices.ts");
    assert.equal(await registerOwnCallDevice(adapter, worker, "synthetic:ack-device"), true);
    assert.equal((await act(worker, "ack")).phase, "ringing");
    assert.equal(db.prepare("SELECT received_at_ms FROM private_call_invitations WHERE id=?")
      .get(first.invitationId).received_at_ms, now);
    assert.equal(await act(outsider, "accept"), null);
    assert.equal(await act(caller, "accept"), null);
    assert.equal(await act(worker, "cancel"), null);
    db.exec("UPDATE worker_agora_call_preferences SET calls_enabled=0");
    assert.equal(await act(worker, "accept"), null);
    db.exec("UPDATE worker_agora_call_preferences SET calls_enabled=1");
    assert.equal((await act(worker, "accept")).phase, "accepted");
    assert.equal((await act(worker, "accept")).phase, "accepted");
    assert.equal((await act(caller)).phase, "accepted");
    const {issueOwnAgoraAudioGrant, JODLO_AGORA_APP_ID} =
      await import("../src/modules/interactions/private-agora-media.ts");
    const {AccessToken2, kRtcServiceType} = await import("agora-token/src/AccessToken2.js");
    const certificate = "a".repeat(32);
    const issue = bearer => issueOwnAgoraAudioGrant(adapter, bearer, first.invitationId, certificate, now);
    const secondWorkerSession = (await issueSession(adapter, "signal-worker")).accessToken;
    assert.equal(await issue(secondWorkerSession), null);
    assert.equal(await issue(outsider), null);
    const callerGrant = await issue(caller);
    const workerGrant = await issue(worker);
    assert.equal(callerGrant.appId, JODLO_AGORA_APP_ID);
    assert.equal(callerGrant.channel, workerGrant.channel);
    assert.equal(callerGrant.uid, 1);
    assert.equal(workerGrant.uid, 2);
    assert.equal(callerGrant.expiresInSeconds, 60);
    const decoded = new AccessToken2();
    assert.equal(decoded.from_string(workerGrant.token), true);
    assert.equal(decoded.verifySignature(certificate), true);
    assert.equal(decoded.getServices(kRtcServiceType)[0].__uid.toString(), "2");
    assert.deepEqual({...decoded.getServices(kRtcServiceType)[0].__privileges}, {1:60,2:60});
    assert.equal((await act(caller, "hangup")).phase, "ended");
    assert.equal(await issue(caller), null);
    assert.deepEqual(db.prepare("SELECT direction,outcome,connected_seconds FROM call_history ORDER BY direction")
      .all().map(row => ({...row})), [
      {direction:"incoming",outcome:"ended",connected_seconds:0},
      {direction:"outgoing",outcome:"ended",connected_seconds:0},
    ]);
    assert.equal(await act(worker, "accept"), null);
    const preference = (suffix = "", method = "GET") => new Request(
      `https://example.invalid/api/v1/me/call-availability${suffix}`,
      {method,headers:{Authorization:`Bearer ${worker}`}},
    );
    assert.equal((await handleRequest(preference(), {DB:adapter})).status, 404);
    const env = {DB:adapter,CALL_SIGNALING_ENABLED:"1"};
    assert.deepEqual((await (await handleRequest(preference(), env)).json()).data, {enabled:true,revision:1});
    const stale = await start("before-unavailable");
    assert.equal((await handleRequest(preference("?enabled=0&revision=1", "POST"), env)).status, 200);
    assert.equal((await start("while-unavailable")).kind, "denied");
    assert.equal((await handleRequest(preference("?enabled=1&revision=2", "POST"), env)).status, 200);
    assert.equal(await claimPrivateCallDispatch(adapter, caller, stale.invitationId, "signal-worker", now), null);
    const second = await start("other-signal-key");
    assert.equal((await ownPrivateCallSignal(adapter, caller, second.invitationId,
      undefined, now + 90_000)).phase, "missed");
    assert.equal(await ownPrivateCallSignal(adapter, worker, second.invitationId,
      "accept", now + 90_000), null);
    await purgeExpiredPrivateInvitations(adapter, now + 300_000);
    await purgeExpiredPrivateInvitations(adapter, now + 300_000);
    assert.deepEqual({...db.prepare("SELECT direction,outcome,connected_seconds FROM call_history WHERE id=?")
      .get(second.invitationId)}, {direction:"outgoing",outcome:"missed",connected_seconds:0});
    assert.equal(db.prepare("SELECT count(*) AS total FROM call_history WHERE account_id='signal-worker'")
      .get().total, 1, "an unseen invitation adds no receiver history");
    db.exec("DELETE FROM accounts WHERE id='signal-worker'");
    assert.equal(db.prepare("SELECT count(*) AS total FROM call_history WHERE account_id='signal-worker'")
      .get().total, 0);
  } finally {
    db.close();
  }
});
