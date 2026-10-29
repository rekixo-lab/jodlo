# JODLO D1 migrations — local-first

- `0001_public_catalog.sql` creates only a safe public taxonomy `categories` table, with English/Hindi label fallback, draft-hidden state, constraints and active-only ordering index. No identity, GPS, payments, customer records or seed data.
- To test locally after `npm install`: `npm run db:migrate:local`. It uses the **local-only** Wrangler config `apps/api/wrangler.local.jsonc` with a placeholder UUID and never connects to Cloudflare.
- `npm test` checks constraints, exact SQL query, index query plan and HTTP errors via Node SQLite/fake D1. CI applies migrations to a disposable local Wrangler D1. No real Cloudflare D1 database has been provisioned.
- Next migrations (users, workers, areas, listings) await an explicit identity/role/area/privacy model. Do not invent those details or create production schema prematurely.
- Migrations are forward-only. Before production launch, document backup/restore rehearsal and approved binding/migration target; **never** apply a migration automatically from a request or to a remote DB during development.

## Migration 0002 — shared-account, worker draft (ADR-0006)

`0002_shared_accounts_worker_drafts.sql` creates minimal `accounts` (one server-owned opaque ID) and `worker_profiles` (PK/FK to account, `draft` only, cascade on account deletion). No login provider IDs, phone/email, location, media, client-selected roles or public verified state. `npm run db:migrate:local` applies versioned migrations only to local Wrangler D1; automated Node SQLite tests assert foreign keys, constraints, idempotent opt-in, disabled-account denial and non-leaking reads. User-facing account creation is intentionally **NOT** exposed until M-002 real provider is approved. Before real deletion workflows, decide legal retention and account-closure rules; cascade alone is not a complete privacy-deletion solution. No remote database is provisioned or touched.

**Verification checkpoint:** [PR #10](https://github.com/rekixo-lab/jodlo/pull/10) merged as `e01dbde44cbe46aadf3d563c66f411a8c9d96818`; [main GitHub Actions #40476898497](https://github.com/rekixo-lab/jodlo/actions/runs/40476898497) SUCCESS on that commit (27 Node tests, docs/design guard, both dry-run builds, local D1 migration 0001+0002 and strict TypeScript). All migrations were applied *locally* by CI; no production D1 was created.

## Migration 0003 — Google subject and revocable sessions

`0003_google_identity_sessions.sql` links only Google OIDC `sub` (stable, verified server-side) to the internal account and stores only SHA-256 hashes of random 32-byte sessions with expiry and `ON DELETE CASCADE`. No email, phone, passwords, raw Google ID token or session secret stored. Versioned local Wrangler D1 migration and synthetic SQLite tests must pass before PR merge; no migration is ever applied remotely during normal development. Production session cleanup/retention and provider configuration are release gates, not completed features.

**Data classification:** Google `sub` is a persistent pseudonymous personal identifier. Real retention/deletion/export policy must include `google_identities` and `auth_sessions`; test cascade alone is not sufficient legal compliance.

**0003 local migration verification:** [PR #12](https://github.com/rekixo-lab/jodlo/pull/12) merged as `494fc1ee3a41757d4099df40532759526afa5e66` with actual [green main GitHub Actions #40479368370](https://github.com/rekixo-lab/jodlo/actions/runs/40479368370) (37/37 tests, D1 migrations 0001–0003 locally, docs/design checks, strict TypeScript, both Wrangler dry-run builds). No migration applied remotely.

**Account lifecycle rehearsal:** synthetic SQLite tests will delete only disposable accounts to confirm existing `ON DELETE CASCADE` relationships and transaction rollback on failure; no new migration or public deletion API is added without founder M-003 retention/deletion approval.

**Verified synthetic account cascade and rollback:** [PR #16](https://github.com/rekixo-lab/jodlo/pull/16) merged as `17ea0b882977ad0bd3a695e49b0112dde64fc9d6`; [main Actions #40482955589](https://github.com/rekixo-lab/jodlo/actions/runs/40482955589) completed **SUCCESS** on that exact commit (49/49 Node tests, docs/design checks, local D1 migrations, TypeScript and both Wrangler dry-run builds). Existing D1 migrations 0001–0003 were applied locally; **no remote migration or approved public delete API** exists.

## 0004 — Immediate minimal worker service publication, local only

D1 `worker_listings` records **only category and opaque owner/listing IDs**; owner remains `worker_profiles.status='draft'`. Unique owner/category, worker unpublish and moderator `hidden` guard public category lookup. No personal GPS/contact/price/media or automatic verification. No actual pilot category seeds or remote migrations until M-007. [ADR-0009](../../docs/decisions/0009-instant-service-publication.md).

## Offline recovery rehearsal (2026-10-29)

Run `node --experimental-strip-types --test apps/api/tests/local-backup-restore.test.mjs` (also included automatically by `npm test`). With only **synthetic** records and the existing four local migrations, this test creates a real SQLite point-in-time backup through Node's `backup` API, mutates its throwaway source, restores a separate temporary copy, checks SQLite integrity/foreign keys and calls real API routes through the shared fake D1 adapter. Restored Google-sub mapping, hashed sessions, private owner listings and moderated public projection are verified. Both temporary files are removed. It does not open or certify a production Cloudflare D1 database. Actual provider-managed backups, disaster-recovery objectives, restore credentials, production reconciliation and approval (M-007) remain mandatory before release.
