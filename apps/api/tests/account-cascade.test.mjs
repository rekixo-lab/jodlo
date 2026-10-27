import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { issueSession, findSessionAccount, sessionHash } from "../src/modules/identity/sessions.ts";

/** These simulate lifecycle/recovery only; public delete-account remains blocked by M-003. */
test("synthetic account deletion cascades worker draft, Google sub and sessions, not another user", async () => {
  const { db, adapter } = openLocalDatabase();
  try {
    await ensureAccount(adapter, "account-a111111");
    await ensureAccount(adapter, "account-b222222");
    await optInAsWorker(adapter, "account-a111111");
    await optInAsWorker(adapter, "account-b222222");
    db.prepare("INSERT INTO google_identities(google_sub,account_id) VALUES(?,?)")
      .run("123456789012345678901", "account-a111111");
    db.prepare("INSERT INTO google_identities(google_sub,account_id) VALUES(?,?)")
      .run("123456789012345678902", "account-b222222");
    const a = await issueSession(adapter, "account-a111111");
    const b = await issueSession(adapter, "account-b222222");
    assert.ok(a && b);
    db.prepare("DELETE FROM accounts WHERE id=?").run("account-a111111");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worker_profiles").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM google_identities").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 1);
    assert.equal(await findSessionAccount(adapter, a.accessToken), null);
    assert.equal(await findSessionAccount(adapter, b.accessToken), "account-b222222");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("SELECT google_sub FROM google_identities").get().google_sub, "123456789012345678902");
  } finally { db.close(); }
});

test("disposable SQLite account-delete rehearsal rolls back fully after failure", async () => {
  const { db, adapter } = openLocalDatabase();
  try {
    await ensureAccount(adapter, "account-a111111");
    await optInAsWorker(adapter, "account-a111111");
    db.prepare("INSERT INTO google_identities(google_sub,account_id) VALUES(?,?)")
      .run("123456789012345678901", "account-a111111");
    const session = await issueSession(adapter, "account-a111111");
    assert.ok(session);
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM accounts WHERE id=?").run("account-a111111");
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM google_identities").get().n, 0);
      throw new Error("synthetic failure before approval");
    } catch { db.exec("ROLLBACK"); }
    for (const table of ["accounts","worker_profiles","google_identities","auth_sessions"]) {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 1, table);
    }
    assert.equal(await findSessionAccount(adapter, session.accessToken), "account-a111111");
    assert.equal(db.prepare("SELECT token_hash FROM auth_sessions").get().token_hash,
      await sessionHash(session.accessToken));
  } finally { db.close(); }
});

test("cascades remain effective for disabled accounts; no public destructive API", async () => {
  const { db, adapter } = openLocalDatabase();
  try {
    await ensureAccount(adapter, "account-a111111");
    const token = await issueSession(adapter, "account-a111111");
    assert.ok(token);
    db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run("account-a111111");
    assert.equal(await findSessionAccount(adapter, token.accessToken), null);
    db.prepare("DELETE FROM accounts WHERE id=?").run("account-a111111");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});
