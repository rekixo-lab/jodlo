# JODLO — current evidence ledger and release gates

> **Read this before date-stamped historical runbooks.** Snapshot recorded 2026-11-06 from GitHub and previously documented founder-operated provider checks. It is not a fresh Cloudflare/phone probe. A newer observed event must replace the corresponding fact and include its own evidence; passing GitHub CI never advances a live-provider status automatically.

<!-- JODLO_STATE_LEDGER_V1
as_of_date: 2026-11-06
source_main_sha: 600d7894d25e1ad25a1446f078b5e1e78cfbe11a
source_ci: verified_success
live_api: owner_verified_2026-11-03_current_version_unverified
live_auth: owner_verified_2026-11-03_current_version_unverified
live_catalog: zero_at_last_owner_read_not_freshly_rechecked
migration_0009: local_only_production_unverified
human_catalog_signoffs: zero_at_last_review
full_marketplace: not_ready
final_physical_phone_acceptance: deferred_not_waived
-->

## What is independently verified in GitHub

- **Verified merged-main snapshot:** [`600d7894d25e1ad25a1446f078b5e1e78cfbe11a`](https://github.com/rekixo-lab/jodlo/commit/600d7894d25e1ad25a1446f078b5e1e78cfbe11a), squash-merged [PR #255](https://github.com/rekixo-lab/jodlo/pull/255) on top of [PR #254](https://github.com/rekixo-lab/jodlo/pull/254). This is a **dated, independently green source-build checkpoint**, not proof of the deployed Worker, a ready Marketplace, real phone acceptance or the newest future commit.
- At the exact `600d7894` SHA, [merged-main Foundation workflow 42170576490](https://github.com/rekixo-lab/jodlo/actions/runs/42170576490) and [merged-main Android workflow 42170576517](https://github.com/rekixo-lab/jodlo/actions/runs/42170576517) both succeeded, including Kotlin Core, local D1/workerd, dependency audits, strict TypeScript and Android debug APK JDK 17/21. Earlier merged-main PR #254 checks [Foundation 42169217671](https://github.com/rekixo-lab/jodlo/actions/runs/42169217671) and [Android 42169217670](https://github.com/rekixo-lab/jodlo/actions/runs/42169217670) also passed at `62ff4b471b828efd15fa3cef444413eb5b6716c3`. The prior baseline [Foundation 41956079039](https://github.com/rekixo-lab/jodlo/actions/runs/41956079039) and [Android 41956078782](https://github.com/rekixo-lab/jodlo/actions/runs/41956078782) passed on historical `fd5a5d0a33deadd4e094db49cd50739337cf7a01`. These are **source/CI checks, no Cloudflare deployment, real calling, approval or phone acceptance**.
- Source contains native bilingual Customer Home, approved-Category Search/browse/suggestions, all-Category public Listing feed, fresh current-approved Service detail, device-only Saved/Hidden **on-device find and sort (PR #254)**, Google Worker onboarding/session, reviewed owner Category publish/edit/unpublish/resume, and private Account/export/owner checks. A newer merged change (PR #255) adds **loaded-only private Worker My Services search and status filters**, without claiming an exhaustive live public marketplace. The public Service projection deliberately omits Worker bio, rates, photos, detailed area and calling/verification claims.
- `infra/migrations/0009_public_cross_category_feed_index.sql` exists and is locally tested; applying it to real Cloudflare D1 has **not** been verified. **Do not equate committed migration with deployed migration.**
- GitHub `main` was rechecked on **2026-11-06** and remains **not branch-protected**. The GitHub connector used here cannot make repository-admin branch-protection changes. Require owner-managed mandatory PR reviews/status checks before a release; no branch setting was changed.
- [PR #253](https://github.com/rekixo-lab/jodlo/pull/253), which proposed an owner-private future Agora consent API/UI, was **closed without merging** after the founder M-003/M-005 policy guard rejected the new route. The policy guard was **not weakened**, and there is still no public call-preference route, real ringing, token issuer or RTC SDK. Do not infer permission for provider onboarding or actual calls from a source-only opt-in helper.

## External evidence from founder's earlier operation — NOT a fresh live check

- On **2026-11-03**, founder-operated Cloudflare/Android checks recorded a deployed `jodlo-api` at `https://api.jodlo.rekixo.com`, real Google Sign-In and a private Worker draft on a connected phone. The operator also verified remote migrations **0001–0008**, `quick_check` and `foreign_key_check`. See [STATUS](STATUS.md) and [operator handoff](MANUAL_ACTIONS.md).
- The **currently serving** Worker source SHA, up-to-date DNS/TLS/health, Android binary/source correspondence and deployment of newer PRs are **unverified** by the GitHub source inspection. Never repeat an obsolete first-deploy procedure or blindly redeploy against an existing Worker. Operator must first inspect read-only live bindings/version and backup/rollback.
- Last owner-read `jodlo-production` had **0 total/active approved Categories and 0 published public Listings**. This is **last-observed**, not a read performed in this audit. It means successful code cannot yet prove a useful live Marketplace.
- The original **889 Categories and 7,267 Services** are evidence for review, **not approved production records**. [Review coordination #221](https://github.com/rekixo-lab/jodlo/issues/221), [review issues #216–#220](https://github.com/rekixo-lab/jodlo/issues/216) and intake [#222–#224](https://github.com/rekixo-lab/jodlo/issues/222) remained unassigned/unsigned; first 5 Categories contain 48 Services and 15 independent human review assignments. Only qualified human editorial, occupational/legal and source mapping evidence, followed by separate founder approval, may authorize narrowly scoped activation. No auto-import.

## Product completion — what remains open

The source is **a working software foundation, not a complete released Marketplace**. See the authoritative [engineering issue #235](https://github.com/rekixo-lab/jodlo/issues/235) and [Finworkar-to-JODLO gap map](FINWORKAR_JODLO_BEHAVIOR_PARITY_2026-11-04.md).

| Capability | Current evidence | Next meaningful exit condition |
| --- | --- | --- |
| Customer Home/Search/Saved | Real native and API code plus merged on-device Saved/Hidden find/sort; real public catalog empty at last check | Approved bilingual hierarchy and real public Service/Worker results, error states and consent-safe relevance |
| Worker management | Account, Category-only listing lifecycle, owner status and Customer-visible preview; merged local loaded-only My Services search/filter; no public profile yet | Complete policy-approved service details, guided conflict-safe edits, moderation and useful verified public card (without invented trust) |
| Nearby/service area | No accepted exact private/public area contract | Explicit optional approximate area policy, opt-in, bounded server queries, privacy tests |
| Agora direct Internet audio | Extensive local safety/replay/preflight experiments, consent default OFF | Real server-owned presence/busy/block/abuse, short-lived provider token, signaling, incoming FCM ring/ACK and connected/ended tests |
| Account/trust/safety | Google session, private account overview and export | Reauthenticated full erasure incl. provider/backup retention; block/report/moderation/appeals and privacy controls |
| Notifications/media | Private D1/mock primitives | Real FCM lifecycle and bounded secure R2 uploads/moderation/deletion, after provider/policy gates |
| Payments/web/operations | Architecture/decision docs; no real ledger/launch | Eligible Play/UPI SKU decision, idempotent payments/refunds, public JODLO help/policies, recovery and monitored release |
| Final acceptance | CI green; **not release ready** | Controlled live integration, reviewed data, full non-device QA, then **one consolidated** final physical-phone acceptance |

## How to continue without phone testing

1. **Engineering only:** implement complete API + Kotlin + Compose user journeys, local D1/workerd fixtures, fail-closed privacy/authorization, accessibility/error/retry, and exact-head CI. Continue safe parts of #235 without asking for incremental APK installation.
2. **Owner/qualified reviewer gates:** public profile fields, service-area precision, retention/deletion/appeals, live call abuse thresholds, eligible billing product and catalog editorial/occupational/legal review require real decisions. Do not invent them or declare approvals from a code review.
3. **Provider/operator gates:** separately read current Worker/domain/D1/Android versions, migrations and backup plan. Avoid deployments/production writes without a verified controlled-release procedure. A historical successful login is not the latest deployment acceptance.
4. **Only when all integrated features and provider/reviewer gates are genuinely ready:** conduct one final physical-phone test (not per-PR), resolve defects, complete security/rollback/Play acceptance and obtain explicit release authorization.

**Boundaries:** Do not deploy based on this ledger alone. Never modify or import the old Finworkar production app/data, perform unapproved production writes, send outreach emails, create fictitious workers/approval, turn on Agora without consent, or claim real-provider success from a mock. JODLO API origin is `https://api.jodlo.rekixo.com`; the distinct website is `https://jodlo.rekixo.com`. This ledger supersedes *historical status wording*, not the founder's standing engineering authorization or required approvals.

## Status maintenance contract

When a later PR changes code only, update the source feature row and exact green-check proof **without** changing external evidence. When an operator verifies a real integration, record the timestamp, precise scope, non-sensitive link/output, current deployment SHA and rollback constraints before changing `live_*` or migration flags. If evidence is missing, keep status **unverified**. Each status review should point new chats first to this file, then [STATUS](STATUS.md), [ROADMAP](ROADMAP.md), [RELEASE_READINESS](RELEASE_READINESS.md) and [MANUAL_ACTIONS](MANUAL_ACTIONS.md). `npm run docs:check` guards the minimum required facts and entry-point precedence; it **cannot** query Cloudflare or prove a provider release.
