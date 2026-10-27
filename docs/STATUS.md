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

## 2026-10-27 — Privacy-safe public catalog search slice (CI pending)

- `GET /api/v1/catalog/search?q=...&lang=en|hi&limit=1..25&offset=0..100` uses only the existing public `categories` D1 table, returning published active id/slug/localized name (Hindi fallback) and deterministic `nextOffset`. Query terms are normalized NFC, bounded to 2–64 Unicode code points and prepared with `instr()` so SQL wildcard characters are literal; all inputs/methods strictly validated.
- New in-memory SQLite/Worker tests cover active-only filtering, Hindi/English, slug search, deterministic pages, SQL injection/wildcards, invalid/oversized inputs, missing D1, safe error redaction and zero worker/contact/area disclosure. Shared category projection; no extra dependency or migration, no seeded live categories.
- **Verified implementation:** [PR #18](https://github.com/rekixo-lab/jodlo/pull/18) merged as `36c9d83ad8f720d4eb7244364e789f5fc4bd7879`; [main GitHub Actions #40484455029](https://github.com/rekixo-lab/jodlo/actions/runs/40484455029) **SUCCESS** on the exact main head (55/55 Node tests, local D1 migrations, documentation/design guards, strict TypeScript, local and normal Worker dry-run builds). **M-003** locality/privacy and **M-005** category/pilot listing rules still unapproved; this does NOT implement workers/requests/nearby search, publish a pilot or collect real location. M-004 UI, M-008 live OAuth, M-007 production approval unchanged.

## Latest verified JODLO main — privacy-safe taxonomy search (2026-10-27)

- **Done/Evidence:** [PR #18](https://github.com/rekixo-lab/jodlo/pull/18) merged as `36c9d83ad8f720d4eb7244364e789f5fc4bd7879`; [main GitHub Actions #40484455029](https://github.com/rekixo-lab/jodlo/actions/runs/40484455029) **SUCCESS** on the exact main head (55/55 Node tests, local D1 migrations, documentation/design guards, strict TypeScript, local and normal Worker dry-run builds). Six new synthetic tests extend prior 49 to 55: active vs draft filtering, Hindi/English fallback, deterministic limits/pages, Unicode normalization, SQL injection/wildcard literals, method/query rejection and private-data non-disclosure.
- **Still pending:** actual worker/service discovery, real locality/consent/retention, worker publication/trust/matching, authenticated customer request lifecycle, Android UI and Google/device provider tests, production Cloudflare resources. No published category data seeded and no remote deployments.
- **Manual NOW:** None for category search alone. **M-003 UPCOMING** before real location/privacy/lifecycle data; **M-005 UPCOMING** before real worker and pilot/category/request decisions; **M-004 UPCOMING** before UI; **M-008 UPCOMING** for Google OAuth device setup; **M-007 DEFERRED** until explicit production-only signoff.
- **Next exact step:** prepare provider-neutral, *pure* matching/request state-machine validation and fake tests without creating real user/worker/request storage. Founder decisions needed before implementing final request lifecycle or public worker/listings.

## 2026-10-27 — Pure request and matching contracts merged and verified

- **Proposed code:** `interactions/request-contract.ts` defines **pure policy-injected** request transition decisions with server-resolved owner checks, compare-and-swap revision, strict opaque IDs, bounded idempotency keys and trusted replay receipts. No default request lifecycle, persistence, public route or real customer record. Future D1 adapter must enforce CAS + unique retry receipt transactionally; unit tests explicitly use a disposable fake journal only.
- **Proposed code:** `discovery/candidate-policy.ts` filters bounded **synthetic** candidate arrays by public category and a mandatory injected approval function, denying self-match, duplicates and unsafe candidates; returns opaque IDs only, never contact/location/trust labels, ranks or auto-published worker profiles. **Not** an approved eligibility/trust policy.
- **Verified evidence:** [PR #20](https://github.com/rekixo-lab/jodlo/pull/20) merged as `31839e4c5eca44251db85e3d4c220ea1be3bd296`, and [main GitHub Actions #40486525096](https://github.com/rekixo-lab/jodlo/actions/runs/40486525096) **SUCCESS** on this exact commit: 68/68 Node tests, local D1 migrations, docs/design checks, strict TypeScript, both Worker dry-run bundles.
- **Manual:** M-003 locality/privacy and M-005 pilot categories/worker publication/request state definitions **not approved**. No new decision required for pure test-only contracts; no UI (M-004), real Google (M-008), Cloudflare production (M-007), payments or legacy Finworkar changes.
- **Next exact step:** CI + code PR, green merge/main verification, doc checkpoint; only then separately prepare founder M-003/M-005 decisions when real request storage/matching is ready.

## Latest verified JODLO main — request/matching pure contracts, 2026-10-27

- **Done/evidence:** [PR #20](https://github.com/rekixo-lab/jodlo/pull/20) merged as `31839e4c5eca44251db85e3d4c220ea1be3bd296`, and [main GitHub Actions #40486525096](https://github.com/rekixo-lab/jodlo/actions/runs/40486525096) **SUCCESS** on this exact commit: 68/68 Node tests, local D1 migrations, docs/design checks, strict TypeScript, both Worker dry-run bundles. 13 new synthetic tests verify owner guard, retry receipts, replay/collision, optimistic stale-version rejection, deny-by-default transition policy, category-filtered candidate selection, no accidental draft publication, full-input validation, bounded scans and absent public worker/request APIs.
- **Scope limitation:** pure TypeScript policy contracts only, no real matches, booking/request persistence or request-state defaults; fake journal **does not** demonstrate D1 atomic CAS, unique retry receipts or distributed race safety. No personal locality, contact details, media, payments or public worker records added.
- **Manual NOW:** none for this synthetic milestone. **M-003 UPCOMING** privacy/locality/deletion/retention decision before personal areas/data; **M-005 UPCOMING** worker publishing/trust and real request lifecycle decisions before live marketplace storage; M-004 UI, M-008 OAuth device, M-007 production gated.
- **Next exact task:** founder-approved M-005 worker/request rules and M-003 locality/privacy decision when moving beyond pure contracts; independent test-only adapter failure/CAS rehearsals are still possible without any private user or cloud resources. Keep main green, reuse code, and do not touch Finworkar.

## 2026-10-27 — Read-only legacy behavior study and pure contact guard verified

- **Source reviewed:** Finworkar Android `0ad9ddd230439f76da363c6bbacdddb35288704f`, backend `f31d089953f68868108f5d475436842b55c10204`. See [Legacy behavior study](LEGACY_FINWORKAR_BEHAVIOR.md) for old guided worker-service post, guest/public + signed-in nearby feed, moderation/active-account visibility, bilateral block/self checks and Nok-Nok/call transaction rechecks and retry behavior. This is source analysis, not measured real-user activity.
- **New JODLO slice pending PR CI:** pure `interactions/contact-safety.ts` requires server-trusted requester/worker/listing IDs, active parties, worker opt-in **and explicit published listing**, available/unmoderated service, two-way nonblocking and founder-policy-approved channel. Unknown/missing facts deny; synthetic tests include stale browse recheck and private-info non-disclosure. No public contact endpoint, real worker listing, persisted requests, contact/phone/GPS/media data or call/payment service.
- **Manual NOW:** none to study read-only legacy or test pure guard. **M-003 UPCOMING** before real location and retention/deletion rules; **M-005 UPCOMING** before selecting actual worker publication/contact/request/call flows. **M-004** UI, **M-008** real OAuth, **M-007** production remain gated. No Cloudflare deployment or Finworkar changes.
- **Next:** GitHub PR CI green, merge, verify main CI, persist exact checkpoint to handoff. Then propose specific M-003/M-005 decisions when operational API genuinely needs them.

## Latest JODLO milestone, 2026-10-27 — legacy behavior preserved as specification only

**Done/Evidence:** [PR #22](https://github.com/rekixo-lab/jodlo/pull/22) merged as `24ed69e735e136cc95b6ac43f74d83f08d019e6a`; [main GitHub Actions #40489994251](https://github.com/rekixo-lab/jodlo/actions/runs/40489994251) **SUCCESS** on the same commit (76/76 Node tests, local D1, docs/design guards, strict TypeScript, both Wrangler dry-run builds). Read-only Finworkar Android/backend worker-customer journeys documented in [Legacy behavior map](LEGACY_FINWORKAR_BEHAVIOR.md); independently written pure JODLO contact eligibility guard and eight synthetic tests. No old repository mutation, no location, personal contact, live worker/public listing, request write or call API.
**Pending:** real location consent, retention/deletion; pilot worker visibility, trust, category and request lifecycle; atomic D1 rechecks, notifications/calls, Android UI, real Google OAuth/devices, production readiness.
**Manual NOW:** none for this slice. **M-003 and M-005 UPCOMING** when moving from pure contracts to operational marketplace; M-004 UI, M-008 OAuth, M-007 production still gated.
**Next:** founder-led privacy/location and real worker/contact workflow decisions when implementation needs them; otherwise continue safe reusable mock integration tests. No Cloudflare deployment.

## 2026-10-27 — Original proposed natural-search enhancement (Hinglish later explicitly rejected by founder)

- Continue the READ-ONLY legacy Finworkar speech/category intent study without porting its proprietary matcher vocabulary, Firebase categories or UI. New **small original** `catalog/search-phrases.ts` strips only explicit originally Hindi/Hinglish/English grammatical words (**Hinglish subsequently forbidden** by founder); preserves existing literal query behavior when no sentence signal is present. The existing read-only public category search reuses one bound SQL term expression to match **every meaningful trade word** (conservative intersection), never invents synonyms, trust labels or workers. Category output/limits/public projection unchanged; zero meaningful words returns no results.
- Synthetic local D1/Worker tests cover Hindi spoken-worker/customer phrasing, Roman Hindi, English, ambiguity/no-trade cases, active-only/category privacy, bounded pagination and SQL metacharacter injection defense. No real worker discovery, locations, category seeding, personal user data, new tables, UI or providers.
- **PR/main GitHub CI pending** for this slice; record actual evidence only after GREEN. M-003 area/privacy/retention and M-005 pilot category/worker workflows still owner-controlled; no Cloudflare deployment.

## 2026-10-27 — Founder supersedes Hinglish assumption: Hindi and English ONLY

- **Final approved product language rule:** Devanagari **Hindi** and **English**, and **no Hinglish, Roman-Hindi or mixed-script language mode**. Earlier PR #24's Roman-Hindi cases were not founder-approved; delete those code paths and replace synthetic tests with explicit negative Hinglish/mixed-script checks. [ADR-0008](decisions/0008-hindi-english-only.md) is the current decision, overriding historic documentation and the legacy app's Hinglish logic.
- Keep existing `lang=en|hi` public category output; Hindi and English natural sentences can match active categories, no guessed translations/worker data. No third locale/translation dependency/PII.
- **Verification must use actual latest PR/main CI evidence** before claiming fully merged. Other product gates unchanged: M-003 privacy/locality, M-005 pilot/calls/publication, M-004 UI, M-008 Google OAuth and M-007 production.

## Latest verified founder language correction — 2026-10-27

**Done:** [PR #25](https://github.com/rekixo-lab/jodlo/pull/25) merged as `e0ce6d04a56f9c8aaa27c24d50f821ace5201ae3`; [main GitHub Actions #40493262734](https://github.com/rekixo-lab/jodlo/actions/runs/40493262734) **SUCCESS** on that exact SHA (84/84 Node tests, local D1 migrations, strict TypeScript, docs/design guards and both Worker dry-run bundles). JODLO supports only **Hindi (Devanagari) and English**; prior unauthorized Hinglish/Roman Hindi grammar removed, mixed-script natural queries produce no category match. Existing `lang=en|hi` bilingual output retained; eight new/adjusted natural phrase tests are in the 84 green suite. **No extra UI, languages, providers, user data or cloud resources**.
**Manual now:** language decision is DONE and must not be re-asked. Separate M-003 locality/privacy, M-005 pilot/worker/customer workflow, M-004 design approval, M-008 real Google integration and M-007 production-only gate remain pending.

## 2026-10-27 — Disposable SQLite request transaction rehearsal (PR CI pending)

- Add **synthetic-only** `apps/api/tests/request-sqlite-atomicity.test.mjs` with two independent local SQLite connections to a temporary file deleted after each case, a *test-defined* generic state table and composite unique (requestId,retryKey) receipts. Exercise BEGIN IMMEDIATE, UPDATE revision compare-and-swap, same-key replay, stale independent keys, per-request isolation, rollback on injected failure, competing connection lock and stale owner revalidation. Extend pure `decideRequestTransition` to reject a replay receipt whose result revision is **ahead of** the current revision (protect broken restore/replay ordering).
- No production D1 schema/migration, Cloudflare worker endpoints, actual customer requests, worker publication, location/phone/PII, charging, calling or new dependency. Fake state names `prepared/submitted/reviewed` are **test fixtures only**, not M-005 approved real request stages. SQLite BEGIN IMMEDIATE is local-only and **not** a deployed D1 transaction design or proof of distributed races.
- **Verify actual PR CI and post-merge main CI before claiming complete.** Founder rule Hindi (Devanagari) + English ONLY, no Hinglish (ADR-0008) retained. M-003 and M-005 remain necessary before real data/workflows, M-004 UI, M-008 OAuth and M-007 production remain gated.
