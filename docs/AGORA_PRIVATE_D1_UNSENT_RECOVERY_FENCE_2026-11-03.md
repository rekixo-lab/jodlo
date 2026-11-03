# JODLO — private D1 recheck at UNSENT recovery boundary (2026-11-03)

**LOCAL-ONLY TEST TRIAL.** Founder standing authorization (2026-11-03) permits autonomous engineering. This patch introduces no live calling, real outbox, new production table/migration, external token, notification, schedule, user data collection or release. The exact M-003 personal-data lifecycle and M-005 presence/abuse/busy/expiry rules are still not specified.

## Why this is the next backend gap

PR #190–#192 establish three separate facts: (1) current Customer–Worker block and Worker availability are private authenticated D1 data; (2) a block→unblock ABA may be invisible without a **fully coordinated** durable pair revision; and (3) a single SQL write can check original consent/availability and other conditions more reliably than a multi-await SQLite lock copied into D1.

The preexisting `agora-invite-sqlite-atomicity.test.mjs` already rehearses generic local outbox claims, lease generations, unknown transport outcomes, and no-repeat semantics. **This work does not duplicate that generic outbox implementation.** Instead, the new tests connect hypothetical recovery to the **actual migrated D1 private safety facts**, so an old fake UNSENT intent cannot pass a lease/recovery read merely because it was allowed when staged.

## New disposable SQL proof

In `apps/api/tests/agora-private-safety-unsent-lock-sqlite.test.mjs`, a new **test-owned** `fake_private_recovery_leases` table references an existing synthetic `fake_private_unsent_intents` row. Only opaque call references, a fake original unordered-pair revision, test-only generation, artificial deadline/lease and an enum `pending_unsent_test_only | leased_pre_send_test_only | outcome_unknown_test_only` are stored in a temporary two-connection SQLite database. This is *not* the production schema or a proposed retention policy.

`CLAIM_PRIVATE_UNSENT_RECOVERY_QUERY` uses one conditional `UPDATE ... WHERE EXISTS (...)` through the D1-shaped `prepare().bind().run()` path, without JavaScript `BEGIN`/`COMMIT` around awaited reads. It derives the caller and Worker from a **server-owned previously staged opaque UNSENT row**, never from a new customer-supplied worker ID or customer/worker bearer. It requires in that same write:

- Both original accounts still active; same actual listing owner and Worker profile, active Category, published and not hidden listing.
- Worker call consent still ON with the **original** consent revision, and Worker availability intent still ON with the **original** availability revision. OFF→ON is a new epoch and never revives an old intent.
- Neither directional relationship block exists. An **experiment-only**, fully coordinated pair epoch must still match the stored original. Real migrated table 0008 has **no durable epoch**: therefore it cannot currently prove ABA-safe recovery.
- An original UNSENT intent exists, generation matches, fake deadline has not passed, the proposed artificial PRE-SEND lease is valid, and either no earlier claim exists or a PRE-SEND-only lease expired. Two SQLite writers cannot both increment the same generation.

The test fixture stages its original UNSENT record and recovery row **in separate local statements**: this is NOT a production atomic admission/outbox design. Any future real admission must atomically commit authenticated consent/availability/block checks, original candidate, pair version, intent and outbox state within an approved storage/coordination boundary.

## Unknown outcome is a quarantine, not a retry

The test-only `MARK_UNCERTAIN_TEST_ONLY_QUERY` marks the current generation `outcome_unknown_test_only` **before any hypothetical external side effect**. There is no real side effect in this suite. Once UNKNOWN, the record is **never automatically reclaimed, treated as delivered, or declared failed**; duplicate/old generation markers fail closed. An expired PRE-SEND lease may be reclaimed only if the marker was never crossed and the private D1 and stored epoch checks still pass. This favors duplicate prevention over automatic liveness and is not itself a provider acknowledgement protocol.

Tests cover absence of original row, disabled/hidden/unpublished Category/listing or account, either block direction, availability OFF and OFF→ON, consent OFF→ON, historical block→unblock ABA (only while every test mutation increments the fake pair revision), stale generation, concurrent SQLite writer, expired fake deadline, lease ceiling, reclaimer generation increment, stale worker, and permanent unknown outcome withholding.

## Strict limitations and next decision gates

- A **successful local PRE-SEND lease is NOT permission to send an Agora signal**. Server-owned real presence, worker busy/capacity state, abuse quota and privacy/disclosure remain unknown. A lock or claim is neither delivered notification nor RTC token.
- The test's fake pair-generation store cannot protect calls while the existing real `setOwnAgoraAccountBlock` writer does not mutate a corresponding durable ledger. No real history/timestamp is collected. **Do not activate until every block path, including unblock, is coordinated.**
- Cloudflare D1 single-statement writes are a narrower atomicity unit than awaited multi-call JavaScript transaction simulations. This local SQLite success does **not** prove cross-region D1/DO synchronization, crash safety of a real outbox and provider, remote ACK semantics, token revocation or exactly-once network delivery.
- M-003 needs the *specific* retention/deletion/export/appeal basis and backup lifecycle for call/pair metadata. M-005 needs explicit online/busy/push presence rules, rate threshold and window, capacity, deadline, failure and dispute policy. M-006 needs real Agora onboarding and sender protocol; M-007 controlled production-only release and M-008 live OAuth remain separate. Prior approved no-staging workflow remains.
- **Test gate:** green exact-head Foundation CI and separately green merged-main CI; no production/cloud/network calls, no Finworkar writes.

Related: [single-statement trial](AGORA_D1_SINGLE_STATEMENT_UNSENT_2026-11-03.md), [ABA evidence](AGORA_BLOCK_ABA_PAIR_EPOCH_TRIAL_2026-11-03.md), [existing generic local outbox test](../apps/api/tests/agora-invite-sqlite-atomicity.test.mjs), [manual decision register](MANUAL_ACTIONS.md).
