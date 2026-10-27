# JODLO

> **NEW FOUNDER DECISION — 2026-10-27: CODE FIRST, NO STAGING.** Develop Android, backend, database and external-provider adapter code using Wrangler local simulation, mock integrations and GitHub CI. **Do not deploy or request Cloudflare credentials now.** First cloud deployment is a founder-approved controlled production launch after product readiness. Former staging directions are superseded. See [ADR-0004](docs/decisions/0004-local-first-no-staging-until-production.md) and [Release Readiness](docs/RELEASE_READINESS.md).


**Fast, native Android experience. Cloudflare-first infrastructure. Clean-slate build.**

> **HARD FOUNDER REQUIREMENT (2026-10-27): REUSE FIRST, PREMIUM DESIGN AND MOTION.** Reuse genuinely shared code/components/assets/contracts; no duplicate functions or media, unused SDKs or scattered UI text, colors, typography, radius, strokes, spacing and animation values. Localized user text and **one founder-approved design theme** are mandatory. Premium responsive animations for tabs/navigation/actions plus **selective lightweight 3D/2.5D**, preserving low-end phone speed, reduced-motion, accessibility and battery. **Founder approves actual visual palette/screens/motion before UI implementation.** Read [ADR-0005](docs/decisions/0005-reuse-tokens-premium-motion.md) · [Reuse](docs/REUSE_ASSET_POLICY.md) · [Design System](docs/DESIGN_SYSTEM.md) · [Motion/3D](docs/MOTION_3D.md).

> JODLO is a new, independent local work and services platform for India, designed to connect customers with nearby, relevant workers through a simple, trustworthy and privacy-first experience.

| Project identity | Fixed decision |
|---|---|
| Name | **JODLO** |
| Native Android application ID | **`com.rekixo.jodlo`** |
| Website | **`https://jodlo.rekixo.com`** (reserved; NOT deployed yet) |
| Repository | **`rekixo-lab/jodlo`** |
| Cloud infrastructure | **Cloudflare-first** |
| Payments | **Google Pay India (UPI) preferred where permitted; Google Play Billing for Play digital purchases unless valid alternative/exception** |
| Legacy payment system | **Do NOT port the old Finworkar Razorpay integration** |
| Existing Finworkar | **Read-only reference; NEVER modify or overwrite** |
| Data | **New, independent data stores; no migration** |
| UI | **Founder review and suggestions before any layout, theme or screen is implemented** |

## हमारा मकसद

भारत में लोगों को आसपास के सही वर्कर या सर्विस देने वाले व्यक्ति को आसानी से खोजने में मदद करना, और काम करने वालों को अपनी वास्तविक सेवा दिखाने का सुविधाजनक माध्यम देना। हिंदी/हिंग्लिश और कम क्षमता वाले Android फ़ोन का ध्यान रखा जाएगा। सुरक्षा, भरोसा, जवाब देने की विश्वसनीयता और वास्तविक काम मिलने के परिणाम डाउनलोड की संख्या से ज़्यादा महत्वपूर्ण हैं।

JODLO को **हल्का, तेज़, सुचारु, कम खर्च वाला, सुरक्षित और भविष्य में आसानी से बदलने योग्य** बनाना है। अनावश्यक कोड, फीचर, डिपेंडेंसी, background jobs और architectural complexity को नए प्रोजेक्ट में नहीं लाएँगे।


## For a new AI chat / नए AI के लिए — START HERE

**This repository is the project's written source of truth; ChatGPT Memory is not a substitute.** If opening a new chat, connect/share `https://github.com/rekixo-lab/jodlo` **after files have actually been pushed**, or attach the latest foundation ZIP. An AI cannot see local, unpushed docs merely because their names are listed here.

**Read in this order:** [AGENTS.md](AGENTS.md) → [AI HANDOFF](docs/AI_HANDOFF.md) → [CURRENT STATUS](docs/STATUS.md) → [Roadmap](docs/ROADMAP.md) → [Architecture](docs/ARCHITECTURE.md). Every session must update the status with Done / Pending / Blocked / Next and links/tests, and never invent production/CI success.

