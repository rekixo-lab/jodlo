# JODLO — Finworkar Infrastructure Audit and Greenfield Architecture Blueprint
**Date:** 2026-10-27 (India) | **Status:** Proposed architecture based on verified source and current vendor documentation; not production deployment | **Android:** `com.rekixo.jodlo` | **Domain:** `jodlo.rekixo.com`

## 1. What was actually inspected and what was not

Read-only source trees on `main` of three GitHub repositories:

| Existing repository | Source HEAD | Recorded inventory / key discoveries |
|---|---|---|
| `rekixo-lab/finworkar-android` | `0ad9ddd230439f76da363c6bbacdddb35288704f` | 549 file blobs, 155 Java/Kotlin files under application package, 354 Android resources. Native Java/Kotlin multi-Activity architecture; Firebase Auth/Firestore/Functions/Storage/FCM/Analytics/App Check, Agora voice SDK, Razorpay, Google Maps/Places and AdMob. `HomeActivity.java` ~2472 lines; `GuidedAddPostActivity.java` ~3508 lines; `CallService.kt` ~2254 lines. |
| `rekixo-lab/finworkar-backend` | `f31d089953f68868108f5d475436842b55c10204` | 126 repository files, ~73 feature files in `functions/src`, ~20 backend tests. Node 22 and Firebase Functions v2 with Express entrypoint and many individually exported callables/triggers; Firestore rules, 71 composite indexes and 39 field overrides. |
| `rekixo-lab/Finworkar-web` | `3b4e7ce3d5d7a2cab244fedef43be4728b913823` | 31 source files. Mostly static Firebase Hosting site, privacy/support/delete/refund pages, invite/share rewrites, `/p/**` dynamic function rewrite. Website static version text is older than Android source; live release not established. |

**Limitations:** This is a structural source review, not a complete line-by-line exploit audit; no live Firebase project access, no real performance/load tests, no user records, no real Cloud Billing, no Android device runtime; no claim about production deploy state. Existing infrastructure is READ ONLY. New repository `rekixo-lab/jodlo` was empty and GitHub connector write calls returned 403 previously; this blueprint is local until independently confirmed pushed.

## 2. What to preserve conceptually and what to replace

