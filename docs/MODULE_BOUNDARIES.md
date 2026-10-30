# JODLO module contracts and dependency boundaries

This is the **architecture contract**, not a claim that these modules exist in the current starter. Start with one Cloudflare Worker deployment and small code packages; create files only when implementing tested behavior.

## Backend dependency direction
```text
GET/POST /api/v1/*
   -> HTTP router + auth/validation guard
      -> FEATURE service (domain rules, authorization decisions)
         -> repository interfaces (D1 storage)
         -> provider interfaces (FCM / R2 / RTC / billing)
            -> concrete Cloudflare/bank/platform adapter
```
No HTTP route with Firestore-like direct DB writes, no UI-supplied trusted price, no module reaching into another module's table without its published service contract. Service accepts plain typed inputs and produces typed outputs; it should not depend on raw `Request`, platform globals or SDK implementation unless intentionally the adapter.

## Module ownership and data contracts
| Module | Primary responsibility | Allowed collaborators and constraints |
| --- | --- | --- |
| `system` | Health/readiness/feature flags (no secrets exposed) | No user data; already scaffolded only as local health. |
| `identity` | Authenticate/verify external identity; sessions; account closure | Provider adapter + D1 identities; server derives actor ID. Auth provider pending. |
| `workers` | Worker profile, languages/skills, availability, public visibility | Identity, catalog, media; independent verification is NOT same as profile completeness. |
| `catalog` | Categories, localized aliases/synonyms and active taxonomy | Read-heavy, cache safe public metadata where measured. |
| `listings` | Worker service creation, draft, edit, expiry and moderation state | Auth, workers, catalog, area, media; posting policy server authoritative. |
| `discovery` | Area/category-indexed worker/listing search, ranking, pagination | Catalog + approved public projections only; bounded SQL reads, no private GPS leakage. |
| `interactions` | Buyer intent, contact requests, blocked/report outcomes | Identity + listing + rate limits; real customer work requests not assumed to exist without spec. |
| `media` | Short-lived uploads, private R2 metadata and publishing state | Image validation, contact-info stripping, moderation; private by default. |
| `notifications` | Preference-aware pushes; delivery status | Queue + FCM when approved; consent, TTL, idempotency and send limits. |
| `calls` | Authenticated call session, signaling state, events, settlement | RTC provider interface; **not** raw voice packets; separate billing ledger. Deferred. |
| `payments` | SKU/channel eligibility, verified purchase state/refund | Google Pay+merchant PSP where eligible; Google Play Billing/eligible alternative for digital purchases; never Razorpay. Deferred. |
| `ledger` | Append-only entitlements and balances, idempotent grant/revoke | Server-authoritative transactional accounting, separate from payment UI/providers. Deferred. |
| `moderation` | Report/block/review, policy actions, appeals | Human/admin review, audit; no fictional ID-verified claims. |
| `admin` | Privileged operations and audit | Least privilege, MFA/Access, no hidden admin backdoors from consumer Android. Deferred. |
| `analytics` | Privacy-safe outcomes and operational metrics | No raw personal email, phone, GPS, secrets in events. Deferred. |

## Contract examples (illustrative, not implemented)
- `GET /api/v1/health` exists in the local scaffold and returns generic status only.
- `GET /api/v1/catalog` might return localized categories with version/ETag (NOT implemented).
- `GET /api/v1/listings?areaId=...&categoryId=...&cursor=...` returns a bounded public projection (NOT implemented).
- `POST /api/v1/listings` requires authenticated actor, schema validation, idempotency and spam guards (NOT implemented).
- `POST /api/v1/payments/verify` must never trust client-supplied success or price (NOT implemented).

Do not convert illustrative paths into live product claims. Define API contracts/OpenAPI plus Kotlin models before creating the client. For currency, use integer minor units; for timestamps, defined UTC ISO/epoch standard; for IDs, opaque values; for errors, stable codes + opaque correlation ID.

## Interaction invariants
- UI may query public data without GPS; manual area first and opt-in geo.
- Authenticated writes check server-side ownership and content policy.
- Client cannot set verified worker status, final wallet balance or paid entitlement.
- Media not public until moderation and authorization succeed.
- Calls: request -> ringing -> accepted -> connecting -> active -> ended or terminal alternatives; no charge merely for a ring.
- Payments: created -> pending -> provider-verified -> fulfilled; replay duplicates never add credits. Refunds/disputes have reconciled adjustments.
- Queues deliver at least once; consumers tolerate duplicate and out-of-order events.
- Data deletion covers profile, records, R2 objects, events and applicable legal/financial retention exceptions.

## Test standards for each module
Unit state/policy, invalid payload, missing identity/role, conflicting status, pagination caps, retry/idempotency, cross-user data access, queue duplicates, latency and cost; local workerd/D1/API integration with mock providers + real device tests when relevant. Keep tests independent of live old Finworkar.

## Splitting criterion
Split Worker runtime (or Gradle module) only if independently deployable scaling/security/fault domain, ownership, or build size creates measured benefit; module structure itself does not require microservice deployment.
## Cross-module mandatory reuse invariant

