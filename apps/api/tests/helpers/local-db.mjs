import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

/** Shared synthetic SQLite/D1 adapter. Never connect tests to any remote Cloudflare D1. */
export function openLocalDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_public_catalog.sql", "0002_shared_accounts_worker_drafts.sql"]) {
    db.exec(readFileSync(new URL("../../../../infra/migrations/" + name, import.meta.url), "utf8"));
  }
  const adapter = {
    prepare(query) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async all() { return { results: db.prepare(query).all(...params).map(row => ({ ...row })) }; },
        async run() { return db.prepare(query).run(...params); },
      };
    },
  };
  return { db, adapter };
}
