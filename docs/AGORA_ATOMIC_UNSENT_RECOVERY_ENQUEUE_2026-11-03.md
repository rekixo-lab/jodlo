# JODLO — atomic local UNSENT + recovery enqueue and orphan quarantine (2026-11-03)

**Scope: disposable SQLite experiment only.** Under the founder's standing 3 November 2026 engineering authorization, the backend team continues local-first proof without enabling any live Agora calling, public contact endpoint, production D1 schema, provider transport, call metadata retention, new block-history collection or remote deployment.

## Failure gap inherited from PR #193

PR #193's real-private-safety recovery rehearsal introduced a fake `fake_private_recovery_leases` row referencing a fake original `fake_private_unsent_intents` row. It correctly checks current Worker call consent, availability, both directions of blocks, listing/moderation, Category, account status and an experiment-only pair revision when taking a PRE-SEND lease. However, the original UNSENT insert and recovery seed were **two separate writes**: an imagined process crash between them could leave an UNSENT intent **without** a corresponding recovery record. A naive repair/retry could silently lose a job, bypass the initial safety checks, duplicate a hypothetical request, or mistake an unknown transport outcome for a safe retry.

## The new self-contained atomic enqueue rehearsal

`apps/api/tests/agora-private-safety-unsent-lock-sqlite.test.mjs` now installs a **test-only SQLite AFTER INSERT trigger** on the synthetic UNSENT table, only within explicitly scoped tests. When the existing authenticated D1-shaped `stageOneStatementFakeUnsent` conditional `INSERT ... SELECT` succeeds, the trigger inserts exactly one `pending_unsent_test_only` recovery row **inside the same SQLite write statement**. Its fake original pair revision is sampled from the same local SQLite state. The parent/child foreign key, unique call ID and SQLite statement rollback prohibit partial successful results.

This is a design rehearsal, **not a proposal to add a real database trigger without architecture and policy approval**. It requires no new production migration. Future real D1 implementation must verify Cloudflare's supported SQL transaction mechanism and the full read-to-write consistency protocol for account blocks, intent, outbox and recoverability. A single SQLite trigger cannot coordinate a remote Durable Object, push/Signaling send or RTC token.

## Regression and crash evidence

- Default-OFF Worker call consent or missing availability results in **neither row**. Current consent/availability and combined private block checks remain enforced by the already tested one-statement parent writer.
- A successful original synthetic write creates **exactly one fake UNSENT and one fake pending recovery** row; duplicate call ID never enqueues twice. A separate local SQLite connection can see both after commit and only claim a PRE-SEND test lease when the private recovery policy still allows it.
- Injected failure **before** the child recovery insert and separately **after** the child insert both abort the original parent statement and leave zero fake rows. After removing the test-only fault trigger, a fresh attempt can create one paired record.
- A concurrent second SQLite writer cannot split the pair or claim an uncommitted record. If a test-owned block→unblock advances the fake pair revision, stale original expected revision fails; a newly observed revision is stored consistently in the paired fake recovery row. Any later block vetoes reuse of that original recovery epoch.
- An old orphaned UNSENT from the former two-write test path is detected by a **read-only aggregate integrity audit**, not silently reconstructed or retried. A deliberately corrupted orphan recovery row (simulated with temporary foreign-key enforcement disabled) is also withheld; the audit does not expose customer IDs, block direction, phone, session tokens or details.
- A local `outcome_unknown_test_only` phase survives reading through another SQLite connection and is not automatically reclaimed, marked delivered or interpreted as a confirmed failure. It is a quarantine, not a provider acknowledgement or a live resend rule.

## What remains unsolved

This test does **not** implement production call admission, real notification delivery, automatic crash recovery, caller/worker push eligibility, service-worker capacity, online presence, an abuse budget, genuine block-history fencing or provider reconciliation. It also does not prevent the historic block ABA gap when **any real block/unblock path lacks** an approved durable pair generation; see [negative-control evidence](AGORA_D1_SINGLE_STATEMENT_UNSENT_2026-11-03.md).

A real implementation must settle **M-003** purposes, data minimization, retention and deletion/export/backup for call metadata and pair versions; **M-005** presence, quota/window, busy capacity, expiry and appeals; **M-006** Agora credentials, Signaling/FCM delivery evidence and uncertain-provider reconciliation; **M-007** controlled direct production release; and M-004 UI / M-008 actual OAuth independently. Founder standing authorization permits engineering without repeated generic prompts but does not invent those settings.

**No real callers contacted; no Finworkar writes; no cloud staging/provisioning.** Exact-head PR Foundation CI and independent merged-main CI must both pass before calling this local proof verified.

Related: [private recovery](AGORA_PRIVATE_D1_UNSENT_RECOVERY_FENCE_2026-11-03.md), [D1 single-statement design](AGORA_D1_SINGLE_STATEMENT_UNSENT_2026-11-03.md), [owner action register](MANUAL_ACTIONS.md).