**Founder-action rule:** The assistant proactively identifies and explains each actually needed manual decision/action **during an active JODLO conversation**; non-blocked development proceeds automatically. Permanent task IDs, trigger dates/states, actionable instructions and deferred tasks are in [Manual Actions](docs/MANUAL_ACTIONS.md), and current blockers in [Status](docs/STATUS.md). No chat promise of background notifications. No Cloudflare deployment/account tasks now; current first choice is the customer/worker account-role model (`M-001`).

### End-to-end proposed design at a glance

```text
Android native Kotlin (com.rekixo.jodlo)        Approved web site (future)
             |                                        |
             +---- HTTPS /api/v1 ---------------------+
                              |
                   Cloudflare Worker API
                Small typed, modular monolith
                /    |      |        |      \
             Identity Workers Listings Search  Contact
                \    |      |        |      /
                  D1 (only after schema approval)
                   |                    |
         R2 private media (later)      Queues for async (later)
                   |                    |
          External: FCM + media RTC provider (evaluated) +
          Google Pay India/merchant PSP OR Google Play Billing
```

**Implemented locally:** `GET /api/v1/health` and a binding-gated, read-only `GET /api/v1/catalog?lang=en|hi` backed by a first versioned public-category D1 migration. The catalog is empty until approved taxonomy entries exist; without a configured local D1 binding it returns 503. **No live D1 database exists.** R2/Queues, cloud deployment, Android app, UI, calls and payment checkout remain unimplemented. No cloud resource or DNS created.

### Android Activity/class design — proposed, not a built app

- **One thin `MainActivity`** for Android lifecycle/navigation, not a 2,500-line all-purpose `HomeActivity`.
- **ViewModel + `StateFlow` per feature**, clear `UiState`/events, cancellation/lifecycle-aware state, separate domain/repository/network/cache adapters. Kotlin first; Jetpack Compose is a *technical proposal*, and visuals/layouts **still need founder approval**.
- Source root would be `apps/android/app/src/main/java/com/rekixo/jodlo/` with `core/{network,session,model,data,security,location,image,push,designsystem,testing}` and `feature/{onboarding,authentication,discovery,workerprofile,listings,contacts,calling,payments,settings}`. These are architectural intentions, **not currently existing code modules**.
- Never put D1/R2 keys, wallet authority, payment proof or RTC signing secret in Android. FCM/RTC are separately approved platform/provider integrations.
- See **[Android Structure — classes and dependencies](docs/ANDROID_STRUCTURE.md)** and [ADR-0003](docs/decisions/0003-native-android-single-activity.md).

### Cloudflare infrastructure choices — proposed, not provisioned

| Component | Decision and timing |
| --- | --- |
| Workers + TypeScript | **One initial Worker** with small typed routes and feature modules, versioned `/api/v1`; avoid premature microservices. |
| D1 | Relational tables, indexed area/category search, ownership and idempotent writes **after schema reviews**. |
| R2 | Private worker photos/portfolio; controlled uploads, scanning and thumbnails when media exists. |
| Queues | For actual asynchronous notifications/moderation/reconciliation only; duplicate-safe consumer + dead-letter. |
| Durable Objects | Only if measured realtime signaling/state coordination needs it, **not ordinary HTTP voice media**. |
| WAF/rate limiting/Observability | Protect and measure requests before public launch, minimal PII in logs. |
| Cloudflare website | `jodlo.rekixo.com` after UI and DNS review; prevent disruption of legacy domain. |
| External | Android + Google Play + FCM + eligible Google Pay/Play Billing + native RTC media where required. |

**Read:** [Cloudflare Infrastructure](docs/CLOUDFLARE_INFRASTRUCTURE.md), [Module Boundaries](docs/MODULE_BOUNDARIES.md), [Technical Research](docs/ARCHITECTURE_RESEARCH_20261027.md). No Cloudflare service has been deployed or provisioned by this scaffold.

