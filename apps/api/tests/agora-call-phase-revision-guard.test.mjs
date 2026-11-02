import assert from "node:assert/strict";
import test from "node:test";
import {
  decideSyntheticAgoraCallEvent,
  assessSyntheticAgoraJoinPrerequisites,
} from "../src/modules/interactions/agora-call-lifecycle.ts";
import {
  assessSyntheticAgoraSignalingIntent,
} from "../src/modules/interactions/agora-signaling-intent.ts";

/**
 * OFFLINE REDUCER ONLY. These are synthetic, trusted test identities and
 * fixed test timestamps. No auth, persistent call record, Agora credential,
 * provider signal, phone, real presence, approved ring/RTC limit or policy.
 */
const CALLER = "account-phase-guard-caller";
const WORKER = "account-phase-guard-worker";
const CREATED = 1_800_000_000_000;
const DEADLINE = CREATED + 30_000;

const call = (phase = "ringing", revision = 0) => ({
  callId: "call-phase-guard-000001",
  listingId: "listing-phase-guard-0001",
  categoryId: "phase-guard-category",
  callerAccountId: CALLER,
  workerAccountId: WORKER,
  phase, revision, createdAtMs: CREATED, ringDeadlineMs: DEADLINE,
});
let sequence = 0;
const cmd = (actorAccountId, event, expectedRevision, nowMs = CREATED + 1000) => ({
  actorAccountId, event, expectedRevision, nowMs,
  idempotencyKey: "phase-guard-key-" + String(++sequence).padStart(8, "0"),
});
const reject = code => ({ kind: "reject", code });
const deny = reason => ({ kind: "denied", reason });

test("all impossible synthetic phase/revision combinations deny reducer, signaling and join", () => {
  const impossible = [
    ["ringing", 1], ["ringing", 2],
    ["accepted", 0], ["accepted", 2], ["accepted", 3],
    ["connected", 0], ["connected", 1], ["connected", 3],
    ["declined", 0], ["declined", 2],
    ["busy", 0], ["busy", 3],
    ["cancelled", 0], ["cancelled", 2],
    ["missed", 0], ["missed", 2],
    ["ended", 0], ["ended", 1], ["ended", 4],
  ];
  for (const [phase, revision] of impossible) {
    const state = call(phase, revision);
    const command = cmd(WORKER, "hangup", revision);
    const copy = structuredClone(state);
    assert.deepEqual(
      decideSyntheticAgoraCallEvent(state, command),
      reject("INVALID_INPUT"), phase + "/" + revision,
    );
    assert.deepEqual(
      assessSyntheticAgoraSignalingIntent(state, command),
      deny("INVALID_INPUT"), phase + "/" + revision,
    );
    assert.deepEqual(
      assessSyntheticAgoraJoinPrerequisites(state, CALLER, revision, null, null),
      deny("INVALID_STATE"), phase + "/" + revision,
    );
    assert.deepEqual(state, copy, "invalid input must not be mutated");
  }
  assert.equal(impossible.length, 19);
});

test("each reachable synthetic phase and revision remains valid", () => {
  const cases = [
    ["ringing", 0], ["accepted", 1], ["connected", 2],
    ["declined", 1], ["busy", 1], ["cancelled", 1],
    ["missed", 1], ["ended", 2], ["ended", 3],
  ];
  for (const [phase, revision] of cases) {
    // A correctly formed but non-transitioning state is NOT INVALID_INPUT.
    const outcome = decideSyntheticAgoraCallEvent(
      call(phase, revision), cmd(WORKER, "hangup", revision),
    );
    assert.notDeepEqual(outcome, reject("INVALID_INPUT"), phase + "/" + revision);
  }
  assert.equal(cases.length, 9);
});

