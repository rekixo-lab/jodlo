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
- [x] Initial local-only D1 public category catalog migration, indexed read query, typed binding, synthetic SQLite tests and Wrangler local migration CI verified in catalog foundation PR: 19 tests + migration/types/build passed on code head `0b44bf8`, [run 40473268574](https://github.com/rekixo-lab/jodlo/actions/runs/40473268574). This is **not** a complete D1 database or production deployment.
- [x] Provider-neutral local account + one-to-one worker private draft D1 migration and owner-only opt-in/API authorization tests verified; see [PR #10](https://github.com/rekixo-lab/jodlo/pull/10), main [CI #40476898497](https://github.com/rekixo-lab/jodlo/actions/runs/40476898497). No real identity provider or public worker activation.
- [ ] External auth, real PII, area/listing migrations, account deletion/retention and full authorization/integration tests remain pending.
- [ ] Typed API/auth, worker profiles, service listings, category search and customer request workflows.
- [ ] Local R2 media, image validation/moderation, Queue processing, mock FCM/RTC/payment adapters.
- [ ] Native Kotlin `com.rekixo.jodlo` project and approved screens, network/offline tests, real Android device performance.
- [ ] Server-verified idempotent payment ledger, Google Pay India/Google Play Billing policy gating, refunds and callback reconciliation.
- [ ] Security, abuse throttling, integration, mock provider, migration, load and device tests; green release candidate CI.
- [ ] Production release checklist reviewed only when code is feature-complete; no arbitrary deadline.

## Manual owner tasks
**Owner-action checkpoint — 2026-10-27:** Hard requirement to proactively ask for any genuinely needed founder/manual task in the active JODLO conversation is tracked in [Manual Actions](MANUAL_ACTIONS.md). **M-001 DONE (founder explicit approval, 2026-10-27):** one customer account can opt into a private worker draft profile; no separate account. [ADR-0006](decisions/0006-shared-account-opt-in-worker.md). M-002 auth provider, M-003 area/privacy and M-004 UI sign-off are upcoming at their respective gates. M-006/M-007 provider/production provisioning remain deferred. AI should keep building safe non-blocked backend/test components; no cloud activity now.

**None for Cloudflare right now.** Do not request API token, account ID, DNS or staging setup. Founder feedback is required only when proposing visible UI and major product choices. Merchant/provider onboarding and Cloudflare production access wait until final launch gate.

## Next exact engineering action
1. **Catalog PR #7 merged and main Actions GREEN** (run 40473524328). Next: define MVP actor roles, auth/provider, locality model and privacy/deletion before account/worker/listing migrations; no staging/deployment.
2. Keep README/AGENTS/AI_HANDOFF/STATUS in sync with actual GitHub Actions for each new head.
3. Do not claim a feature deployed or validated against real providers without direct proof.

[README](../README.md) · [AGENTS](../AGENTS.md) · [AI Handoff](AI_HANDOFF.md) · [Roadmap](ROADMAP.md) · [Release Readiness](RELEASE_READINESS.md) · [ADR-0004](decisions/0004-local-first-no-staging-until-production.md) · [Manual Actions](MANUAL_ACTIONS.md).

## 2026-10-27 — Catalog foundation merged and verified
- **Done in code:** first no-PII category migration, indexed and bounded bilingual read-only catalog query, typed optional D1 binding, local-only Wrangler configuration and synthetic database/API tests. Existing health API preserved.
- **Evidence:** **Merged catalog milestone:** [PR #7](https://github.com/rekixo-lab/jodlo/pull/7) squash-merged as `dd16db9`, verified [green main GitHub Actions #40473524328](https://github.com/rekixo-lab/jodlo/actions/runs/40473524328) on `dd16db92a1e04b2e40237bc440ab0a062039f5ea` (19 Node tests, local-only Wrangler D1 migration, local and normal Worker dry-run builds, strict TS, docs/design checks). No Cloudflare/Android deployment. Earlier failed PR attempts were fixed; final docs-head PR run [40473455818](https://github.com/rekixo-lab/jodlo/actions/runs/40473455818) was GREEN.
- **Pending:** full role/auth/area schemas, worker profiles, data lifecycle, all remaining Android/backend integrations, load testing. **Manual:** M-001 is now approved; M-002 provider and M-003 location/privacy are upcoming; UI remains gated. **Next:** pass account/worker draft PR CI, then proceed with provider-neutral and approved identity tasks.

### Latest stable main checkpoint
**Merged catalog milestone:** [PR #7](https://github.com/rekixo-lab/jodlo/pull/7) squash-merged as `dd16db9`, verified [green main GitHub Actions #40473524328](https://github.com/rekixo-lab/jodlo/actions/runs/40473524328) on `dd16db92a1e04b2e40237bc440ab0a062039f5ea` (19 Node tests, local-only Wrangler D1 migration, local and normal Worker dry-run builds, strict TS, docs/design checks). No Cloudflare/Android deployment.

## 2026-10-27 — M-001 approved; shared-account worker drafts (new engineering slice)

- **Decision DONE:** founder explicitly selected one JODLO account for customer and opt-in worker access in current chat. Persisted in [ADR-0006](decisions/0006-shared-account-opt-in-worker.md) and [Manual Actions](MANUAL_ACTIONS.md); no repeated M-001 question.
- **New implementation:** local-only D1 migration `0002_shared_accounts_worker_drafts.sql`, provider-neutral trusted AUTH contract, internal account provisioning service (not exposed as public API), idempotent private worker-draft opt-in and owner-only GET/POST route. No self-declared account ID or verified/published profile; no real provider/PII/location.
- **Evidence:** [PR #10](https://github.com/rekixo-lab/jodlo/pull/10) merged as `e01dbde44cbe46aadf3d563c66f411a8c9d96818`; [main GitHub Actions #40476898497](https://github.com/rekixo-lab/jodlo/actions/runs/40476898497) SUCCESS on that commit (27 Node tests, docs/design guard, both dry-run builds, local D1 migration 0001+0002 and strict TypeScript). Prior failed PR runs were corrected and are not evidence of success; this merged main run is.
- **Pending/Blocked:** M-002 real login/OTP selection before collecting identities; M-003 area/consent before location schema; M-004 founder UI design sign-off; account deletion/retention decisions. **Manual now:** no account/cloud credentials needed. **Next:** evaluate M-002 real identity/OTP approach with founder before implementing external login/user identity; meanwhile continue provider-neutral authorization, privacy and fake-adapter tests.

### Latest verified milestone: M-001 shared account, 2026-10-27

- **Done:** [PR #10](https://github.com/rekixo-lab/jodlo/pull/10) merged as `e01dbde44cbe46aadf3d563c66f411a8c9d96818`; [main GitHub Actions #40476898497](https://github.com/rekixo-lab/jodlo/actions/runs/40476898497) SUCCESS on that commit (27 Node tests, docs/design guard, both dry-run builds, local D1 migration 0001+0002 and strict TypeScript).
- **Pending:** M-002 real provider/OTP, M-003 area/retention, M-004 UI review. **Manual:** do not provide account passwords, tokens or OTP in chat. **Next:** seek founder direction on real login method before provider integration; do not deploy.

## 2026-10-27 — M-002 Google Sign-In backend implemented locally and verified

- **Founder decision DONE:** Google Sign-In is the sole initial login; phone OTP is not selected. [ADR-0007](decisions/0007-google-signin-verified-session.md). Do not re-ask M-002.
- **Code under review:** `0003_google_identity_sessions.sql`, server-verified Google ID token using rotating JWKS and trusted client audience; Google `sub`→opaque account mapping with D1 transactional batch, hash-only expiring session storage, owner authorization and logout revocation. One small audited `jose` cryptographic dependency; reusable local DB test adapter.
- **Actual evidence:** [PR #12](https://github.com/rekixo-lab/jodlo/pull/12) merged as `494fc1ee3a41757d4099df40532759526afa5e66` with actual [green main GitHub Actions #40479368370](https://github.com/rekixo-lab/jodlo/actions/runs/40479368370) (37/37 tests, D1 migrations 0001–0003 locally, docs/design checks, strict TypeScript, both Wrangler dry-run builds). Synthetic local verification does not prove real Google provider/device behavior.
- **Manual:** M-002 DONE. **M-008 UPCOMING** Google Cloud OAuth public client IDs/Android signing setup only when real-device integration is ready. No passwords/secrets should be shared here. M-003 area/privacy, M-004 UI approval, M-007 production release pending.
- **Next exact task:** implement independent backend security hardening (request rate limits, session expiry cleanup/retention and account deletion design) locally; request M-008 OAuth client configuration **when** Android provider integration needs it. No staging or deployment.

- **Privacy boundary:** Google `sub` is a persistent pseudonymous personal identifier, *not anonymous data*. Real-user data retention, deletion/export and provider-configuration review remain pre-launch gates; [ADR-0007](decisions/0007-google-signin-verified-session.md).

### Latest stable JODLO main checkpoint, M-002 — 2026-10-27

**Done/Evidence:** [PR #12](https://github.com/rekixo-lab/jodlo/pull/12) merged as `494fc1ee3a41757d4099df40532759526afa5e66` with actual [green main GitHub Actions #40479368370](https://github.com/rekixo-lab/jodlo/actions/runs/40479368370) (37/37 tests, D1 migrations 0001–0003 locally, docs/design checks, strict TypeScript, both Wrangler dry-run builds).
**Pending:** real Google OAuth/Android device verification (M-008 UPCOMING), area/privacy and user-data lifecycle (M-003), founder UI sign-off (M-004), login abuse throttling/operational protections. **Blocked manual now:** none; do not request credentials or OAuth secrets. **Next:** non-UI backend security/integration slice, then owner-approved Google console configuration when needed. No remote deployment and legacy Finworkar unchanged.

## 2026-10-27 — Authentication hardening implemented and main CI verified

- Scope: bound active sessions per verified account to **six**, with single-statement atomic conditional insert and `429 Retry-After` after cap; prune **at most 100 expired** sessions per successful sign-in using indexed D1 SQL (no cron); add authenticated `POST /api/v1/auth/logout-all` for account-owned multi-device revocation. All built on existing D1 tables and shared bearer parser, no new migration or dependency.
- **Verified evidence:** [PR #14](https://github.com/rekixo-lab/jodlo/pull/14) squash-merged as `c234961204c0c2586748c52bcd1976a8611c7197`, and [main Actions #40481385874](https://github.com/rekixo-lab/jodlo/actions/runs/40481385874) completed **SUCCESS** (41 automated tests, docs/design guard, local D1 migrations, TypeScript and both Wrangler dry-runs). Includes concurrency/session cap, bounded expiry cleanup, ownership isolation, disabled accounts and SQL outage redaction. This is **not** IP/WAF throttling, anti-bot verification, user-data retention policy or real provider integration.
- Manual: **none required now**; M-003 privacy/deletion/area, M-004 design and M-008 Google OAuth setup remain gated. Next: CI evidence, green merge, then independent abuse controls and user data lifecycle proposals. No cloud deployment.

### Latest GitHub checkpoint — session hardening, 2026-10-27

**Done and evidence:** [PR #14](https://github.com/rekixo-lab/jodlo/pull/14) squash-merged as `c234961204c0c2586748c52bcd1976a8611c7197`, and [main Actions #40481385874](https://github.com/rekixo-lab/jodlo/actions/runs/40481385874) completed **SUCCESS** (41 automated tests, docs/design guard, local D1 migrations, TypeScript and both Wrangler dry-runs).
**Still pending:** full Cloudflare WAF/IP admission rate-limits, owner-approved privacy retention/deletion, nonvisual account recovery and load tests, real Google/device verification, Android UI and production release. **Manual now:** none for this code slice. **Next:** independent backend abuse-safety and retention design/tests without touching real users, Cloudflare or legacy Finworkar.

## 2026-10-27 — Local admission/abuse-control slice (under CI review)

- Added two **local-only, simulated** Cloudflare Rate Limiting bindings for Google sign-in: coarse pre-verification 100 requests/10 sec per PoP; post-verification 20 requests/60 sec per **hashed Google `sub`** (not raw subject/IP). A missing binding or limiter outage denies sign-in (503); an exhausted limiter returns 429 with 10/60-second Retry-After. No new D1 table, raw IP, user email, external personal data or remote infrastructure.
- Provider Rate Limiting limits are **approximate per Cloudflare location** (not a guaranteed worldwide security guarantee), and the shared pre-auth bucket may delay legitimate users under bursts. Actual production cost, quotas, Cloudflare bot/WAF rules and provider behavior still require readiness review.
- Synthetic account deletion cascade + transactional rollback tests protect worker profiles, Google subject and session cleanup, **without exposing any public account-deletion endpoint**. Real deletion/export notice, data retention/consent remains founder gate M-003.
- CI/evidence pending: require green PR + green merged-main Actions before marking these features verified. No staging, remote deploy, Android UI or Finworkar mutation.

## Latest merged checkpoint — auth admission and synthetic data lifecycle, 2026-10-27

- **Done/Evidence:** [PR #16](https://github.com/rekixo-lab/jodlo/pull/16) merged as `17ea0b882977ad0bd3a695e49b0112dde64fc9d6`; [main Actions #40482955589](https://github.com/rekixo-lab/jodlo/actions/runs/40482955589) completed **SUCCESS** on that exact commit (49/49 Node tests, docs/design checks, local D1 migrations, TypeScript and both Wrangler dry-run builds). Two fail-closed Worker login admission gates, 429 response and 10/60 second Retry-After, no new personal data schema or IP capture; local-only simulated bindings and synthetic account cascade/rollback tests.
- **Still pending:** real Cloudflare distributed rate limiter/WAF/quotas, Android+Google end-to-end sign-in, account closure export/deletion/retention policy, service listings/requests, native UI and production launch. Cloudflare local counters are approximate per PoP and are not comprehensive abuse protection.
- **Manual now:** none for this local-only milestone. **M-003 UPCOMING** before user locality and personal-data lifecycle, **M-004 UPCOMING** founder visual approval, **M-005 UPCOMING** pilot categories/request/trust rules, **M-008 UPCOMING** Google OAuth console for real-device tests. **M-007 DEFERRED** until production-only launch.
- **Next:** provider-neutral service discovery contracts and fake authorization/abuse tests without seeding real worker profiles, areas, private contacts or deploying anything.