Every developer/AI searches existing shared contracts, validators, provider ports and composables before adding code. When genuinely repeated, extract one small owned/tested function/component instead of copying. No mega-utils, redundant microservices or duplicate business sources. Android owns reusable localized theme/motion widgets, server Worker owns authoritative auth/pricing/ledger; shared contracts prevent divergent DTOs. Asset files are canonical, compressed and not duplicated.

Premium transitions, tab/action feedback and occasional lightweight 3D are required in the *approved future UI*, using central design tokens and low-end/accessibility/reduced-motion tests. See [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md), [Reuse](REUSE_ASSET_POLICY.md), [Design](DESIGN_SYSTEM.md) and [Motion](MOTION_3D.md).

## Approved account-to-worker boundary (ADR-0006)

Active `accounts` implicitly have customer capability; optional `worker_profiles` rows represent opt-in and begin as private `draft`. The `identity` service owns trusted server-resolved internal account IDs and account lifecycle, while the `workers` service owns the idempotent transition into a worker draft. No separate customer/worker logins, client-supplied role grant, public verification, provider-specific subjects or precise GPS. Real identity verification is M-002; privacy/area decisions M-003. [Decision](decisions/0006-shared-account-opt-in-worker.md).

## Google sign-in ownership (ADR-0007)

`identity/google.ts` cryptographically verifies Google OIDC JWT using `jose` and trusted Google JWKS; `identity/google-accounts.ts` transactionally maps verified Google `sub` to an active internal `accounts.id` without copying email, name or tokens; `identity/sessions.ts` creates and resolves short-lived, hashed-at-rest bearer sessions and revokes them. `http/router.ts` owns bounded JSON/method/HTTP status only. Worker modules reuse one resolved actor and D1 contract; no client-supplied account IDs, no Google ID token used as a long-term app session. Future real OAuth setup is manual gate M-008, UI remains M-004. No deployed providers.

## Pure pre-policy contracts (2026-10-27; no public API)

`interactions/request-contract.ts` owns only generic immutable transition decisions; the caller must provide a founder-approved transition graph and later implement atomic D1 revision/unique-retry storage. `discovery/candidate-policy.ts` selects only opaque approved synthetic worker IDs by category, requiring a trusted injected predicate; drafts must remain invisible and no public worker/contact/GPS/trust signal is inferred. Shared `modules/shared/identifiers.ts` owns three narrow ID/key validators to avoid duplicate validation. These contracts **do not approve or implement** user requests, worker publication, ranking/matching, localities or real worker data. M-003/M-005 remain owner-controlled gates.