### What old Finworkar taught us: keep / rebuild / drop

- **Keep rules as design inputs:** privacy-protecting profiles/locations, server-side payment and call event reconciliation, Hindi/Hinglish vocabulary, bounded search/pagination, reports and account deletion.
- **Rebuild:** Firebase Auth/Firestore/Functions calls become explicit Worker API + D1; multi-Activity Java/Firebase screens become Kotlin feature layers; old Firestore geo queries become indexed and bounded D1 queries; Agora is only one RTC candidate, not assumed; wallet is newly designed, with independent ledger.
- **Drop by default:** old Razorpay implementation, Firebase-coupled client, oversized multi-purpose Activities and 2,000-line call logic, unnecessary ads/rewards/stories/premium boosts, excessive always-on maintenance cron and premature platform dependencies. **Never remove safety-critical cleanup, refunds, deletion or reconciliation.**
- **Read only:** all three old GitHub repositories; never change the live Finworkar code/data or claim that its production metrics were audited.

### Mandatory gates to implement anything new

1. Tests + branch/PR + actual green GitHub Actions; **a local test pass alone is not CI green**.
2. D1 schema/permissions and product requirements before user data collection.
3. Founder design review **before UI implementation or promotional artwork**; founder can suggest anything, and final design requires agreement.
4. SKU/payment channel eligibility before Google Pay/Play Billing checkout. Do not port Razorpay and do not activate money movement early.
5. Manual founder UI approval during implementation; Cloudflare/DNS/provider provisioning and **production-only** launch approval only after feature completion.

The project is long-term; 30/60/90 days are not a fixed finishing deadline. **Never drop a checklist item merely to finish early.**

## Product principles

1. **Greenfield only:** Finworkar Android / Firebase backend / website remain unchanged. Use them for feature understanding and lessons; do not copy credentials, private records or broken architectural assumptions.
2. **Native Android, Cloudflare backend:** Kotlin/Android on-device; Workers/TypeScript for API and business rules; D1, R2, Queues and other bindings added only when required. Cloudflare cannot replace Android runtime, Google Play delivery, push services, real-time voice-media infrastructure or all payment providers.
3. **Modular monolith to start:** Small independently testable feature modules with explicit interfaces; one API Worker initially, split into multiple services when measurements justify it.
4. **Performance budget:** Measure launch delay, first content, p95 API latency, payload size, query scans, DB read/write counts and cloud spending. Goals are targets until measured, never guarantees.
5. **Zero trust and privacy:** least privilege, no contact/location data in public endpoints by default, authenticated writes, abuse prevention, verified event idempotency and account deletion support.
6. **Maintainable and future-proof:** versioned APIs, structured logs without PII, types, tests, migration strategy, reproducible environments, small PRs and rollback planning.
7. **Payment strategy:** Google Pay India/UPI is the founder-selected preference for eligible payments; Google Pay is **not** Google Play Billing. Follow Play digital-purchase rules (or properly enrolled allowed alternative billing), verify merchant/UPI success server-to-server, and never copy legacy Razorpay. See [Payment Strategy](docs/PAYMENTS.md) and [ADR-0002](docs/decisions/0002-google-pay-and-play-billing.md).
8. **Founder owns UI decisions:** show proposed flow/wireframes and ask for user suggestions and approval **before creating or changing UI**; likewise for brand/Play Store media.
9. **No rushed launch:** No fixed 30/60/90-day deadline. Track every pending task and do not call failing/blocked CI a success.

## Project structure

