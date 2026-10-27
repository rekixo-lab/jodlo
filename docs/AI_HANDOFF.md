# JODLO — Complete AI handoff and source-of-truth index

> **READ FIRST — superseding founder decision (2026-10-27): code-first, no staging Worker, no deployment until JODLO fully ready.** Keep all integration work local/mock-based + CI, ask for no Cloudflare credentials now, then request a controlled production-only release. Old staging deployment instructions below are obsolete. [ADR-0004](decisions/0004-local-first-no-staging-until-production.md) · [Release Readiness](RELEASE_READINESS.md).


**Last documentation consolidation:** 2026-10-27 (India). **Mode:** source/planned architecture + local scaffold. **Legacy:** strictly read-only. **This is not a production service.**

## New hard founder directive — code reuse, premium theme, smooth animation (2026-10-27)

**Hard rule:** Every future engineer/AI must search for/reuse matching existing tested code, UI components, contracts and media rather than copy-pasting. Delete unused/duplicate code and asset files. Localized strings and one approved semantic Material 3 theme/source of truth for attractive colors, type, corners, strokes, spacing, elevation and motion; no repeated hardcoded screen styles. Create reusable composables on real needs, not heavy premature abstraction.

**Required premium visuals:** subtle professional depth, beautiful highly responsive animated tabs, navigation transitions, press/gesture feedback, state changes and selected high-value 3D/2.5D. Use light draw/layer animations, support reduced-motion/static fallback, TalkBack and low-end performance/battery. Real 3D engine only if founder approves and benchmarks support it. **UI design/palette/animation specifics still require founder review BEFORE implementation.** No Android UI has been built yet.

