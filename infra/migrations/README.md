# JODLO D1 migrations — local-first

- `0001_public_catalog.sql` creates only a safe public taxonomy `categories` table, with English/Hindi label fallback, draft-hidden state, constraints and active-only ordering index. No identity, GPS, payments, customer records or seed data.
- To test locally after `npm install`: `npm run db:migrate:local`. It uses the **local-only** Wrangler config `apps/api/wrangler.local.jsonc` with a placeholder UUID and never connects to Cloudflare.
- `npm test` checks constraints, exact SQL query, index query plan and HTTP errors via Node SQLite/fake D1. CI applies migrations to a disposable local Wrangler D1. No real Cloudflare D1 database has been provisioned.
- Next migrations (users, workers, areas, listings) await an explicit identity/role/area/privacy model. Do not invent those details or create production schema prematurely.
- Migrations are forward-only. Before production launch, document backup/restore rehearsal and approved binding/migration target; **never** apply a migration automatically from a request or to a remote DB during development.
