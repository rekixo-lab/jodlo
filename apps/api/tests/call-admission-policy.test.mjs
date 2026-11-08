import assert from "node:assert/strict";
import test from "node:test";
import {
  CALL_ATTEMPT_LIMITS, CALL_ATTEMPT_WINDOW_MS, CALL_RING_MS, evaluateCallAttempt,
} from "../src/modules/interactions/call-admission-policy.ts";

test("Finworkar attempt policy applies all three limits and resets at five minutes", () => {
  const now = 1_800_000_000_000;
  assert.equal(CALL_RING_MS, 90_000);
  assert.deepEqual(CALL_ATTEMPT_LIMITS, {pair:8, caller:20, receiver:30});
  const blank = {pair:null, caller:null, receiver:null};
  const first = {startedAtMs:now, count:1};
  assert.deepEqual(evaluateCallAttempt(blank, now),
    {kind:"allow", windows:{pair:first, caller:first, receiver:first}});
  for (const [scope, limit] of Object.entries(CALL_ATTEMPT_LIMITS)) {
    const last = {...blank, [scope]:{startedAtMs:now, count:limit - 1}};
    const allowed = evaluateCallAttempt(last, now);
    assert.equal(allowed.kind, "allow");
    assert.equal(allowed.windows[scope].count, limit);
    assert.deepEqual(evaluateCallAttempt(allowed.windows, now + CALL_ATTEMPT_WINDOW_MS - 1),
      {kind:"limit", scope, retryAfterSeconds:1});
    assert.equal(evaluateCallAttempt(allowed.windows, now + CALL_ATTEMPT_WINDOW_MS)
      .windows[scope].count, 1);
  }
  const limited = {pair:{startedAtMs:now,count:8}, caller:{startedAtMs:now,count:20},
    receiver:{startedAtMs:now,count:30}};
  assert.deepEqual(evaluateCallAttempt(limited, now),
    {kind:"limit", scope:"pair", retryAfterSeconds:300});
  assert.deepEqual(evaluateCallAttempt({...limited, receiver:{startedAtMs:now+1,count:1}}, now),
    {kind:"invalid"});
});