test("accepted-to-ended and connected-to-ended legitimate paths still work", () => {
  const original = call();
  const acceptedCmd = cmd(WORKER, "accept", 0);
  const accepted = decideSyntheticAgoraCallEvent(original, acceptedCmd);
  assert.equal(accepted.kind, "apply");
  assert.equal(accepted.result.phase, "accepted");
  assert.equal(accepted.result.revision, 1);

  const directHangupCmd = cmd(CALLER, "hangup", 1, CREATED + 2000);
  const endedFromAccepted = decideSyntheticAgoraCallEvent(
    accepted.result, directHangupCmd,
  );
  assert.equal(endedFromAccepted.kind, "apply");
  assert.equal(endedFromAccepted.result.phase, "ended");
  assert.equal(endedFromAccepted.result.revision, 2);
  assert.deepEqual(
    decideSyntheticAgoraCallEvent(
      endedFromAccepted.result, directHangupCmd, endedFromAccepted.receipt,
    ),
    { kind: "replay", receipt: endedFromAccepted.receipt },
  );

  const mediaCmd = cmd(null, "media_ready", 1, CREATED + 3000);
  const connected = decideSyntheticAgoraCallEvent(accepted.result, mediaCmd);
  assert.equal(connected.kind, "apply");
  assert.equal(connected.result.phase, "connected");
  assert.equal(connected.result.revision, 2);

  const finalHangupCmd = cmd(WORKER, "hangup", 2, CREATED + 4000);
  const endedFromConnected = decideSyntheticAgoraCallEvent(
    connected.result, finalHangupCmd,
  );
  assert.equal(endedFromConnected.kind, "apply");
  assert.equal(endedFromConnected.result.phase, "ended");
  assert.equal(endedFromConnected.result.revision, 3);
  for (const [command, receipt] of [
    [acceptedCmd, accepted.receipt],
    [mediaCmd, connected.receipt],
    [finalHangupCmd, endedFromConnected.receipt],
  ]) {
    assert.deepEqual(
      decideSyntheticAgoraCallEvent(endedFromConnected.result, command, receipt),
      { kind: "replay", receipt },
      "exact historical receipts still replay without new state changes",
    );
  }
});

test("forged receipt with impossible result revision never replays", () => {
  const original = call();
  const accept = cmd(WORKER, "accept", 0);
  const committed = decideSyntheticAgoraCallEvent(original, accept);
  assert.equal(committed.kind, "apply");

  for (const forgedResult of [
    { ...committed.result, phase: "accepted", revision: 2 },
    { ...committed.result, phase: "connected", revision: 1 },
    { ...committed.result, phase: "ended", revision: 1 },
    { ...committed.result, phase: "ringing", revision: 1 },
  ]) {
    const forgedReceipt = { ...committed.receipt, result: forgedResult };
    assert.deepEqual(
      decideSyntheticAgoraCallEvent(committed.result, accept, forgedReceipt),
      reject("KEY_CONFLICT"), "invalid receipt cannot replay",
    );
    assert.deepEqual(
      assessSyntheticAgoraSignalingIntent(committed.result, accept, forgedReceipt),
      deny("KEY_CONFLICT"), "invalid receipt cannot produce signaling intent",
    );
  }
});

test("unapproved media duration is not invented by phase-revision validation", () => {
  const connected = call("connected", 2);
  const result = decideSyntheticAgoraCallEvent(
    connected, cmd(WORKER, "hangup", 2, DEADLINE + 1_000_000),
  );
  assert.equal(result.kind, "apply");
  assert.equal(result.result.phase, "ended");
  assert.equal(result.result.revision, 3);
  // Future M-005 T02 duration and media expiry remain founder-gated.
});

