# JODLO — Historic block/unblock ABA and hypothetical pair epoch (2026-11-03)

**LOCAL TEST REHEARSAL ONLY.** This does not select an actual block-history retention policy, migrate D1, expose a route, grant a call or choose provider/production architecture. It follows the founder's 3 November 2026 broad permission to continue engineering without repeatedly requesting a generic "करो".

## The real gap

PR #189's authenticated private D1 caller safety query intentionally returns only `contactBlocked` and keeps the other party's block direction private. PR #190 demonstrates local SQLite write locking for an already-current single state. However, a block that is **inserted and then deleted** between two independent read-only checks yields exactly the same current D1 result as if it had never occurred. A future real call writer MUST NOT treat this current-state comparison as an historical mutation fence.

## What this test adds

The existing `apps/api/tests/agora-private-safety-unsent-lock-sqlite.test.mjs` now creates a second **fake table, local to a disposable two-connection SQLite file**, called `fake_block_pair_epochs`. Its canonical unordered account pair and positive monotonically increasing revision are used solely to compare the following design hypothesis:

1. Two real, authenticated, actor-owned `setOwnAgoraAccountBlock` operations (block and unblock) happen while the same local SQLite transaction updates the fake pair revision. **Each real block writer is unchanged**; only the test harness wraps it and updates fake state.
2. Before and after that pair's block→unblock, the real private `contactBlocked:false` D1 read, consent revision and availability revision are **identical**. The test explicitly proves those existing values alone miss the history.
3. A test-only `onLocked` comparison against the original fake revision denies creation of a fake `unsent_test_only` record. A new snapshot with the fresh revision can stage a purely local fake record, never a provider message.
4. Caller-initiated and Worker-initiated block changes increment the **same pair**. An unrelated Customer–Worker pair has independent fake revision; there is no public direction disclosure, IP, device identifier, reason, location, phone or raw bearer storage.
5. A synthetic failure after both the real block mutation and fake revision update rolls back the two together. Duplicate/no-op mutations do not invent new revisions, and a competing writer cannot interleave under the **local SQLite** `BEGIN IMMEDIATE` lock.

## Why this is not ready for real deployment

- **No persistent production pair epoch exists.** The actual migration 0008 and `readLocalCallerAgoraSafetyFacts` remain unchanged; no real caller/worker activity is logged or retained. A snapshot without an actual durable epoch still has the ABA gap.
- A production revision would be **personal relationship metadata**. Its lifecycle, export/deletion, evidence disclosure, dispute handling, backup/restore and retirement need M-003/M-005 privacy and operational choices before a real migration. This test deliberately avoids guessing a retention interval or silently approving block history.
- SQLite's test-only `BEGIN IMMEDIATE` is not a proof of Cloudflare D1/DO cross-request transaction guarantees or an atomic external Agora/FCM send, a provider ACK, a media cutoff, an anti-abuse budget or concurrency admission.
- Founder-wide engineering permission was given **3 November 2026**, but unspecified product parameters, technical feasibility, external account/provider configuration, final human catalog/legal reviews, and controlled production release readiness are still not automatically supplied by that permission. No staging or production action is taken.

**Acceptance gate:** exact PR-head Foundation CI SUCCESS, then separately verified merged-main push CI SUCCESS. All synthetic claims stay `unsent_test_only`; JODLO's original Finworkar reference remains read-only.
