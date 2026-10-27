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
