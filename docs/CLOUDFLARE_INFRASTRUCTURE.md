# JODLO Cloudflare-first infrastructure — detailed blueprint

**Status:** Proposed; NOT provisioned/deployed. New product and Cloudflare project completely separate from the live Finworkar/Firebase infrastructure. Design prioritizes simple safe releases, low idle overhead, predictable spend and smooth Indian mobile UX.

## Recommended runtime topology
```text
                           jodlo.rekixo.com
                              Cloudflare DNS/TLS
                  +--------------+----------------+
                  |                               |
         Static web/public share pages       /api/v1 JSON
           (after owner UI gate)                 |
                  |                         edge WAF/rate-limit
                  +-------------------------- API Worker
                                              single typed router
                                              feature service modules
                                       +----------+-----------+
                                       |          |           |
                                      D1         R2      Queue producer
                                   source of    private      |
                                    truth       media     consumers+DLQ
                                       |          |
                               External APIs only when approved:
                                identity/FCM/RTC/GooglePay/Play
```
The Android app is a native installed binary and talks to the API over HTTPS; a Worker cannot run native Android code or act as a bank/Google Play store.

## What to use, when, and why
| Component | Initial phase | Role and careful limits |
| --- | --- | --- |
| **Workers TypeScript** | MVP API now (health local only) | One Worker/app with bounded routers; no Express port; stateless request code, versioned `/api/v1`. |
| **D1 SQLite relational** | On first data feature, after schema review | Users, identities, workers, categories, localities, listings, leads, reports; indexes and explain plans; transactions for consistency. Plan capacity/region/backup; avoid query scanning. |
| **R2** | On first media feature | Private originals + derived thumbnails, temporary upload grants, MIME/size/EXIF moderation checks and safe publication. Never make bucket public by habit. |
| **Queues** | When async tasks truly exist | At-least-once delivery, idempotent consumers, bounded retries and dead-letter processing for moderation, notifications and payment reconciliation. |
| **Durable Objects** | ONLY if realtime signaling coordination needs it | Per-session state/ordering; not replacement for native voice media. Benchmark alternatives first. |
| **KV/Cache API** | Only measured public read bottleneck | Cache safe public catalogs/search facets with clear TTL/invalidation. Don't cache private identities, tokens, wallet or location data. |
| **WAF/rate limits/Turnstile where appropriate** | Before public launch | Shield abused public endpoints; app auth/authorization and business limits still implemented at Worker. |
| **Workers Observability/logging** | From staging | Request IDs, non-PII errors, p95, CPU time, DB rows read/write, R2/Queue outcomes and budget alert coverage. |
| **Cloudflare Access** | Privileged admin later | Protect admin frontend/service. Not a consumer Android auth replacement. |
| **Cloudflare website assets/Pages** | After design review | Landing, legal/deletion, actual share previews, SEO + Android App Links. Custom domain DNS/TLS must be confirmed without changing live old site. |

## Database and search intent, not yet schema-applied
Core tables when approved: `users`, `identities`, `worker_profiles`, `categories`, `category_aliases`, `areas`, `listings`, `listing_cells`, `contact_requests`, `media_assets`, `reports`, `moderation_actions`. Add `payments`, `payment_events`, `ledger_entries`, `call_sessions`, `call_events` **only when corresponding features and verification rules are specified**.

- Server-generated opaque IDs and indexes for category, area/cell, status, popularity/recency as justified.
- Privacy: manual area first; precise user coordinates private with consent, purpose and retention. Public area/cell should not reveal raw home GPS.
- Discovery: category+cell+status filters, candidate caps and keyset pagination, then bounded distance/ranking. No full table scan for each app keystroke.
- Use prepared SQL, transactionally enforce ownership and status, and benchmark D1 `EXPLAIN QUERY PLAN` under realistic test data and concurrency.
- Design an escape hatch for growth: partition by region/tenant or adopt more capable database based on **measured** volume/consistency requirements. D1 does not mean unlimited write scaling or automatic global strong-consistent replicas; follow current limits and Sessions API documentation before using read replication.

## Env and deploy pattern (planned)
```text
local/dev:    wrangler dev / fake data / separate bindings
staging:      jodlo API staging Worker + own D1/R2, tests, manual reviewer
production:   separate Worker + own D1/R2/secrets, explicit founder launch approval
```
Maintain least-privilege Worker bindings, typed env interfaces, no secrets committed to Git, no client DB credentials, no prod identifier in tests, and narrow origin/CORS policy (native Android is not subject to browser CORS in the same way as web). Migrations must be reviewed, versioned and applied by a controlled deploy job, never lazily by user traffic.

## Reliability and operations
- Limit requests with CPU timeouts, explicit input sizes, maximum SQL rows and paging.
- `requestId`/trace without raw phone, tokens, GPS or payment PII.
- Retry only safe operations; queue consumer, payment fulfillment, call transitions and upload completion must be idempotent.
- Backups/recovery, R2 cleanup and data deletion/retention test before real users. Outbox+scheduled recovery needed for safety-critical work even when traffic stops; do not *blindly eliminate all* cron.
- Collect actual Cloudflare bill/usage and evaluate D1 reads/writes/rows, Workers CPU/subrequests, R2 requests/storage and queue delivery; budget alerts alone are not always a hard spend cap.
- No GitHub push-to-prod automatic deployment until CI passes and founder separately approves deployment workflow. No operational change to old `rekixo.com` DNS that could impact Finworkar.

## External integrations unavoidable or undecided
- Google Play Store and Android runtime are outside Cloudflare.
- Native FCM delivery, Google/phone OTP identity provider if selected, device integrity checking.
- Google Pay India merchant/UPI acquiring PSP verification for eligible transaction types; Google Play Billing for in-app digital products unless valid enrolled alternative.
- Voice calling: evaluate Cloudflare Realtime SFU/native Android WebRTC against alternatives; token generation and state on API Worker, media outside ordinary HTTP route.

## Decisions deferred with tests
Auth provider, D1 residency/capacity and benchmark, Cloudflare Realtime vs Agora/other, WebSocket signaling/DO, merchant program eligibility, worker ID verification, media scanning provider, region/city, search index complexity. Track them via ADRs and founder approval when appropriate.

## Authoritative references to recheck at implementation
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/best-practices/use-indexes/
- https://developers.cloudflare.com/d1/best-practices/read-replication/
- https://developers.cloudflare.com/r2/get-started/workers-api/
- https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/realtime/sfu/
- https://developer.android.com/topic/architecture/recommendations