**Verified pure module boundary:** [PR #20](https://github.com/rekixo-lab/jodlo/pull/20) merged as `31839e4c5eca44251db85e3d4c220ea1be3bd296`, and [main GitHub Actions #40486525096](https://github.com/rekixo-lab/jodlo/actions/runs/40486525096) **SUCCESS** on this exact commit: 68/68 Node tests, local D1 migrations, docs/design checks, strict TypeScript, both Worker dry-run bundles. Tests do not approve worker eligibility/trust, request lifecycle or any location-based ranking. No new D1 schema/route.

## Legacy-inspired safety gate without cross-repo code reuse (2026-10-27)

[Behavior study](LEGACY_FINWORKAR_BEHAVIOR.md) captures the read-only legacy worker/customer flow. Internal pure `interactions/contact-safety.ts` requires explicit server-trusted participation/publication/moderation/block/channel facts and recheck-at-write as a future D1 adapter invariant. It does **not** create a contact request, call, post/listing or published worker. Do not import Firebase, legacy payment code, passwords, images or UX designs. Future M-003/M-005 product approval required.

**Synthetic atomicity rehearsal (2026-10-27):** test-only SQLite file/unique retry journal models the future atomic storage obligation; it is NOT production D1 schema. `request-contract.ts` remains policy-neutral and now rejects replay of a future receipt against an earlier request revision. Do not introduce a real `requests` D1 table or public action API before founder-approved M-005/M-003, or assume SQLite locking equals deployed D1 semantics.

**Verified rehearsal boundary:** [PR #27](https://github.com/rekixo-lab/jodlo/pull/27) merged as `68d89e593fa34760aec1af9a04c8c64f11360590`; [main GitHub Actions #40495912363](https://github.com/rekixo-lab/jodlo/actions/runs/40495912363) **SUCCESS** on the exact commit (93/93 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Wrangler dry-run bundles). Source contract is pure; temporary SQLite journal only models future atomic D1 revision/receipt obligations. No live storage, API, location, approved M-005 states or request publication exists.

## Explicit future listing projection boundary (2026-10-27)

`discovery/public-listing.ts` is a **pure hypothetical** visibility check requiring trusted owner status, private-draft exclusion, published/available listing, category active, moderation and future founder-approved disclosure policy; its return type allowlists only `id,categoryId` with no worker ID, locality/PII or invented verification. It must **not** read or expose a real public listing before M-005, and its future D1 adapter must re-read authoritative mutable status; production authorization remains unimplemented. Reuse `shared/identifiers.ts`, don't clone profile/catalog validators or the existing `contact-safety.ts` action-specific guard.

**Verified internal worker listing projection boundary:** [PR #29](https://github.com/rekixo-lab/jodlo/pull/29) merged as `f4009f3b207d3ab828b4b0a1738163233bd81f7c`; [main GitHub Actions #40497728947](https://github.com/rekixo-lab/jodlo/actions/runs/40497728947) **SUCCESS** on that exact commit (102/102 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Worker dry-run builds). `projectVisibleListing` is read-only/pure; no public endpoint, table or identity verifier is introduced. Existing worker drafts stay nonpublic, and future D1 reader + founder-approved policy must provide all mutable evidence at read time. Not an authorization to publish real workers.

## 2026-10-27 — CI founder-gate tripwires (approval still manual)

`scripts/verify-founder-gates.mjs` asserts today's limited HTTP route literals, existing five D1 tables and draft-only worker schema, original Hindi/English-only parser and no direct remote deploy in CI/scripts. This fails accidental expansion until founder M-003/M-005/M-007 decisions are documented and allowlist updates reviewed. It is a limited static check, not an authenticated transaction or complete source analyser. No new public worker or customer feature added.

**Verified current CI guard:** [PR #31](https://github.com/rekixo-lab/jodlo/pull/31) merged as `812ec39f51b70ce10564c4396cd7824b8caf78e5`; [main GitHub Actions #40501136670](https://github.com/rekixo-lab/jodlo/actions/runs/40501136670) **SUCCESS** on the exact commit (111/111 Node tests, docs/design/founder no-dependency checks, local D1 migrations, TypeScript strict and both Wrangler dry-run bundles). `verify-founder-gates.mjs` is small and read-only; it does not publish workers or implement permission checks. Future founder-authorized marketplace APIs must carry independent D1/HTTP tests and reviewed new gate configuration.

## 2026-10-27 — One-statement session revocation boundary

`identity/sessions.ts` now uses **server-authenticated bearer hash inside a single SQL DELETE** for one-device/all-devices revocation, checking active status and expiry atomically instead of read-then-write; no client account or person-specific data is accepted. Existing HTTP auth/logout API is unchanged; shared ID validator reused. M-005 proposal is NOT an authorization to store/publish worker listings or contacts; see [Decision proposal](M005_DECISION_PROPOSAL.md).

**Verified atomic identity revocation boundary:** [PR #33](https://github.com/rekixo-lab/jodlo/pull/33) merged as `5d7906e96cd71d7f104fcb58098ea5547b6b098b`; [main GitHub Actions #40504504583](https://github.com/rekixo-lab/jodlo/actions/runs/40504504583) completed **SUCCESS** on that exact commit (119/119 Node tests, docs/design/founder checks, local D1 migrations, strict TypeScript and both Wrangler dry-run Worker builds). Single conditional DELETE scope is restricted to current verified bearer and active account. No subject or client account parameter can expand deletion. No new public marketplace capability follows from this verified auth work.

## 2026-10-27 — Founder-approved minimal auto-public service listing boundary

[ADR-0009](decisions/0009-instant-service-publication.md): `worker_listings` stores opaque ID, active existing category and private draft worker owner; public GET allowlists only `id,categoryId`. `worker_profiles` remains `draft` and cannot be labeled verified automatically. Own POST/DELETE rely on server-issued session and DB conditional checks; moderator `hidden` suppresses immediate reappearance in public reads and cannot be overridden by a retrying worker. Reuses existing pure `projectVisibleListing`, category/opaque ID helpers and bounded body reader. No status/owner/verification/moderation writes via clients; no location, profile, public contact, prices, text, images, real pilot categories or Cloudflare deployment. Other M-005 pilot choices and M-003 privacy pending.

**Verified publication boundary:** [PR #35](https://github.com/rekixo-lab/jodlo/pull/35) merged as `2668fc2a6e59c0b8e87871c4def1c4e2dc847a06`; [main GitHub Actions #40514179945](https://github.com/rekixo-lab/jodlo/actions/runs/40514179945) completed **SUCCESS** on that exact main SHA (128/128 Node tests, docs/design/founder gate checks, local D1 migrations 0001–0004, strict TypeScript and both Wrangler dry-run Worker bundles). Public listing projection never includes account ID, address, phone, location, verification label, free text/media or prices. Worker opted-in draft identity remains private. Moderator hidden is server-owned but full admin/reports/appeal system is **not** yet built.

## Notifications module source boundary (2026-10-30)

Actual apps/api/src/modules/notifications/delivery.ts is a **provider-neutral Queue-compatible processing engine**, not a wired live notification. Trusted backend must supply current consent, event policy and recipient/destination status plus an atomic durable receipt store and dead-letter adapter. Only a disposable single-process SQLite receipt adapter and fake Queue/provider exist in Node tests; no Cloudflare Queue bindings, D1 migration or live FCM provider. Provider acceptance is not device delivery; exactly-once is not guaranteed. See docs/NOTIFICATIONS.md. Do not copy the Finworkar Firebase/FCM flow.
