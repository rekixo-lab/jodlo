# JODLO — Private D1 safety under disposable UNSENT claim lock (2026-11-03)

**Scope:** Test-only backend concurrency evidence. This exercise reuses the real local migrations 0001–0008 and existing authenticated caller/worker D1 readers. It adds **no production table, API, provider integration or call permission**.

## What is tested

Earlier #188 checks private relationship blocks and availability before and after asynchronous synthetic sources, but those separate SELECTs are **not** an atomic call admission. A block or changed availability can occur between a preview and a future writer. The local-only test `apps/api/tests/agora-private-safety-unsent-lock-sqlite.test.mjs` rehearses a narrower, explicit safety boundary.

- Two separate SQLite connections share one disposable temporary database with the **actual** D1 migration 0008 account blocks and worker availability preference (plus published listing, category, live bearer and worker consent).
- A fake, test-owned `fake_private_unsent_intents` table exists **only inside the test file's temporary database**. It stores opaque IDs, current consent/availability revisions and constant `unsent_test_only`; no phone, device, source log, callback, contact, queue or provider send.
- A test-only `BEGIN IMMEDIATE` lock covers fresh caller-own session/listing/worker-consent read, *real* private D1 availability and block read, and insertion of the fake UNSENT record. Unknown real presence and rate facts are explicitly **not** converted into `online` or `pass`.
- Before-lock state is not trusted: if either party blocks the other, or the worker turns availability OFF after a preview, the locked recheck refuses to stage a fake intent. Another caller remains independently scoped.
- A competing second connection cannot insert a block while the first local write transaction holds the SQLite lock. Once the first transaction commits, that actor can block; a fresh recheck refuses to reuse the still-UNSENT historical intent. This proves **local lock ordering only**, not durable delivery cancellation.
- Rechecking an older UNSENT fake record requires identical original worker consent revision and worker availability revision. OFF→ON does not revive an older fake record; wrong caller, revoked bearer and duplicate/conflicting call IDs fail closed. A thrown error between fake insert and commit rolls back fully.
- Duplicate replay is only a local idempotency observation, not permission to contact a worker. The test does not select a global worker concurrency limit or busy-slot policy.

## Explicit gaps

**No live Agora invocation is reachable.** These tests do not prove that Cloudflare D1 multi-request transactions or Durable Objects behave like local SQLite `BEGIN IMMEDIATE`; they do not reserve a real slot, enforce a quota, verify provider presence, send FCM/Signaling, issue tokens or provide an atomic network-delivery fence. Even a valid local UNSENT record may become stale as soon as the transaction commits.

The current `agora_account_blocks` schema has no block-generation ledger. A block that was added and then removed entirely between independent reads cannot be detected from the final current block state alone. This local lock test does **not** solve that historical ABA problem or authorize an unreviewed schema change. Future production admission requires an approved cross-store protocol and founder M-003 retention/relationship decisions, M-005 operational rules (including capacity and abuse limits), M-006 provider setup, and M-007 final production release. M-004 UI and M-008 OAuth remain separate.

No old Finworkar data or remote Cloudflare resources were accessed. Exact PR-head and independent merged-main Foundation CI are mandatory before claiming validation.
