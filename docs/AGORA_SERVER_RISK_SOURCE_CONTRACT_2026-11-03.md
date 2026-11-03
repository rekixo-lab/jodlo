# JODLO — Server-injected Agora risk-source read contract (2026-11-03)

**LOCAL-ONLY SYNTHETIC ENGINEERING.** JODLO's founder-approved first contact remains a **customer-initiated Agora in-app Internet AUDIO call**, with separate, default-OFF, revocable Worker call opt-in (ADR-0013/0014). The five actual server-owned sources needed for real presence/availability, bilateral blocks, abuse/rate admission and connection privacy **are not built or approved**. M-003/M-005/M-006 and release M-007 remain blocking gates for live contact; do not invent policy thresholds.

## The missing integration contract

The earlier offline fixtures already had a robust risk composer and current-session/worker-opt-in read. But each test supplied a preassembled JSON-like risk object; there was no narrow entry point enforcing **who obtains the caller/worker identity, which source supplies each dimension, how failing readers behave and when consent/expiry must be rechecked**. That leaves room for accidentally treating client input, missing risk sources or a stale pre-read as contact authorization when building a future backend.

## New internal contract

`apps/api/src/modules/interactions/agora-server-risk-sources.ts` introduces `prepareSyntheticServerRiskReadAgoraInvite`. It has no public route, no provider transport, no real writer and no persistence. Its five **read-only, server-injected** reader ports are `presence`, `availability`, `mutualBlocks`, `abuse` and `connection`. The ports must be exactly those five own *data* functions: missing/extra/hidden/symbol/accessor/proxy metadata rejects **before D1**. Client JSON, browser headers and a caller-provided worker ID must never be used as a substitute for these ports.

The sequence is **fail closed**:

1. Require a valid injected test clock and ring deadline (not a founder-approved duration), then read the customer's **own active D1 session**, exact published/allowed Category/listing, actual owner account and **currently enabled Worker consent revision**, without receiving any worker bearer.
2. If the D1 read denies, **no reader is called**. Otherwise freeze an opaque identity containing ONLY caller account ID, actual listing-owner account ID and listing ID. Pass only this identity to each of the five independent server reader ports; no access token, phone number, channel, provider UID or private session digest is exposed.
3. Await all five sources; a missing/throwing/malformed/cross-identity/stale source denies. Recheck the injected clock and compose the same strict, source-specific, five-part risk evidence already covered by the 576-state matrix. Require online, available, **neither party blocks the other**, passing rate/abuse evidence, recipient verification and explicit privacy approval; no guess that unknown is safe.
4. Re-read current **caller-session/listing/worker enabled consent** with the existing original-epoch-bound preflight. Reject if the worker turned OFF or OFF→ON while independent safety sources were pending—even if the latest enabled preference is again ON.
5. Read the test clock a final time; reject if it moved backward, source evidence expired at the **earliest** of five expiries, or the proposed ring deadline already passed while D1 was pending. Return only a frozen synthetic call snapshot and original revision—not proof that the evidence can be used later.

This is a **preview**, not a lease, durable consent reservation, live availability guarantee, real rate counter or send authorization. A different process could revoke consent, change blocks/presence or consume a quota immediately after these reads. The actual implementation will need approved source ownership/schema/privacy and an appropriate atomic admission/dispatch coordination boundary (with original consent epoch fencing), not simply calling this helper from an HTTP route.

## Evidence

`apps/api/tests/agora-server-risk-sources.test.mjs` uses local D1 sessions, published worker-owned listings and explicit default-OFF consent to verify strict port shape, absent sources, bearer scoping, owner-only identity, every negative block/busy/rate/privacy condition, cross-identity evidence, source failure, stale and backwards clocks, and current epoch rechecks across OFF/ON races. Existing `agora-risk-evidence-matrix.test.mjs` (120 permutations / 576 negative-state combinations), `agora-invite-epoch-bound.test.mjs`, SQLite two-writer call/opt-out/UNSENT outbox tests, TypeScript, local workerd and Kotlin Core remain covered by Foundation CI.

**No live activation:** no D1 migrations, actual block/report/availability/rate tables, legal decisions, production thresholds, call/RTC APIs, Agora tokens or SDK, message delivery, private location/PII, Google OAuth onboarding, Android, staging/production Cloudflare, Category activation, payment or legacy Finworkar changes. Founder M-005 operational questions remain open; the approved defaults and boundaries are unchanged.
