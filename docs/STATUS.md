# JODLO — current state, 2026-10-27

**Identity:** JODLO; Android `com.rekixo.jodlo`; future production domain `jodlo.rekixo.com`. Entirely independent from live Finworkar (read-only reference).

## Founder-approved development/release method
- [x] **NO staging Cloudflare environment. NO remote deployment until product code is ready.** Complete Cloudflare Worker, D1/R2/Queues, all API modules, native Android, real-provider adapters and full tests with local cloud simulations/mock adapters and GitHub CI.
- [x] First cloud deployment is a separately **founder-approved production-only** launch, after tests, backups, migration rehearsals, policies, credentials and rollback. Live provider callbacks, domain routing and Cloudflare account behavior remain `UNVERIFIED` until then.
- [x] UI navigation/layouts require founder review before UI implementation. Old Finworkar repos and live data remain untouched. Product Google Pay India preferred; Google Play Billing for eligible digital purchases, no legacy Razorpay.
- [x] Previous JODLO staging workflow and staging Wrangler config **removed from main** by merged PR #3; no GitHub push workflow deploys to Cloudflare.

## Verified code and CI baseline
- [x] GitHub foundation and documentation merged through PR #1 and #2; earlier green main Actions [run 40466624240](https://github.com/rekixo-lab/jodlo/actions/runs/40466624240) on commit `17e3ab16d9a7376000b22cd8aea2cea61ab6f7d1`.
- [x] Working minimal TypeScript API `GET /api/v1/health`, docs/AI handoff and 7 existing tests. These **do not** constitute a complete backend or Android app.
- [x] **No payment API, checkout, ledger**, calling integration, bank/PSP, or live Google Play Billing flows have been implemented or deployed. Mock-first engineering is pending.
- [x] Release-policy [PR #3](https://github.com/rekixo-lab/jodlo/pull/3) merged after [green PR CI 40468508024](https://github.com/rekixo-lab/jodlo/actions/runs/40468508024). Merge commit `89aaf0d05a2c016488ff7d8997088d9f7a1d67bf` had [green main CI 40468562575](https://github.com/rekixo-lab/jodlo/actions/runs/40468562575). Verify subsequent commits separately.

## Mandatory engineering/design quality — founder rule 2026-10-27

- [x] Requirements documented: reuse existing tested helpers/components/contracts; no redundant libraries, duplicate assets or dead code, single localized strings/theme source for premium colors, corners/radii, strokes, spacing, typography and motion. [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md), [Reuse](REUSE_ASSET_POLICY.md), [Design](DESIGN_SYSTEM.md), [Motion](MOTION_3D.md).
- [x] Premium motion required for approved UI tabs, screen transitions, taps/actions/state changes and selective depth/3D; still must meet low-end speed, reduced-motion, contrast and battery constraints.
- [ ] No UI screens, final palette, animation prototypes or actual 3D implementation approved/created yet. **Founder reviews designs before visual implementation**.
- [x] Initial design/duplicate-asset guard and six fixture tests merged via [PR #5](https://github.com/rekixo-lab/jodlo/pull/5). [Green main CI 40470523692](https://github.com/rekixo-lab/jodlo/actions/runs/40470523692) on commit `e6982c49d94522abdb257e1bc0b5c8f0ec4b75e1`: documentation, static design/asset guard, 13 total tests, TypeScript and Wrangler dry-run passed. Actual UI performance/semantic duplication reviews remain pending.

## Development pending (no external deployment/blocker)
- [ ] Local D1 relational schema/migrations, indexes, delete/retention and authorization tests.
- [ ] Typed API/auth, worker profiles, service listings, category search and customer request workflows.
- [ ] Local R2 media, image validation/moderation, Queue processing, mock FCM/RTC/payment adapters.
- [ ] Native Kotlin `com.rekixo.jodlo` project and approved screens, network/offline tests, real Android device performance.
- [ ] Server-verified idempotent payment ledger, Google Pay India/Google Play Billing policy gating, refunds and callback reconciliation.
- [ ] Security, abuse throttling, integration, mock provider, migration, load and device tests; green release candidate CI.
- [ ] Production release checklist reviewed only when code is feature-complete; no arbitrary deadline.

## Manual owner tasks
**None for Cloudflare right now.** Do not request API token, account ID, DNS or staging setup. Founder feedback is required only when proposing visible UI and major product choices. Merchant/provider onboarding and Cloudflare production access wait until final launch gate.

## Next exact engineering action
1. **Start local-only D1 schema + typed API contract implementation** in the next new PR. Use synthetic fixtures/workerd and write tests; no remote Cloudflare or staging required.
2. Keep README/AGENTS/AI_HANDOFF/STATUS in sync with actual GitHub Actions for each new head.
3. Do not claim a feature deployed or validated against real providers without direct proof.

[README](../README.md) · [AGENTS](../AGENTS.md) · [AI Handoff](AI_HANDOFF.md) · [Roadmap](ROADMAP.md) · [Release Readiness](RELEASE_READINESS.md) · [ADR-0004](decisions/0004-local-first-no-staging-until-production.md) · [Manual Actions](MANUAL_ACTIONS.md).
