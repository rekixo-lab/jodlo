# JODLO — trusted contact shutdown before owner block: failure-mode trial (2026-11-03)

**Local-only architecture candidate. NOT a runtime kill switch or a decision to record real pair history.** Existing worker availability and call consent stay separate and default OFF. Real contact admission, transport and RTC remain disabled.

## Why this work is necessary

[PR #196](AGORA_AUTOMATIC_BLOCK_PAIR_EPOCH_TRIAL_2026-11-03.md) proved that an experimental SQLite trigger can move a block/unblock and a canonical pair epoch in **one statement**. It also proved an undesirable failure: if the epoch row reaches its checked limit, or its storage is unavailable, that same trigger aborts the **actual block mutation**. A person trying to block contact must not lose that protection merely because a hypothetical call-recovery ledger is unhealthy.

There are two different safety objectives: **preserve the authenticated block action** and **do not issue new or repeated contact when required call-admission evidence is missing**. Coupling both objectives into a trigger that can abort blocks is not automatically the right design.

Cloudflare's [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) documents that `batch()` commits its statements sequentially within one SQL transaction or rolls back on a statement error. The [D1 timeout guidance](https://developers.cloudflare.com/d1/observability/debug-d1/) warns that client-side timeout races do **not** cancel writes; a timeout can leave an unknown, potentially committed result. Neither property solves external network delivery acknowledgment or unauthorized pair-history retention.

## New local test: **stop contact first, then allow the existing block writer to work**

`apps/api/tests/agora-private-contact-safety-fuse-sqlite.test.mjs` builds actual migrations `0001`–`0008` in a disposable two-connection SQLite file and creates three **fake** tables: a singleton global admission circuit, an unordered per-pair revision hypothesis and transient fake unsent intents. **No production schema or API is changed.**

The local circuit has two states, `open_test_only` and `halted_test_only`. `open_test_only` exists solely to model a previously eligible offline candidate. A **trusted, internal-only** local operation commits `halted_test_only` *before* any subsequent block/unblock. It is never exposed through public routes or arbitrary user commands. The fake admission `INSERT ... SELECT` and the fake background recovery `UPDATE ... WHERE EXISTS` independently require the circuit to be open **inside the same SQL statement** as their current consent/availability/Category/actor/blocks/epoch checks. Once closed, old unsent and unattempted recovery are withheld even if a block is later removed. A completed local lease does not send a provider message.

The trusted shutdown is modeled as monotonic: repeat shutdown returns withheld, and a disposable test trigger prohibits automatic reopening. A real service would require explicit operational verification, privacy rules, audit authorization and a coordinated safe reactivation protocol before reopening anything.

## Seven regression cases

1. Without the worker's **explicit** consent and separate availability, the fake candidate cannot stage. With both ON, the fake single-statement admission and one PRE-SEND test claim work, but no provider contact occurs.
2. At an **artificial maximum per-pair revision** (where PR #196's trigger would abort), the circuit is committed **HALTED first**; the unchanged real `setOwnAgoraAccountBlock` remains usable for the owner to block and unblock. Old and fresh fake calls cannot stage or claim, despite a stale fake pair revision or current `contactBlocked:false`.
3. A simulated crash after committed shutdown and *before* block leaves admission halted across the other SQLite connection; the real authenticated block remains writable after recovery.
4. Duplicate shutdown or a direct reopening attempt does not permit contact. The circuit is deliberately irreversible inside the test.
5. A competing SQLite writer prevents a **successful** halt acknowledgment. A subsequent safe halt works. If the halt was not committed, never report that contact has been stopped.
6. A fake transport `UNKNOWN` outcome remains quarantined after halt, block→unblock and an independent connection read; no automatic resend or provider acknowledgment is inferred.
7. **Global shutdown sacrifices availability for unrelated pairs** too. This prevents drawing the false conclusion that global shutdown is a free substitute for a pair-scoped, privacy-approved design.

## Security limitations and next decisions

**This does not solve the production system.** A global shutdown must **never** be a user-controlled arbitrary DoS primitive; only trusted operations could initiate it. The test has no actual server-side operator authorization, online status, provider call, queue or published shutoff API. D1, Durable Objects and Agora signaling have **no shared transaction**. A write or network response that times out may have committed or been sent. An already-issued network message cannot be recalled by a database circuit alone. The current test-only circuit begins in OPEN solely to allow controlled comparison and is **not** a recommended production default.

If the shutdown write itself fails, this experiment cannot assert that blocking is complete or new sends are safely stopped. A real sender must also stop when its authoritative gate is unreachable, must recheck at its own irreversible send boundary, and must not reconstruct a missing history or automatically retry UNKNOWN. Concurrent in-flight sends and external handoff need separate fencing/acknowledgment evidence. Test-only local atomicity is not Cloudflare cross-region/replay safety.

**Decisions still required before real collection/release:**

- **M-003:** is a retained pair generation or global circuit justified; what erasure/export, backup lifetime, account-deletion and reset policy applies? A pair revision is still account-linked metadata. No such production history is added.
- **M-005:** presence/busy/queue capacity, quotas/windows, reporting, recipient communication, how a stopped service informs users and who can resume it. Do not infer these values from the synthetic test.
- **M-006:** provider idempotency, request correlation, reliable ACK lookup, UNKNOWN quarantine and collision-safe reconciliation with actual Agora services.
- **M-007:** controlled direct-production release gate; do not deploy or provision staging. M-004 UI and M-008 Google OAuth remain separate.

**Result requirement:** latest PR-head Foundation CI and independently merged-main Foundation CI SUCCESS. Finworkar remains strictly read-only.

Related: [#196 automatic revision experiment](AGORA_AUTOMATIC_BLOCK_PAIR_EPOCH_TRIAL_2026-11-03.md), [private recovery](AGORA_PRIVATE_D1_UNSENT_RECOVERY_FENCE_2026-11-03.md), [manual policy register](MANUAL_ACTIONS.md).