```
apps/
  api/                Cloudflare Worker, TypeScript, HTTP contracts and tests
  android/            Reserved: native Kotlin Android, after founder UI review
  web/                Reserved: Cloudflare-hosted website, after founder UI review
  admin/              Reserved: scoped admin UI, after authorization architecture
packages/             Shared contracts when a second client needs them
infra/migrations/     D1 migration scripts only after schema review
.github/workflows/    No-deploy quality checks
docs/
  PROJECT.md          Mission, boundaries, decisions and collaboration
  ARCHITECTURE.md     Architecture, performance, persistence and security
  AI_HANDOFF.md       Exact resumption guide for any new AI session
  ANDROID_STRUCTURE.md Native Android Activity/ViewModel/module blueprint
  CLOUDFLARE_INFRASTRUCTURE.md Cloudflare services, D1/R2/Queues/ops
  MODULE_BOUNDARIES.md Module ownership, contracts, no tight coupling
  ARCHITECTURE_RESEARCH_20261027.md  source-backed deep audit and blueprint
  PRODUCT_REQUIREMENTS.md Product capabilities and unanswered decisions
  PAYMENTS.md          Google Pay-first decision, Play Billing rules, safe checkout gates
  ROADMAP.md          Ordered milestones and truthful delivery state
  MANUAL_ACTIONS.md   Founder-controlled external account actions
  reference/          Old code mapping (read-only)
  decisions/          Architecture Decision Records
```

Folders not yet implemented intentionally remain absent or placeholder-only; we do not create fake features.

## Run the first API starter locally

Requires **Node.js >=22.16**. No package install is needed for the offline request tests.

```bash
npm test
```

For TypeScript typechecking and Cloudflare local emulation, first install declared dev dependencies:

```bash
npm install
npm run typecheck
npm run dev:api
```

The only implemented API is `GET /api/v1/health`; it returns generic readiness without accessing user records, credentials, databases, Cloudflare secrets or remote systems. It is not production health monitoring. No deployment scripts are configured yet. Production deployment requires an explicit setup/approval gate.

## Implementation status

- [x] Mission, identity, architecture/decisions and collaboration rules drafted.
- [x] Initial API skeleton and deterministic request tests drafted.
- [x] Architecture decisions, new-chat handoff and Android/Cloudflare module design **committed on GitHub main** (see linked docs).
- [x] **Local** docs link checker added (`npm run docs:check`), 20 mandatory docs and 90 relative links valid; local Node tests 7/7 and TypeScript check passed on 2026-10-27.
- [x] **GitHub foundation merged to main** with 38 files (36 original+2 staging deploy files), after PR #1 verified green. [Main Actions run](https://github.com/rekixo-lab/jodlo/actions/runs/40466265299) succeeded on squash merge commit `2b447de586e0c9d655edc188203acf843e4dc66f`.
- [ ] Cloudflare account/zone/bindings/provisioning.
- [ ] Live website/API/Android app.
- [ ] Founder-reviewed UI.
- [x] Payment direction recorded: **Google Pay India preferred; Razorpay not ported; Play Billing compatibility gate documented**.
- [ ] Merchant onboarding, policy decisions, payment tests and actual checkout implementation.
- [ ] Real worker/customer journeys, identity and storage.

**Source-only development. No production system touched. Documentation is currently LOCAL ONLY until GitHub write and CI are actually verified.**

## Legacy reference sources (read-only)

- https://github.com/rekixo-lab/finworkar-android
- https://github.com/rekixo-lab/finworkar-backend
- https://github.com/rekixo-lab/Finworkar-web

Read the [October 2026 infrastructure and structure research](docs/ARCHITECTURE_RESEARCH_20261027.md) for evidence, Cloudflare decisions, module diagram and migration-free build sequence.

See [docs/ROADMAP.md](docs/ROADMAP.md) for next actions and [docs/MANUAL_ACTIONS.md](docs/MANUAL_ACTIONS.md) for the actions that only the founder can perform.

**Public repository warning:** do not commit secrets, signing keys, customer records, exported user data, raw GPS coordinates, vendor invoices or payment information.
## Code-first local development and one eventual production release

**No staging deployment is required or planned.** Implement the complete product (native Android, Cloudflare Worker, D1/R2/Queues adapters, calling/payments, search, privacy/security), test against Wrangler/workerd local simulations and mocked provider callbacks and require real green GitHub CI. Do not create `jodlo-staging`, remote databases or any Cloudflare API tokens during development.

