# Cloudflare-first architecture — JODLO

## System topology (proposed, not deployed)

```
Android native Kotlin (applicationId com.rekixo.jodlo)
              | HTTPS JSON /api/v1
              v
Cloudflare edge -> Worker API, small typed router + domain modules
              |       |        |           |
              v       v        v           v
              D1      R2     Queues    Turnstile/rate limits
              |                    async retries/idempotency
         User & service data

jodlo.rekixo.com -> Cloudflare site/Worker assets (later after UI approval)
                    /api/v1 -> Cloudflare Worker API routing to be reviewed

Calls (media transport): provider to be evaluated; Cloudflare Worker authenticates/
                     authorizes tokens and records events, does not carry RTC media.
FCM or equivalent: push transport for native Android, when implemented.
Payments: approved regional provider and Google Play policy review, never invented.
```

## Why this topology?

A **single modular Worker** keeps deploys, latency, cost and debugging simple at launch; module boundaries separate transport, auth, search, worker profiles, jobs, calling, wallet and moderation. Add a separate Worker/Queue or Durable Object only after a measured requirement appears. Avoid microservices and persistent socket servers by default. Cloudflare execution CPU/memory and account plan limits still apply.

## Source boundaries

- `apps/api/src/index.ts`: stable Worker fetch entrypoint, no business logic.
- `apps/api/src/http/router.ts`: routes, content negotiation, method constraints and safe responses.
- `apps/api/src/modules/system/health.ts`: minimal public health.
- Future `modules/auth|workers|services|search|contacts|wallet|reports`: own models, handlers, validation and tests; keep adapters at edges.
- `infra/migrations`: forward-only, reviewed D1 migrations; never auto-run from production API traffic.
- Android architecture later: native Kotlin, feature modules only when usage justifies; separate UI/state/domain/network/data. **No UI code before founder review**.

## Cloudflare service choice

| Need | Preferred component | Decision constraint |
| --- | --- | --- |
| HTTP JSON business logic | Workers (TypeScript) | One Worker until scaling/ownership justifies split |
| Relational posts, profiles, events | D1 + proper indexes | Use parameterized statements and `EXPLAIN QUERY PLAN`; assess latency and row-based billing |
| User media and approved documents | R2 | Private by default; content moderation/size/type and short-lived authorizations |
| Background messages | Queues | At-least-once, deduplicate/idempotency, DLQ/retry and controlled concurrency |
| Configuration/cache | Static config / Cache API / KV only when proven | Cache only safe public content, never private profile/wallet data |
| Stateful real-time coordination | Durable Objects if genuinely needed | Not for RTC voice media; evaluate complexity vs benefit |
| Local admin controls | Cloudflare Access / admin auth | Strong auth and complete activity audit |
| Website | Workers Static Assets or Cloudflare Pages | Separate staged custom domain provisioning |
| Native push | FCM (Android platform service) | Consent, permission and payload privacy |
| Voice calls | Evaluated RTC provider (not selected yet) | Billing/availability/legal reliability; Cloudflare doesn't relay media itself |
| Payment collection | Provider TBD + Play compliance review | Server-side trusted ledger, webhooks and idempotency |

## API design

- Base `/api/v1`; JSON response envelope `{ ok, data | error }` with versioned stable error code and opaque correlation ID.
- Validate URL shape and HTTP methods; content-type and size constraints, auth by route; no permissive CORS by default. Send no-store for sensitive data and redact errors.
- Public health returns **only** service readiness, no DB configs/build SHA/credentials/env names.
- Rate limit login, search, writes, invite and callbacks; input validation, abuse throttling and server-side authorization.
- For data: account_id and durable IDs not raw phone/GPS; geohash/indexing later after privacy design; bound pagination and selective queries.

## Performance operating budgets (targets to verify, not promises)

