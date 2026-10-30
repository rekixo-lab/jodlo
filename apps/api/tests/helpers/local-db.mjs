import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

/** Existing test-only D1 facade, also usable on a recovered SQLite file.
 * No Cloudflare resource, HTTP endpoint, or production database is opened.
 */
export function localD1Adapter(db) {
  return {
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const stmt of statements) {
          const result = db.prepare(stmt._query).run(...stmt._values);
          results.push(result);
        }
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query) {
      let params = [];
      const stmt = { _query: query, _values: params,
        bind(...values) { params = values; this._values = values; return this; },
        async all() { return { results: db.prepare(query).all(...params).map(row => ({ ...row })) }; },
        async run() { const result = db.prepare(query).run(...params); return { meta: { changes: Number(result.changes) } }; },
      };
      return stmt;
    },
  };
}

/** Shared synthetic SQLite/D1 adapter. Never connect tests to any remote Cloudflare D1. */
export function openLocalDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_public_catalog.sql", "0002_shared_accounts_worker_drafts.sql", "0003_google_identity_sessions.sql", "0004_worker_service_listings.sql", "0005_notification_delivery_receipts.sql"]) {
    db.exec(readFileSync(new URL("../../../../infra/migrations/" + name, import.meta.url), "utf8"));
  }
  return { db, adapter: localD1Adapter(db) };
}
