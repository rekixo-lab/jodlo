import assert from "node:assert/strict";
import test from "node:test";
import { decideRequestTransition } from "../src/modules/interactions/request-contract.ts";

const policy = Object.freeze({
  prepared: ["submitted"], submitted: ["reviewed", "cancelled"], reviewed: [],
  cancelled: [],
});
const baseline = () => ({ requestId: "request-00001", ownerAccountId: "account-owner1",
  categoryId: "cat1", state: "prepared", revision: 0 });
const attempt = (overrides={}) => ({
  actorAccountId: "account-owner1", expectedRevision: 0,
  idempotencyKey: "retrykey-00000001", toState: "submitted", ...overrides,
});

test("pure request command applies policy-gated transition with immutable receipt", () => {
  const original=baseline(), command=attempt();
  const result=decideRequestTransition(original,command,policy);
  assert.equal(result.kind,"apply");
  assert.deepEqual(result.result, {...original,state:"submitted",revision:1});
  assert.deepEqual(result.receipt, {
    requestId: original.requestId, actorAccountId: command.actorAccountId,
    idempotencyKey: command.idempotencyKey, expectedRevision: 0,
    toState:"submitted", result:result.result,
  });
  assert.deepEqual(original,baseline());
  assert.equal(Object.isFrozen(result.result),true);
  assert.equal(Object.isFrozen(result.receipt),true);
});

test("duplicate command replays original receipt even when snapshot advanced", () => {
  const first=decideRequestTransition(baseline(),attempt(),policy);
  assert.equal(first.kind,"apply");
  const current={...first.result,state:"reviewed",revision:2};
  const retry=decideRequestTransition(current,attempt(),policy,first.receipt);
  assert.deepEqual(retry,{kind:"replay",receipt:first.receipt});
  assert.deepEqual(current,{...first.result,state:"reviewed",revision:2});
});

test("same idempotency key with altered target, revision or actor is rejected", () => {
  const first=decideRequestTransition(baseline(),attempt(),policy);
  assert.equal(first.kind,"apply");
  for(const changes of [{toState:"cancelled"},{expectedRevision:1},
      {actorAccountId:"account-other2"},{idempotencyKey:"retrykey-00000002"}]){
    const decision=decideRequestTransition(first.result,attempt(changes),policy,first.receipt);
    assert.deepEqual(decision,changes.actorAccountId
      ? {kind:"reject",code:"NOT_OWNER"} : {kind:"reject",code:"KEY_CONFLICT"});
  }
  assert.deepEqual(decideRequestTransition(first.result,attempt(),policy,
    {...first.receipt, requestId:"request-other2"}), {kind:"reject",code:"KEY_CONFLICT"});
});

test("owner-only authorization precedes replay or revisions and blocks stolen receipt", () => {
  const first=decideRequestTransition(baseline(),attempt(),policy);
  const bad=attempt({actorAccountId:"account-other2"});
  assert.deepEqual(decideRequestTransition(baseline(),bad,policy,first.receipt),
    {kind:"reject",code:"NOT_OWNER"});
  assert.deepEqual(decideRequestTransition(baseline(),bad,policy),
    {kind:"reject",code:"NOT_OWNER"});
});

test("missing policy, unsupported transitions, stale versions and terminal state deny", () => {
  assert.deepEqual(decideRequestTransition(baseline(),attempt(),{}),
    {kind:"reject",code:"TRANSITION_DENIED"});
  assert.deepEqual(decideRequestTransition(baseline(),attempt({toState:"reviewed"}),policy),
    {kind:"reject",code:"TRANSITION_DENIED"});
  assert.deepEqual(decideRequestTransition(baseline(),attempt({expectedRevision:1}),policy),
    {kind:"reject",code:"STALE_REVISION"});
  const terminal={...baseline(),state:"cancelled",revision:1};
  assert.deepEqual(decideRequestTransition(terminal,attempt({expectedRevision:1}),policy),
    {kind:"reject",code:"TRANSITION_DENIED"});
});

