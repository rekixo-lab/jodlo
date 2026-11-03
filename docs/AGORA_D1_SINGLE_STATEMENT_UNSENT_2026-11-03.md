# JODLO — D1-shaped single-statement private UNSENT admission rehearsal (2026-11-03)

**Status: TEST-ONLY / NO ACTIVATION.** Following founder standing engineering permission on 2026-11-03, this adds only a local SQLite test using actual JODLO schema 0001–0008 and two temporary fixture tables from previous #190/#191 tests. It neither adds nor approves a production table, stored personal-data mutation ledger, public endpoint, provider operation, network send, RTC grant, anti-abuse threshold or retention duration.

## Engineering finding: use one conditional write where D1 data is authoritative

Earlier #190 used local `BEGIN IMMEDIATE` around multiple awaited D1-like readers and a fake insert. That models SQLite locking but is **not** a portable JavaScript callback transaction across Cloudflare D1 requests.

The new `ATOMIC_FAKE_UNSENT_INSERT_QUERY` in `apps/api/tests/agora-private-safety-unsent-lock-sqlite.test.mjs` is one `INSERT ... SELECT ... WHERE ... ON CONFLICT DO NOTHING` executed through the existing `localD1Adapter.prepare(...).bind(...).run()` interface. No `BEGIN` or `COMMIT` string is sent to D1. It is a **candidate SQL shape**, not a production implementation.

Its single statement derives the caller account from a hashed current bearer session, the Worker from the published listing, and verifies both account states, Worker profile, enabled Category, allowed moderation, distinct Worker call consent, Worker availability intent, **expected** consent and availability revisions, *neither* directional block and an **expected test-only unordered pair revision**. Only after these conditions does it atomically insert an **UNSENT synthetic** row into a disposable test table. Worker bearer, phone, private block direction, online/push presence, quota status and device IDs are not accepted from an API payload or stored.

The `fake_block_pair_epochs` dependency is intentionally **absent from actual production migrations**; the SQL cannot be used against JODLO's deployed D1 schema. The test proves:

- Default-OFF consent/availability, forged/Worker bearer, invalid epoch, disabled state, unpublished/moderated listing, either active block, late OFF→ON and mismatched expected revisions cannot insert.
- Two local SQLite connections respect statement-level atomicity and unique call ID, including busy/locked writes, unrelated Customer scope, expired/revoked bearer and duplicate suppression.
- If a **test-only** block→unblock transaction increments a fake pair epoch, old expected epoch zero is refused despite unchanged real `contactBlocked:false`; a newly trusted test snapshot can insert.
- **Negative control:** If the real block writer changes and unchanges the pair without updating that fake epoch, the resulting SQL will admit a fake UNSENT row. This deliberately demonstrates that a partial rollout of a revision ledger is **unsafe**. All mutation paths and reader/write coordination must share a privacy-approved authoritative ledger before such a fence could be relied upon.
- Successful local rows remain `unsent_test_only`; subsequent blocking still requires an independent recheck. No method sends, receives, retries or acknowledges a real notification.

## Cloudflare-specific architecture evidence (verify at implementation)

Cloudflare D1's [database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) describes auto-commit and guarantees `batch()` statements execute sequentially as a transaction, rolling the whole batch back on failure. It **does not** describe the multiple asynchronous JavaScript operations from #190 as one transaction. The single conditional D1 SQL write is the **narrower portable pattern** to test further, not proof of any future cross-service admission transaction.

Cloudflare's [SQLite-backed Durable Objects storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) supports `transactionSync` with a **synchronous callback**, and synchronous SQL storage is private to one Durable Object. That can help design per-identity serialization, but it cannot atomically coordinate arbitrary remote D1 writes and RTC/provider sends without an additional documented protocol. A D1 session/bookmark is not a block-revision ledger or an external-provider idempotency guarantee.

## Not decided / next validation gates

1. **M-003:** privacy/legal basis, duration/deletion/export/disclosure and backup lifecycle for durable Customer–Worker pair revisions; current directional block table has **no timestamps or mutation history**. Do not add production collection until these are defined.
2. **M-005:** real online/busy/push presence, rate window/threshold, worker concurrency, report handling, blocked-user disclosure, and actual call expiry/admission coordination. Synthetic `rateGate:unknown` and `workerPresence:unknown` never equal approval.
3. **M-006:** actual Agora server-issued tokens, signaling/FCM, identity binding and provider error/unknown-delivery reconciliation. **No provider API or live tokens now.**
4. **M-007 / release:** final verified production-only rollout; no staging, remote migrations or Finworkar edits. M-004/M-008 and Category human review remain separate.
5. **Engineering gate:** exact-head PR Foundation CI, independent merged-main CI. Tests are local SQLite + D1-shaped API, **not proof of actual cloud multi-request or multi-store atomicity**.

This document is not an incident report or permission for any user-visible call button.
