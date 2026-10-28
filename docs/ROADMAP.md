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
- [x] Local `accounts` / private worker draft migration, idempotent opt-in + owner-only authenticated route, SQLite and fake-auth tests: [PR #10](https://github.com/rekixo-lab/jodlo/pull/10) merged as `e01dbde44cbe46aadf3d563c66f411a8c9d96818`; [main GitHub Actions #40476898497](https://github.com/rekixo-lab/jodlo/actions/runs/40476898497) SUCCESS on that commit (27 Node tests, docs/design guard, both dry-run builds, local D1 migration 0001+0002 and strict TypeScript).
- [ ] M-002 real identity/OTP choice **before** any production-grade login/user PII; M-003 precise location and deletion/retention rules before storage, M-004 before UI. Avoid false claims of live verified workers.

## M-002 Google Sign-In backend milestone — 2026-10-27

- [x] Founder **approved Google Sign-In** first, no phone OTP; [ADR-0007](decisions/0007-google-signin-verified-session.md).
- [x] Locally tested Google JWKS sign-in, stable `sub` account mapping, D1 transaction, hashed expiring sessions and logout; [PR #12](https://github.com/rekixo-lab/jodlo/pull/12) merged as `494fc1ee3a41757d4099df40532759526afa5e66` with actual [green main GitHub Actions #40479368370](https://github.com/rekixo-lab/jodlo/actions/runs/40479368370) (37/37 tests, D1 migrations 0001–0003 locally, docs/design checks, strict TypeScript, both Wrangler dry-run builds). Still NOT a verified real Google/device integration.
- [ ] M-008 (future): founder configures Google OAuth consent, Android + server client IDs and signing SHA for real-device tests. **No setup or secrets required now**. M-003 area/privacy and M-004 visual UI still need approval at their gates.

## Verified authentication milestone, 2026-10-27

[PR #12](https://github.com/rekixo-lab/jodlo/pull/12) merged as `494fc1ee3a41757d4099df40532759526afa5e66` with actual [green main GitHub Actions #40479368370](https://github.com/rekixo-lab/jodlo/actions/runs/40479368370) (37/37 tests, D1 migrations 0001–0003 locally, docs/design checks, strict TypeScript, both Wrangler dry-run builds). Upcoming: rate-limiting, account retention/deletion/session cleanup, owner-approved M-008 real OAuth configuration, M-003 locality/privacy, M-004 visible UI approval. No Cloudflare staging or deployment during development.

## Security hardening: session lifecycle (2026-10-27)

- [x] Six-active-session atomic cap, indexed expiry cleanup and authenticated logout-all with synthetic concurrency/isolation tests, [PR #14](https://github.com/rekixo-lab/jodlo/pull/14) squash-merged as `c234961204c0c2586748c52bcd1976a8611c7197`, and [main Actions #40481385874](https://github.com/rekixo-lab/jodlo/actions/runs/40481385874) completed **SUCCESS** (41 automated tests, docs/design guard, local D1 migrations, TypeScript and both Wrangler dry-runs).
- [ ] Future: Cloudflare WAF/admission rate limiting and abuse controls, legally reviewed personal-data retention/deletion (M-003), Android safe credential storage and real Google OAuth client/device testing (M-008). No staging or deployment.

## Login admission and disposable account-lifecycle tests — 2026-10-27

- [x] Approximate Cloudflare local rate-limit bindings (100/10s anonymous burst; 20/60s hashed verified sub), fail-closed 503 on binding outage, 429 on deny; [PR #16](https://github.com/rekixo-lab/jodlo/pull/16) merged as `17ea0b882977ad0bd3a695e49b0112dde64fc9d6`; [main Actions #40482955589](https://github.com/rekixo-lab/jodlo/actions/runs/40482955589) completed **SUCCESS** on that exact commit (49/49 Node tests, docs/design checks, local D1 migrations, TypeScript and both Wrangler dry-run builds).
- [x] Synthetic account deletion FK cascade and rollback tests, [PR #16](https://github.com/rekixo-lab/jodlo/pull/16) merged as `17ea0b882977ad0bd3a695e49b0112dde64fc9d6`; [main Actions #40482955589](https://github.com/rekixo-lab/jodlo/actions/runs/40482955589) completed **SUCCESS** on that exact commit (49/49 Node tests, docs/design checks, local D1 migrations, TypeScript and both Wrangler dry-run builds). **Not** public account-deletion API or approved real-user retention/deletion. M-003 UPCOMING.
- [ ] Prior to final production launch: founder M-007 review of approximate PoP counter limitations, appropriate WAF/bot policy, rate-limit quotas and false-positive UX; real OAuth M-008 and UI M-004 remain separate.

## Latest green admission checkpoint — 2026-10-27

[PR #16](https://github.com/rekixo-lab/jodlo/pull/16) merged as `17ea0b882977ad0bd3a695e49b0112dde64fc9d6`; [main Actions #40482955589](https://github.com/rekixo-lab/jodlo/actions/runs/40482955589) completed **SUCCESS** on that exact commit (49/49 Node tests, docs/design checks, local D1 migrations, TypeScript and both Wrangler dry-run builds). All login admission is local simulated and Cloudflare limits are approximate per PoP. Next safe development: typed discovery and request state-machine contracts, local fake ownership/moderation tests. **Never create user locality/PII or final categories** before M-003/M-005 explicit founder choices; no UI before M-004, no Google live setup before M-008, no production Cloudflare before M-007.

## Public taxonomy search (local-only), 2026-10-27

- [x] Bounded bilingual, active-only public category search with deterministic pagination, Unicode NFC, injection/literal-wildcard tests and error redaction. [PR #18](https://github.com/rekixo-lab/jodlo/pull/18) merged as `36c9d83ad8f720d4eb7244364e789f5fc4bd7879`; [main GitHub Actions #40484455029](https://github.com/rekixo-lab/jodlo/actions/runs/40484455029) **SUCCESS** on the exact main head (55/55 Node tests, local D1 migrations, documentation/design guards, strict TypeScript, local and normal Worker dry-run builds).
- [ ] **M-005 UPCOMING:** Founder chooses actual pilot categories, trust labels and request workflow before any public worker listing or real category seeding; **M-003 UPCOMING:** Founder locality/consent/retention decision before location storage.
- [ ] Android design still M-004; no remote Cloudflare or Google OAuth service until separately approved gates.

## Catalog discovery CI milestone (2026-10-27)

[PR #18](https://github.com/rekixo-lab/jodlo/pull/18) merged as `36c9d83ad8f720d4eb7244364e789f5fc4bd7879`; [main GitHub Actions #40484455029](https://github.com/rekixo-lab/jodlo/actions/runs/40484455029) **SUCCESS** on the exact main head (55/55 Node tests, local D1 migrations, documentation/design guards, strict TypeScript, local and normal Worker dry-run builds). Next: domain-neutral pure validation/state-machine contract tests only until founder approves M-003 location/privacy and M-005 actual pilot categories, worker listing publication/trust and matching lifecycle; M-004 visual UI, M-008 Google OAuth and M-007 production gates still pending. No worker/area tables added or real users seeded by this slice.

## Request/matching contract foundation — 2026-10-27

- [x] Implement and locally verify owner-checked **pure** request decisions, injected graph, synthetic receipt/replay/CAS and abstract candidate selection. [PR #20](https://github.com/rekixo-lab/jodlo/pull/20) merged as `31839e4c5eca44251db85e3d4c220ea1be3bd296`, and [main GitHub Actions #40486525096](https://github.com/rekixo-lab/jodlo/actions/runs/40486525096) **SUCCESS** on this exact commit: 68/68 Node tests, local D1 migrations, docs/design checks, strict TypeScript, both Worker dry-run bundles. No real D1/booking transitions.
- [ ] M-003 founder approval BEFORE location/retention/deletion schema, M-005 founder approval BEFORE worker publication, request lifecycle and real matching eligibility/trust. No public request route or writeable listing tables now.

## Request/matching pre-policy contract CI proof (2026-10-27)

[PR #20](https://github.com/rekixo-lab/jodlo/pull/20) merged as `31839e4c5eca44251db85e3d4c220ea1be3bd296`, and [main GitHub Actions #40486525096](https://github.com/rekixo-lab/jodlo/actions/runs/40486525096) **SUCCESS** on this exact commit: 68/68 Node tests, local D1 migrations, docs/design checks, strict TypeScript, both Worker dry-run bundles. Next gates: founder M-005 defines actual pilot worker approval/publication/trust/request lifecycle; M-003 governs locality/PII and data deletion/retention. Only afterwards implement real listing, request state machine, authorization + atomic transactional D1/response tests. M-004 UI, M-008 real Google credential/device and M-007 final production remain deferred. No deployment.

## Legacy behavior preservation without legacy code migration — 2026-10-27

- [x] Read-only legacy worker/customer behavior study plus independent pure JODLO contact guard, tests and CI. [PR #22](https://github.com/rekixo-lab/jodlo/pull/22) merged as `24ed69e735e136cc95b6ac43f74d83f08d019e6a`; [main GitHub Actions #40489994251](https://github.com/rekixo-lab/jodlo/actions/runs/40489994251) **SUCCESS** on the same commit (76/76 Node tests, local D1, docs/design guards, strict TypeScript, both Wrangler dry-run builds). No actual requests/listings.
- [ ] After founder M-003 and M-005 decisions: implement final worker listings, area-first search, contact/request stages and true atomic authorization/rechecks in D1; later device/RTC/Google integrations only at approved gates. No Firebase, Razorpay or existing UI copying.

## Safe pre-M-005 speech/typing discovery (2026-10-27)

- [x] Historical PR #24 implemented natural category phrase matching; the subsequent founder correction **forbids Hinglish**. Replace former Roman-Hindi grammar with **Hindi (Devanagari) + English only**, and cover unsupported mixed-script queries in tests. Track actual corrective PR/main green CI separately.
- [ ] Later founder M-005 decides actual service category inventory/synonyms, phrase ambiguity UX and whether voice input is desired; M-004 required before client UI, M-003 before location data.

## APPROVED language scope correction — 2026-10-27

- [x] Enforce founder's **Hindi + English ONLY** policy (no Hinglish, Romanized Hindi or mixed-script natural-language match), test and verify source. [PR #25](https://github.com/rekixo-lab/jodlo/pull/25) merged as `e0ce6d04a56f9c8aaa27c24d50f821ace5201ae3`; [main GitHub Actions #40493262734](https://github.com/rekixo-lab/jodlo/actions/runs/40493262734) **SUCCESS** on that exact SHA (84/84 Node tests, local D1 migrations, strict TypeScript, docs/design guards and both Worker dry-run bundles). [ADR-0008](decisions/0008-hindi-english-only.md).
- [ ] Do not build UI before M-004; avoid actual service listing/location/call writes before M-003/M-005. No cloud deployment before M-007.

## Request consistency before real request storage (2026-10-27)

- [x] Disposable two-connection SQLite CAS/composite-key retry journal, rollback and stale-owner/revision tests plus pure integrity hardening. [PR #27](https://github.com/rekixo-lab/jodlo/pull/27) merged as `68d89e593fa34760aec1af9a04c8c64f11360590`; [main GitHub Actions #40495912363](https://github.com/rekixo-lab/jodlo/actions/runs/40495912363) **SUCCESS** on the exact commit (93/93 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Wrangler dry-run bundles). Local only, no real D1 implementation.
- [ ] Real durable request table/API still blocked by M-005 owner workflow choices; real location or personal-data retention by M-003; Hindi+English only ADR-0008, UI M-004, OAuth M-008, deployment M-007 still enforced.

## Verified request consistency rehearsal — 2026-10-27

[PR #27](https://github.com/rekixo-lab/jodlo/pull/27) merged as `68d89e593fa34760aec1af9a04c8c64f11360590`; [main GitHub Actions #40495912363](https://github.com/rekixo-lab/jodlo/actions/runs/40495912363) **SUCCESS** on the exact commit (93/93 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Wrangler dry-run bundles). Next real-request/storage/worker publication needs M-005 founder workflow signoff and M-003 privacy/locality decisions. Continue using test-only contracts until then; UI M-004, OAuth M-008, production M-007 gated. No Hinglish; Hindi/English only.

## Worker publication privacy contract (2026-10-27)

- [x] Internal fail-closed synthetic visibility/allowlist projection, real D1 draft-only constraint and 9 privacy/integrity tests. [PR #29](https://github.com/rekixo-lab/jodlo/pull/29) merged as `f4009f3b207d3ab828b4b0a1738163233bd81f7c`; [main GitHub Actions #40497728947](https://github.com/rekixo-lab/jodlo/actions/runs/40497728947) **SUCCESS** on that exact commit (102/102 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Worker dry-run builds). Not approved worker publication or public endpoint.
- [ ] M-005 founder decides actual worker listing publication, moderation/trust labels and pilot service categories BEFORE any operational availability/search; M-003 before locality or deletion/retention; M-004 UI, M-008 Google and M-007 cloud release later.

## Verified worker draft vs public listing separation — 2026-10-27

[PR #29](https://github.com/rekixo-lab/jodlo/pull/29) merged as `f4009f3b207d3ab828b4b0a1738163233bd81f7c`; [main GitHub Actions #40497728947](https://github.com/rekixo-lab/jodlo/actions/runs/40497728947) **SUCCESS** on that exact commit (102/102 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Worker dry-run builds). Next **M-005** founder choice required to define real worker publication/review lifecycle, permitted public fields, pilot taxonomy and contact flow; **M-003** consent/retention for locality. No published workers or public listing data created; M-004 UI, M-008 OAuth and M-007 Cloudflare production remain deferred. Hindi and English only.

## Automated no-dependency founder gate regression safety — 2026-10-27

- [x] Add no-dependency pre-install CI source audit and 9 adversarial tests for approved routes/tables, worker draft-only privacy, Hindi+English and no-deploy safety. [PR #31](https://github.com/rekixo-lab/jodlo/pull/31) merged as `812ec39f51b70ce10564c4396cd7824b8caf78e5`; [main GitHub Actions #40501136670](https://github.com/rekixo-lab/jodlo/actions/runs/40501136670) **SUCCESS** on the exact commit (111/111 Node tests, docs/design/founder no-dependency checks, local D1 migrations, TypeScript strict and both Wrangler dry-run bundles). Static check is not a complete security proof.
- [ ] Later M-003 area/privacy and M-005 real worker/request schema, M-007 production require explicit founder decisions and deliberately reviewed guard changes; M-004 UI and M-008 real OAuth remain separately gated.

## Latest Green CI regression gate proof — 2026-10-27

[PR #31](https://github.com/rekixo-lab/jodlo/pull/31) merged as `812ec39f51b70ce10564c4396cd7824b8caf78e5`; [main GitHub Actions #40501136670](https://github.com/rekixo-lab/jodlo/actions/runs/40501136670) **SUCCESS** on the exact commit (111/111 Node tests, docs/design/founder no-dependency checks, local D1 migrations, TypeScript strict and both Wrangler dry-run bundles). New safety check blocks accidental founder-unapproved changes during local development. Future production D1 auth, permissions and founder business decisions require independent work after recorded M-003/M-005/M-007 approvals. M-004 UI, M-008 real Google remain deferred; no third language.

## Security milestone and M-005 decision path — 2026-10-27

- [x] Existing logout/logout-all replaced with atomic conditional DELETE statements; concurrency, owner isolation, expired/disabled and HTTP regression tests. [PR #33](https://github.com/rekixo-lab/jodlo/pull/33) merged as `5d7906e96cd71d7f104fcb58098ea5547b6b098b`; [main GitHub Actions #40504504583](https://github.com/rekixo-lab/jodlo/actions/runs/40504504583) completed **SUCCESS** on that exact commit (119/119 Node tests, docs/design/founder checks, local D1 migrations, strict TypeScript and both Wrangler dry-run Worker builds).
- [ ] Present [M-005 safe pilot decision proposal](M005_DECISION_PROPOSAL.md) and record explicit manual-vs-auto worker publication answer; then collect actual pilot area/categories and contact/request choice separately. General encouragement to continue is not approval of product details or personal data retention (M-003).

## Verified logout + next owner decision (2026-10-27)

[PR #33](https://github.com/rekixo-lab/jodlo/pull/33) merged as `5d7906e96cd71d7f104fcb58098ea5547b6b098b`; [main GitHub Actions #40504504583](https://github.com/rekixo-lab/jodlo/actions/runs/40504504583) completed **SUCCESS** on that exact commit (119/119 Node tests, docs/design/founder checks, local D1 migrations, strict TypeScript and both Wrangler dry-run Worker builds). **Next**: get explicit M-005 choice for manual-review-before-publication vs auto-publish, then actual pilot city/categories and customer contact stages; M-003 locality/retention separately. These are not automatically approved by general engineering go-ahead. M-004 design, M-008 real OAuth, M-007 production continue gated. No Hinglish.

## 2026-10-27 — Founder approved immediate self-publication (specific M-005 choice)

- [x] Ship founder-approved immediate, category-only worker service publication: 0004 D1, strict actor-scoped owner/public routes, active account/category, duplicate retry and moderator-hide safeguards, 9 new local tests. [PR #35](https://github.com/rekixo-lab/jodlo/pull/35) merged as `2668fc2a6e59c0b8e87871c4def1c4e2dc847a06`; [main GitHub Actions #40514179945](https://github.com/rekixo-lab/jodlo/actions/runs/40514179945) completed **SUCCESS** on that exact main SHA (128/128 Node tests, docs/design/founder gate checks, local D1 migrations 0001–0004, strict TypeScript and both Wrangler dry-run Worker bundles). [ADR-0009](decisions/0009-instant-service-publication.md).
- [ ] M-005 remaining actual pilot city/categories, moderation admin/reporting, trusted verification criteria, customer request/contact choices; M-003 area/privacy/retention, M-004 visual signoff, M-008 live Google and M-007 production still gated. Older manual-review proposal superseded.

## Founder M-005 partial approval milestone Green — 2026-10-27

[PR #35](https://github.com/rekixo-lab/jodlo/pull/35) merged as `2668fc2a6e59c0b8e87871c4def1c4e2dc847a06`; [main GitHub Actions #40514179945](https://github.com/rekixo-lab/jodlo/actions/runs/40514179945) completed **SUCCESS** on that exact main SHA (128/128 Node tests, docs/design/founder gate checks, local D1 migrations 0001–0004, strict TypeScript and both Wrangler dry-run Worker bundles). Publication can now happen immediately in the backend for a pre-approved active category, not via profile verification or manual review. **Next** owner decisions still needed for pilot city/area, actual curated category rows, review/report moderation operations, worker verified label criteria and customer request/contact channel. M-003 consent/retention/privacy and M-004 UI/M-008 OAuth/M-007 Cloudflare production gate remain separately controlled. No actual user/category seed or deployment. Hindi/English only.

## 2026-10-27 — Founder historic public catalog source delivered

- [x] Founder export of **all 8,390 legacy catalog records** received; persist complete original in private Library, bilingual safe full projection in GitHub; audit counts, ancestry, en/hi names, status conflicts, unsafe legacy category ID, and service sections. [Source audit](reference/FINWORKAR_CATALOG_AUDIT_2026-10-27.md).
- [ ] Use verified source to propose a **curated Hindi/English JODLO pilot taxonomy**, review risk tiers, explicit exception mapping and service hierarchy; get founder's actual pilot area/categories before real active D1 seed. No "enable everything" shortcut.

**Verified source-reference closeout:** [PR #37](https://github.com/rekixo-lab/jodlo/pull/37) merged as `24ceeb5a206efb4116a3620b542ddaddb8eaa550`; [exact main GitHub Actions #40523757801](https://github.com/rekixo-lab/jodlo/actions/runs/40523757801) completed **SUCCESS** on that SHA: **128/128 tests**, bilingual gzip/SHA and full ancestry check, docs/design/founder CI, local D1 migrations, strict TS and both Wrangler dry-run builds. Historic file collection/source study complete. Next backlog = review categories by founder-approved actual pilot location, publish a **proposed** first-wave category shortlist (not active D1), resolve one category ID mapping and statuses, then seed only founder-chosen safe taxonomy locally. Do not infer customer demand from old flags. Privacy M-003/location separate; UI M-004 and Cloudflare M-007 blocked.

## 2026-10-27 — Source-backed pilot taxonomy and service Hindi quality gate (proposal only)

1. **Reference audit (code/CI only):** run source SHA/ancestry + new pilot-candidate/Hindi-script quality verifier with `npm run reference:check`; no live data.
2. **M-005 founder input:** choose actual pilot city and exact candidate IDs after reading [proposed shortlist](reference/JODLO_PILOT_TAXONOMY_PROPOSAL_2026-10-27.md); don't automatically enable 889 old categories.
3. **After approval, separately:** review Hindi service content, risk/credential/moderation scope and reversible ID mappings. Future approved local-only seed should be minimal, tested and explicit; Cloudflare remains blocked until M-007.
4. **Unrelated safe work:** synthetic auth/discovery/regression tests and moderation-policy planning with no PII or operational request/call routes. M-003/M-004/M-006/M-008 still gated.

## Verified taxonomy/audit PR #39 — 2026-10-27

[PR #39](https://github.com/rekixo-lab/jodlo/pull/39) was squash-merged into `main` as `275ae95d968f58494febfef4ca1eac344bcc80f9`. The [exact main push Actions #40530286592](https://github.com/rekixo-lab/jodlo/actions/runs/40530286592) completed **SUCCESS** on that SHA; job logs show **128 tests / 128 passed / 0 failed**, pre-existing historical gzip/SHA/ancestry check, new 10-ID pilot/Hindi script review, documentation/design/founder guards, local D1 migration 0001–0004, strict TypeScript and both Wrangler dry-run bundles. PR head `e15070538d8cab324d0b89bd97beb9a85a0429a7` had its own [SUCCESS run #40530081123](https://github.com/rekixo-lab/jodlo/actions/runs/40530081123). New audit confirmed 4,928/7,267 historical Hindi service names contain Latin letters, across 616 categories. **No service translation was fixed or made public**, no category became active in JODLO, and no Cloudflare deployment happened. 10 first-wave IDs are unapproved; Founder M-005 must choose pilot city/area and category IDs. Instant worker self-publication/no automatic verification already approved. M-003, M-004, M-006, M-007, M-008 remain distinct gates. Consult `docs/reference/JODLO_PILOT_TAXONOMY_PROPOSAL_2026-10-27.md` and `docs/reference/data/jodlo-pilot-candidates-2026-10-27.json` before further work.

## 2026-10-27 — M-005 pilot city names approved: Bilaspur and Raipur

**Founder chose both pilot city names**, not just one, in the JODLO chat: Bilaspur / बिलासपुर and Raipur / रायपुर. [ADR-0010](decisions/0010-bilaspur-raipur-pilot-city-names.md) and [city-only bilingual reference](reference/data/jodlo-pilot-cities-2026-10-27.json) record the selection. No category approved or activated; previous 10 first-wave IDs remain reference-only. Exact wards/geofences, real worker/customer area data, consent, retention/deletion need M-003. M-005 still needs category shortlist approval, first customer contact/request, trust/verification and moderation/reporting decisions. ADR-0009 instant worker self-publication (never automatic verified badge), ADR-0008 Hindi+English only, M-004 UI, M-006 providers, M-007 production and M-008 real Google still binding. No DB/API changes, user location or Cloudflare deployment. New validator is part of existing `npm run reference:check`. **This is city-name approval only, not real pilot launch approval; verify PR and main CI before claiming merged.**

**Sequencing:** (1) city names DONE, (2) pilot category IDs MUST be founder approved, (3) independently review scope, operational moderation/contact and M-003 privacy, (4) later create safe local-only pilot category seed and tests if approved, (5) eventually controlled production with M-007. No automatic dual-city enablement.

## 2026-10-27 — Read-only legacy four-page Guided Post / Home / Group-Category / Search deep code study

Founder requested direct source study **before discussing taxonomy rollout or UI changes**. Read exact current legacy Android `0ad9ddd230439f76da363c6bbacdddb35288704f` and backend `f31d089953f68868108f5d475436842b55c10204` in READ-ONLY mode. Detailed file/line source trace and explicit static-only uncertainty: [review](reference/LEGACY_GUIDED_POST_HOME_SEARCH_CODE_REVIEW_2026-10-27.md). Confirms four steps (Work/Experience & Price/Location/Review), mandatory canonical category and image on old publish, category picker Group→Category with Family metadata (no separate Service selection), old Home's active catalog Group chips independent of post counts, guest/signed-in feed distinction, published-post filtering and category→group→text fallback. Also records *possible* unfiltered Search at fallback stage 0 when no strong category/Group; NOT runtime verified. **No JODLO UI/backend/code/seed, no real user data, no locale change and no Cloudflare deployment.** Review does NOT authorize all 889 categories or alter ADR-0009/M-003/M-004/M-005/M-007; await discussion with founder. Actual PR/main CI must be confirmed before marking GitHub documentation verified.

## 2026-10-27 — Smart discovery first implementation slice (read-only, local-only; CI pending)

Founder directed work to begin on full-catalog, low-friction worker/customer matching after deep legacy review. Implemented optional `availableOnly=1` on existing `GET /api/v1/catalog` and `/api/v1/catalog/search`; old default path still searches all **currently active** categories, including empty ones. Server selects available-only categories by an `EXISTS` of real eligible public listings sharing the **same** SQL eligibility condition as the previously approved minimal public listing read (published + moderation allowed + owner active + worker opted in + category active). Duplicate listings do not duplicate categories; no contact, owner, location, count, trust or private profile is projected. Synthetic D1 HTTP/injection/owner/moderation tests added. See [technical design/limitations](reference/JODLO_SMART_DISCOVERY_FOUNDATION_2026-10-27.md). This is **not** semantic AI, full 889 import, geo-local search or completed UI. Old 100-entry `GET /catalog` cap persists. No M-003 location, M-004 UI, actual M-005 category seeds, M-006 provider, M-007 deployment or M-008 live Google approval implied. No legacy writes. Require exact PR head + main CI before reporting done. Next: reviewed synonyms and bounded 889 synthetic pagination tests without seeding, then founder-scoped category policy and M-003 area decision before actual city matches.

## 2026-10-27 — Synthetic 889-category cursor browse extension (PR/main CI pending)

Preserved existing `GET /api/v1/catalog` legacy no-cursor 100-item response; added bounded opt-in keyset pages (`limit=1..25`, `after=<sortOrder:categoryId>`, `nextCursor`) for approved active catalogs and optional `availableOnly=1` filtering, **without new route/table/seed**. One new local SQLite/API suite exercises all **889 synthetic active category entries** across 36 pages, cursor stability after earlier entries are disabled, a late-category published listing, moderation, malformed parameters and server-error privacy. [Read design and limitations](reference/JODLO_SMART_DISCOVERY_FOUNDATION_2026-10-27.md). This is technical readiness for manual fallback, not complete semantic intent, real 889 activation, live app/group UI, city matching or deployment. Next: curated safety-reviewed taxonomy import policy, reviewed Hindi/English aliases and ambiguity regression tests. M-003/M-004/M-005/M-007 gates unaltered. Check exact PR head and merged-main CI before verification claims.

## 2026-10-27 — Conservative natural-work-intent fallback (safe active-only)

After PR #43 (live-listing availability facet) and #44 (889-item synthetic cursor traversal), added a tightly bounded **first work-intent alias fallback** in the **existing** `GET /api/v1/catalog/search` route. It only runs when ordinary category name/grammar matching returns **no rows**, and only returns a **preexisting active D1 Category ID**. It reuses the exact optional `availableOnly=1` server-side listing eligibility check (published + allowed moderation + active owner + private opt-in + active category). No new route, table, user data, category seed or language mode.

- Four illustrated trades (plumber, carpenter, tailor-stitching, bicycle-repairer), 12 deliberately narrow hand-authored Hindi or English phrases; these are **engineering examples to verify matcher behavior**, not a complete human-reviewed service dictionary or founder approval of the category IDs. A category absent/inactive in D1 produces **zero** suggestions.
- Distinct trades in one request produce **no automatic choice**. Unsupported Romanized-Hindi, mixed-script, punctuation/injection-like or unrelated contextual text cannot trigger this alias fallback. SQL remains parameterized. This is **not broad semantic understanding** or fuzzy classification; it uses explicit matching evidence.
- Client must still allow worker confirmation/manual Group/Category selection; the original name search and response shape/pagination remain unchanged.
- Tests cover Hindi worker/customer examples, English equivalents, conflicting trades, unsupported language, inactive/hidden moderation, no-listing discovery, no private projection and error redaction. Exact CI results **pending verification**.
- Legacy 7,267 Service names (4,928 with Latin characters in Hindi labels) are **not** imported; no new UI, personal location, Bilaspur/Raipur area, Google OAuth, real pilot category enablement or Cloudflare deployment. M-003/M-004/M-005/M-007 boundaries remain as before.

## 2026-10-27 — Alias quality guard + six more trade examples (CI PENDING)

Founder said continue building JODLO Smart Discovery. Extended existing conservative explicit Hindi/English phrase matcher from **4 to 10 routine first-wave CANDIDATE IDs**, with **24 total hand-authored phrase examples** (one Hindi and one English for all ten). These are *engineering test examples*, not a bulk import of the 7,267 Finworkar service records, not evidence of thorough human translation approval, and **not category activation**. The authoritative D1 category-active gate and optional global eligible-listing `availableOnly=1` gate still decide which suggestions appear. Added `validateWorkAliasRegistry` fail-closed review checks for unsupported/mixed scripts, duplicate phrases, contradictory overlapping aliases across categories, bad IDs, malformed/oversized phrases and bounded registry/per-category volume. Added synthetic tests including ambiguous jobs, missing/inactive D1 categories and unavailable listings. No additional API route, migration, user data, UI, location, extra language or deployment.

**Important:** This registry quality guard is a partial safety check; it cannot prove a phrase is semantically correct or professionally safe. A founder-approved category activation policy and editorial Hindi/English review of real service terms are still prerequisites to wide production coverage. Exact PR and separate main CI required before marking green. Read [Smart Discovery foundation](reference/JODLO_SMART_DISCOVERY_FOUNDATION_2026-10-27.md), [pilot audit](reference/JODLO_PILOT_TAXONOMY_PROPOSAL_2026-10-27.md) and ADR-0008; M-003/M-004/M-005/M-007 gates remain.

## 2026-10-27 — Full legacy 889-category per-record review tooling (CI verification pending)

Added offline **read-only** pinned-archive review matrix CLI and five synthetic/whole-snapshot tests, extending `npm run reference:check` and adding `npm run reference:review` JSON output for an engineer's **local** editorial queue. Records include source hierarchy, bilingual Category names, old Safety Tier (not a JODLO policy), Service-script counts, cross-category Service label collisions, explicit always-unapproved state and diagnostic flags. Actual pinned source yields 889 rows, 616 mixed-Hindi-service categories, 51 legacy parent-group status questions, 127 cross-category-label-overlap categories, 1 invalid category ID. No D1 seeds, Category approval, new API/UI, personal locality, OAuth, old-repo edits or deployment. [Detailed matrix process](reference/JODLO_LEGACY_889_CATEGORY_REVIEW_2026-10-27.md). M-003/M-004/M-005/M-007 separate decisions remain gated; active-category self-publication continues per ADR-0009. Exact PR and merged-main CI must be checked before calling this fully verified.

## 2026-10-28 — 7,267-service historical search-vocabulary safety work queue (PR/main CI pending)

Extended the existing pinned **read-only** legacy Category archive reader so it can be reused by a new offline per-Service-language/scope review CLI without duplicated hash validation. `npm run reference:service-summary` provides counts; `npm run reference:services` emits 7,267 **unapproved** historical service rows locally; `npm run reference:check` guards full source invariants. Tests include original-language combining marks, cross-Category same labels (no global synonym merging), invalid historical leaf IDs, ancestry failures, unsupported languages and no private/approval/seed fields. The full historical content stays unseeded, neither Matcher nor D1 imports any unapproved vocabulary, and no new route, UI, location, Google setup, category activation or Cloudflare deployment is authorized. This is mechanical editorial preparation, **not human translation, safety certification or general semantic search**. [Workflow/spec](reference/JODLO_LEGACY_7267_SERVICE_REVIEW_2026-10-28.md). M-003/M-004/M-005/M-007 unchanged. Verify exact PR and merged-main CI before completed claims.

## 2026-10-28 — Offline parent-scoped phrase collision work queue (CI pending)

Building the next source-only search safety step: group all **14,534 historical en/hi Service label occurrences** by normalized `(language,phrase)` while retaining each legacy Group/Family/Category/Service occurrence and full distinct Category choices. The old snapshot contains **139 distinct cross-category duplicated localized label keys**; this tool refuses to guess one correct worker trade. Same-parent duplicates are separately classified. The read-only CLI `reference:phrases`, `reference:phrase-summary` and `reference:check` + synthetic tests create no runtime matcher/approved alias/Category seed, personal information, UI or remote Cloudflare operation. [Specification](reference/JODLO_LEGACY_PARENT_SCOPED_PHRASE_REVIEW_2026-10-28.md). Founder M-003/M-004/M-005/M-007 still gated, 889 Categories remain historical reference only. PR/main exact CI needs verification.

## 2026-10-28 — Native-language editorial proposal validation (PR/main CI pending)

Following the full historical phrase collision review, added a **read-only, SHA-pinned, zero-runtime-import editorial batch/validator** `scripts/editorial-phrase-proposals.mjs`. It proposes **at most 2 Hindi and 2 English exact source-backed phrases per each of ten UNAPPROVED historic candidate IDs** solely as a manageable human work queue. It rejects every cross-Category shared phrase (139 old collision keys), invalid lineage/source IDs, unsupported scripts, parent-state/ID/cross-label review flags, duplicate rows and authorization-field tampering. Each row retains three required pending reviews (language, occupational scope, founder M-005 Category authorization) and is permanently `NOT_APPROVED_NO_RUNTIME_MATCHER_NO_D1_SEED`. Local `reference:editorial-summary` / `reference:editorial-batch` and test suite integrate with `reference:check`. **No changes to actual live Search matcher, no Category/Service activation, cloud, user data, UI or legacy repo edits.** See [precise editorial contract](reference/JODLO_EDITORIAL_PHRASE_PROPOSALS_2026-10-28.md); M-003/M-004/M-005/M-007 still separate. PR/main CI must be verified.

## 2026-10-28 — Optional public Search ambiguity choices (CI pending)

Added opt-in includeChoices=1 facet to existing GET /api/v1/catalog/search. Known multi-trade sentences may return needsChoice:true and strictly D1-active, optionally published/eligible Category options, instead of silently empty. No user choice, posting, UI, PII or location; absent facet retains old API DTO exactly. Refined curated alias matcher to reject unrelated words even if multiple reviewed phrases occur. Synthetic Hindi/English, moderation, active-only, SQL injection, privacy and backwards compatibility tests added. Uses existing 24 engineering-example phrases only: NO auto-import of 32 unapproved editorial tasks, 7,267 service leaves or 889 Categories. More detail in reference/JODLO_SMART_DISCOVERY_FOUNDATION_2026-10-27.md. M-003, M-004, M-005, M-007 still gated, and PR+merged-main CI proof required.

## 2026-10-28 — End-to-end category confirmation and literal/alias collision safety (CI pending)

Nonvisual Backend improvement: explicit `includeChoices=1` Search now detects when a **curated single-trade work phrase** disagrees with another active Category matched literally by name/slug. Instead of presenting the unrelated literal match as chosen, it returns `needsChoice:true`, `categories:[]` and only bounded currently active (optionally eligible-published) public Category choices. If >9 literal matches exist, it returns empty choices rather than a misleading truncated shortlist. The unflagged legacy search DTO remains unchanged. New local HTTP integration tests connect bilingual Search/ambiguous work choices to the EXISTING strict worker opt-in + explicit `categoryId` + authenticated idempotent `POST /api/v1/me/listings`, actual `GET /api/v1/listings` and `availableOnly=1` visibility, then unpublish; no other Category is automatically published. No new public route, D1 migration, real 889 activation, 32 pending editorial aliases, UI, PII, location or Cloudflare deployment. [Search contract](reference/JODLO_SMART_DISCOVERY_FOUNDATION_2026-10-27.md); M-003/004/005/007 gates unchanged. Require PR-head and main CI proof.

## 2026-10-28 — Catalog expansion activation preflight, all 889 source Categories (CI pending)

Built `scripts/catalog-activation-preflight.mjs`, a **non-deployable, source-locked, offline draft gate** for **ALL 889 historical Category records**, including source-only invalid IDs (flagged rather than silently omitted). It includes existing English/Hindi labels, parent ancestry, historical Safety Tier as non-authoritative evidence, mechanical review flags and a *mandatory human + Founder M-005 review status on every row*, even mechanically clean ones. It rejects duplicate/unknown source IDs, forged approvals, altered provenance/row content, missing gates and generated activation claims; no SQL, D1 seeds, new API route, real category activation, alias import, user location/PII, Android UI or cloud deployment. CLI `catalog:preflight-summary` / `catalog:preflight-review`, `reference:check` and six dedicated tests added. See [exact activation-preflight contract](reference/JODLO_CATEGORY_EXPANSION_PREFLIGHT_2026-10-28.md). Further actual rollout must be separately founder-authorized under M-005; M-003/004/007 unchanged. Require PR and merged-main CI proof before claiming green.