| Current legacy design | Why / finding | JODLO greenfield decision |
|---|---|---|
| Many Activities with mixed UI, Firebase calls, permission handlers and state | `HomeActivity.java` and `GuidedAddPostActivity.java` are very large and costly to change/test safely | **REPLACE:** Kotlin, single activity, feature screens + ViewModels + repositories; optional Compose only after founder's UI decision. |
| Direct Firebase SDK access in Android via `FinFirebase.java` | Ties UX/data layer to Firestore, Auth, callable functions, Storage | **REPLACE:** typed HTTPS `/api/v1` via OkHttp/Retrofit or Ktor; server-only D1/R2 access. Local cache via Room/DataStore as needed. |
| `functions/src/index.js` many exported Firebase callable functions/triggers | Numerous deployment identities and cross-file orchestration | **REPLACE:** 1 modular Cloudflare Worker HTTP API at launch, internal feature folders; no separate Worker per route. Split on measured need. |
| Firestore rules + 71 composite indexes / 39 overrides | No direct portable database schema; useful permission and access patterns | **REPLACE:** D1 relational schema with tested SQLite indexes and guarded application authorization; implement DB migrations, never port Firestore queries literally. |
| `HomePosts.js` geo-bounded Firestore pagination, nearby snapshot sessions | Source uses radius/search caps, geohashes, session paging; potential read amplification | **REBUILD:** D1 indexed cell/radius/city search, keyset pagination, bounded candidates; no unconditional scan of all workers. Test Hindi relevance. |
| `fwMatcherEngine.js`, category corpus and catalog search | Hindi/Hinglish token normalization and synonym handling is a valuable domain insight | **RETAIN AS TEST IDEAS:** build small normalization + lexical matching corpus with at least 100 genuine queries; don't copy Node filesystem-heavy matcher into every edge request. |
| `AddPost.js` + mandatory photo validation, image moderation / server PII redaction | Prevents spam and leaks, but can add onboarding friction | **REBUILD:** draft/confirm API; validations and R2 upload/scan pipeline; optional photo policy determined by evidence and founder. |
| `calling.js` (~2152 lines), `CallService.kt` (~2254), Agora & FCM | Many call delivery/billing states; correctness and Android lifecycle complexity | **REBUILD WITH ISOLATION:** CallCoordinator state machine, CallMediaProvider, PushProvider, BillingPolicy. Evaluate Cloudflare Realtime SFU vs existing Agora performance on Indian phones. Do not run voice RTP through Worker HTTP endpoints. |
| Razorpay + Firebase wallet credits / membership/minutes | Old system is not JODLO account/merchant; server-side verification principles valuable | **DO NOT PORT RAZORPAY:** Google Pay India/UPI preferred for legally permitted categories; Google Play Billing for applicable digital goods or approved alternative program. Double-entry or balanced append-only ledger, verified webhooks/receipts, idempotent fulfillment, reconciliation. |
| `maintenanceSchedules.js`: 7 groups, 21 subtasks (consolidated source) | Approx 2,689 possible group schedule ticks/day if source consolidated layout live; actual costs not verified | **REPLACE:** event-driven Queues first, alarm/scheduled rare housekeeping only. Privacy deletion, refunds and call reconciliation must still work if no traffic. |
| `user_location.js` live geo + privacy cleanup and 60-day history | Location state and retention can cause privacy and write churn | **REDUCE:** manual city/area from day one, device GPS optional; store only required approximate grid/cell/public area, exact coordinates private, purpose/retention/consent enforced. |
| `nearby.js` Firestore event-driven bulk FCM | Push fanout may be costly at scale; FCM unavoidable for Android reliable background push | **REBUILD:** Queue and consent-first FCM sender with rate caps, dedupe, recipient filtering and payload privacy. |
| Admin panel with audit, moderation, deletion | Safety needs persist even when scope is simplified | **REBUILD LATER:** admin via separate authentication/Cloudflare Access, RBAC, immutable audit, deletion and support. No broad admin key in Android. |
| Firebase Hosting static web / old deep-links | Independent JODLO domain, no legacy redirect requirement | **REBUILD:** Cloudflare Workers Static Assets or Pages on `jodlo.rekixo.com`, public landing, share preview, verified App Links, legal pages and sitemap. No UI work without founder approval. |

## 3. Proposed runtime topology (separation by criticality, not dozens of services)

```text
 Google Play                                Browser
    |                                         |
 JODLO Android (native Kotlin)      jodlo.rekixo.com (Cloudflare static assets)
    |          |                             |
    +--- HTTPS /api/v1 ----------------------+--- public share pages
                       |
              Cloudflare edge / WAF / rules / rate limit
                       |
         JODLO API Worker (TypeScript, modular monolith)
             | auth guard | versioned routes | validation | tracing
             |
             +-- modules/accounts       -> D1 users/sessions + provider adapter
             +-- modules/workers        -> D1 worker profiles/availability
             +-- modules/listings       -> D1 listings/categories/visibility
             +-- modules/discovery      -> D1 cell+category+status indexes
             +-- modules/interactions   -> D1 leads/contact intents/reports
             +-- modules/media          -> R2 private originals, derived thumbnails
             +-- modules/payments       -> policy router + ledger + provider adapters
             +-- modules/calls          -> call state + RTC token integration
             +-- modules/notifications  -> queue publisher
             +-- modules/admin          -> privileged auth + audit, later
                       |
             +-- D1  (source-of-truth transactional relational data)
             +-- R2  (media, private assets, independently authorized access)
             +-- Queue consumer(s) (push, moderation, emails, cleanup, reconciliation)
             +-- Durable Objects (ONLY if warranted for realtime call signaling/presence)

 External integrations (not hosted on Cloudflare):
 - Google Play Billing; Google Pay India/UPI + merchant bank/PSP verification
 - Google sign-in/identity option, FCM for background device pushes
 - Voice media provider: evaluate Cloudflare Realtime SFU native WebRTC vs Agora/other
```

**Important:** "Cloudflare first" does not eliminate the Google Play store, the Android runtime, push transport, bank/PSP, Google Pay SDK, payment verification or third-party RTC when technically necessary.

