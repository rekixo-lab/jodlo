# JODLO

> **M-005 FOUNDER DECISION — 2026-10-31:** Worker receiving Agora app-to-app voice calls requires **separate explicit opt-in, DEFAULT OFF**, independently of profile/listing publication. Worker can toggle OFF at any time; current consent is rechecked at future call/RTC token preflight. [ADR-0014](docs/decisions/0014-explicit-worker-agora-call-opt-in.md). Implemented only as private, owner-session-scoped D1 preference and local tests; **no public toggle route, visual UI, actual Agora SDK/tokens, call, recording or cloud deploy**. Other M-003/M-004/M-005/M-006/M-007/M-008 gates remain.


> **LOCAL-ONLY AGORA DUAL-SESSION AND SIGNALING PREFLIGHT — 2026-10-31:** Both the customer and listing owner's own active bearer sessions must be current **in one D1 SELECT** for a future RTC token grant. Offline signaling transition intents reuse the call reducer's actor/revision/duplicate checks and emit **no real messages**. This does **not** issue an Agora token/channel/UID, send a push, store a call, create an API or permit live calling. See [Agora Voice security design](docs/AGORA_VOICE.md). M-003/M-004/M-005/M-006/M-007/M-008 remain gated.

> **OFFLINE AGORA LIFECYCLE CONTRACT — 2026-10-31:** A new pure call-invite/ringing/accept/decline/cancel/busy/timeout/connected/ended model and join-prerequisite checks are exercised only by synthetic local tests. See [Agora Voice implementation design](docs/AGORA_VOICE.md). There is NO actual Agora channel, access token, in-app ringtone, SDK, call history, public route, UI or remote deployment. M-003/M-004/M-005/M-006/M-007/M-008 gates are unchanged.

> **FOUNDER CLARIFICATION — 2026-10-31:** Customer's first contact is **Agora RTC in-app Internet voice calling**, not SIM/mobile-number calling; **no worker phone number is required, displayed or routed**. No mandatory service Request→Accept workflow before the call. See [ADR-0013](docs/decisions/0013-agora-ip-voice-calling.md) (corrects ADR-0012). M-005 mode and M-006 **Agora voice provider choice** are DONE; actual RTC SDK, signaling/ringing, secure short-lived tokens, caller/worker consent, privacy/retention, screens and production are NOT implemented or approved. M-003/M-004/M-005 safety/M-006 onboarding/M-007/M-008 gates remain.

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

## Founder-approved all-category direction — 2026-10-29

**JODLO is NOT a ten-trade-only marketplace.** Founder reaffirmed **all kinds of legitimate work together**: the full historical **889-Category** inventory is in scope for structured safety/language review and future broadly available smart discovery. The old ten-trade proposal is an **editorial review sample only**. Do not ask the founder to choose ten versus all again. Existing synthetic 889-row keyset Browse, Hindi/English active Catalog Search, `availableOnly=1` and 45 source-backed review packets are already present. **They are not a live 889-category D1 import or completed semantic matcher**; source label, legal/safety, Category-ID and real contact/area/UI/production gates still apply. Read [ADR-0011](docs/decisions/0011-all-category-coverage-smart-discovery.md) and [Manual Actions](docs/MANUAL_ACTIONS.md).

## हमारा मकसद

भारत में लोगों को आसपास के सही वर्कर या सर्विस देने वाले व्यक्ति को आसानी से खोजने में मदद करना, और काम करने वालों को अपनी वास्तविक सेवा दिखाने का सुविधाजनक माध्यम देना। सिर्फ हिंदी और English तथा कम क्षमता वाले Android फ़ोन का ध्यान रखा जाएगा। सुरक्षा, भरोसा, जवाब देने की विश्वसनीयता और वास्तविक काम मिलने के परिणाम डाउनलोड की संख्या से ज़्यादा महत्वपूर्ण हैं।

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

