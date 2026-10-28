# JODLO — Code completion and first production release gates

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