## 4. Modules and allowed dependencies

Every module has: `contract` (public types), `handler` (HTTP), `service` (business rules), `repository` (D1), `policy` (authorization/privacy), `tests` (unit and integration). The router cannot contain billing logic; domain services cannot read raw `Request`/Wrangler globals; interfaces inject platform adapters. Modules interact through narrow application services, not imports into each other's database internals.

Recommended initial modules: `system`, `identity`, `users`, `workers`, `catalog`, `listings`, `discovery`, `interactions`, `media`, `moderation`; later `notifications`, `calls`, `payments`, `ledger`, `reviews`, `admin`, `analytics` as usage justifies. Avoid empty placeholder packages and 20 Worker deployments. Only expose routes that exist and are tested.

Example directory intent:

```text
jodlo/
  apps/
    api/
      src/
        index.ts
        app.ts                 # compose minimal router/middleware
        shared/{errors,auth,config,validation,logger}.ts
        modules/{identity,workers,catalog,listings,discovery,interactions,media}/
          {routes,service,repository,schemas}.ts
        adapters/{d1,r2,google-identity,push}.ts
      tests/{unit,integration,contract}/
      wrangler.jsonc           # no secrets; env bindings after authorization
    android/                   # NEW Kotlin project after founder's UI review
      app/
      core/{network,data,designsystem,model,testing}/
      feature/{auth,discovery,worker,listing,contact,settings}/
    web/                       # Cloudflare static app after UI approval
    admin/                     # privileged optional UI after RBAC design
  packages/contracts/         # OpenAPI/schema, generated Kotlin client if useful
  infra/{d1/migrations,observability,runbooks}/
  docs/{ARCHITECTURE.md,PRODUCT_REQUIREMENTS.md,PAYMENTS.md,ROADMAP.md,
        ARCHITECTURE_RESEARCH_20261027.md,decisions/}
  .github/workflows/checks.yml
```

Start with *folders as features are implemented*. Avoid creating large framework dependency graphs prematurely. Public Android design-system components and screens need founder approval before implementation.

## 5. D1 schema draft and query strategy (NOT migrations yet)

- `users(id, status, created_at, deleted_at)` — internal IDs, minimal PII.
- `identities(user_id, provider, provider_subject_hash, verified_at)` — unique external identity, security review of hashing/linking needed.
- `sessions(id, user_id, refresh_token_hash, expires_at, revoked_at, last_seen_at)` — if using app-owned sessions; secure refresh and device revocation.
- `worker_profiles(user_id, title, about, area_id, availability, verified_level, updated_at)` — verified_level must not pretend government ID verification.
- `areas(id, city_id, slug, display_name, cell_id)` — canonical, localized geographic label; avoid building GPS dependence into identity.
- `categories(id, parent_id, slug, active, rank)` and `category_aliases(category_id, locale, normalized_text)`.
- `listings(id, owner_id, category_id, area_id, status, visibility, created_at, updated_at, score_version)`; `listing_cells(listing_id, cell_id)` for geographic lookup.
- `media_assets(id, owner_id, r2_key, mime, size, status, created_at)` + separate moderation events.
- `contact_requests(id, buyer_id, worker_id, listing_id, state, created_at)`; prevent spam and keep private communication internal.
- `reports(id, reporter_id, subject_type, subject_id, status, created_at)` and `moderation_actions(...)`.
- `outbox_events(id, kind, payload_ref, state, attempts, created_at)` for reliable DB-write→queue bridge where atomic handoff is needed.
- *Later only:* `calls`, `call_events`, `payment_orders`, `payment_events`, `ledger_entries`, `entitlements`, `refunds`, `audit_events`.

Index by actual composite access patterns, e.g. `(category_id, area_id, status, updated_at DESC, id DESC)` and `(owner_id, updated_at DESC, id DESC)`, never blanket create all combinations. Use keyset pagination `(updated_at, id)` rather than OFFSET at high volumes; bounded candidate sets, query plan tests and sane page cap. For nearby radius, prefilter by city / grid-cell / coarse geohash, then distance-rank only bounded candidates, not all rows. Use Hindi/Hinglish normalized aliases and targeted lexical search, benchmark before adding specialized search service or assuming arbitrary FTS module behavior.