**First Android-compatible Kotlin code (2026-10-28):** a [nonvisual headless networking Core](apps/android/README.md) now exists and is compiled/tested in CI without Android SDK, Activity, Layout, Theme or UI. It plans the existing secure Search, Category browse, Worker opt-in and category-only Listing routes and has a bounded one-shot HTTPS adapter. This is **not yet a native Android app/APK or Android UI**; M-004 and M-008 still gate visual screens and real OAuth, and location M-003 remains entirely unset.

**Implemented locally:** `GET /api/v1/health` and a binding-gated, read-only `GET /api/v1/catalog?lang=en|hi` backed by a first versioned public-category D1 migration. The catalog is empty until approved taxonomy entries exist; without a configured local D1 binding it returns 503. **No live D1 database exists.** R2/Queues, cloud deployment, actual Android app/APK and UI, calls and payment checkout remain unimplemented. No cloud resource or DNS created.

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

- **Keep rules as design inputs:** privacy-protecting profiles/locations, server-side payment and call event reconciliation, Hindi and English vocabulary only, bounded search/pagination, reports and account deletion.
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

## Hindi and English category intent only — local public catalog

New incremental phrase search will support natural text such as `मुझे प्लंबिंग का काम चाहिए` or `I need plumbing` via separate Hindi and English grammar parsing (no Hinglish or transliteration) and the existing parameterized `/api/v1/catalog/search` endpoint. It **does not** assume old Finworkar voice/audio UX, copy matcher vocabulary, invent service aliases, publish workers or store spoken text. User-facing Google/Android UI and actual category/pilot inventory remain founder-gated. Check [Status](docs/STATUS.md) and CI evidence.

**Hard language decision (2026-10-27): ONLY Hindi in Devanagari and English are supported.** No Hinglish, Romanized Hindi or mixed-script natural-language matching, regardless of old Finworkar support or prior drafts. See [ADR-0008](docs/decisions/0008-hindi-english-only.md).

## Safe request transaction rehearsal (backend tests only, 2026-10-27)

An ephemeral two-connection SQLite test journal rehearses optimistic revision control, request retry receipt uniqueness, rollback and owner revalidation using **synthetic requests**. The pure request contract rejects stale/future receipts. This is not a new booking/worker API, not a D1 migration, not production-grade distributed concurrency, nor a founder-approved request lifecycle. Hindi and English only (ADR-0008); see [Status](docs/STATUS.md) for CI.

