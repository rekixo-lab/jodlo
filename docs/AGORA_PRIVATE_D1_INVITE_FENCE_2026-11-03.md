# JODLO — Private D1 safety fence around scripted Agora invite (2026-11-03)

**Local-only backend engineering**, following the founder's permission to implement the minimal private Agora safety schema. **No real Agora calling or provider access is enabled.** Operational M-003/M-005 policy remains pending.

## Gap closed

PR #187 added current private D1 Worker availability intent and actual directional Customer↔Worker blocks, while the earlier PR #186 five-reader synthetic preflight still could prepare a **fake** invite from scripted all-pass availability/blocks, without consulting the new D1 safety tables. A scripted `mutualBlocks: false` or `workerAvailability: available` is **not evidence** that a real account is unblocked or that Worker availability intent is enabled.

`prepareSyntheticServerRiskReadAgoraInvite` now requires two **caller-session-bound private D1 safety reads**, before and after the five scripted source reads:

1. Current caller active session, actual listing owner/approved Category/moderation and explicit Worker Agora call consent revision are verified as before.
2. The first private D1 safety read MUST match that original consent revision, show a distinct **Worker-owned accepting-calls intent ON** with valid positive availability revision and **no block in either direction**. Missing availability, either block, disabled account or invalid adapter response denies **before any scripted risk reader** is called.
3. The existing five synthetically injected presence, availability, bilateral block, abuse and connection checks still must pass strict identity/shape/time validation. They CANNOT override D1 rejection; they are test-only and do not implement real device presence or quotas.
4. The existing consent-epoch-bound fake invite rechecks the caller's session, current listing and original Worker consent revision.
5. A final private caller-bound D1 safety read MUST show current availability ON, neither block direction set, unchanged original consent revision **and unchanged Worker availability revision**. OFF→ON during independent source collection increments the revision and invalidates that older candidate.
6. Final injected test clock is sampled **after** the final private D1 await; the earliest source expiry and proposed ring deadline must not have passed.

This change adds no new D1 tables, columns, API routes, source inference, timers, call logs, push, provider tokens or network side effects.

## Failure boundaries and remaining work

- **Correct test-only result:** scripted evidence says all pass AND the separate, authentic D1 availability/blocks/consent gates stay eligible → the helper may return a *synthetic prepared snapshot*. This is neither a real call grant nor permission to display a dial button.
- **Strict local veto:** missing default-OFF Worker consent/availability, caller/worker blocked pairs, unavailable source/expired evidence, changed availability revision, lost publication/moderation or stale consent revision → `denied`.
- The private D1 reader intentionally returns `workerPresence: unknown` and `rateGate: unknown` even if availability intent is ON and the aggregate counter table exists. A scripted passing risk check does not provide a policy-approved real presence or abuse verdict.
- Multiple independent SELECT statements still **cannot guarantee cross-store atomic admission** or detect an account block inserted and then removed entirely between reads. An actual provider delivery must use an approved transactional coordination/fencing design with authoritative presence, blocks, quota and privacy sources. No permission for real dispatch, RTC token or fixed rate-limit numbers is implied.
- Retention for personal block-pair and aggregate activity data, legitimate user disclosure, deletion/export and appeal flow remain M-003/M-005 decisions; operational presence and quotas remain M-005; real Agora M-006 and controlled production-only release M-007 remain gated.

## Regression evidence

`apps/api/tests/agora-server-risk-sources.test.mjs` now creates **real throwaway SQLite D1 rows** and tests: default missing availability prevents any reader work; explicit availability and opt-in are separately necessary; a real caller block or Worker block vetoes synthetic all-pass sources; unrelated customer remains scoped to their own block pair; turning availability OFF or OFF→ON while independent sources await denies; a new block just before the final private safety read vetoes a stale fake candidate. Existing 120-order/576-state matrix, security founder guards, isolated workerd, TypeScript, SQLite transactions and Kotlin Core continue to run in Foundation CI.

No real data was written to Cloudflare or the old Finworkar repositories. [Minimal private D1 privacy model](AGORA_PRIVATE_SAFETY_D1_PRIVACY_2026-11-03.md).