D1 is SQLite-backed with finite per-database size. **Current documented paid single database limit: 10GB; free: 500MB (as of Oct 24, 2026)**; size and consistency are architecture constraints, not promise of unlimited scale. Read replicas require D1 Sessions API and consistency/bookmark handling; single primary remains relevant for authoritative writes. Shard/partition or a different database *only if measured growth/transaction requirements justify*. D1 Time Travel backups are not a substitute for verified restore practice.

## 6. Critical state machines

### Calls (when approved)
`requested → ringing → accepted → connecting → active → ended`; side paths `missed/declined/failed/timeout`, every transition authorized and idempotent. One server authoritative source of call/billing state, immutable event IDs, lease/expiry and bounded retries, client out-of-order reconciliation. Never debit merely for an unanswered ring. Test lock screen, FCM blocked, network switch, double-answer, app killed, clock tampering, out-of-order end events and refund/settlement. Voice packets go via selected media provider, not D1/Worker API. Evaluate Cloudflare Realtime SFU plus native WebRTC integration vs Agora on p95 connection time, audio quality, regional jitter, pricing, battery, SDK weight and maintenance. **Provider choice not yet made.**

### Payments
The founder chooses Google Pay India/UPI **where eligible**; not Razorpay. For Play-distributed digital credit/minutes/subscriptions Google Play Billing ordinarily applies unless approved alternative or exemption. Model catalog and channel eligibility first; never create a checkout without founder merchant/Play eligibility confirmation. `created → pending → verified → fulfilled`, optional `failed/expired/refunded/disputed`. An external callback or Android success intent is NOT settlement proof. Verify server-to-server, use unique provider event IDs, idempotent ledger updates and one-transaction fulfillment; refunds/reconciliation independent of queue duplicates. Never store old Finworkar money/data.

### Media
Private R2 upload grant with short expiry and content type/size restrictions, process/scan/strip EXIF and contact data, produce small web-friendly derivatives, only then publish. Queue consumers are retryable and must be idempotent with dead-letter monitoring. R2 signed PUT URLs are supported; protect object visibility via server-side metadata, not merely URL obscurity.

## 7. Android architecture and speed requirements

- Modern native Kotlin with one activity, navigation, screen ViewModels + StateFlow and unidirectional events, use cases *when complexity justifies*, thin UI; Compose is a technical default proposal but MUST obtain founder approval before UI screens/theme are authored.
- Network: typed client with cancellation/timeouts, retry only idempotent requests, auth/session refresh guards, TLS, versioned error models, request IDs.
- Local cache: DataStore for preferences and Room for a bounded, privacy-conscious listing cache/drafts when needed. Offline screens and skeletons without fake data.
- Image decode/caching, thumbnail sizes, WorkManager for resumable background uploads and FCM token lifecycle; no regular GPS polling without consent.
- Target real Android hardware: budget devices, limited memory, low bandwidth, Hindi font/readability, notifications denied and GPS denied scenarios.
- **Provisional targets only:** health/simple cached edge path p95 <300ms server-side; feed path benchmark p95 <600ms on reference region, first page <=20 records, compressed first-page payload ~20–40KB without images, image thumbs <=120KB where quality permits, Android jank <5% on reference phone. Targets revised only after device and network tests.

## 8. Cost, reliability, security and release safety