test("strict request IDs, revision and retry-key validation deny malformed values", () => {
  for(const bad of [
    {...baseline(),requestId:"abc"},
    {...baseline(),ownerAccountId:"owner@example.com"},
    {...baseline(),categoryId:"../../etc"},
    {...baseline(),revision:-1},
    {...baseline(),revision:Number.MAX_SAFE_INTEGER+1},
    {...baseline(),state:"__proto__"},
  ]){
    assert.deepEqual(decideRequestTransition(bad,attempt(),policy),
      {kind:"reject",code:"INVALID_INPUT"});
  }
  for(const changes of [
    {idempotencyKey:"short"},{idempotencyKey:"a".repeat(81)},
    {idempotencyKey:"injected;DROP"},{expectedRevision:-1},
    {toState:"INVALID STATES"},
  ]){
    assert.deepEqual(decideRequestTransition(baseline(),attempt(changes),policy),
      {kind:"reject",code:"INVALID_INPUT"});
  }
});

test("synthetic unique-key + CAS store rehearsal prevents double commit or out-of-order writes", () => {
  let current=baseline();
  const stored = new Map();
  function dispatch(command){
    const result=decideRequestTransition(current,command,policy,
      stored.get(command.idempotencyKey) ?? null);
    if(result.kind==="apply"){
      // Simulate storage transaction with revision compare and unique receipt.
      assert.equal(result.result.revision,current.revision+1);
      current=result.result;
      stored.set(command.idempotencyKey,result.receipt);
    }
    return result;
  }
  const first=dispatch(attempt());
  assert.equal(first.kind,"apply");
  assert.equal(dispatch(attempt()).kind,"replay");
  assert.equal(dispatch(attempt({idempotencyKey:"retrykey-00000002"})).kind,"reject");
  const second=dispatch(attempt({idempotencyKey:"retrykey-00000003",
    expectedRevision:1,toState:"reviewed"}));
  assert.equal(second.kind,"apply");
  assert.equal(dispatch(attempt()).kind,"replay");
  assert.equal(current.revision,2);
  assert.equal(stored.size,2);
  assert.equal(dispatch(attempt({idempotencyKey:"retrykey-00000003",
    expectedRevision:1,toState:"cancelled"})).kind,"reject");
});

test("future-version receipt cannot be replayed against a rolled-back snapshot", () => {
  const first=decideRequestTransition(baseline(),attempt(),policy);
  assert.equal(first.kind,"apply");
  assert.deepEqual(decideRequestTransition(baseline(),attempt(),policy,first.receipt),
    {kind:"reject",code:"KEY_CONFLICT"});
  // Correct forward state can replay, as can a later valid revision.
  assert.equal(decideRequestTransition(first.result,attempt(),policy,first.receipt).kind,"replay");
});

test("malformed stored retry receipt fails closed instead of throwing", () => {
  const accepted=decideRequestTransition(baseline(),attempt(),policy);
  assert.equal(accepted.kind,"apply");
  const current=accepted.result;
  for(const receipt of [
    undefined,
    false,
    {},
    {...accepted.receipt,result:null},
    {...accepted.receipt,result:undefined},
    {...accepted.receipt,result:false},
    {...accepted.receipt,result:{}},
    {...accepted.receipt,result:{...accepted.result,revision:-1}},
    {...accepted.receipt,result:{...accepted.result,state:null}},
  ]) {
    assert.deepEqual(decideRequestTransition(current,attempt(),policy,receipt),
      {kind:"reject",code:"KEY_CONFLICT"});
  }
  assert.deepEqual(decideRequestTransition(null,attempt(),policy),
    {kind:"reject",code:"INVALID_INPUT"});
  assert.deepEqual(decideRequestTransition(baseline(),null,policy),
    {kind:"reject",code:"INVALID_INPUT"});
});

test("same-revision out-of-band state change invalidates a stored success receipt", () => {
  const first=decideRequestTransition(baseline(),attempt(),policy);
  assert.equal(first.kind,"apply");
  const wrong={...first.result,state:"cancelled"};
  assert.deepEqual(decideRequestTransition(wrong,attempt(),policy,first.receipt),
    {kind:"reject",code:"KEY_CONFLICT"});
  assert.equal(decideRequestTransition(first.result,attempt(),policy,first.receipt).kind,"replay");
});

test("valid historical receipts still replay after later legitimate revisions", () => {
  const first=decideRequestTransition(baseline(),attempt(),policy);
  assert.equal(first.kind,"apply");
  const second=decideRequestTransition(first.result,
    attempt({idempotencyKey:"retrykey-00000002",expectedRevision:1,toState:"reviewed"}),policy);
  assert.equal(second.kind,"apply");
  assert.deepEqual(decideRequestTransition(second.result,attempt(),policy,first.receipt),
    {kind:"replay",receipt:first.receipt});
  assert.equal(second.result.revision,2);
});
