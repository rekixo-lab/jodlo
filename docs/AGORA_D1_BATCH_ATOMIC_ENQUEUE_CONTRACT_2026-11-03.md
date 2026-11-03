# JODLO — Cloudflare D1 batch transaction versus trigger-only UNSENT enqueue (2026-11-03)

**Status: offline test contract / no live call admission.** JODLO's founder granted standing permission for engineering on 3 November 2026. Real privacy decisions, operational rates/capacity, provider configuration and production release have not been specified and are **not presumed** by this test.

## Source of the architecture choice

Cloudflare's [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) (updated 22 June 2026) documents that `D1Database.batch([...])` runs the prepared statements **sequentially as one transaction** and rolls back the sequence when a statement fails. It does not authorize holding an arbitrary multi-`await` JavaScript lock, nor does it make external notifications/RTC/another storage service atomic.

The [SQLite-backed Durable Objects storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) (updated 21 September 2026) is private to **each individual object**. Its local storage transaction is not a universal transaction with D1 or provider calls. JODLO must choose one authoritative admission storage/coordination boundary before real signaling is activated.

## Gap in #194 and improvement in this PR

PR #194 rehearsed an **AFTER INSERT trigger** that inserted a fake recovery child in the same SQLite write as a fake UNSENT parent. That is useful SQLite evidence, but it does not separately demonstrate the **documented D1 `batch()` transaction API** or the case where a conditional D1 insert silently changes zero rows.

The new `apps/api/tests/agora-d1-batch-atomic-unsent.test.mjs` runs eight tests using real JODLO migrations `0001`–`0008`, real session/worker opt-in/availability/block writers, two file-backed SQLite connections and `localD1Adapter.batch`. It creates *only two test-owned tables*:

- `fake_batch_unsent`: opaque synthetic parent ID, listing and actor FKs, original exact opt-in and availability revisions, unique **server-test attempt nonce** and constant UNSENT test state;
- `fake_batch_recovery`: matching fake parent ID, nonce, and a pending-only fake state, not a provider delivery log.

No production migration or account data was changed. In a **single** `db.batch([first, second])`, the first prepared `INSERT ... SELECT` binds the caller's *own* current hashed session and actual listing, category, Worker consent, Worker availability, both block directions, and original revisions. The second `INSERT ... VALUES((SELECT ...),...)` rechecks the same safety predicates before inserting a child. If that subquery finds **no matching current and originally eligible candidate**, it returns NULL; the child's `call_id TEXT NOT NULL` constraint throws, forcing the **whole batch** to roll back. It cannot merely return zero changes while leaving a half-committed parent. The caller cannot select a Worker ID or supply the Worker's bearer.

The rehearsal uses a **new private test-owned attempt nonce** per attempted batch and a strict primary key/unique constraint. If a duplicate old parent is present, the first statement throws rather than silently backfilling a missing child on retry. Both returned `changes` values must be exactly 1 before even reporting a **test-only paired UNSENT result**. This is an architecture candidate, **not** a production nonce generation or privacy/retention policy.

## Regression boundaries

- Missing/disabled consent or availability: neither row. When both worker-controlled states explicitly ON with expected original revisions: exactly one fake parent plus one fake recovery.
- Duplicate call ID, reused nonce, foreign/Worker bearer, incorrect revision, or an old original without a recovery child: reject, with no repair/replay.
- Child failure injected **before or after** INSERT: rollback both records; a new independent attempt may then succeed.
- Either block direction and revoked caller session reject without half-stored recovery.
- Consent OFF→ON and availability OFF→ON must not resurrect earlier preview epochs.
- A competing SQLite writer cannot interleave a batch or create a duplicate.
- No actual Agora call table, route, notification, online presence, rate threshold, real provider calls or Cloudflare deployment is introduced.

## Critical limits and unresolved production gates

This is **not a complete admission protocol**. The fake batch does not coordinate historical block→unblock ABA, because real D1 migration 0008 has **no approved durable pair mutation generation** and some block paths do not update any ledger. Thus even one perfect local transaction cannot justify contacting a worker after an untracked block epoch changed.

A production storage design must bind: actual pair-history minimization/deletion/export (M-003), approved presence, rate quotas and worker capacity (M-005), original call identity and consistent outbox/send state, crash/UNKNOWN outcome reconciliation, a provider idempotency/ACK model (M-006), and controlled release readiness (M-007). UI M-004 and OAuth M-008 remain separate. No staging deployment is allowed by the project plan.

An attempted transport outcome of **UNKNOWN must never be called delivered or automatically resent** merely because D1 committed the outbox. Real provider delivery is outside D1's transaction.

**Required verification:** exact PR-head Foundation CI SUCCESS and separately confirmed merged-main CI SUCCESS. No remote resources or Finworkar mutations.

Related: [#194 local trigger experiment](AGORA_ATOMIC_UNSENT_RECOVERY_ENQUEUE_2026-11-03.md), [#193 recovery safety](AGORA_PRIVATE_D1_UNSENT_RECOVERY_FENCE_2026-11-03.md), [founder manual register](MANUAL_ACTIONS.md).
