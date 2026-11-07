import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { CALL_HISTORY_CLEANUP_CRON, CALL_HISTORY_RETENTION_SECONDS } from "../src/modules/interactions/call-history.ts";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

test("call history only exposes the signed-in owner's unexpired summaries", async () => {
  const {db, adapter} = openLocalDatabase();
  try {
    const owner = "call-history-owner";
    const other = "call-history-other";
    await ensureAccount(adapter, owner);
    await ensureAccount(adapter, other);
    const {accessToken} = await issueSession(adapter, owner);
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - CALL_HISTORY_RETENTION_SECONDS;
    const insert = db.prepare("INSERT INTO call_history VALUES(?,?,?,?,?,?)");
    const ownerIds = Array.from({length:26}, () => crypto.randomUUID());
    for (const id of ownerIds) insert.run(id, owner, "incoming", "ended", now - 30, 15);
    const expired = crypto.randomUUID();
    const foreign = crypto.randomUUID();
    insert.run(expired, owner, "outgoing", "missed", cutoff, 0);
    insert.run(foreign, other, "incoming", "missed", now - 10, 0);
    const env = {DB:adapter, CALL_HISTORY_ENABLED:"1"};
    const url = "https://jodlo.test/api/v1/me/call-history";
    const headers = {Authorization:"Bearer " + accessToken};
    const request = (query = "") => worker.fetch(new Request(url + query, {headers}), env);

    assert.equal((await worker.fetch(new Request(url, {headers}), {DB:adapter})).status, 404);
    assert.equal((await worker.fetch(new Request(url), env)).status, 401);
    assert.equal((await request("?after=x&after=y")).status, 400);
    const first = await request();
    assert.equal(first.status, 200);
    const {items, nextCursor} = (await first.json()).data;
    const sorted = ownerIds.sort().reverse();
    assert.deepEqual(items.map(row => row.id), sorted.slice(0, 25));
    assert.deepEqual(items[0], {id:sorted[0], direction:"incoming", outcome:"ended",
      endedAt:now - 30, connectedSeconds:15});
    assert.equal(nextCursor, sorted[24]);
    const second = (await (await request("?after=" + nextCursor)).json()).data;
    assert.deepEqual(second.items.map(row => row.id), sorted.slice(25));
    assert.equal(second.nextCursor, null);
    for (const anchor of [expired, foreign]) {
      assert.deepEqual((await (await request("?after=" + anchor)).json()).data,
        {items:[], nextCursor:null});
    }

    await worker.scheduled({cron:"0 * * * *", scheduledTime:now * 1000}, env);
    assert.ok(db.prepare("SELECT id FROM call_history WHERE id=?").get(expired));
    await worker.scheduled({cron:CALL_HISTORY_CLEANUP_CRON, scheduledTime:now * 1000}, env);
    assert.equal(db.prepare("SELECT id FROM call_history WHERE id=?").get(expired), undefined);
    db.prepare("DELETE FROM accounts WHERE id=?").run(owner);
    assert.deepEqual(db.prepare("SELECT id FROM call_history").all().map(row => row.id), [foreign]);
    assert.equal((await request()).status, 401);
  } finally {
    db.close();
  }
});
