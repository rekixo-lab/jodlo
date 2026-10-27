# JODLO — Complete AI handoff and source-of-truth index

> **READ FIRST — superseding founder decision (2026-10-27): code-first, no staging Worker, no deployment until JODLO fully ready.** Keep all integration work local/mock-based + CI, ask for no Cloudflare credentials now, then request a controlled production-only release. Old staging deployment instructions below are obsolete. [ADR-0004](decisions/0004-local-first-no-staging-until-production.md) · [Release Readiness](RELEASE_READINESS.md).


**Last documentation consolidation:** 2026-10-27 (India). **Mode:** source/planned architecture + local scaffold. **Legacy:** strictly read-only. **This is not a production service.**

## New hard founder directive — code reuse, premium theme, smooth animation (2026-10-27)

**Hard rule:** Every future engineer/AI must search for/reuse matching existing tested code, UI components, contracts and media rather than copy-pasting. Delete unused/duplicate code and asset files. Localized strings and one approved semantic Material 3 theme/source of truth for attractive colors, type, corners, strokes, spacing, elevation and motion; no repeated hardcoded screen styles. Create reusable composables on real needs, not heavy premature abstraction.

**Required premium visuals:** subtle professional depth, beautiful highly responsive animated tabs, navigation transitions, press/gesture feedback, state changes and selected high-value 3D/2.5D. Use light draw/layer animations, support reduced-motion/static fallback, TalkBack and low-end performance/battery. Real 3D engine only if founder approves and benchmarks support it. **UI design/palette/animation specifics still require founder review BEFORE implementation.** No Android UI has been built yet.

**Read/obey:** [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md), [Reuse Assets](REUSE_ASSET_POLICY.md), [Design System](DESIGN_SYSTEM.md), [Motion 3D](MOTION_3D.md). CI will include `design:check` and synthetic tests; future device performance gates remain pending. Cloudflare deployment remains delayed until finished code.

## What we are building
A new, independent, responsive local-work/services platform **JODLO**, focused on actual local matching and verified customer-worker contact/outcomes rather than installation counts. Founder's requirements: native Android, low-end-device performance, Hindi/Hinglish UX, modularity, clear architecture, minimal unnecessary dependencies/schedulers, Cloudflare-first, future changes without big rewrites, and manual owner gates clearly identified.

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
The only currently implemented API route is `GET /api/v1/health`, which is a local scaffold, not production monitoring.

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
- Local scaffold includes `apps/api/src/index.ts`, HTTP router, system health module and tests. No login, profiles, listings, payments, database, Cloudflare binding or deploy code exists yet.
- Latest local run on 2026-10-27: `npm run check` passed (**20 required docs, 90 local Markdown links, 7/7 Node unit tests, strict TypeScript check**). This does NOT establish GitHub green CI or Cloudflare deploy; new sessions must rerun against their actual checkout.
- **Resolved on 2026-10-27:** GitHub connector read/write works. Foundation PR #1 **merged into main** with 38 files. Main CI [run 40466265299](https://github.com/rekixo-lab/jodlo/actions/runs/40466265299) = SUCCESS. This supersedes the previous 403/empty local-archive findings.
- Existing `jodlo.rekixo.com` is a planned address; not confirmed routed/live. No Cloudflare provisioning has been executed.
- Follow [`STATUS.md`](STATUS.md) for current status (this handoff may become older).

## Read / act protocol for the next AI
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