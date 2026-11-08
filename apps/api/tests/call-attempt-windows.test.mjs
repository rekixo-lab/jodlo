import assert from "node:assert/strict";
import test from "node:test";
import { CALL_ATTEMPT_WINDOW_MS } from "../src/modules/interactions/call-admission-policy.ts";
import { purgeExpiredCallAttemptWindows, reserveCallAttemptWindows } from "../src/modules/interactions/call-attempt-windows.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

test("all three quota counters reserve together and denied attempts change none", async () => {
  const {db, adapter} = openLocalDatabase();
  try {
    const now = 1_800_000_000_000;
    const caller = "caller-main";
    const receiver = "receiver-main";
    const others = Array.from({length:30}, (_, i) => `account-${i}`);
    const add = db.prepare("INSERT INTO accounts(id) VALUES(?)");
    for (const id of [caller, receiver, ...others]) add.run(id);
    const reserve = (from = caller, to = receiver, time = now) =>
      reserveCallAttemptWindows(adapter, from, to, time);
    const snapshot = () => db.prepare("SELECT * FROM call_attempt_windows ORDER BY counter_key").all();

    for (let i = 0; i < 8; i++) assert.equal(await reserve(), true);
    const beforePairDenial = snapshot();
    assert.equal(beforePairDenial.length, 3);
    assert.ok(beforePairDenial.every(row => row.attempt_count === 8));
    assert.equal(await reserve(), false);
    assert.equal(await reserve(caller, receiver, now - 1), false);
    assert.deepEqual(snapshot(), beforePairDenial);

    for (const id of others.slice(0, 12)) assert.equal(await reserve(caller, id), true);
    const beforeCallerDenial = snapshot();
    assert.equal(await reserve(caller, others[12]), false);
    assert.deepEqual(snapshot(), beforeCallerDenial);

    for (const id of others.slice(0, 22)) assert.equal(await reserve(id, receiver), true);
    const beforeReceiverDenial = snapshot();
    assert.equal(await reserve(others[22], receiver), false);
    assert.deepEqual(snapshot(), beforeReceiverDenial);
    assert.equal(await reserve(others[22], "account-missing"), false);
    assert.deepEqual(snapshot(), beforeReceiverDenial);

    assert.equal(await reserve(caller, receiver, now + CALL_ATTEMPT_WINDOW_MS), true);
    await purgeExpiredCallAttemptWindows(adapter, now + CALL_ATTEMPT_WINDOW_MS);
    assert.equal(snapshot().length, 3);
    assert.ok(snapshot().every(row => row.attempt_count === 1));
    db.prepare("DELETE FROM accounts WHERE id=?").run(receiver);
    assert.deepEqual(snapshot().map(row => row.counter_key), ["caller:caller-main"]);
  } finally {
    db.close();
  }
});