test("losing cancel/decline/busy/timeout receipt cannot replay on the winner's connected or ended branch",()=>{
  const initial=call();
  const acceptedCommand=cmd(WORKER,"accept",0,CREATED+1000);
  const accepted=decideSyntheticAgoraCallEvent(initial,acceptedCommand);
  assert.equal(accepted.kind,"apply");
  const connectedCommand=cmd(null,"media_ready",1,CREATED+2000);
  const connected=decideSyntheticAgoraCallEvent(accepted.result,connectedCommand);
  assert.equal(connected.kind,"apply");
  const endedCommand=cmd(CALLER,"hangup",2,CREATED+3000);
  const ended=decideSyntheticAgoraCallEvent(connected.result,endedCommand);
  assert.equal(ended.kind,"apply");

  // Every competing terminal receipt is internally valid on ringing (and
  // matches its own original actor/event/key/time) but cannot be part of the
  // winning accept -> media_ready -> hangup history. A persisted/corrupted
  // loser must never be replayed as a successful action.
  const terminalCases=[
    [CALLER,"cancel",CREATED+900],
    [WORKER,"decline",CREATED+900],
    [WORKER,"busy",CREATED+900],
    [null,"ring_timeout",DEADLINE],
  ];
  for(const [actor,event,time] of terminalCases){
    const loserCommand=cmd(actor,event,0,time);
    const loser=decideSyntheticAgoraCallEvent(initial,loserCommand);
    assert.equal(loser.kind,"apply",event);
    for(const current of [connected.result,ended.result]){
      assert.deepEqual(
        decideSyntheticAgoraCallEvent(current,loserCommand,loser.receipt),
        reject("KEY_CONFLICT"),event+"/"+current.phase);
      assert.deepEqual(
        assessSyntheticAgoraSignalingIntent(current,loserCommand,loser.receipt),
        deny("KEY_CONFLICT"),event+"/"+current.phase);
    }
  }

  // Genuine winning history remains replayable after later revisions.
  for(const [oldCommand,receipt] of [
    [acceptedCommand,accepted.receipt],
    [connectedCommand,connected.receipt],
    [endedCommand,ended.receipt],
  ]){
    assert.deepEqual(decideSyntheticAgoraCallEvent(ended.result,oldCommand,receipt),
      {kind:"replay",receipt});
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(
      ended.result,oldCommand,receipt),{kind:"replay_suppressed"});
  }
});

test("competing accepted-to-ended terminal receipts cannot replay after connected-to-ended",()=>{
  const initial=call();
  const acceptCommand=cmd(WORKER,"accept",0,CREATED+1000);
  const accepted=decideSyntheticAgoraCallEvent(initial,acceptCommand);
  assert.equal(accepted.kind,"apply");
  const connected=decideSyntheticAgoraCallEvent(
    accepted.result,cmd(null,"media_ready",1,CREATED+2000));
  assert.equal(connected.kind,"apply");
  const ended=decideSyntheticAgoraCallEvent(
    connected.result,cmd(WORKER,"hangup",2,CREATED+3000));
  assert.equal(ended.kind,"apply");
  assert.equal(ended.result.revision,3);

  // These receipts describe valid but mutually exclusive shorter histories:
  // accepted -> ended(2), not accepted -> connected(2) -> ended(3).
  for(const [actor,event] of [
    [CALLER,"hangup"],[WORKER,"hangup"],[null,"media_failed"],
  ]){
    const command=cmd(actor,event,1,CREATED+1500);
    const shortEnd=decideSyntheticAgoraCallEvent(accepted.result,command);
    assert.equal(shortEnd.kind,"apply");
    assert.equal(shortEnd.result.phase,"ended");
    assert.equal(shortEnd.result.revision,2);
    assert.deepEqual(decideSyntheticAgoraCallEvent(
      ended.result,command,shortEnd.receipt),reject("KEY_CONFLICT"));
    assert.deepEqual(assessSyntheticAgoraSignalingIntent(
      ended.result,command,shortEnd.receipt),deny("KEY_CONFLICT"));
  }
});

test("terminal same-revision retry remains exactly idempotent but cannot manufacture a successor",()=>{
  const initial=call();
  const cancelCmd=cmd(CALLER,"cancel",0,CREATED+1000);
  const cancelled=decideSyntheticAgoraCallEvent(initial,cancelCmd);
  assert.equal(cancelled.kind,"apply");
  assert.deepEqual(decideSyntheticAgoraCallEvent(
    cancelled.result,cancelCmd,cancelled.receipt),
    {kind:"replay",receipt:cancelled.receipt});
  // Accepted -> ended(2) is a valid *independent* winner but not a
  // successor to the terminal cancelled(1) receipt.
  const accept=decideSyntheticAgoraCallEvent(
    initial,cmd(WORKER,"accept",0,CREATED+1000));
  assert.equal(accept.kind,"apply");
  const ended=decideSyntheticAgoraCallEvent(
    accept.result,cmd(WORKER,"hangup",1,CREATED+2000));
  assert.equal(ended.kind,"apply");
  assert.deepEqual(decideSyntheticAgoraCallEvent(
    ended.result,cancelCmd,cancelled.receipt),reject("KEY_CONFLICT"));
});
