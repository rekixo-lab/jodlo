import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker, ownWorkerDraft, OWN_DRAFT_QUERY } from "../src/modules/workers/profile.ts";

function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_public_catalog.sql", "0002_shared_accounts_worker_drafts.sql"]) {
    db.exec(readFileSync(new URL("../../../infra/migrations/" + name, import.meta.url), "utf8"));
  }
  const adapter = {
    prepare(sql) {
      const params = [];
      return {
        bind(...values) {
          params.push(...values);
          return this;
        },
        async all() { return { results: db.prepare(sql).all(...params).map(row => ({ ...row })) }; },
        async run() { return db.prepare(sql).run(...params); },
      };
    },
  };
  return { db, adapter };
}

test("migration gives each account customer access and zero worker roles by default", () => {
  const { db } = openDb();
  try {
    assert.deepEqual(db.prepare("PRAGMA table_info(accounts)").all().map(row => row.name), ["id", "status", "created_at"]);
    assert.deepEqual(db.prepare("PRAGMA table_info(worker_profiles)").all().map(row => row.name), ["account_id", "status", "created_at"]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worker_profiles").get().n, 0);
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.equal(db.prepare("EXPLAIN QUERY PLAN " + OWN_DRAFT_QUERY).all("account-owner1").some(row => String(row.detail).includes("worker_profiles")), true);
  } finally { db.close(); }
});

test("verified internal account is unique, worker opt-in is idempotent and draft-only", async () => {
  const { db, adapter } = openDb();
  try {
    await ensureAccount(adapter, "account-owner1");
    await ensureAccount(adapter, "account-owner1");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 1);
    assert.equal(await ownWorkerDraft(adapter, "account-owner1"), null);
    assert.deepEqual(await optInAsWorker(adapter, "account-owner1"), { status: "draft" });
    assert.deepEqual(await optInAsWorker(adapter, "account-owner1"), { status: "draft" });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worker_profiles").get().n, 1);
    assert.throws(() => db.prepare("UPDATE worker_profiles SET status = 'verified'").run());
    assert.throws(() => db.prepare("UPDATE worker_profiles SET status = 'published'").run());
  } finally { db.close(); }
});

test("unknown/disabled accounts cannot enroll, and no cross-account data is exposed", async () => {
  const { db, adapter } = openDb();
  try {
    await ensureAccount(adapter, "account-owner1");
    await ensureAccount(adapter, "account-other2");
    assert.equal(await optInAsWorker(adapter, "account-ghost"), null);
    assert.equal(await ownWorkerDraft(adapter, "account-other2"), null);
    assert.deepEqual(await optInAsWorker(adapter, "account-owner1"), { status: "draft" });
    assert.equal(await ownWorkerDraft(adapter, "account-other2"), null);
    db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run("account-owner1");
    assert.equal(await ownWorkerDraft(adapter, "account-owner1"), null);
    assert.equal(await optInAsWorker(adapter, "account-owner1"), null);
    assert.throws(() => db.prepare("INSERT INTO worker_profiles(account_id) VALUES ('no-such-account')").run());
    db.prepare("DELETE FROM accounts WHERE id = ?").run("account-owner1");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worker_profiles").get().n, 0);
  } finally { db.close(); }
});

test("account creation rejects invalid IDs and schema enforces statuses", async () => {
  const { db, adapter } = openDb();
  try {
    await assert.rejects(ensureAccount(adapter, "bad"));
    await assert.rejects(ensureAccount(adapter, "bad' OR 1=1 --"));
    assert.throws(() => db.prepare("INSERT INTO accounts(id, status) VALUES (?, ?)").run("account-broken1", "admin"));
    assert.throws(() => db.prepare("INSERT INTO worker_profiles(account_id) VALUES (?)").run("account-owner1"));
  } finally { db.close(); }
});
