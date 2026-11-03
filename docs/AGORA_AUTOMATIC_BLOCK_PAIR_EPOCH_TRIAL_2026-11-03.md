# JODLO — automatic, test-only block/unblock pair epoch and UNKNOWN boundary (2026-11-03)

**Engineering status: local SQLite demonstration; NEVER live calling or approved retained relationship metadata.** The founder's standing permission permits code, isolated PRs and CI without repeated generic approval. It does not supply M-003 data lifetime/export/deletion, M-005 actual busy/presence/rate policy or provider credentials.

## Why this advances #191–#195

The prior [ABA pair epoch trial](AGORA_BLOCK_ABA_PAIR_EPOCH_TRIAL_2026-11-03.md) used a **manual test wrapper** around the actual actor-owned block writer and a fake unordered pair revision. An uninstrumented block writer could still change block→unblock without advancing that revision. The later [single-statement test](AGORA_D1_SINGLE_STATEMENT_UNSENT_2026-11-03.md) correctly included a *negative control* showing stale UNSENT admission was possible when a mutation path missed the ledger.

This PR instead installs **three fixture-owned SQLite triggers** on the already migrated `agora_account_blocks` table, **inside a temporary two-connection test database only**. Each existing `setOwnAgoraAccountBlock` authenticated INSERT or DELETE automatically bumps the same test-owned canonical unordered `fake_block_pair_epochs` record *as part of the same SQLite statement*, with no additional awaited JavaScript ledger call. A relationship-identity UPDATE, although **not used by the present real authenticated writer**, invalidates both the old and new pair revisions; a no-op UPDATE does not advance either.

The canonical pair key uses `MIN(account_id1,account_id2)` and `MAX(account_id1,account_id2)`; only one monotonic revision is needed per unordered pair in the **experiment**. There is no reason, phone, bearer, device, IP, location, recording or call payload in the fake ledger. The existing private D1 read still returns only `contactBlocked`, not block direction.

## What the local tests demonstrate

1. Actual owner-authenticated Worker/CUSTOMER block and unblock writes automatically advance the **fake** pair epoch once for each committed mutation; duplicate block / absent-direction unblock are not mutations and do not advance it.
2. A real block→unblock sequence yields **identical** before/after current private `contactBlocked:false` facts, while the fake epoch changes. The stale expected zero revision is rejected by the existing [single-statement fake UNSENT writer](AGORA_D1_SINGLE_STATEMENT_UNSENT_2026-11-03.md). After a new fake snapshot, later mutations invalidate pre-send recovery through the already tested **single conditional SQL UPDATE**.
3. Both block directions share the same unordered fake epoch; an unrelated Customer–Worker pair remains independent. A raw direction/target change invalidates **both former and new pairs**, preventing a forgotten UPDATE-only migration path in this local fixture.
4. Fault injection preventing the fake revision write rolls back the **real** block mutation in the disposable SQLite transaction. A second SQLite writer holding a write lock forces a denied mutation without producing a mismatched pair. Nothing is sent.
5. Deliberately setting the test revision to its `2147483647` maximum causes the next local mutation to fail its CHECK constraint instead of wrapping to zero. **This is an unresolved safety/product hazard:** a real user must not lose the ability to block someone due to revision exhaustion or ledger unavailability. A future approved design needs a fail-closed *call* gate and reliable block action, not simply this trigger.
6. A preexisting synthetic `outcome_unknown_test_only` remains quarantined through block→unblock and a simulated independent connection restart. It is neither provider delivery proof nor safe automatic resend.

## Why this is not ready for deployment

- **No production pair version or history exists.** Migration `0008` and the authenticated block writer remain unchanged. Test-only triggers are not a release design, and these tests do **not** demonstrate Cloudflare's exact remote D1 trigger support, replica consistency, Time Travel restore, account deletion/cascade, privacy erasure, key reuse or reliable generation reset policy. Each possible writer/import/admin repair, deletion and restore path needs review.
- Genuine **M-003** retention, backup lifecycle, export/erasure and disclosure rules must be chosen before any permanent pair version or call intent/outbox metadata is added. A scalar revision can still be account-linked personal data. This is especially important for safety-related blocks.
- Genuine **M-005** presence/push, busy capacity, rate windows/thresholds, report/appeal/abuse workflow and recipient verification remain unknown. `workerPresence:unknown` and `rateGate:unknown` are never approval.
- **M-006** provider-sent signaling and RTC AccessToken2, ACK/reconciliation and per-attempt idempotency are not integrated. Even a fully atomic database fence cannot atomically commit a network operation. Cloudflare warns that a **timed-out D1 write can later commit**; never assume a timeout means no write or use a new call ID to retry blindly. The [D1 debug and retry guidance](https://developers.cloudflare.com/d1/observability/debug-d1/) and [D1 `batch()` semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/) remain separate from provider delivery guarantees.
- M-007 direct-production-only release, M-004 actual UI and M-008 Google OAuth have not been marked ready. No Cloudflare staging, provider contact or Finworkar write is performed.

**Do not promote an offline `UNSENT` fixture to a call button, provider send, RTC token, reservation, grant or confirmed delivery.** Require exact PR-head and independent merged-main Foundation CI success before the local experiment is marked verified.

Related: [private recovery fence](AGORA_PRIVATE_D1_UNSENT_RECOVERY_FENCE_2026-11-03.md), [D1 batch transaction rehearsal](AGORA_D1_BATCH_ATOMIC_ENQUEUE_CONTRACT_2026-11-03.md), [manual owner choices](MANUAL_ACTIONS.md).