After code/product readiness, obtain **explicit founder approval** for a controlled first **production** deployment to `jodlo.rekixo.com`, with secure production provider credentials, backups/recovery, migration plan, live smoke tests and rollback. Real RTC, payment/Play callbacks, DNS/TLS and Cloudflare policy behavior cannot be fully proven offline; mark those UNVERIFIED until safe live testing.

[Local-only ADR](docs/decisions/0004-local-first-no-staging-until-production.md) · [Release Readiness](docs/RELEASE_READINESS.md) · [Current Status](docs/STATUS.md).

## Required reuse and premium visual-quality gates

**Reuse, don't repeat:** search existing shared component/helper/contract/icon/asset first; extract small tested reusable code when a genuine second usage appears. Keep modules lean and remove dead/redundant features. No copy-paste network, search, validation, media, payment or styling code. Avoid premature giant generic libraries.

**One semantic theme:** all Android user-facing strings use `stringResource`/localized XML, including Hindi; palette, typography, corners/radii, strokes/borders, spacing, elevation and animation durations come from founder-approved Material 3/design-system tokens. Future web does the same with translation/CSS variables. No duplicate images or unused heavy 3D assets.

**High-end feel without bloat:** animated tab indicator/navigation/action transitions, press feedback, loading/success/error and optional subtle perspective/selected 3D. Honor reduced-motion, screen readers and low-end frame/memory/battery budget. Never block the user behind animation; actual style must be proposed to founder before coding.

**Automated guard:** `npm run design:check` plus fixture tests in GitHub CI, supplemented by future Android Lint/Detekt/on-device benchmarks. They catch common hardcodes and byte-identical media, but not every semantic duplicate or frame-jank bug.

[ADR-0005](docs/decisions/0005-reuse-tokens-premium-motion.md) · [Reuse policy](docs/REUSE_ASSET_POLICY.md) · [Design tokens and premium palette brief](docs/DESIGN_SYSTEM.md) · [Motion/3D standards](docs/MOTION_3D.md).

## First database development slice (2026-10-27; local code, not deployed)

`infra/migrations/0001_public_catalog.sql` and `apps/api/wrangler.local.jsonc` enable a local-only category catalog. Run `npm install`, `npm run db:migrate:local`, `npm test`, `npm run typecheck` and `npm run db:build:local`. `GET /api/v1/catalog?lang=hi` is public and read-only; only approved/active categories appear and Hindi labels fall back to English. No seed city/categories, identities, user records or production bindings exist. Future D1 tables require founder-approved roles, auth and locality/privacy model. No Cloudflare staging or production deployment.