- One paid/free Worker entry rather than many schedules. Add Queue only when real background events; avoid cron-every-minute unless a safety need cannot use an alarm/event. Critical refund/deletion/reconciliation tasks need periodic recovery or outbox polling backup regardless of traffic.
- Workers plan has CPU/memory/subrequest limits; test worst-case input and slow DB. Prefer efficient indexed D1 queries, fewer roundtrips and private R2 media.
- Observability: request correlation IDs, module tags, status, D1 rows read/written, Worker CPU & p95, Queue age/retry/DLQ, R2 operations, call connection stats, payment mismatch counts. Log no raw GPS, phone, tokens or payment PII.
- Auth: select reviewed identity approach (Google sign-in with server-validated audience/nonce or external identity provider). Cloudflare Access is appropriate for admin but **not a drop-in consumer sign-in system**. Android application integrity checks and server anti-abuse recommended.
- Security: server-only D1, deny by default, owner ID is derived from validated auth, strict authorization by row, no public upload bucket, encrypted secrets, CSP where relevant, signed webhooks/receipts, input/output schema, rate limits, human moderation/report routes and deletion.
- Data governance: minimal collection, real deletion/account closure and retention, India privacy/policy legal review and real user consent before launch; production backup and restore tests.
- CI on every PR: `npm ci` with committed lockfile, TS check, lint, unit, Worker-local integration tests, Android Gradle tests once Android exists, schema migration tests, dependency scanning. **No auto deploy.** Separate dev/stage/prod accounts or at least isolated databases/buckets/namespaces and credentials; merge only when GitHub shows actual green checks. GitHub account runner permission/billing failures cannot be fixed by rewriting tests.
- Release: staging manual approval, canary, verify new migrations are compatible, flag-off behavior, monitor, rollback. Do not modify old Finworkar.

## 9. Practical build order and founder checkpoints (not rigid days)

| Milestone | Implement / validate | Gate |
|---|---|---|
| A — Foundation | GitHub access, clean Worker, TypeScript, source control, lockfile, tests, green CI, Cloudflare account/zone inventory | **Manual:** GitHub App repository authorization; Cloudflare owner authorization. |
| B — Data design | Product model sign-off; initial D1 schema/migrations, area/category/listing contract, index and benchmark, auth sessions | **Manual:** product roles, first 2–3 service types, data/privacy review. |
| C — MVP API | Identity; worker profile; listing CRUD; guest search with manual area; R2 upload and moderation | Real tests and staging security, no customer data in shared env. |
| D — UI checkpoint | Show app user flows, wireframes, typography/theme, accessibility and founder suggestions | **Mandatory founder visual approval before Android/website UI implementation.** |
| E — Native mobile | Kotlin app, network, login, location optional, listing/search, image upload, offline states, tests | Functional native emulator/real-device and performance evidence. |
| F — Safe contact | Contact intent + FCM, call media provider spike and state machine, report/block | Android background delivery, RTC/retry/settlement tests. |
| G — Payments | SKU classification; Google Pay India onboarding/verification; Google Play Billing/allowed alternative rules; ledger/refunds | **Manual:** merchant/Play program eligibility, founder pricing UI/release approval. |
| H — Public launch | Domain website/share pages, deletion/privacy, honest screenshots/video, load/cost tests, canary | Staging green, recovery drills, support process, founder sign-off. |
| I — Pilot/growth | real local supply/demand, genuine successful jobs and retention metrics | Optimize measured bottlenecks before new infrastructure. |

## 10. Decision checklist / items intentionally undecided

**Firm now:** JODLO brand; separate new ID and domain; leave legacy untouched; native Android; Cloudflare Worker API; modular monolith; Google Pay priority for eligible use; Play compliant digital billing; founder UI signoff; no fake test/CI claims.

**To validate before committing to design:** customer posting a request vs only discovering service listings; exact two-sided first use case; phone OTP vs Google login; initial identity provider; worker verification level; voice calling provider; media moderation provider; actual Play SKU legality; production residency and budget; D1 benchmark under realistic concurrency; content/search ranking; founder theme and screen flow.

## Official research references (checked 2026-10-27)

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- D1 platform limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 read replication and Sessions API: https://developers.cloudflare.com/d1/best-practices/read-replication/
- R2 signed upload URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Cloudflare Queues retry / DLQ: https://developers.cloudflare.com/queues/configuration/dead-letter-queues/
- Durable Object WebSocket hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Realtime SFU: https://developers.cloudflare.com/realtime/sfu/
- Cloudflare Realtime TURN: https://developers.cloudflare.com/realtime/turn/
- Workers observability: https://developers.cloudflare.com/workers/observability/
- Android app architecture: https://developer.android.com/topic/architecture/recommendations
- Play Billing: https://developer.android.com/google/play/billing
- Alternative billing: https://developer.android.com/google/play/billing/alternative
- Google Pay India merchants: https://support.google.com/console/answer/10945206

**Audit type:** Architecture/structural and vendor platform research. No code or DB schema deployed, no production evidence collected, no owner UI approval presumed.