**Verified request-safety tests:** [PR #27](https://github.com/rekixo-lab/jodlo/pull/27) merged as `68d89e593fa34760aec1af9a04c8c64f11360590`; [main GitHub Actions #40495912363](https://github.com/rekixo-lab/jodlo/actions/runs/40495912363) **SUCCESS** on the exact commit (93/93 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Wrangler dry-run bundles). This is local disposable SQLite atomicity rehearsal, not production Cloudflare D1 request storage or an approved booking workflow.

## Worker visibility guard (pure local test only, 2026-10-27)

JODLO rehearses how to avoid unintentionally disclosing draft/unpublished/inactive/moderated worker services via a new tiny internal allowlist projection. Existing worker opt-in stays a private `draft` enforced by D1 CHECK constraint; no public worker/listing API or real workflow is created. See [Status](docs/STATUS.md), founder M-003/M-005 and only Hindi+English ADR-0008.

**Verified worker draft privacy tests:** [PR #29](https://github.com/rekixo-lab/jodlo/pull/29) merged as `f4009f3b207d3ab828b4b0a1738163233bd81f7c`; [main GitHub Actions #40497728947](https://github.com/rekixo-lab/jodlo/actions/runs/40497728947) **SUCCESS** on that exact commit (102/102 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Worker dry-run builds). No public listing route or worker status beyond `draft`. See [Status](docs/STATUS.md) and [source behavior reference](docs/LEGACY_FINWORKAR_BEHAVIOR.md).

## CI founder gate audit (backend, local only)

`npm run founder:check` rejects accidental expansion of public worker/request routes, new operational D1 tables, worker draft publishing, extra language locales and remote Wrangler deployment commands while founder decisions M-003/M-005/M-007 are not approved. It is a lightweight static tripwire and not a comprehensive security audit. Synthetic fixtures run in `npm test`. See [Status](docs/STATUS.md) and [Manual Actions](docs/MANUAL_ACTIONS.md). No new user-facing features or deployment.

**Verified no-dependency founder gate checks:** [PR #31](https://github.com/rekixo-lab/jodlo/pull/31) merged as `812ec39f51b70ce10564c4396cd7824b8caf78e5`; [main GitHub Actions #40501136670](https://github.com/rekixo-lab/jodlo/actions/runs/40501136670) **SUCCESS** on the exact commit (111/111 Node tests, docs/design/founder no-dependency checks, local D1 migrations, TypeScript strict and both Wrangler dry-run bundles). It is defense-in-depth against accidental source expansion, not complete security, owner approval or deployed service.

## Safer existing logout and next marketplace decision

Current code is improving per-token and all-devices session revocation using a single conditional database write with duplicate retry safety; no new endpoints, storage or Cloudflare deployment. The founder allowed development to continue but did **not** select pilot service categories or real publication/contact/privacy policy. See [M-005 proposal](docs/M005_DECISION_PROPOSAL.md). Hindi and English only, no Hinglish.

**Latest verified atomic logout / M-005 proposal checkpoint:** [PR #33](https://github.com/rekixo-lab/jodlo/pull/33) merged as `5d7906e96cd71d7f104fcb58098ea5547b6b098b`; [main GitHub Actions #40504504583](https://github.com/rekixo-lab/jodlo/actions/runs/40504504583) completed **SUCCESS** on that exact commit (119/119 Node tests, docs/design/founder checks, local D1 migrations, strict TypeScript and both Wrangler dry-run Worker builds). Owner's broad go-ahead does not set real pilot city/categories, public worker trust labels, contact flow or retention; [decision proposal](docs/M005_DECISION_PROPOSAL.md) is pending specific choices.

## Founder-approved instant worker service listing (backend-only)

Workers with an existing private opt-in can **immediately self-publish one category-only service listing per approved active category**, without earning a verification badge. Existing worker profile stays private `draft`, public `GET /api/v1/listings?categoryId=...` exposes only opaque listing ID/category ID and moderators can hide the row; authenticated owner can publish/unpublish. No real pilot categories seeded or personal address/phone/GPS/price/media fields. [ADR-0009](docs/decisions/0009-instant-service-publication.md) records this decision. Other M-005 pilot rules and M-003 privacy remain pending; no UI/cloud deployment.

**Verified auto-public listing implementation:** [PR #35](https://github.com/rekixo-lab/jodlo/pull/35) merged as `2668fc2a6e59c0b8e87871c4def1c4e2dc847a06`; [main GitHub Actions #40514179945](https://github.com/rekixo-lab/jodlo/actions/runs/40514179945) completed **SUCCESS** on that exact main SHA (128/128 Node tests, docs/design/founder gate checks, local D1 migrations 0001–0004, strict TypeScript and both Wrangler dry-run Worker bundles). Only active-category minimal IDs are public, and no worker verification, real category seeding or Cloudflare deployment occurred. Other M-005/M-003 product/privacy decisions remain open.

## Historical Finworkar categories available as read-only reference

Founder-provided complete legacy Firestore catalog is safely archived: original JSON in private ChatGPT Library; all 8,390 records in compact Hindi/English-only [GitHub gzip reference](docs/reference/data/finworkar-catalog-bilingual-2026-10-27.json.gz); see [full catalog audit](docs/reference/FINWORKAR_CATALOG_AUDIT_2026-10-27.md). `npm run reference:check` verifies data integrity without Firebase access. It does **not** activate any old categories, set the pilot city, transfer personal data or permit extra languages. Existing worker instant self-publication requires approved active JODLO category only; no auto verified badge. Old Finworkar read-only.

## Founder-selected pilot city names (2026-10-27)

**Bilaspur / बिलासपुर** and **Raipur / रायपुर** were chosen as the two pilot city names (see [ADR-0010](docs/decisions/0010-bilaspur-raipur-pilot-city-names.md)). This is nonpersonal planning only, not a geofence, location consent, active category seed, customer request workflow or production launch. [10 curated category candidates](docs/reference/JODLO_PILOT_TAXONOMY_PROPOSAL_2026-10-27.md) remain pending founder selection. The existing `npm run reference:check` validates the tiny city-name manifest and the legacy catalog without deploying anything. Immediate worker self-publication for separately approved categories remains allowed without any automatic verified badge.


**Nonvisual Kotlin Repository Layer (2026-10-28):** [Android Core](apps/android/README.md) now has separately injected Catalog and Worker repository interfaces, strict typed backend response coherence, explicit Category selection for posting, and fake-network Kotlin tests. No Android screen or APK, actual Google mobile login, personal GPS or approved active historical Categories are implied.

**Session state (2026-10-28):** The [headless Kotlin Android core](apps/android/README.md) now has in-memory expiry, draft-only worker state and local-first logout with stale-response isolation. No APK or live Google mobile integration exists.

## 2026-10-29 — All-Service Category reviewer detail (non-public, CI pending)

The 889 historical Categories in 45 original review packets now have an **optional complete 7,267-Service evidence view** (`npm run catalog:full-service-evidence -- --packet=1` or `--category=OLD_ID`). This preserves original bilingual labels, source lineage and conflicting cross-Category phrase parent choices for qualified review—not public synonyms, live D1 seeds, translation approval, or permission to activate regulated work. See [Service reviewer guide](docs/reference/JODLO_CATEGORY_HUMAN_REVIEW_PACKETS_2026-10-28.md). All founder M-003/M-004/M-005/M-007/M-008 restrictions still apply; no deployment.

## 2026-10-29 — Offline all-work editorial and safety exception register (pending CI)

The existing all-889 Category / 7,267 Service review now has a single source-locked diagnostic exception register: `npm run catalog:exceptions -- --summary`, `--issues`, `--issue=HINDI_SERVICE_LATIN_SCRIPT`, `--packet=1` or `--category=OLD_ID`. Every source Category remains included, even if no mechanical exception was detected. Original archived safety tiers are evidence, **not** JODLO risk approval. The first 17 scope assessments remain preliminary desk opinions (10 narrow recommendations, 4 extra reviews, 3 specialist holds), **not** an activation list. See [complete exception runbook](docs/reference/JODLO_FULL_CATALOG_EXCEPTION_REGISTER_2026-10-29.md). All actual legal/occupational, bilingual editorial, mapping, contact/moderation and founder M-005 approvals are pending; no alias seed, UI, Cloudflare release or Finworkar change.

## 2026-10-29 — Complete historical bilingual Service correction intake (CI pending)

For human editorial corrections to any original Service within **all 889 Category/45 review packets**, run `npm run catalog:service-corrections -- --packet=1` to create a source-hashed, nonauthorizing proposal JSON and validate it with `--validate-file=PATH`. Proposed Hindi/English names and original ambiguous Category choices remain reviewer evidence only; no auto-translation, alias import, user-facing UI, published Service or Category activation. See [Service correction runbook](docs/reference/JODLO_ALL_SERVICE_CORRECTION_EVIDENCE_2026-10-29.md). All independent M-003/M-004/M-005/M-007/M-008 founder gates remain.

## 2026-10-29 — All-45 Service correction proposal collision reconciliation (PR pending)

New offline-only `scripts/catalog-service-cross-packet-reconcile.mjs` combines **exactly 45** source-fingerprinted Service editor proposal packets, covering all **889 original Categories and 7,267 historical Services** (ADR-0011; never a ten-category restriction). It reuses `validateServiceCorrectionPacket` for each packet, rejects missing, duplicated, reordered, source-tampered/forged-approved records, untrusted local directories/files/symlinks and out-of-root paths, and compares proposed Hindi/English phrases in **separate locales** against (a) other original parent Categories, (b) other proposals in the same packet, and (c) other proposals across different packets. Same-Category repeated phrases are not incorrectly classified as cross-trade. **All collisions remain UNRESOLVED HUMAN REVIEW DIAGNOSTICS**, not auto-picks, approved terms or forbidden editorial proposals. Reviewers can run `npm run catalog:service-reconcile -- --check` or `--directory=.local-category-review/services`. See [review runbook](docs/reference/JODLO_ALL_SERVICE_CORRECTION_EVIDENCE_2026-10-29.md). No category/Service approval, true language certification, occupational/legal signoff, SQL, seeds, public aliases, UI, location, Cloudflare deploy or Finworkar mutation. Founder-approved full work breadth stands; M-003/M-004/M-005 final mapping/legal/scope/contact/moderation/M-007/M-008 remain independently gated. Require green exact PR-head AND separately merged-main CI.

## 2026-10-29 — All-trade Search cursor pagination (PR pending)

Added a strictly opt-in, backward-compatible **keyset Search** path to `GET /api/v1/catalog/search?q=...&cursor=1&limit=25`, with optional `after=sortOrder:categoryId`. This removes the **old Search offset 100 depth limit only for cursor-mode callers**, so customers/workers can find *every already independently approved active matching Category*, rather than only the first 125 broad matches. Old Search still returns `nextOffset`; cursor requests return `nextCursor` and no offset. Same public-only D1 active filter, existing worker eligibility `availableOnly=1`, only Hindi or English, bound SQL and no contact, area, worker count, verification badge, auto-disambiguation or auto-publication. Strict parser rejects mixed `cursor`+`offset` or `cursor`+`includeChoices`, malformed cursors, unsupported locale and repeated inputs. A local synthetic **889 active fixture** verifies complete keyset traversal, without seeding or approving ANY of the historical 889 Categories/7,267 Services. Existing headless Kotlin Search stays on the old compatible route; future opt-in client work needs separate nonvisual tests and M-004 before visual UI. [Search cursor reference](docs/reference/JODLO_ALL_CATEGORY_SEARCH_KEYSET_2026-10-29.md). Founder ADR-0011 full legitimate-trade coverage remains binding; M-003 location/retention, M-004 UI, M-005 human legal/safety/translation/final ID/contact/moderation, M-007 no remote deployment and M-008 OAuth remain unchanged. Run `npm test`, `npm run typecheck`, exact PR CI then independent main CI. No real activation, Cloudflare staging, remote D1, sensitive data or Finworkar write.

## 2026-10-29 — Kotlin opt-in exhaustive Catalog Search cursor (PR pending)

Founder again authorized **continuing engineering across all kinds of work**, consistent with binding ADR-0011 full **889 historical Category / 7,267 Service review scope** and the rejected ten-trade cap. This general authorization is NOT evidence of separate specific M-003 privacy/area terms, M-004 visual design, M-005 human bilingual/occupational/legal review and concrete activation/contact/moderation policy, M-007 production release or M-008 provider credential configuration; those gates still apply.

Nonvisual Kotlin Core now implements `JodloRoutes.searchCursor`, distinct `CatalogSearchCursorPage` strict JSON decoder, opt-in `CatalogSearchCursorRepository` implemented by the existing `RemoteCatalogRepository`, and compiled JVM regression tests. The new server cursor Search can traverse **all synthetically active 889 matching Categories over 36 bounded 25-row fake-network pages** in Kotlin, while old `CatalogRepository.search` and ambiguity/offset DTOs stay unchanged. Cursor mode rejects invalid/forged private response fields, missing or stale cursors, echoed wrong query/language, partial continuation and offline failures. Real worker publishing remains explicit and separately authorized; no automatic Category choice, alias, source-889 D1 seed, UI, personal data, actual Google provider, Cloudflare staging/deployment or Finworkar write. See [Kotlin cursor contract](docs/reference/JODLO_KOTLIN_SEARCH_CURSOR_2026-10-29.md), [backend Search cursor contract](docs/reference/JODLO_ALL_CATEGORY_SEARCH_KEYSET_2026-10-29.md). All manually gated design, safety, privacy and release decisions remain outstanding. Verify exact PR-head and independent merged-main Kotlin + Worker CI success before declaring tested.

## 2026-10-29 — Cursor Search on the headless Customer pagination state machine (PR pending)

The already-implemented Worker `cursor=1` all-active-Category Search and Kotlin `CatalogSearchCursorRepository` now connect to the existing headless `HeadlessCatalogPaginationScope` via **explicit** `startCursorSearch` / `nextCursorSearch`, separately from legacy `startSearch` / `nextSearch` with first-page human ambiguity choices and offset<=100. The same monotonic freshness, cooperative race cancellation, worker-write refresh barrier, user-selected exact Category and no implicit network/worker publication rules apply. Cursor-mode request intent is nonpersonal, is restored without a GET, and retries page ONE after error/expiry; old fake `CatalogRepository` without cursor capability stays usable. One request returns at most 25 rows; user-triggered continuation is capped at 1,000 pages, enough for 889 legitimate Categories at limit=1 when independently human-reviewed and made active. Real compiled Kotlin pagination tests cover synthetic 889 active records over 36 pages, duplicate/fake cursor failures, mode separation, no hidden Search calls, explicit selection, restore, TTL, worker write barrier and stale reply races. [Integration runbook](docs/reference/JODLO_HEADLESS_CURSOR_PAGINATION_2026-10-29.md) and [underlying Kotlin protocol](docs/reference/JODLO_KOTLIN_SEARCH_CURSOR_2026-10-29.md) explain limits. Historic original 889/7,267 are NOT seeded, classified safe, activated or rendered. User's generic approval to continue all valid trades **does not** itself establish separate legal/occupational/bilingual human review, exact M-005 live IDs, M-003 privacy, M-004 UI, M-005 contact/moderation, M-007 remote release, M-008 OAuth setup. No Cloudflare staging/deploy, client PII or Finworkar change. Verify PR and independently merged-main CI.

## 2026-10-29 — All-889 Category / 7,267 Service occupational scope human draft intake (PR pending)

Added `scripts/catalog-service-scope-intake.mjs` for **all 45 source-locked packets**, not just 17 early M-005 desktop examples or 10 proposed trades. `npm run catalog:service-scope -- --packet=N` exports every original Service ID/parent/English-Hindi name and source SHA to an offline, gitignored per-Service *draft* editor. Human reviewers may propose **six separately written bilingual scope fields**: work included, work excluded and qualifications/prerequisites; explicit unverified concern codes and a syntactically valid JODLO PR evidence URL may accompany a submitted draft. `--validate-file=REPO_RELATIVE_JSON` rejects missing/reordered source rows, changed flags or parents, invalid locale text/mixed script, forged approval, bad evidence URL, oversized/symlink/out-of-repo files and unsupported risk statements. An unsubmitted leaf cannot carry a silent proposal. The CLI `--check` verifies full **889 Categories and 7,267 original Services** with zero authorizations. [Occupational scope runbook](docs/reference/JODLO_SERVICE_OCCUPATIONAL_SCOPE_INTAKE_2026-10-29.md). This is neither a legal/safety classifier nor an authenticated qualified human signoff, does not solve semantic naming or confirm qualification. M-005 final service legal/safety/translation scope, founder Category activation/contact/moderation policy, M-003 area/privacy, M-004 visual UI, M-007 production and M-008 OAuth remain independently pending. No public aliases, DB seeds, SQL, Cloudflare deploy, Android UI, personal data or Finworkar writes. Enforced by new `npm test` and `reference:check` regressions; require successful exact PR-head + separate merged-main CI before claiming complete.

## 2026-10-29 — Unified all-trade human review crosswalk (PR pending)

Added OFFLINE-only `scripts/catalog-unified-human-review.mjs` (and regression suite) to join the three existing source-locked human review evidence streams: 45 full **Category ID/slug/Hindi/English** correction packets, 45 full **Service Hindi/English label** packets and 45 full **Service occupational inclusion/exclusion/qualification** scope packets, alongside source-validated full-889 diagnostic exceptions. Its default `--check`/`--summary`/`--packet=N`/`--category=ORIGINAL_ID`/`--all` paths retain **all original 889 Categories and 7,267 Services**, including 872 not desk-assessed (prior 17 opinions/10 samples are NOT launch limits). `--review-root=REPO_RELATIVE_PATH` loads EXACTLY 135 real offline category/service-name/service-scope files, with source and hash checks, wrong/extra/missing row rejection, symlink/traversal protections and all existing per-stream language/ID/uncertain-evidence validators. Result joins draft counts, incomplete one-sided Name/Scope handoffs, original diagnostic flags, specialist concerns and unresolved cross-parent phrase collisions by exact original ID, without automatic parent selection, translation, credential certification or contact. A missing name draft is not necessarily an issue requiring a new name. **All 889/7267 remain subject to human safety/editorial/legal review and all authorization/SQL/alias/activation counts stay zero**, even if evidence URLs exist. See [unified review runbook](docs/reference/JODLO_UNIFIED_HUMAN_REVIEW_QUEUE_2026-10-29.md). Registered in `npm test` and `reference:check` with strict root/packet tamper test coverage. Founder-approved breadth is NOT approved Category IDs/regulated work or a permission to bypass M-003 area/privacy, M-004 visual design, M-005 actual human signoffs/contact/moderation, M-007 no remote deployment or M-008 real OAuth. No live D1 seed, Cloudflare staging, Android UI, PII or Finworkar changes. Verify exact PR-head and independent merged-main CI before claiming tested.

## 2026-10-29 — All-889 Category / 7,267 Service attention-order human review queue (PR pending)

**ADR-0011 scope unchanged:** never impose a ten-trade product cap. Added OFFLINE-only `scripts/catalog-review-triage.mjs`, driven by the already source-checked unified 135 packet evidence streams and the historic 889/7,267/45 review scope. Every original Category appears exactly once in deterministic **reviewer attention** order: previously specialist-held desk opinion, submitted unverified specialist concern/desk-extra-review, cross-Category ambiguous phrase, source and editorial repair, or mandatory baseline human review. These are NOT computed safety scores, occupational/legal classifications, Category eligibility or decisions to skip work. All 872 not-desk-assessed Categories remain in scope, and the 17 prior opinions/10 sample recommendations do not count as signoffs. Each packet summary preserves all Service counts; original IDs, bilingual labels, historic source diagnostics, flagged Service IDs, unverified concern counts, missing name/scope draft handoffs and phrase collisions remain visible. CLI `--summary`, `--packets`, `--packet=N`, `--lane=CODE`, `--all` and optional `--review-root=REPO_RELATIVE_PATH` are read-only and source-locked. [Triage runbook](docs/reference/JODLO_REVIEW_ATTENTION_ORDER_2026-10-29.md). Compiled source guard `npm test` and `reference:check` are extended; verify PR-head and independent main CI before declaring complete. ZERO human/founder certification, Category/Service activation, aliases or SQL. M-003 area/privacy, M-004 visual design, M-005 qualified human occupational/legal/bilingual/final ID/contact/moderation, M-007 no remote staging/deploy and M-008 live OAuth remain independent. No personal data, production or Finworkar changes.

## 2026-10-29 — Complete offline reviewer action cards and progress ledger (PR pending)

ADR-0011 all-889 Category and 7,267 Service breadth is preserved. Added `scripts/catalog-human-review-progress.mjs` to materialize **45 local source-locked reviewer work packets, 889 original Category cards, 2,667 explicit tasks (human English+Devanagari editorial, qualified occupational/legal Service scope, Category mapping and ambiguous parent review)** from the existing deterministic human triage. Each task starts `NOT_STARTED`; allowable self-reported states are `SELF_REPORTED_IN_PROGRESS`, `EVIDENCE_LINKED_UNVERIFIED` and `SPECIALIST_HANDOFF_PENDING`, with JODLO PR links checked **for syntax only**, never for reviewer identity or signoff. `--template-packet=N` generates an editable offline packet; `--progress-root=REPO_RELATIVE_PATH` reads exactly 45 source-locked `review-progress-NN.json` files, with optional `--review-root` to bind them to the 135 existing Category/Service evidence files; `--summary`/`--packet=N`/`--all` report incomplete work. A stale source/evidence fingerprint, extra/missing task/Category, false `APPROVED` status, forged reviewer ID, symlink/path escape, invalid link or oversized JSON is refused. The worklist cannot store private reviewer identity, customer/worker PII or approve final Category IDs. **Every original Category and Service still needs independent qualified human review, zero authenticated signoffs, zero Category/Service activation, zero SQL or aliases** even if every task has a PR URL. The 17 prior desk opinions/10 suggestions never limit all-trade coverage. [Local progress guide](docs/reference/JODLO_HUMAN_REVIEW_PROGRESS_2026-10-29.md). New tests are wired into `npm test` and `reference:check`. M-003 area/privacy, M-004 UI/design, M-005 human/legal/linguistic/final mapping and first-contact/report/moderation, M-007 no remote deploy and M-008 OAuth remain pending independently. No live DB seeds, UI screens, personal information, Finworkar edits or Cloudflare deployment.

## 2026-10-29 — All-trade unresolved reviewer evidence dossier (PR pending)

ADR-0011 all **889 original Categories / 7,267 original Services / 45 review packets / 2,667 pending human tasks** remain in scope, no ten-trade limit. Added offline **`scripts/catalog-human-review-evidence-audit.mjs`** as a source-fingerprint-locked read-only CASE AUDIT. It reuses the existing three 135-packet Category/Service name/Service occupational scope evidence streams, original source diagnostics, five-lane reviewer attention queue and 45 progress packets. It joins every original Category with its source flags, incomplete Service Name/Scope handoffs, unverified specialist concerns, unresolved cross-parent phrases, unverified mapping/name/scope drafts and separately identified self-reported reviewer task states; URLs are **only syntactic JODLO PR/PR-comment references**, not checked for existence, authenticity, qualified identity or actual signoff. A shared reference across Categories is a review-context hint, not automatically an invalidation. `--check`/`--summary`/`--packets`/`--packet=N`/`--category=ORIGINAL_ID`/`--flag=CODE`/`--all` and optional real local `--review-root=REPO_RELATIVE` plus `--progress-root=REPO_RELATIVE`; strict 45/889/7267/2667 alignment, invalid evidence, stale progress, false approval and forged source refusal. [Evidence audit runbook](docs/reference/JODLO_HUMAN_REVIEW_EVIDENCE_AUDIT_2026-10-29.md). New tests integrated into `npm test` and `reference:check`. **Zero authenticated legal/occupational/bilingual/founder approval, zero categories/services authorized, zero aliases/SQL**, even with links. M-003 area/privacy, M-004 visual design, M-005 actual qualified human evidence adjudication/final Category IDs/contact/moderation, M-007 no remote deploy, and M-008 real OAuth remain gated. No PII, Cloudflare staging, visual UI, original-source seed or Finworkar writes. PR-head and independent merged-main CI required to call complete.

## Full-coverage worker's own listings (2026-10-29 engineering slice, PR pending)

The existing authenticated `GET /api/v1/me/listings` keeps its original 100-row `{listings}` contract for backward compatibility. A proposed optional nonvisual `?limit=1..25&after=LISTING_ID` keyset reader lets a worker explicitly page through more than 100 listings across **already independently approved active Categories**. The server binds and verifies ownership of both results and continuation anchor, returns only original `id,categoryId,visible` owner fields (plus `nextCursor` only in opt-in mode), and keeps hidden/unpublished rows privately manageable without making them public. Synthetic 889-row tests exercise full breadth without activating any historical source Category or Service. No UI, location/phone, cloud deployment, real OAuth, final occupational signoff or Finworkar changes. PR-head and post-merge main CI must pass before calling this delivered.