**Catalog verification:** **Merged catalog milestone:** [PR #7](https://github.com/rekixo-lab/jodlo/pull/7) squash-merged as `dd16db9`, verified [green main GitHub Actions #40473524328](https://github.com/rekixo-lab/jodlo/actions/runs/40473524328) on `dd16db92a1e04b2e40237bc440ab0a062039f5ea` (19 Node tests, local-only Wrangler D1 migration, local and normal Worker dry-run builds, strict TS, docs/design checks). No Cloudflare/Android deployment. Production D1 and provider integrations remain UNVERIFIED.

## M-001 approved: shared customer account + optional worker profile (2026-10-27)

Founder explicitly chose **one JODLO account** that can act as customer and, after explicit opt-in, worker. [ADR-0006](docs/decisions/0006-shared-account-opt-in-worker.md) implements provider-neutral local-only `accounts` and `worker_profiles` schema, private draft-only worker records and a strictly authenticated opt-in API `GET/POST /api/v1/me/worker-profile` (returns 503 unless future trusted AUTH and D1 bindings are present). Never accept client-selected account IDs. **No live identity/OTP provider, account provisioning API, user PII, worker publication, location, Android screens or cloud deployment is implemented.** [Manual Actions](docs/MANUAL_ACTIONS.md) tracks later owner gates M-002/M-003/M-004. **Verified:** [PR #10](https://github.com/rekixo-lab/jodlo/pull/10) merged as `e01dbde44cbe46aadf3d563c66f411a8c9d96818`; [main GitHub Actions #40476898497](https://github.com/rekixo-lab/jodlo/actions/runs/40476898497) SUCCESS on that commit (27 Node tests, docs/design guard, both dry-run builds, local D1 migration 0001+0002 and strict TypeScript). This verifies local-only code and tests, not actual identity onboarding or a deployed user database.

## M-002 approved: Google Sign-In only at initial launch (2026-10-27)

Founder approved **Google Sign-In** instead of mobile OTP for initial login; [ADR-0007](docs/decisions/0007-google-signin-verified-session.md). Backend-only implementation adds `POST /api/v1/auth/google` (strict bounded JSON `{ "idToken": "..." }`), Google JWT verification using Google’s rotating public JWKs (`jose`; RS256, issuer, exact Google OAuth audience, expiry, issuance, stable numeric `sub`), transactional D1 `google_identities` link, and 32-byte random **hashed/revocable one-hour** JODLO bearer sessions. `POST /api/v1/auth/logout` revokes the active session; previously protected worker draft routes now accept DB-backed sessions without untrusted client account IDs.

No live OAuth client ID, Google Cloud setup, real Android login UI, personal Google email/name/photo, Firebase dependency or Cloudflare deployment has been configured. Unset/invalid `GOOGLE_CLIENT_ID` makes sign-in HTTP 503 (fail closed). Later **M-008** founder-owned Google OAuth configuration and real device validation; M-004 design approval before screens. Local tests use synthetic RSA keys and SQLite; they **do not** establish real Google token acceptance or deployed/provider behavior. Refer to [manual actions](docs/MANUAL_ACTIONS.md) and [testing](docs/TESTING.md).

**Google Sign-In backend milestone verified:** [PR #12](https://github.com/rekixo-lab/jodlo/pull/12) merged as `494fc1ee3a41757d4099df40532759526afa5e66` with actual [green main GitHub Actions #40479368370](https://github.com/rekixo-lab/jodlo/actions/runs/40479368370) (37/37 tests, D1 migrations 0001–0003 locally, docs/design checks, strict TypeScript, both Wrangler dry-run builds). No real Google-client ID or Android Credential Manager integration is configured; the Google `sub` stored by D1 is pseudonymous personal data and requires deletion/retention rules before collecting real users. No remote Cloudflare resources.

## Authentication session controls — local-only hardening (2026-10-27)

**Implemented and CI-verified** source change limits verified Google accounts to **six active one-hour JODLO sessions**, refuses excess with HTTP `429`, opportunistically purges at most **100 expired hashes per sign-in**, and provides `POST /api/v1/auth/logout-all` for authenticated all-device revocation. No new provider, table or deployment. **Actual evidence:** [PR #14](https://github.com/rekixo-lab/jodlo/pull/14) squash-merged as `c234961204c0c2586748c52bcd1976a8611c7197`, and [main Actions #40481385874](https://github.com/rekixo-lab/jodlo/actions/runs/40481385874) completed **SUCCESS** (41 automated tests, docs/design guard, local D1 migrations, TypeScript and both Wrangler dry-runs). This cap is not a substitute for Cloudflare WAF, login abuse filtering or a consent/retention policy.

## Local Google login abuse controls (2026-10-27)

The new backend slice adds Cloudflare-compatible local rate-limit bindings for pre-verification bursts and post-verification Google-sub sign-ins. It doesn't save IP addresses or add personal-data tables. Login fails closed without both bindings, returns HTTP 429 on limit denial, and retains the existing six-active-session atomic cap. Also adds synthetic account/worker/Google mapping/session cascade-and-rollback tests—**no public account-delete endpoint is authorized** until M-003 privacy policy is approved. Read [Status](docs/STATUS.md) for actual GitHub PR/main CI evidence; no Cloudflare staging, live limits or Android UI.

**Login admission security verification:** [PR #16](https://github.com/rekixo-lab/jodlo/pull/16) merged as `17ea0b882977ad0bd3a695e49b0112dde64fc9d6`; [main Actions #40482955589](https://github.com/rekixo-lab/jodlo/actions/runs/40482955589) completed **SUCCESS** on that exact commit (49/49 Node tests, docs/design checks, local D1 migrations, TypeScript and both Wrangler dry-run builds). The limiter is still **only local-simulated** and intentionally unavailable in unconfigured normal Worker environment. This is not deployed WAF/bot defense or real Google sign-in. Synthetic cascade/rollback tests are not an approved account deletion policy.

## Privacy-safe bilingual category search (backend-only, 2026-10-27)

New read-only `GET /api/v1/catalog/search?q=plumb&lang=en&limit=20&offset=0` searches **published category taxonomy only**, with Hindi/English labels, bounded validation, deterministic next-page offset and literal parameterized substring matching. No worker records, contact details, GPS/area data, verified labels or real pilot category seeds are created; those remain M-003/M-005 decisions. Only synthetic SQLite/Worker tests until actual GitHub green CI; see [Status](docs/STATUS.md). No Android UI or Cloudflare deployment.

**Merged green evidence:** [PR #18](https://github.com/rekixo-lab/jodlo/pull/18) merged as `36c9d83ad8f720d4eb7244364e789f5fc4bd7879`; [main GitHub Actions #40484455029](https://github.com/rekixo-lab/jodlo/actions/runs/40484455029) **SUCCESS** on the exact main head (55/55 Node tests, local D1 migrations, documentation/design guards, strict TypeScript, local and normal Worker dry-run builds). This is read-only category-taxonomy search only; **not** live worker discovery, location search, contact/matching workflow or actual product deployment.

## Policy-neutral interaction prototypes (2026-10-27)

Backend-only **pure, synthetic** request transition and candidate-selection contracts are being tested. They enforce session-actor ownership, revision/retry-key checks, policy-denied-by-default state changes and selection of only explicitly approved category-matched opaque candidate IDs. No actual booking statuses, worker matching, location/contact records, request database, public endpoint, UI or deployment are created. Founder M-003 and M-005 still control the real privacy, pilot and request lifecycle decisions. Check [Status](docs/STATUS.md) for actual GitHub CI before treating this milestone as complete.

**Verified pure contract milestone:** [PR #20](https://github.com/rekixo-lab/jodlo/pull/20) merged as `31839e4c5eca44251db85e3d4c220ea1be3bd296`, and [main GitHub Actions #40486525096](https://github.com/rekixo-lab/jodlo/actions/runs/40486525096) **SUCCESS** on this exact commit: 68/68 Node tests, local D1 migrations, docs/design checks, strict TypeScript, both Worker dry-run bundles. This enables safe policy-injected domain decisions but does not expose worker matching/customer request endpoints or handle real bookings. M-003 and M-005 remain owner gates.

## Finworkar behavior continuity without legacy migration

JODLO uses an independent modular codebase. Founder requested careful read-only comparison of how the original Finworkar worker published a service, how customers discovered it, and how safe contact/requests/calls worked. [Source-backed legacy behavior map](docs/LEGACY_FINWORKAR_BEHAVIOR.md) records this workflow, reusable safety lessons and non-portable legacy choices. A pure local contact-safety guard is proposed for JODLO (no user data/API/storage), subject to actual PR/main green evidence. No old repositories modified.

**Legacy behavior continuity CI verified:** [PR #22](https://github.com/rekixo-lab/jodlo/pull/22) merged as `24ed69e735e136cc95b6ac43f74d83f08d019e6a`; [main GitHub Actions #40489994251](https://github.com/rekixo-lab/jodlo/actions/runs/40489994251) **SUCCESS** on the same commit (76/76 Node tests, local D1, docs/design guards, strict TypeScript, both Wrangler dry-run builds). Old Finworkar flow analyzed read-only; JODLO contact guard independently implemented and tested. See [Legacy behavior map](docs/LEGACY_FINWORKAR_BEHAVIOR.md).
