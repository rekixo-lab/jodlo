import assert from "node:assert/strict";
import test from "node:test";
import { backup, DatabaseSync } from "node:sqlite";
import { mkdtempSync, copyFileSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../src/index.ts";
import { localD1Adapter, openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { issueSession, findSessionAccount, sessionHash } from "../src/modules/identity/sessions.ts";
import { makeD1NotificationReceiptStore } from "../src/modules/notifications/d1-receipts.ts";
import { makeD1NotificationDeadLetters } from "../src/modules/notifications/d1-dead-letters.ts";

const ORIGIN = "https://jodlo.rekixo.com";
const OWNER = "account-backup-owner";
const OTHER = "account-backup-other";
const get = (path, env, bearer) => worker.fetch(new Request(ORIGIN + path, {
  headers: bearer ? { Authorization: "Bearer " + bearer } : {},
}), env);

test("local SQLite backup restores authorization, receipts and dead letters", async () => {
  // Every row and bearer is synthetic; this never opens a Cloudflare D1 binding.
  const { db, adapter } = openLocalDatabase();
  const dir = mkdtempSync(join(tmpdir(), "jodlo-local-recovery-"));
  const snapshotPath = join(dir, "point-in-time.sqlite");
  const recoveredPath = join(dir, "recovered.sqlite");
  let recovered;
  try {
    for (const id of [OWNER, OTHER]) {
      await ensureAccount(adapter, id);
      assert.deepEqual(await optInAsWorker(adapter, id), { status: "draft" });
    }
    db.prepare("INSERT INTO google_identities(google_sub,account_id) VALUES(?,?)")
      .run("123456789012345678901", OWNER);
    db.prepare("INSERT INTO google_identities(google_sub,account_id) VALUES(?,?)")
      .run("123456789012345678902", OTHER);
    for (const [id, slug, en, hi] of [
      ["fixture-plumber", "fixture-plumber", "Plumber", "प्लंबर"],
      ["fixture-carpenter", "fixture-carpenter", "Carpenter", "बढ़ई"],
    ]) {
      db.prepare("INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES(?,?,?,?,1,0)")
        .run(id, slug, en, hi);
    }
    const a = await issueSession(adapter, OWNER);
    const b = await issueSession(adapter, OTHER);
    assert.ok(a?.accessToken && b?.accessToken);
    const publicItem = await publishListing(adapter, OWNER, "fixture-plumber");
    const hiddenItem = await publishListing(adapter, OTHER, "fixture-carpenter");
    assert.ok(publicItem && hiddenItem);
    db.prepare("UPDATE worker_listings SET moderation_status='hidden' WHERE id=?")
      .run(hiddenItem.id);

    // New D1 receipt state is part of a real local backup/restore too, not a
    // fictional in-memory success counter or imported Finworkar push record.
    const delivery=makeD1NotificationReceiptStore(adapter,()=>1_800_000_000_000);
    const claim=await delivery.acquire("event-backup-synthetic-0001");
    assert.equal(claim.state,"acquired");
    await delivery.markCompleted("event-backup-synthetic-0001",claim.claimToken);
    await makeD1NotificationDeadLetters(adapter,()=>1_800_000_000_000)
      .record("event-backup-deadletter-0002","RETRIES_EXHAUSTED");

    // Node's actual SQLite online backup copies both schema and committed rows.
    // Never use the throwaway source DB as the restore target.
    await backup(db, snapshotPath);
    assert.ok(statSync(snapshotPath).size > 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 2);

    // Emulate data loss ONLY in the disposable source database after snapshot.
    db.prepare("DELETE FROM accounts WHERE id=?").run(OWNER);
    db.prepare("UPDATE categories SET is_active=0 WHERE id='fixture-carpenter'").run();
    assert.equal(await findSessionAccount(adapter, a.accessToken), null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n, 1);

    // Recover to a SEPARATE file. Reuse the established fake D1 adapter, real
    // router, and real session verification, rather than a second API mock.
    copyFileSync(snapshotPath, recoveredPath);
    recovered = new DatabaseSync(recoveredPath);
    recovered.exec("PRAGMA foreign_keys = ON");
    assert.equal(recovered.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(recovered.prepare("PRAGMA foreign_key_check").all(), []);
    for (const table of ["categories", "accounts", "worker_profiles",
                         "google_identities", "auth_sessions", "worker_listings",
                         "notification_delivery_receipts", "notification_delivery_dead_letters"]) {
      assert.equal(recovered.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name=?"
      ).get(table).n, 1, table);
    }
    assert.equal(recovered.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 2);
    assert.equal(recovered.prepare("SELECT COUNT(*) AS n FROM worker_listings").get().n, 2);
    assert.deepEqual(await makeD1NotificationReceiptStore(
      localD1Adapter(recovered),()=>1_800_000_000_000+60_000,
    ).acquire("event-backup-synthetic-0001"),{state:"completed"});
    assert.deepEqual({...recovered.prepare(
      "SELECT event_id,reason,recorded_at_ms FROM notification_delivery_dead_letters WHERE event_id=?"
    ).get("event-backup-deadletter-0002")}, {
      event_id:"event-backup-deadletter-0002",reason:"RETRIES_EXHAUSTED",
      recorded_at_ms:1_800_000_000_000,
    });
    await makeD1NotificationDeadLetters(localD1Adapter(recovered),()=>1_800_000_060_000)
      .record("event-backup-deadletter-0002","PERMANENT_FAILURE");
    assert.equal(recovered.prepare(
      "SELECT reason FROM notification_delivery_dead_letters WHERE event_id=?"
    ).get("event-backup-deadletter-0002").reason,"RETRIES_EXHAUSTED");
    assert.equal(recovered.prepare("SELECT google_sub FROM google_identities WHERE account_id=?")
      .get(OWNER).google_sub, "123456789012345678901");
    assert.equal(recovered.prepare("SELECT token_hash FROM auth_sessions WHERE account_id=?")
      .get(OWNER).token_hash, await sessionHash(a.accessToken));
    assert.equal(recovered.prepare("SELECT token_hash FROM auth_sessions WHERE account_id=?")
      .get(OTHER).token_hash, await sessionHash(b.accessToken));
    assert.equal(await findSessionAccount(localD1Adapter(recovered), a.accessToken), OWNER);

    const env = { DB: localD1Adapter(recovered) };
    const catalog = await get("/api/v1/catalog?lang=hi", env);
    assert.equal(catalog.status, 200);
    const categories = (await catalog.json()).data.categories;
    assert.deepEqual(categories.map(x => x.id), ["fixture-carpenter", "fixture-plumber"]);
    assert.deepEqual(categories.map(x => x.name), ["बढ़ई", "प्लंबर"]);
    assert.ok(categories.every(x => Object.keys(x).sort().join(",") === "id,name,slug"));

    const visible = await get("/api/v1/listings?categoryId=fixture-plumber", env);
    assert.equal(visible.status, 200);
    assert.deepEqual((await visible.json()).data.listings, [publicItem]);
    const hidden = await get("/api/v1/listings?categoryId=fixture-carpenter", env);
    assert.equal(hidden.status, 200);
    assert.deepEqual((await hidden.json()).data.listings, []);

    const mine = await get("/api/v1/me/listings", env, a.accessToken);
    assert.equal(mine.status, 200);
    assert.deepEqual((await mine.json()).data.listings, [{ ...publicItem, visible: true }]);
    const theirs = await get("/api/v1/me/listings", env, b.accessToken);
    assert.equal(theirs.status, 200);
    assert.deepEqual((await theirs.json()).data.listings, [{ ...hiddenItem, visible: false }]);
    assert.equal((await get("/api/v1/me/listings", env, "a".repeat(43))).status, 401);

    // The recovered copy remains writable, and revoking a recovered token
    // removes only that session, leaving the other account untouched.
    const logout = await worker.fetch(new Request(ORIGIN + "/api/v1/auth/logout", {
      method: "POST", headers: { Authorization: "Bearer " + a.accessToken },
    }), env);
    assert.equal(logout.status, 200);
    assert.equal(await findSessionAccount(env.DB, a.accessToken), null);
    assert.equal(await findSessionAccount(env.DB, b.accessToken), OTHER);
    assert.deepEqual(recovered.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    recovered?.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy SQLite snapshot restores and upgrades without losing account or listing access", async () => {
  const migrations = new URL("../../../infra/migrations/", import.meta.url);
  const names = readdirSync(migrations).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  const firstPending = names.indexOf("0009_public_cross_category_feed_index.sql");
  assert.equal(firstPending, 8);
  const dir = mkdtempSync(join(tmpdir(), "jodlo-upgrade-recovery-"));
  const legacy = new DatabaseSync(":memory:");
  let restored;
  try {
    legacy.exec("PRAGMA foreign_keys = ON");
    for (const name of names.slice(0, firstPending)) {
      legacy.exec(readFileSync(new URL(name, migrations), "utf8"));
    }
    const db = localD1Adapter(legacy);
    await ensureAccount(db, OWNER);
    await optInAsWorker(db, OWNER);
    const session = await issueSession(db, OWNER);
    assert.ok(session?.accessToken);
    legacy.prepare(
      "INSERT INTO categories(id,slug,name_en,is_active) VALUES(?,?,?,1)"
    ).run("fixture-plumber", "fixture-plumber", "Plumber");
    const listingId = "6ef45488-82b3-4b40-ac55-b9cdfc754809";
    legacy.prepare("INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)")
      .run(listingId, OWNER, "fixture-plumber");

    const snapshot = join(dir, "before-upgrade.sqlite");
    const recovered = join(dir, "restored.sqlite");
    await backup(legacy, snapshot);
    copyFileSync(snapshot, recovered);
    restored = new DatabaseSync(recovered);
    restored.exec("PRAGMA foreign_keys = ON");
    for (const name of names.slice(firstPending)) {
      restored.exec(readFileSync(new URL(name, migrations), "utf8"));
    }

    assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual({
      ...restored.prepare("SELECT revision, service_city, report_hold FROM worker_listings WHERE id=?")
        .get(listingId),
    }, { revision: 0, service_city: null, report_hold: 0 });
    const env = { DB: localD1Adapter(restored) };
    const owner = await get("/api/v1/me/listings", env, session.accessToken);
    assert.equal(owner.status, 200);
    assert.equal((await owner.json()).data.listings[0].id, listingId);
    const publicList = await get("/api/v1/listings?categoryId=fixture-plumber", env);
    assert.equal(publicList.status, 200);
    assert.equal((await publicList.json()).data.listings[0].id, listingId);
  } finally {
    restored?.close();
    legacy.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