**Verified quality milestone:** mandatory reuse/theme/motion requirements and preventive guard merged via [PR #5](https://github.com/rekixo-lab/jodlo/pull/5), with [GREEN main CI 40470523692](https://github.com/rekixo-lab/jodlo/actions/runs/40470523692) on commit `e6982c49d94522abdb257e1bc0b5c8f0ec4b75e1`. All current tests green; no Android UI yet. Current-head CI must be rechecked with any new commit.

**Read/obey:** [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md), [Reuse Assets](REUSE_ASSET_POLICY.md), [Design System](DESIGN_SYSTEM.md), [Motion 3D](MOTION_3D.md). CI will include `design:check` and synthetic tests; future device performance gates remain pending. Cloudflare deployment remains delayed until finished code.

## What we are building
A new, independent, responsive local-work/services platform **JODLO**, focused on actual local matching and verified customer-worker contact/outcomes rather than installation counts. Founder's requirements: native Android, low-end-device performance, Hindi + English ONLY UX (NO Hinglish/Romanized Hindi), modularity, clear architecture, minimal unnecessary dependencies/schedulers, Cloudflare-first, future changes without big rewrites, and manual owner gates clearly identified.

**Fixed names:** GitHub `https://github.com/rekixo-lab/jodlo`; Android `com.rekixo.jodlo`; planned website `https://jodlo.rekixo.com`. Old Finworkar uses different package/infrastructure and will not be renamed/migrated/modified.

## Firm decisions vs only proposed architecture
| Level | Detail | Constraint |
| --- | --- | --- |
| **Owner decided** | New greenfield JODLO. Legacy preserved unchanged. | No old secrets, client data, wallets or payment credentials migrated. |
| **Owner decided** | Cloudflare-first infrastructure, native Android. | Device runtime/FCM and possibly RTC/checkout are external platform concerns. |
| **Owner decided** | Speed, lightweight components, easy future modifications. | Avoid sprawling Activity classes, all-in-one route handlers, needless background jobs. |
| **Owner decided** | Google Pay India/UPI preferred, *no port of legacy Razorpay*. | Digital goods in Play app must follow Google Play Billing or valid eligible alternative. Payment module is **not implemented**. |
| **Owner decided** | Ask owner **before implementing UI**; owner may suggest design. | Store graphics/videos likewise approved. |
| **Architecture proposal** | Single modular Cloudflare Worker API/TypeScript, `/api/v1`, D1 indexed relational storage, private R2, Queues for async and DO only when needed. | Bind/activate services only after schema/privacy/cost review. |
| **Architecture proposal** | Single-Activity Kotlin app; screens/ViewModels/StateFlow and domain/repository abstractions; Compose is a proposed toolkit. | Screen flows, navigation, theme and UI require separate founder review. |
| **Architecture proposal** | FCM for Android notification transport, RTC provider independently evaluated. | No assumption Cloudflare Worker HTTP handles audio media. |
| **UNDECIDED** | First city/categories, customer job-request feature, identity provider/OTP, independent identity verification, calling provider, exact billing programs, D1 capacity/residency. | Record decision and evidence before related work. |

## One-screen architecture diagram
```text
  Google Play -> Native JODLO Android (Kotlin, com.rekixo.jodlo)
                                      |
  jodlo.rekixo.com (Cloudflare web) --+--> HTTPS JSON /api/v1
                                              |
                       Cloudflare edge security/rate limiting
                                              |
                   API Worker (TypeScript modular monolith)
                          | identity/worker/catalog/listings/discovery
                          | contacts/media/moderation/calling/payment adapters
                          |
                     D1 (later) --- R2 private media (later)
                          |               |
                         Queue events/retry/DLQ (when needed)
                          |
                    External adapters: FCM, RTC media provider,
                         Google Pay India/PSP or Play Billing
```
The currently implemented local API includes `GET /api/v1/health` and a public read-only D1-backed `GET /api/v1/catalog` behind an optional local D1 binding. Without D1 the catalog fails closed with HTTP 503. Neither endpoint is deployed.

## Explicit code/module design
- Backend: [`CLOUDFLARE_INFRASTRUCTURE.md`](CLOUDFLARE_INFRASTRUCTURE.md), [`MODULE_BOUNDARIES.md`](MODULE_BOUNDARIES.md).
- Android structure & Activities: [`ANDROID_STRUCTURE.md`](ANDROID_STRUCTURE.md). **No real Android app created yet.**
- Database design & indexed search: [`ARCHITECTURE_RESEARCH_20261027.md`](ARCHITECTURE_RESEARCH_20261027.md) (proposed tables only, not migrated).
- Calls/payment event states and security: research plus [`PAYMENTS.md`](PAYMENTS.md).
- Legacy mapping and keep/rebuild/remove matrix: [`reference/LEGACY_MAPPING.md`](reference/LEGACY_MAPPING.md).
- Performance targets are aspirational and must be measured. No real load/device tests or Cloudflare invoices have been measured.

## Verified legacy source snapshot (read only)
| Repository | `main` commit observed at audit | Structural evidence |
| --- | --- | --- |
| `rekixo-lab/finworkar-android` | `0ad9ddd230439f76da363c6bbacdddb35288704f` | 549 file blobs; 155 Java/Kotlin package files; 354 res files; HomeActivity ~2472 LOC; GuidedAddPostActivity ~3508; CallService ~2254. |
| `rekixo-lab/finworkar-backend` | `f31d089953f68868108f5d475436842b55c10204` | 126 blobs; ~73 function feature source files; 71 composite Firestore indexes, 39 overrides; Firebase Functions and periodic maintenance. |
| `rekixo-lab/Finworkar-web` | `3b4e7ce3d5d7a2cab244fedef43be4728b913823` | 31 files; static Firebase Hosting/privacy/share pages. |

These snapshots do NOT prove deployed version, spend or traffic. This evidence and why it informs JODLO live in [`ARCHITECTURE_RESEARCH_20261027.md`](ARCHITECTURE_RESEARCH_20261027.md).

## Initial known implementation status
- Local scaffold includes `apps/api/src/index.ts`, HTTP router, system health module and tests. No login, profiles, listings, payments, *live* database or remote deployment exists; the first local-only public-category D1 migration and binding-backed catalog reader now exist.
- Latest local run on 2026-10-27: `npm run check` passed (**20 required docs, 90 local Markdown links, 7/7 Node unit tests, strict TypeScript check**). This does NOT establish GitHub green CI or Cloudflare deploy; new sessions must rerun against their actual checkout.
- **Resolved on 2026-10-27:** GitHub connector read/write works. Foundation PR #1 **merged into main** with 38 files. Main CI [run 40466265299](https://github.com/rekixo-lab/jodlo/actions/runs/40466265299) = SUCCESS. This supersedes the previous 403/empty local-archive findings.
- Existing `jodlo.rekixo.com` is a planned address; not confirmed routed/live. No Cloudflare provisioning has been executed.
- Follow [`STATUS.md`](STATUS.md) for current status (this handoff may become older).

## Read / act protocol for the next AI
**MANUAL-GATE mandatory reminder:** Before any new JODLO work, consult [Manual Actions](MANUAL_ACTIONS.md) for stable M-IDs, trigger, blocker, owner decision and next independent task. When genuinely required, directly tell founder in the *active* chat exactly what is needed, why, and what's blocked; do not silently wait or assume unspoken approval. Persist completed decisions and proof in repo after tests/PR/CI. A normal chat does not send spontaneous background messages. **M-001 DONE (2026-10-27):** founder approved one shared account with worker opt-in; see [ADR-0006](decisions/0006-shared-account-opt-in-worker.md). M-002 real identity provider and M-003 location/privacy remain upcoming. No real identity PII or visual UI without their gates. No Cloudflare or UI approval request until appropriate trigger.

1. Open [`AGENTS.md`](../AGENTS.md) then this handoff; also read the [`README.md`](../README.md), [`STATUS.md`](STATUS.md) and [`ROADMAP.md`](ROADMAP.md).
2. Confirm current repo branch, files, latest code and GitHub Actions before editing. If source differs, record what changed.
3. Work in smallest reviewable step. Document the technical reason and compatibility consequences. Keep old Finworkar untouched.
4. Run available local tests, typecheck and documentation link check; **GitHub green requires real remote success**, not local results.
5. Ask founder for required manual actions one at a time. Never ask for secrets or private customer records.
6. **Before visual UI:** demonstrate a concrete planned flow/wireframe/options and ask founder for their suggestions/approval. For Play Store, propose storyboard/screenshot list first; use only real truthful final build screens.
7. Write back decisions in ADRs; append concise progress to [`STATUS.md`](STATUS.md). If repository push is blocked, deliver an updated ZIP and say so.

## Exact first blockers / next tasks
**Current status 2026-10-27:** Foundation PRs #1/#2 merged to GitHub main; latest earlier green run [40466624240](https://github.com/rekixo-lab/jodlo/actions/runs/40466624240). The owner now **forbids early deployment and does not want staging**; staging config/workflow were removed by merged PR #3; [green main run 40468562575](https://github.com/rekixo-lab/jodlo/actions/runs/40468562575) verified. Only local health API exists yet, no Android UI, live D1/R2, payments or RTC, and `jodlo.rekixo.com` remains unconfigured. Next: local D1 schema/migrations and typed backend, then Android implementation with UI approval; all external Cloudflare/merchant setup deferred until final production launch.

## Living documents checklist
- [`PROJECT.md`](PROJECT.md) — mission, founder operational agreement.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — short topology, API/data/security principles.
- [`CLOUDFLARE_INFRASTRUCTURE.md`](CLOUDFLARE_INFRASTRUCTURE.md) — service choice and binding/deployment details.
- [`ANDROID_STRUCTURE.md`](ANDROID_STRUCTURE.md) — single Activity, feature state and suggested package/files.
- [`MODULE_BOUNDARIES.md`](MODULE_BOUNDARIES.md) — service dependencies, handlers, repositories, contracts and later modules.
- [`ARCHITECTURE_RESEARCH_20261027.md`](ARCHITECTURE_RESEARCH_20261027.md) — evidence-rich source-to-target audit.
- [`PAYMENTS.md`](PAYMENTS.md), [`decisions/0002-google-pay-and-play-billing.md`](decisions/0002-google-pay-and-play-billing.md) — payment policy and decision.
- [`ROADMAP.md`](ROADMAP.md), [`MANUAL_ACTIONS.md`](MANUAL_ACTIONS.md), [`STATUS.md`](STATUS.md), [`TESTING.md`](TESTING.md) — execution and evidence.
## Completed merged local catalog database foundation (2026-10-27)

The first independently reviewable database change adds `infra/migrations/0001_public_catalog.sql`, `GET /api/v1/catalog?lang=en|hi`, a local-only D1 Wrangler binding (placeholder UUID, never deploy), index/constraints and Node SQLite/fake D1 tests plus a CI local migration step. It intentionally does **not** assume final user roles, OTP/auth provider, service taxonomy, city boundaries or personal-location policy. **New code verification:** **Merged catalog milestone:** [PR #7](https://github.com/rekixo-lab/jodlo/pull/7) squash-merged as `dd16db9`, verified [green main GitHub Actions #40473524328](https://github.com/rekixo-lab/jodlo/actions/runs/40473524328) on `dd16db92a1e04b2e40237bc440ab0a062039f5ea` (19 Node tests, local-only Wrangler D1 migration, local and normal Worker dry-run builds, strict TS, docs/design checks). No Cloudflare/Android deployment. Next: approve actor/auth/area/deletion contract then implement D1 accounts/workers/listings and authorization tests. No UI or remote deployment.

### Latest repository resume point
**Merged catalog milestone:** [PR #7](https://github.com/rekixo-lab/jodlo/pull/7) squash-merged as `dd16db9`, verified [green main GitHub Actions #40473524328](https://github.com/rekixo-lab/jodlo/actions/runs/40473524328) on `dd16db92a1e04b2e40237bc440ab0a062039f5ea` (19 Node tests, local-only Wrangler D1 migration, local and normal Worker dry-run builds, strict TS, docs/design checks). No Cloudflare/Android deployment.
**Next independent engineering slice:** specify actor types, identity provider, area model, privacy/retention and deletion before creating user/worker/listing schema. Founder approval still gates all visual UI. No remote Cloudflare resources or staging.

## Founder-approved M-001 + local identity/worker draft slice (2026-10-27)

**Explicit user approval:** one shared JODLO account for customer use and optional worker enrollment, never separate credentials per role. [ADR-0006](decisions/0006-shared-account-opt-in-worker.md) and [manual register](MANUAL_ACTIONS.md) are authoritative; **M-001 DONE** and must not be re-asked. The provider-neutral schema adds `accounts` and private draft-only `worker_profiles` (no PII or provider-specific identity). Service contracts require server-resolved internal account ID, prepared SQL and idempotent worker opt-in; a protected `/api/v1/me/worker-profile` route is closed without configured trusted verifier and D1. Real auth/OTP, public worker/search/contact, locations and personal-data/deletion policy are still pending M-002/M-003, and UI requires M-004. **Actual verification:** [PR #10](https://github.com/rekixo-lab/jodlo/pull/10) merged as `e01dbde44cbe46aadf3d563c66f411a8c9d96818`; [main GitHub Actions #40476898497](https://github.com/rekixo-lab/jodlo/actions/runs/40476898497) SUCCESS on that commit (27 Node tests, docs/design guard, both dry-run builds, local D1 migration 0001+0002 and strict TypeScript). No deployment.

## 2026-10-27 founder decision M-002 — Google Sign-In

Founder explicitly approved **Google Sign-In** for initial login, without phone OTP. [ADR-0007](decisions/0007-google-signin-verified-session.md) and [manual register](MANUAL_ACTIONS.md) mark M-002 DONE. A local-only backend slice verifies Google ID token via rotating Google JWKS using `jose` and rejects wrong RSA signature, audience, issuer, expiry or subject; it links stable Google `sub` to shared JODLO account (ADR-0006), issues random SHA-256-at-rest one-hour bearer sessions and supports logout. No public OTP/email identity and no Google user details are stored. Requires `GOOGLE_CLIENT_ID` supplied only after owner OAuth setup (M-008); without config routes fail closed. Unit/integration tests use generated RSA keys and local SQLite, never call Google or real Cloudflare. M-003 location/retention and M-004 screens remain gated; no Cloudflare remote deployment. New code requires real latest PR/main CI verification, not earlier green evidence.

## Latest verified source checkpoint — Google Sign-In M-002, 2026-10-27

[PR #12](https://github.com/rekixo-lab/jodlo/pull/12) merged as `494fc1ee3a41757d4099df40532759526afa5e66` with actual [green main GitHub Actions #40479368370](https://github.com/rekixo-lab/jodlo/actions/runs/40479368370) (37/37 tests, D1 migrations 0001–0003 locally, docs/design checks, strict TypeScript, both Wrangler dry-run builds). The current backend source includes Google-JWKS RS256 verifier, bounded `POST /api/v1/auth/google`, transactional subject→account mapping, SHA-256-at-rest one-hour sessions, revocable logout, owner-only worker drafts, synthetic RSA/token and SQLite integration tests. Identity data contains a persistent **pseudonymous Google sub** (privacy/retention requirement), not an email or phone. No real Google OAuth client/consent configuration, Android Credential Manager UI, provider live test, production D1 or Cloudflare deployment. **M-002 DONE; M-008 UPCOMING (manual console only when required), M-003/M-004 still owner gates.** Next practical non-visual milestone: abuse throttling, expiration/deletion lifecycle and authorization hardening, keeping docs and actual CI green.

## Current security work — bounded sessions and logout-all (2026-10-27)

The next isolated backend PR adds **up to six active 1-hour server sessions per account**, enforced by atomic SQLite conditional insert, returns `429 RATE_LIMITED` when full, opportunistically removes no more than 100 expired session hashes per login via D1 index, and supports `POST /api/v1/auth/logout-all` to revoke the authenticated account's sessions. It reuses the same D1 and token validation; no new tracking table or cron, tokens still SHA-256 at rest. This is not general request/IP rate-limiting and not a complete deletion/retention policy; M-003/M-008 remain future gates. Check latest PR/main CI in GitHub and amend status with real results before claiming shipped.

### Latest verified main checkpoint — session hardening 2026-10-27

[PR #14](https://github.com/rekixo-lab/jodlo/pull/14) squash-merged as `c234961204c0c2586748c52bcd1976a8611c7197`, and [main Actions #40481385874](https://github.com/rekixo-lab/jodlo/actions/runs/40481385874) completed **SUCCESS** (41 automated tests, docs/design guard, local D1 migrations, TypeScript and both Wrangler dry-runs). Current code caps active sessions to six via SQLite atomic conditional write (`429`), prunes up to 100 expired session hashes opportunistically using `idx_auth_sessions_expiry`, and provides owner-only `POST /api/v1/auth/logout-all`. **This is not global/IP request throttling, a retention policy, real Google OAuth/device testing or deployment**. M-003 privacy/area, M-004 UI, M-008 OAuth configuration and M-007 production permissions remain gated. No manual owner action is needed for this completed local slice. Do not repeat this work; proceed with orthogonal nonvisual backend tests/safety.

## 2026-10-27 — Local admission/abuse-control slice (under CI review)

- Added two **local-only, simulated** Cloudflare Rate Limiting bindings for Google sign-in: coarse pre-verification 100 requests/10 sec per PoP; post-verification 20 requests/60 sec per **hashed Google `sub`** (not raw subject/IP). A missing binding or limiter outage denies sign-in (503); an exhausted limiter returns 429 with 10/60-second Retry-After. No new D1 table, raw IP, user email, external personal data or remote infrastructure.
- Provider Rate Limiting limits are **approximate per Cloudflare location** (not a guaranteed worldwide security guarantee), and the shared pre-auth bucket may delay legitimate users under bursts. Actual production cost, quotas, Cloudflare bot/WAF rules and provider behavior still require readiness review.
- Synthetic account deletion cascade + transactional rollback tests protect worker profiles, Google subject and session cleanup, **without exposing any public account-deletion endpoint**. Real deletion/export notice, data retention/consent remains founder gate M-003.
- CI/evidence pending: require green PR + green merged-main Actions before marking these features verified. No staging, remote deploy, Android UI or Finworkar mutation.

## Latest checkpoint — auth admission milestone (2026-10-27)

[PR #16](https://github.com/rekixo-lab/jodlo/pull/16) merged as `17ea0b882977ad0bd3a695e49b0112dde64fc9d6`; [main Actions #40482955589](https://github.com/rekixo-lab/jodlo/actions/runs/40482955589) completed **SUCCESS** on that exact commit (49/49 Node tests, docs/design checks, local D1 migrations, TypeScript and both Wrangler dry-run builds). `apps/api/src/modules/identity/admission.ts` uses the existing `sessionHash` utility to key a verified-subject limiter without passing raw Google sub, never uses untrusted client IP headers. Only `wrangler.local.jsonc` has mock `ratelimits`; the unconfigured generic Wrangler config remains closed to real login. There is no new D1 migration/dependency, no personal location or Google user email saved. Disposable account deletion/rollback SQLite tests verify current FK cascades, but **no public delete endpoint or legal retention policy** exists. M-003 and M-005 are now the next product/privacy gates for real area/listing data; M-004 UI approval and M-008 OAuth configuration still upcoming. Next safe engineering slice: provider-neutral discovery types, synthetic moderation/authorization tests; stop before founder-gated data flows. All deployments prohibited until final M-007 production-only approval.

## 2026-10-27 — Public category search foundation (pending green PR)

Reuse `apps/api/src/modules/catalog/catalog.ts` for a strict bounded `GET /api/v1/catalog/search` endpoint; limit 1–25, offset 0–100, Hindi/English matching and fallback, SQLite `instr` literal-substring matching with bound parameters and active-only projection. New tests are synthetic and use existing SQLite/D1 fake; no new tables, seeded real services, worker profiles, contact/location data or actual search marketplace. **M-003/M-005** owner decisions are required before building/publishing worker/area listings; M-004 visual UI and M-008 real Google OAuth also still gated. Verify latest branch PR + main Actions and update these lines with actual results before claiming completion.

## Latest verified source checkpoint — catalog search, 2026-10-27

[PR #18](https://github.com/rekixo-lab/jodlo/pull/18) merged as `36c9d83ad8f720d4eb7244364e789f5fc4bd7879`; [main GitHub Actions #40484455029](https://github.com/rekixo-lab/jodlo/actions/runs/40484455029) **SUCCESS** on the exact main head (55/55 Node tests, local D1 migrations, documentation/design guards, strict TypeScript, local and normal Worker dry-run builds). `catalog.ts` now shares one public projection between `/api/v1/catalog` and `/api/v1/catalog/search`. Read-only route validates q 2–64 code points, Hindi/English lang, limit 1–25, offset 0–100; matches active category en/hi/slug via SQLite-bound `instr`, NFC normalization, returns public id/slug/name plus nextOffset. All six new tests are synthetic, **not actual seeded marketplace data or worker discovery**. No new schema, dependence, remote Cloudflare deployment, user PII, UI. Next gate M-003 locality/privacy/deletion; M-005 actual pilot categories, matching/trust and worker publication before any real worker/requests data; M-004 UI, M-008 OAuth setup, M-007 first production-only release. Source green; future chat MUST confirm latest head and avoid duplicating search code.

## 2026-10-27 — Pure policy-driven request/matching library (pending PR green)

New `apps/api/src/modules/shared/identifiers.ts` centralizes non-PII opaque/category/idempotency validators, reused by pure `interactions/request-contract.ts` and `discovery/candidate-policy.ts`. Generic request state transitions are **explicitly supplied test policy**, no final lifecycle or persistence; rules check owner first, optimistic revision and trusted receipt replay. Candidate selection requires trusted approval callback and category match, rejects self, duplicates, oversized batches and invalid IDs and yields opaque IDs only. No new D1 table, route, real worker search/phone/geo/trust validation, actual request, UI or deployment. Fake tests are not distributed concurrency validation and M-003/M-005 still founder gates. Verify real PR/main Actions before recording implementation green.

## Latest verified checkpoint — request and candidate-selection contracts (2026-10-27)

[PR #20](https://github.com/rekixo-lab/jodlo/pull/20) merged as `31839e4c5eca44251db85e3d4c220ea1be3bd296`, and [main GitHub Actions #40486525096](https://github.com/rekixo-lab/jodlo/actions/runs/40486525096) **SUCCESS** on this exact commit: 68/68 Node tests, local D1 migrations, docs/design checks, strict TypeScript, both Worker dry-run bundles. Reusable `shared/identifiers.ts` covers opaque account/request IDs, category IDs and retry keys for two pure modules. `interactions/request-contract.ts` checks server-resolved ownership before replay, rejects stale revisions/conflicting keys, accepts only explicitly injected synthetic graph and returns frozen in-memory receipts. `discovery/candidate-policy.ts` requires explicit trusted approval, category match, non-self, dedupe and capped complete input validation; returns opaque IDs only. No request/listing/area D1 schema, public endpoints, default matching/ranking algorithm, verified worker claims, phone/GPS or live request notifications. All 13 new tests synthetic. **M-003 and M-005 still unapproved**, M-004 visual design, M-008 OAuth real-device and M-007 production continue gated. Next: define the founder's M-005 worker visibility/request transitions before actual persistent service requests; M-003 before private locality/retention schema. No deployment.

## Founder continuity request — old Finworkar must be READ for behavior, JODLO rebuilt (2026-10-27)

Read [read-only legacy behavior study](LEGACY_FINWORKAR_BEHAVIOR.md) before implementing JODLO worker/customer flows. Source evidence immutable old Android `0ad9ddd230439f76da363c6bbacdddb35288704f` and Firebase backend `f31d089953f68868108f5d475436842b55c10204`: guided publish, categories/guest preview/nearby, active+moderation visibility, bilateral self/block contact checks, Nok-Nok idempotent transaction+response, call accept-time recheck, expiry/recovery. Implement JODLO cleanly with no old code, services, UI, credentials or data copied. `interactions/contact-safety.ts` new local pure deny-by-default guard with trusted facts and tests; **NOT** real D1 transactional check or final contact flow, no public endpoint. M-003/M-005 still unapproved. Verify PR/latest main green before marking shipped. No deployment.

## Latest verified legacy-behavior continuity / JODLO contact safety (2026-10-27)

[PR #22](https://github.com/rekixo-lab/jodlo/pull/22) merged as `24ed69e735e136cc95b6ac43f74d83f08d019e6a`; [main GitHub Actions #40489994251](https://github.com/rekixo-lab/jodlo/actions/runs/40489994251) **SUCCESS** on the same commit (76/76 Node tests, local D1, docs/design guards, strict TypeScript, both Wrangler dry-run builds). Founder wants new JODLO UX/code, but understand how original Finworkar users/workers worked. [Source-backed map](LEGACY_FINWORKAR_BEHAVIOR.md) at immutable read-only old Android/backend SHAs reconstructs guided service posts, guest feed vs signed-in trusted nearby, safe post visibility, bilateral block/self prevention, Nok-Nok pending/dedupe and transaction recheck, call acceptance/timeout semantics. New JODLO `interactions/contact-safety.ts` is purely policy-dependent, denies missing facts, draft/unpublished, disabled/blocked/moderated/unavailable and leaks no PII. Eight new tests, all 76 green. **Not** real D1 transactional contact or Android app. Consult map; do not port Firebase/Razorpay, exact GPS or old theme/assets. M-003/M-005 unapproved; M-004/M-008/M-007 still gated.

## 2026-10-27 — Natural language search enhancement (pending verification)

`apps/api/src/modules/catalog/search-phrases.ts` is small original phrase analyzer inspired only by the [read-only legacy behavior map](LEGACY_FINWORKAR_BEHAVIOR.md). It detects separate Hindi (Devanagari) and English grammatical filler only, never translates/trusts identity or invents categories. `catalog.ts` reuses existing single-term public SQL projection, optionally ANDs at most 6 prepared term groups when a sentence is detected, preserving API response and strict q/limit/offset validation. No new D1 schema, synonyms index or dependencies. Only **active** categories (test-only fixture data) can match; unknown multi-trade speech is not auto-assigned. PR/main CI evidence required. M-003/M-005 still gated; do not create worker listing, contact, location, UI or Cloudflare resources.

## Founder correction — ONLY Hindi and English, NO Hinglish (2026-10-27)

**HARD APPROVED RULE**: JODLO must support **Hindi in Devanagari and English only**, never Hinglish/Roman-Hindi/mixed-script copy or language processing. Founder explicitly corrected old previous assistant assumptions; do NOT infer Hinglish from legacy Finworkar, old documents, or source PR #24. Original `catalog/search-phrases.ts` must remove Romanized Hindi grammar and explicitly reject mixed Latin+Devanagari input in public natural category search, while preserving regular English and Hindi searches and `lang=en|hi` output. `apps/api/tests/catalog-natural-phrases.test.mjs` must prove negative Hinglish cases and positive both language cases. Treat any historical mention of Hinglish as superseded JODLO policy, though still accurate as a description of the old Finworkar. See [ADR-0008](decisions/0008-hindi-english-only.md). Keep separate M-003/M-004/M-005/M-008/M-007 gates and no remote deployment.

## Verified founder correction — Hindi + English ONLY, NO Hinglish (2026-10-27)

[PR #25](https://github.com/rekixo-lab/jodlo/pull/25) merged as `e0ce6d04a56f9c8aaa27c24d50f821ace5201ae3`; [main GitHub Actions #40493262734](https://github.com/rekixo-lab/jodlo/actions/runs/40493262734) **SUCCESS** on that exact SHA (84/84 Node tests, local D1 migrations, strict TypeScript, docs/design guards and both Worker dry-run bundles). [ADR-0008](decisions/0008-hindi-english-only.md) **supersedes** all early JODLO Hinglish wording and PR #24 experimental Roman-Hindi phrases. `catalog/search-phrases.ts` now has separate Hindi (Devanagari) and English grammar; Romanized Hindi is NOT a supported input, mixed-script input returns zero matches. Test source and docs updated, reusable existing catalog query retained. Future worker/customer UX must follow only these two approved languages, not import legacy Finworkar's Hinglish parser. No UI before M-004, no operational listing/privacy before M-003/M-005, no Cloudflare deployment before M-007.

## Local atomicity rehearsal — 2026-10-27 (CI pending)

`tests/request-sqlite-atomicity.test.mjs` contains ephemeral SQLite **test-only** request and receipt tables, with two separate SQLite connections, BEGIN IMMEDIATE write serialization, guarded revision CAS and unique per-request retry key. Covers replay, stale competing write, bad owner/recovery, rollback, no production route. `interactions/request-contract.ts` additionally rejects future-result receipt replay against rolled-back revision; remains a pure independent contract. This is NOT a D1 migration/route, approved M-005 state machine or a Cloudflare production race guarantee. See latest PR+main CI before marking green. Read old Finworkar journey in `LEGACY_FINWORKAR_BEHAVIOR.md` read-only, and enforce Hindi + English ONLY (ADR-0008). No UI/PII/deploy.
