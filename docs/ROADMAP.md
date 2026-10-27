> **Current founder directive, 2026-10-27:** finish the whole JODLO source **locally and in green CI first**; **no Cloudflare staging or other deployment** until product-ready. Eventual *direct, controlled production* release requires separate approval. [ADR-0004](decisions/0004-local-first-no-staging-until-production.md) · [Release gates](RELEASE_READINESS.md).

# JODLO — Living delivery roadmap

**Status 2026-10-27: GitHub Foundation merged with GREEN CI; Cloudflare NOT YET DEPLOYED.** No fixed deadline, no dropped tasks.

## Phase 0 — Repository foundation / NOW
- [x] Lock JODLO name, Android ID `com.rekixo.jodlo`, website `jodlo.rekixo.com`.
- [x] Write mission, team agreement, legacy-reference boundaries, architecture ADR.
- [x] Develop minimal Cloudflare Worker API scaffold and local tests (verify test results before accepting).
- [x] GitHub App write access works; 38 Foundation files committed to `main` via PR #1.
- [x] GitHub Actions green for final merged `main` commit [40466265299](https://github.com/rekixo-lab/jodlo/actions/runs/40466265299); **reverify each new head**.
- [x] New founder decision: no need for Cloudflare account, secrets, staging or DNS now. All postponed until final production release.
- [ ] Design (not provision) future production secrets, budgets, data retention, observability, migration/backup and rollback before final release.

## Phase 1 — Product/legacy behavior specification
- [ ] Read-only audit of old Android/Backend/Web capabilities and feature state.
- [ ] Requirements interviews: real workers/customers/lapsed users, accessible pilot area.
- [ ] Define MVP: buyer intent, worker profile, actual request model, rating/trust rules.
- [ ] Record privacy/identity/verification, payments, push and calling requirements.
- [ ] Founder UI review & approval before UI work.

## Phase 2 — Complete locally testable Cloudflare-compatible backend
- [x] **M-001 approved 2026-10-27:** shared account gives customer access and opt-in private worker draft; [ADR-0006](decisions/0006-shared-account-opt-in-worker.md) and [manual-action register](MANUAL_ACTIONS.md).
- [ ] **M-002/M-003 later product gates:** auth/OTP provider and manual area/PII consent model before related D1 identity/location implementations; non-blocked typed contracts and fake auth tests may proceed.
- [x] First local-only public categories D1 migration, indexed bounded read-only API and synthetic migration tests added in catalog PR; [green PR CI #40473268574](https://github.com/rekixo-lab/jodlo/actions/runs/40473268574) on code commit `0b44bf8` (19 tests, local D1 migration, both Wrangler dry-run bundles, TypeScript, docs and design checks); zero live resources.
- [ ] Full accounts/workers/areas/listings D1 relational schema, migrations, privacy lifecycle/backup-recovery tests; founder identity/area model decisions pending.
- [ ] Auth/session implementation, identity provider decision; abuse and rate limits.
- [ ] Private R2 media validation; approved Queue workflows and idempotency as needed.
- [ ] Automated tests: unit, integration, authorization, privacy, data recovery, latency and cost.

## Mandatory cross-phase gate — zero duplicate assets, reuse, premium animated UI

- [ ] Before each new feature, search and reuse common tested components/helpers/API contracts; remove dead/duplicate code, unused Gradle/JS dependencies and duplicate image/icon/media files. Do not over-abstract single-use functionality.
- [ ] Android user text and descriptions via localized `strings.xml`; one founder-approved theme owns attractive palette, typography, corners/radii, strokes, spacing, elevation and animation durations. No per-screen hardcoded style constants.
- [ ] Founder chooses premium light/dark visual directions, tab/navigation/action transition patterns and selective professional 3D/2.5D **before any UI coding**.
- [ ] Build purposeful high-quality motion for tabs, navigation, loading/feedback/actions with reduce-motion/no-animation fallback, low-end Android FPS/thermal/memory/APK and TalkBack validation.
- [ ] CI uses `npm run design:check`, duplicate-asset guard and future Android Lint/Detekt and release-mode performance/device tests. [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md), [Design](DESIGN_SYSTEM.md), [Motion](MOTION_3D.md), [Reuse](REUSE_ASSET_POLICY.md).

## Phase 3 — Native Android after UI approval
- [ ] New Android Kotlin applicationId `com.rekixo.jodlo`, environment-aware networking.
- [ ] Founder's confirmed screen layouts, navigation and copy; no legacy theme copy.
- [ ] Guest discovery, sign-up, profiles, service creation and search under weak network tests.
- [ ] Native privacy settings, permissions, offline/error states and push consent.

## Phase 4 — Useful local contacts and safety
- [ ] Reliable contact/calling provider & secure tokens, refunds/timing after consent.
- [ ] Verification distinctions, ratings only after real interactions, report/block/audit.
- [ ] Moderation and case workflows, independent admin auth.
- [ ] Verify genuine work outcomes through privacy-safe consent.

## Phase 5 — Website, trust, payments & launch
- [ ] Founder website design review; publish at `jodlo.rekixo.com`, verify TLS and links.
- [ ] India digital purchase / Play policy and platform review before integrating paywall.
- [ ] Device integration tests, cost budgets, load tests, staged rollout and rollback.
- [ ] Honest Play screenshots/video storyboard agreed with founder, real build captures.
- [ ] Publish new app only after owner approval, policy, security and real-world validation.

## Phase 6 — Growth only after useful outcomes
- [ ] Pilot first locality with genuine willing workers and customers.
- [ ] Measure search → contact → mutually confirmed work, worker reachability and retention.
- [ ] Optimize D1 index/Worker CPU/R2 usage; expand modularly with evidence.

## Session status format
`Date | Work ID | Done (link/test) | Pending | Blocked/manual owner action | Next exact action`

## Known blockers as of 2026-10-27
- RESOLVED: GitHub read/write works, Foundation present on main; actual green main CI run 40466265299.
- Previous Finworkar GitHub Actions failures were in another repository; JODLO Foundation GitHub Actions have actually passed. Recheck current PR and main green.
- Cloudflare credentials/DNS/live resources intentionally deferred to final approved production release, not development blockers.
## Payment policy alignment — 2026-10-27

JODLO prefers **Google Pay** for eligible merchant India UPI transactions, never the legacy Razorpay connector. **Google Play Billing** is the default Play-distributed digital-goods channel unless legally eligible exception or enrolled alternative billing permits otherwise. No money movement is enabled until bank/PSP verification, idempotent ledger, refund tests and owner approval. See [PAYMENTS](PAYMENTS.md).

## 2026-10-27 incremental backend milestone — catalog foundation

First shippable unit is local-only `categories` migration and typed read API (en/hi, active records only, capped 100, no PII). Validate with Node SQLite and Wrangler local D1 migration/build in GitHub Actions. **Merged catalog milestone:** [PR #7](https://github.com/rekixo-lab/jodlo/pull/7) squash-merged as `dd16db9`, verified [green main GitHub Actions #40473524328](https://github.com/rekixo-lab/jodlo/actions/runs/40473524328) on `dd16db92a1e04b2e40237bc440ab0a062039f5ea` (19 Node tests, local-only Wrangler D1 migration, local and normal Worker dry-run builds, strict TS, docs/design checks). No Cloudflare/Android deployment. The next slice is account/worker/area authorization model, **only after** product roles, external auth/provider and selected-area/privacy behavior are defined. No visual UI work or Cloudflare deployment here.

## Verified milestone after PR #7
**Merged catalog milestone:** [PR #7](https://github.com/rekixo-lab/jodlo/pull/7) squash-merged as `dd16db9`, verified [green main GitHub Actions #40473524328](https://github.com/rekixo-lab/jodlo/actions/runs/40473524328) on `dd16db92a1e04b2e40237bc440ab0a062039f5ea` (19 Node tests, local-only Wrangler D1 migration, local and normal Worker dry-run builds, strict TS, docs/design checks). No Cloudflare/Android deployment.
**Next:** settle minimal customer/worker identity and locality/consent/retention model, then implement tested D1 ownership tables, migration/restore and typed authorization APIs locally. Neither Android UI nor cloud deployment is authorized by this milestone.

## M-001 backend implementation slice — 2026-10-27

- [x] Founder approved one account: customer by default, worker opt-in; no separate worker credentials. [ADR-0006](decisions/0006-shared-account-opt-in-worker.md).
- [ ] Local `accounts` / private worker draft migration, idempotent opt-in + owner-only authenticated route, SQLite and fake-auth tests (PR/main GitHub CI confirmation required for completed-code tick).
- [ ] M-002 real identity/OTP choice **before** any production-grade login/user PII; M-003 precise location and deletion/retention rules before storage, M-004 before UI. Avoid false claims of live verified workers.
