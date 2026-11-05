# JODLO — Code completion and first production release gates

> **CURRENT VERIFIED STATE — 2026-11-05:** See [current code/live/reviewer evidence ledger](CURRENT_STATE.md) **first**; it supersedes older historical deployment and PR-pending statements below. Latest verified main `fd5a5d0` passed Foundation and native Android JDK17/21 CI. The owner previously proved the live API/Google login/private Worker draft on 2026-11-03, but this does **not** prove the newest code was deployed. Last owner-read D1 had 0 approved Categories and 0 public Listings; human review, consent-safe Agora/FCM, full product, release and final consolidated physical-phone acceptance remain gated. No blind redeploy, data seed, outreach emails or Finworkar modifications.


> **2026-11-04 CURRENT RELEASE STATE:** Founder-provided 2026-11-03 evidence in [STATUS](STATUS.md) confirms an existing deployed JODLO API Worker, real Android Google Sign-In and private Worker draft. The older “no verified live resources” statements below are historical and superseded for *these specific facts only*. Latest merged main (#225–#231) Foundation/Android CI is green, but its deployment, production Categories/Worker Listings, full phone acceptance, Agora/FCM and public Marketplace release are **not** verified. Last read D1: 0 Categories/0 public Listings. Never repeat an obsolete first-deploy step without checking the current live resource. No automatic launch, seed, provider activation, secrets or Finworkar writes.


**CURRENT EXECUTION UPDATE (2026-11-03):** [ADR-0015](decisions/0015-real-provider-integration-and-controlled-production.md) authorizes **real Cloudflare/Google onboarding and controlled production deployments now**, superseding the delayed-provisioning policy stated below. This checklist is still essential **before broad public access**; controlled protected production integration is a milestone, not final launch. [Manual actions](MANUAL_ACTIONS.md) · [real setup runbook](REAL_PRODUCTION_CONNECTION_RUNBOOK_2026-11-03.md). No live resources are verified connected yet. Never automatically deploy from a GitHub push, store secrets in the repo or skip backup/privacy/security checks.


**Founder-approved strategy (2026-10-27): no deployed staging, no Cloudflare deployment before product readiness.** Development uses local cloud simulations, mock integrations and GitHub CI. First external deployment is a separately approved production release.

**Latest source/CI gap ledger:** [Release Gap Audit — 2026-10-28](RELEASE_GAP_AUDIT_2026-10-28.md). It distinguishes previously verified headless tests from all still-open device, provider, operational and founder gates. The Kotlin suite inventory/aggregate checks are only **coverage wiring checks**, not release acceptance or numerical code coverage.

## Mandatory quality acceptance before final release

- [ ] Follow [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md): reusable tested UI/business components/contracts, no redundant media/assets, no unused SDKs, localized strings and one approved theme for colors, corners, strokes, spacing, elevation, typography and animation tokens.
- [ ] Founder-approved premium palette, tab/navigation/action animations and selective 3D/depth visuals **before their implementation**; sensible reduced-motion/low-power/static fallbacks.
- [ ] Release-mode real-device motion/frame jank, startup, battery/thermal, memory/APK and accessibility checks passed, with actual evidence—not just static design guard.

## Code completion (no Cloudflare account needed)
- [ ] Native Android Kotlin project `com.rekixo.jodlo`, founder-approved screen UX/UI, accessible/localized and optimized for low-end devices.
- [ ] Typed Worker API contracts, validation, authentication, roles, profiles, catalog, listings, area/geosearch, contact requests, moderation, abuse protection, account deletion and admin safeguards.
- [ ] Local D1 schema + versioned migrations, indexes, transactions, privacy deletion, backup/restore rehearsals and fixture load tests.
- [ ] R2 media upload validation/privacy, mock-able background Queues/retries, notifications, RTC signaling and idempotent call settlements.
- [ ] Payment policy: Google Pay India UPI for eligible merchant sales; Google Play Billing for Play digital SKUs unless approved alternative. No old Razorpay. Server-verified idempotent ledger, refund/reconciliation **tested without real money**.
- [ ] Device/emulator, networking, Android unit/integration, Worker/workerd and locally simulated storage, security/authorization, failure/retry, duplicate callback, migration and performance tests all pass.
- [ ] Actual green PR and latest `main` CI, docs/AI handoff truthful, dependency audit, release candidate checklist and domain plan.

## Final one-time production release (founder manual approval required later)
- [ ] Founder confirms completed features, UI, Play/disclosure/policy decisions, payment provider/RTC onboarding, budget and launch scope.
- [ ] Secure production-only Cloudflare account, Worker/D1/R2/Queues, DNS `jodlo.rekixo.com` and credentials via protected secrets; no change to old Finworkar.
- [ ] Tested migrations/backups/restore, controlled deployment without automatic push-to-prod, alerts, WAF/rate limits and an explicit rollback plan.
- [ ] Real DNS/TLS, auth, listing, push, RTC, payment status/webhook/refund behavior and performance are carefully smoke tested with safe limits; block/rollback any failure.
- [ ] Launch to controlled traffic and monitor; no invented green validations.

See [ADR-0004](decisions/0004-local-first-no-staging-until-production.md), [Status](STATUS.md), [Manual Actions](MANUAL_ACTIONS.md), [Testing](TESTING.md).

## Uncertain write diagnosis — code-only preflight (2026-10-30, PR CI pending)

A worker might eventually own more than 100 approved Category listings; the legacy private `GET /me/listings` and its recheck remain bounded to first 100 for compatibility. The proposed Kotlin `HeadlessWorkerWriteScope.recheckOwnListingsPage()` explicitly requests **one 25-row owner keyset page per action**, so the complete approved catalog can be inspected without automatic POST/DELETE, implicit 36-request bursts or memory accumulation. A matching owner record is **current visibility**, not evidence that the uncertain write caused it. A nonmatch—even after all pages—is **not proof of no remote commit**, especially across concurrently changing keysets. Malformed/stale anchors, offline reads, session loss and in-flight races must fail closed. This adds **code tests only**, not release acceptance or actual historic catalog approval. CI on exact PR-head and independent main SHA must be verified; all checkboxes above stay open and M-003/M-004/M-005/M-007/M-008 remain blocking at their own boundaries.