- Baseline API p95 latency target ≤300 ms for simple edge-only reads where network allows; measure Indian mobile networks separately.
- Initial JSON payload for one discovery page target ≤40 KiB compressed; adaptive pagination with explicit page size and bounded database scans.
- Mobile start and first useful content baseline on low-end devices; exact SLO set after device tests. Images resized and uploaded safely with limits.
- Track Worker CPU/subrequests, D1 rows read/written, R2 operations/storage and queue deliveries. Alert thresholds selected after founder budget review.

## Data/security invariants

- New **production-only** Cloudflare resources only after complete product readiness. Locally simulate D1/R2/Queues with synthetic data and never connect to real production bindings during code development.
- Store only necessary PII, with purpose/retention, access controls and deletion/export processes before collecting real users.
- D1 transactions and business-unique idempotency keys for wallet/calling/payment; never trust client time/price/entitlements.
- No secrets in Git, logs, App assets or README. Store credentials with Wrangler encrypted secrets/Cloudflare account secrets.
- R2 private; signed/time-limited access or authorized Worker proxy, malware/content abuse controls.
- Disaster recovery through D1 Time Travel/backup strategy, R2 recovery approach and config backups; test restores before production.
- Public repo requires dependency checks and security disclosure, but not security theater.

## Deployment rules

- No staging or production deployment during development. PR and main GitHub CI use local tests, strict types and Wrangler build `--dry-run` only.
- Founder authorizes `rekixo.com` DNS and `jodlo.rekixo.com` routing **only at final production launch** after code, privacy, backups, monitoring and rollback are ready. Old Finworkar stays unchanged.
- CI must be green before PR merges; GitHub Actions runner billing/access issues are blocking external conditions, not a reason to fake passing tests.

## Official implementation references (check latest versions before provisioning)

- Cloudflare Workers/Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Workers test harness and Workers Vitest: https://developers.cloudflare.com/workers/testing/
- D1 indexes and row-based query cost: https://developers.cloudflare.com/d1/best-practices/use-indexes/
- D1 read replication, opt-in Sessions API: https://developers.cloudflare.com/d1/best-practices/read-replication/
- R2 with Worker bindings: https://developers.cloudflare.com/r2/get-started/workers-api/
- Queues at-least-once/idempotency: https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- Cloudflare Worker Custom Domain for website host: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
## Payment integration invariant (ADR-0002)

Founder preference is **Google Pay India UPI** for eligible real-world payments; **Google Play Billing** governs in-app digital purchases unless a valid policy exception or approved/enrolled alternative program applies. The previous **Razorpay** integration is not copied. JODLO's backend must verify payments authoritatively, keep a separate immutable/idempotent transaction ledger and refund/reconciliation processing, and never release paid entitlements solely from client callbacks. **No payment provider or checkout is implemented.**

Read [payment strategy](PAYMENTS.md) and [ADR-0002](decisions/0002-google-pay-and-play-billing.md).

## Superseding no-staging architecture decision

Founder instruction (2026-10-27): complete Android/API/D1/R2/RTC/payment modules using local Wrangler workerd simulations, fake provider adapters and CI **without deploying a staging Worker**. Cloudflare credentials and DNS are not needed now. Real provider transactions, DNS/TLS and live Cloudflare permissions remain unverified until approved first production release, with controlled smoke tests and rollback. See [ADR-0004](decisions/0004-local-first-no-staging-until-production.md) and [Readiness](RELEASE_READINESS.md).

## Mandatory reuse and premium visual quality (ADR-0005)

Founder requires no unnecessary code repetition, duplicate media assets, unused SDKs or scattered style constants. Share tested API/domain contracts and relevant components; keep abstractions small and justified. All localized Android UI strings, theme colors/typography/corners/strokes/spacing/elevation and animations must use one founder-approved token system (future web has equivalent). Professional animated tabs/navigation/actions and selected immersive 3D are a *required visual direction* but must be lightweight, accessible/reduced-motion and measured on low-end Android. UI designs/palette are not approved yet. [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md) · [Reuse](REUSE_ASSET_POLICY.md) · [Design](DESIGN_SYSTEM.md) · [Motion](MOTION_3D.md).
