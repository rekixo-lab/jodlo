# JODLO — Headless Android-compatible Kotlin Core (2026-10-28)

**Real Kotlin/JVM-compiled network source, not an APK or Android UI.** No founder-approved screen, theme, Activity, Android plugin, Manifest or user location permissions exist yet; M-004 visual approval is still required.

`apps/android/core` is the first platform-neutral Kotlin networking foundation for the future native application `com.rekixo.jodlo`. It constructs only previously approved backend routes: Hindi/English Category browse/search, strict cursor and optional `includeChoices=1`, category-filtered public listings, Worker opt-in/private draft, explicitly chosen Category ID publish/unpublish, owner listing and session logout. It does NOT auto-select a category, import the old 889 historic trades, add arbitrary PII, or activate a Category.

Its one-shot HTTPS adapter is synchronous and **must be called off the Android main thread** by a later asynchronous application adapter. HTTPS-only root origins, no redirects or automatic retries, bounded 10-second timeouts/64KiB body and redacted default debug output are enforced. A later production adapter still needs trusted origin configuration, lifecycle-aware concurrency, structured JSON response parsing and device tests.

Run the actual Kotlin compiler and contract suite:
```bash
gradle -p apps/android :core:verifyContracts --no-daemon
```
GitHub CI uses Gradle and Java 17 to compile and execute this test. Nothing contacts a real backend or provides a login secret. This is NOT an Android app build or runtime UI test.

**Still to create:** native Android `:app`, approved screen/theme/navigation, Android networking scheduler, JSON DTO parser, Google OAuth M-008 real-device integration, consent-based area M-003, real Contact/Request M-005, notification/calling/payment, physical-device tests and controlled M-007 production approval. Existing Finworkar remains read-only.

## 2026-10-28 — Typed JSON reply decoder and one-shot network safety

The new `JodloReplyDecoder.kt` is **real compiled Kotlin code** using `kotlinx.serialization-json:1.6.3` in the nonvisual JVM core. It accepts exactly the existing Cloudflare Worker `{ok,data}` or `{ok:false,error:{code,message}}` envelope with HTTP-status consistency. Typed results cover public Category browse (legacy/paged), search (including the **explicit** `needsChoice:true` case and bounded D1-active choice projection), public listings, own listings, explicit Listing publication and unpublication. Only `id,slug,name` / `id,categoryId` / `visible` public fields enter DTOs; unexpected account, phone, verification, location, owner or other new fields **fail closed**, not silently retained. Array lengths and IDs are bounded, duplicate Category/Listing IDs are rejected.

`ApiOutcome.Failed` carries a finite error **kind only**, never raw server messages or untrusted JSON. Server HTTP error code must agree with the envelope (401/403/400/404/405/429/503). Redirects, malformed/mismatched JSON, new unsupported fields, oversized responses, missing choice confirmation and malformed cursors are rejected as `BAD_RESPONSE`.

`performOnce` is a synchronous injectable one-shot transport boundary: `IOException` produces a safe `OFFLINE_OR_TIMEOUT` failure without leaking low-level detail. **No implicit retry or new permission to retry an uncertain POST/DELETE:** a lost acknowledgement may occur after the server committed the operation. Later Android callers must explicitly schedule the blocking `HttpsTransport.execute` off the UI thread; real Android lifecycle handling, JSON credential issuance and offline persistence remain unimplemented.

Execute **both** Kotlin contract suites:
```bash
gradle -p apps/android :core:verifyContracts :core:verifyReplies --no-daemon
```
GitHub CI compiles both Kotlin files/tests and runs both real JVM executables. No Android `:app`, Manifest, screen, theme, GPS, R2, Cloudflare deploy, real Google OAuth or new API route was added. M-003, M-004, M-005, M-007, M-008 are still gated.

## 2026-10-28 — Tested nonvisual Catalog and Worker Repository interfaces

The headless `JodloRepositories.kt` now exposes **two separately injectable interfaces**, `CatalogRepository` (public browse/search/listings) and `WorkerRepository` (opt-in draft/my listings, explicit Category ID publish and unpublish). Its implementations use only the established `JodloRoutes` request planner, `JodloReplyDecoder`, and the single-attempt `performOnce` transport boundary. An injected `RequestSender` allows **real compiled Kotlin behavior tests** against offline fake responses; actual HTTPS transport can be injected via `HttpsTransport.asRequestSender()`, later called off the UI thread.

The repositories **never store bearer tokens**, auto-select ambiguous search results, publish anything from a Search response, retry an unacknowledged POST/DELETE, or infer “verified” worker identity. A successful Worker opt-in is strictly `WorkerDraft(status="draft")`. The following additional response-scope checks fail closed: returned Hindi/English language must match request; normalized Search echo must match the requested query; paged results may not exceed requested limit or replay the cursor; search `needsChoice` cannot appear without explicit opt-in; public listing and publication Category IDs must equal the exact requested ID. These are consistency checks, not substitutes for server D1 authorization.

All **three** Kotlin suite executables compile and run locally in CI:

```bash
gradle -p apps/android :core:verifyContracts :core:verifyReplies :core:verifyRepositories --no-daemon
```

New `JodloRepositoryTest.kt` uses a fake, *no network or Google tokens*, and checks a complete read-only Search → manual Category selection → authorized-request construction → public/own Listing → unpublish path. It rejects wrong-language, wrong-query, wrong-category, forged verified profile, pagination contradiction and transport loss. This is **not Android APK/integration, native device session storage or UI**. Worker eligibility still depends on approved-active backend Categories only; M-003/004/005/007/008 remain explicitly gated.

## 2026-10-28 — Headless in-memory session and worker state

New Kotlin `InMemorySessionCoordinator.kt` reuses the existing `WorkerRepository` and strict reply parser. This is NONVISUAL, not an Android APK or verified Google mobile sign-in.

- Only accept the exact *server-issued* Google-exchange response containing an opaque 43-character Bearer and 1–3600 second lifetime. The caller MUST have acquired the response from the trusted backend over HTTPS. The decoder cannot authenticate a randomly supplied JSON response or Google identity on its own; M-008 remains pending.
- A private process-memory token powers the client; only `SignedOut` and `SignedIn(worker=UNKNOWN|NO_DRAFT|DRAFT)` are exposed as state. Tokens are not copied into UI, disk, telemetry, debug messages, saved state or repositories. Java/Kotlin strings cannot be guaranteed securely zeroized. Process termination discards the session.
- Session expiry uses an injectable MONOTONIC elapsed clock, not a changeable wall clock. A `404 NOT_FOUND` worker-profile result means `NO_DRAFT`, while successful opt-in means `DRAFT`; neither claims worker verification.
- On 401, local session is invalidated. Offline or server errors do not grant new worker permissions or silently erase valid worker state. Logout clears memory BEFORE requesting server revoke, whether one-device or all-device. If revoke fails, it is explicitly **unconfirmed**; the server may still accept the previous token until expiry. No automatic retries.
- Each privileged operation checks session generation after its network response. A late result from an older login or logout cannot mutate a newer worker state or report authenticated success. This cannot reverse an already-committed remote POST; do not automatically retry ambiguous publication.

Actual fake-clock, fake-network Kotlin suite `:core:verifySessions` covers verified shape, memory-only state, TTL expiry, invalid/extra token data, worker profile 404, 401 revocation, local-first logout, all-device reply, offline uncertainty and late response/re-login races.

Run all four compiled Kotlin suites:
```bash
gradle -p apps/android :core:verifyContracts :core:verifyReplies :core:verifyRepositories :core:verifySessions --no-daemon
```

Still no Android `:app`, Activity, UI, credential storage, on-device Google SDK, real approved Category seed, location data, customer contact implementation or Cloudflare deployment. Founder M-003/004/005/007/008 remain independent.

## 2026-10-28 — Kotlin worker session race and single-flight guard (CI pending)

Nonvisual Kotlin `InMemorySessionCoordinator` now reserves **one worker write per session** across opt-in, explicit Category publish and unpublish. A concurrent write is rejected with `SessionFailure.OPERATION_IN_PROGRESS` **before a second network call** (no queue, automatic retry or exactly-once server guarantee). Worker-profile and own-listings reads capture a revision and reject overtaken responses with `STALE_RESULT`, preventing a delayed pre-opt-in 404 from downgrading a successful DRAFT or a stale listings response from appearing current. Write reservations are released on remote failures and unexpected injected-adapter exceptions, with replacement-login isolation preserved. Real executable fake-interleaving tests were added to existing `:core:verifySessions`. This remains a blocking, headless Kotlin JVM library, not an Android Activity/APK/Google SDK. No personal location, active Category seeds, contact workflow, Cloudflare deployment, UI or Founder approvals were added. M-003/M-004/M-005/M-007/M-008 remain independent. Verify PR CI and a separate green merged-main run before marking complete.


## 2026-10-28 — Fakeable Google backend exchange (CI pending)

Nonvisual Kotlin `InMemorySessionCoordinator.signInWithGoogleIdToken` now uses `BackendGoogleSessionExchange`, injectable `RequestSender`, and the existing `POST /api/v1/auth/google` JSON contract. Only a bounded 4096-character JWT-shaped proof is accepted; the outbound request has no bearer, keeps the proof out of its path and redacted debug descriptions, and uses the existing strict issued-session decoder. The HTTPS request body cap is 8192 bytes for this route alone; other requests remain at 256 bytes. The backend alone verifies Google identity; the Kotlin Core does not implement any Google provider or actual OAuth flow.

An older login response cannot replace a newer login attempt, trusted installed session or logout (including logout while signed out). Failures preserve an existing session. An already-issued server token could still exist after an uncertain exchange; no automatic POST retry, remote revocation guarantee or secret persistence has been added. New fifth compiled suite `:core:verifyAuthExchange` tests exact JSON, invalid proofs, failures, slow responses and logout races. Run with the previous four suites using `gradle -p apps/android :core:verifyContracts :core:verifyReplies :core:verifyRepositories :core:verifySessions :core:verifyAuthExchange --no-daemon`.

No Android APK/UI, native Google Sign-In, approved Category activation, private location, customer contact, Cloudflare deployment or device integration has been added. Founder gates M-003/M-004/M-005/M-007/M-008 remain unchanged. PR and independent merged-main CI must pass before declaring this complete.


## 2026-10-28 — Cooperative cancellation of slow Kotlin session operations (CI pending)

Added real nonvisual, thread-safe `CancellationSignal` using an atomic flag, accepted optionally by Google backend exchange and authenticated worker read/opt-in/publish/unpublish operations. A pre-cancelled operation sends no request; when cancellation occurs while a request is blocked in the fake transport, its response is discarded and cannot overwrite current worker/login state. The worker single-flight write reservation is released even after cancellation. A genuine server 401 still signs out locally, and logout/re-login supersession takes precedence over cancellation. The client deliberately does NOT interrupt an already-started HTTPS request, reverse a committed server write, revoke a remotely issued login token, guarantee exactly-once semantics, or automatically retry POST/DELETE. Logout stays local-first and is intentionally not cancellable.

A sixth compiled JVM test executable, `:core:verifyCancellation`, exercises real thread/latch-controlled slow read, publish and login, pre-send cancellation, remote unauthorized handling and logout races. Reuses existing `InMemorySessionCoordinator`, backend request sender and strict decoders; no visual Android app, permissions, GPS, real OAuth credentials, Category activation, contact workflow or remote deployment. Founder gates M-003/M-004/M-005/M-007/M-008 remain unchanged. PR and independent merged-main CI required before calling this verified.


## 2026-10-28 — Nonvisual lifecycle-scoped marketplace reads (PR/main CI pending)

Added real compiled Kotlin `HeadlessMarketplaceReadScope` on top of the existing `CatalogRepository`, `InMemorySessionCoordinator`, `CancellationSignal`, and backend route validators. It provides separately isolated, latest-request-wins states for **read-only** Category browse, bilingual Catalog search, public listings, private worker draft check and own listings. `MarketplaceReadSnapshot` has immutable typed `Idle/Loading/Ready/ApiError/SessionError` values; neither opaque bearer nor Google proof is present. A scope must be used off the main thread for network operations and closed by its future approved view lifecycle; `close()` cancels all outstanding signals, clears cached values, rejects future operations and discards late responses. `clearSearch()` cancels only Search while preserving other lanes. Invalid route inputs are rejected before replacing active reads.

An internal non-secret session epoch advances on login replacement, logout, unauthorized or expiry, allowing the read scope to drop **cached private worker information** even if the future caller forgets to close it. In-flight old-account requests cannot repaint private data. The coordinator never posts a listing or opts a user into worker mode: the explicit worker mutation flow and server authorization remain separate. Cancellation cannot roll back an already-sent HTTP request. No Jetpack Compose, ViewModel, Activity, Android APK, observable UI design, real provider, GPS, new active Category, customer contact, Cloudflare provisioning or deployment.

New **seventh executable Kotlin JVM suite** `:core:verifyReadScope` tests latest-search-wins concurrent slow replies, independent browse/listings, lifecycle closure, clear/invalid searches, safe failures, private data purge on account change/logout and 401 authorization rejection. CI runs all seven Kotlin suites alongside the existing backend, D1, docs/design/founder and Wrangler dry-run gates. M-003/M-004/M-005/M-007/M-008 remain unchanged; do not mark complete without green PR and separate exact-commit main CI.


## 2026-10-28 — Headless uncertain-worker-write review (PR/main CI pending)

Added `HeadlessWorkerWriteScope` to coordinate only **explicitly chosen** existing active-category worker publish and own-listing unpublish via `InMemorySessionCoordinator`. It never derives a write from Search, generates a Category approval, retries a POST/DELETE, or claims to undo a request already sent to the backend. Genuine positive server acknowledgement creates `Confirmed`; no-network, malformed reply and server-availability failures create `NeedsReview` with one unresolved action and block further writes. Rejected server failures are typed without exposing the original message. The caller can **explicitly** request one authenticated `myListings` GET to observe `VISIBLE`, `NOT_VISIBLE` or `NOT_IN_FIRST_100`; an observation is **not evidence that the previous mutation committed**. In particular, `visible=false` may result from moderation/inactive Category, not an actual unpublish. The capped 100-row response means missing rows are inconclusive. Explicit acknowledgement only releases the local guard; it never certifies a write or secretly resends it.

The scope is nonvisual, lifecycle-closeable, concurrency-safe, process-memory-only and clears any pending action when the authenticated session changes. A newly added non-secret `writeRevision` fingerprint in `InMemorySessionCoordinator` also invalidates `HeadlessMarketplaceReadScope`'s cached private worker status and owned listings whenever **any** worker mutation starts, including requests whose acknowledgements are lost. Existing route ID validators are reused. Eighth actual JVM test suite `:core:verifyWorkerWriteReview` covers uncertain and rejected POSTs, read-only visibility, manual acknowledgement, no duplicate sends, concurrent read/write races, scope closure, account switch and private cache invalidation. GitHub CI runs all eight suites plus Node, docs/design/founder, local D1, strict TypeScript and dry-run builds.

No actual Android app/UI/APK, live Google SDK, Google credential/provider setup, personal areas/GPS, active pilot category import, customer contact, Cloudflare resources/deployment or Finworkar modifications. M-003/M-004/M-005/M-007/M-008 and Hindi-Devanagari/English-only policy remain intact. Real PR CI and an independent green merged-main run are needed before reporting success.


## 2026-10-28 — Headless public Catalog refresh barrier after worker writes (PR/main CI pending)

Added **process-local, non-secret public-read revision and in-flight write counter** to the existing `InMemorySessionCoordinator`. A reserved worker opt-in/publish/unpublish write advances the revision **at start and again in finally**, even on timeout, cancellation, account replacement or injected adapter exception. Previous public GETs may no longer be current. These counters never expose an account ID, Google proof or bearer and remain valid across local logout while an older request finishes. This does **not** detect changes from other devices/workers; those still need a fresh explicit server read.

The existing **nonvisual** `HeadlessMarketplaceReadScope` now marks **public Category Browse, Search and Listings** `ReadState.RefreshRequired` after a local worker write, cancels stale in-flight replies, and returns `ReadCompletion.DEFERRED` **without sending a GET while any worker mutation is on the wire**. Once the write resolves, a caller can explicitly invoke the existing public read methods to replace each lane with current server data. No hidden timer, background refresh, network polling, automatic POST/DELETE retry, optimistic publication or new backend route was added. Closing the scope is permanent and keeps its cached data empty.

Added real ninth Kotlin JVM suite `:core:verifyPublicRefresh` with thread/latch interleavings for delayed public GETs, writes that finish before old GET replies, no-GET-during-write, one explicit refresh after the barrier, uncertain publish/unpublish invalidation, lifecycle close and non-mutating login/worker-read isolation. GitHub CI compiles and runs nine Kotlin suites alongside the existing 211 Node tests, local D1, TypeScript, docs/design/founder and dry-run builds.

Still **no Android APK/UI**, native OAuth setup, personal location, contact workflow, real active Category activation, Cloudflare provisioning or deployment. M-003/M-004/M-005/M-007/M-008 remain pending. Pilot names Bilaspur/Raipur are not geo or Category approval. Only Hindi (Devanagari) and English. Verify real PR CI and separate exact-main green CI before claiming completion.


## 2026-10-28 — Bounded public cache freshness and explicit refresh (PR/main CI pending)

Nonvisual `HeadlessMarketplaceReadScope` now bounds successful **public** Category Browse, Hindi/English Search and Public Listings cached states to **60 seconds from the GET request start by default**, using a monotonic process clock. A requested/public snapshot lazily marks an over-age `Ready` result `ReadState.RefreshRequired`, clears its cached content, and requires a new **explicit** GET; an unusually slow GET already beyond the limit at response time is discarded. Clock regression fails closed, and per-read state remains independently refreshed. The caller can call `requestPublicRefresh()` to synchronously invalidate all three public lanes and cancel late results, without issuing network traffic or changing authenticated worker state. Default window is 60,000 ms; a testable bounded constructor option accepts 1–300,000 ms. The TTL is a local display freshness upper bound, **not** real-time proof of live remote data or cross-device synchronization.

Added compiled **tenth** Kotlin JVM test suite `:core:verifyPublicFreshness` covering exact expiry boundary, selective explicit refetch, very slow GETs, manual invalidation during a live request, clock rollback, independence of worker/own-listing states, invalid configurations and permanent lifecycle close. Prior worker write barriers and no-retry guarantees remain. All ten Kotlin executables plus the existing Node, docs/design/founder, local D1, strict TypeScript and Wrangler dry-run checks are required in CI.

No new backend endpoints, polling/automatic traffic, push subscription, Android UI/APK, location/GPS, Google credentials/provider, active Category activation, contacts, Cloudflare staging/production deployment or Finworkar modifications. Founder M-003/M-004/M-005/M-007/M-008 remain pending; only Hindi (Devanagari) and English. Verify the actual PR and independent merged-main CI before claiming success.


## 2026-10-28 — Headless Catalog cursor/offset pagination safety (PR/main CI pending)

Added real compiled Kotlin `HeadlessCatalogPaginationScope` built on existing `CatalogRepository`, `JodloRoutes`, `InMemorySessionCoordinator.publicReadMarker()` and monotonic age checks, without new backend routes or Android visuals. Category Browse is a separately scoped **cursor** sequence; Catalog Search is a separate bounded **offset** sequence, with `includeChoices` only on the first page and ambiguous Search choices terminal until a new explicit Search. Each next page is an **explicit one-shot GET**. Starting a fresh Search/Browse resets only its own sequence and rejects older network replies. Appends are atomic and reject duplicate Category IDs across pages, including items shifted between offsets/cursors. An invalid page, expired first-page freshness window (default 60 seconds for the **whole** sequence), explicit refresh or locally observed worker mutation never leaves a mixed accumulated dataset accepted as fresh; next-page operations are blocked until a new first page. Local worker writes defer public page requests without sending a GET. Hard bounds stop Browse continuation after 20 pages and prevent exposing Search offsets above the existing route maximum of 100. The repository/route remains responsible for current response validation and bounds.

`PageState` and `CatalogPageSnapshot` expose only public Category IDs/names, selected language/filter/query, ambiguity choices and pagination metadata; no tokens, contact fields, locations or verification claims. This is **client-side anti-mixing**, not a transactionally consistent remote snapshot: the current API supplies no global revision and independent server-side changes across requests may still occur, even if no duplicate is observed. No auto-pagination, polling, writes, imported/activated Categories, UI, GPS, contacts, Google native SDK, cloud provisioning/deployment or Finworkar changes. Founder M-003/M-004/M-005/M-007/M-008 remain separately gated; Hindi Devanagari/English only, Bilaspur/Raipur city names are not operational approval.

The eleventh executable Kotlin JVM test suite `:core:verifyPagination` verifies cursor/offset accumulation, new-query supersession, first-page-only search choices, duplicate fail-closed, delayed network replies, age expiry during paging, worker write barriers, manual refresh, lifecycle close and the API offset-100 cap. CI runs all eleven JVM suites plus existing 211 Node API tests, local D1, docs/design/founder, TS and Wrangler dry-run checks. Do not mark complete before green PR CI and a separate exact-main green CI.


## 2026-10-28 — Explicit Customer Category selection and public Listings navigation (PR/main CI pending)

Extended the existing **nonvisual Kotlin** `HeadlessCatalogPaginationScope` (no duplicate HTTP adapter or Android UI) with `CustomerSelectionState` and `CatalogPageSnapshot.selection` (default `Idle` for backward compatibility). A caller may explicitly `selectCategory(source, exactCategoryId)` **only if that ID belongs to the CURRENT ready Browse categories, normal Search categories or ambiguous Search `choices`**. Ambiguous suggestions are never auto-chosen and never treated as worker publication consent. Selection alone sends **zero requests**; only a separate explicit `loadSelectedListings()` fetches `GET /api/v1/listings?categoryId=<exact-selected-id>` using the existing read-only `CatalogRepository` / route. Results contain exclusively allowed public Listing IDs and Category IDs, not private profiles, contacts, location, verification claims or bearer.

A newer page in the selection's source, changed query/filter, explicit refresh, 60-second sequence freshness expiry, locally observed worker mutation or lifecycle close cancels the old selection and discards any late Listings response. A worker write in progress defers selection/listing GETs without issuing traffic. Concurrent duplicate Listings GETs are blocked; strict public response checking (same Category, max 25 rows, no duplicate IDs) yields typed `BAD_RESPONSE`, never an optimistic visible result. Caller may deliberately re-request a GET following a typed failure. Independent Browse/Search lanes preserve each other's selection until its own source changes. The scoped list is only a **read snapshot**, not real-time cross-device freshness or evidence of worker approval.

Added **twelfth compiled Kotlin JVM suite** `:core:verifyCustomerSelection` with synthetic ambiguous choices, exact-ID protection, explicit read only, changed Search and concurrent slow GET, local worker-write barrier, TTL, manual refresh, malformed/mismatched API result, repeat request, and permanent close. GitHub CI runs this alongside existing 11 JVM suites, 211 Node tests and all docs/design/founder, local D1, TypeScript and Worker dry-runs. No UI/APK, native Google OAuth, personal GPS/location, active pilot Category seed, contact workflow, Cloudflare deployment or Finworkar modifications. M-003/M-004/M-005/M-007/M-008 remain unchanged; Hindi (Devanagari) and English only. Require green PR and separate exact-merged-main CI before marking complete.


## 2026-10-28 — Headless Customer Back navigation and safe source-page restoration (PR/main CI pending)

Extended the **existing**, nonvisual `HeadlessCatalogPaginationScope` with `CustomerNavigationState` / `CustomerDestination` and optional `CatalogPageSnapshot.navigation` (default root Browse for existing consumers). There is **no** Activity, Compose view, theme, APK or Android navigation library: these are pure Kotlin state transitions for a future explicitly approved visual experience. The previously added `startBrowse` / `startSearch` select the corresponding destination; **only an explicit Category choice** enters the Public Listings destination. Navigation is deterministic: Listings Back returns to the source Browse/Search, Search Back returns to Browse, root Back is blocked, and closed Scope rejects navigation. `showBrowse()` / `showSearch()` revisit unexpired cached public source pages with **zero new GETs**. The app shell, not this code, would own device Back/system exit semantics after M-004 approval.

Leaving Listings synchronously cancels in-flight Listing GETs, drops the selected Listing data and rejects late replies. Leaving Search while its initial GET is in flight cancels it and marks Search `RefreshRequired`, retaining an independent valid Browse page. Expired source TTL, explicit refresh, worker write revision, manual selection clearing or lifecycle close still prevent stale data restoration. No implicit search/category choice, worker opt-in, publication, customer contact, data persistence, polling or network replay. Current Catalog API lacks snapshot revision; restored pages are bounded **local** cache, not real-time cross-device proof.

Added thirteenth real Kotlin JVM suite `:core:verifyBackNavigation` with source-preserving Back stack, direct Browse choice, slow Listings GET / Search GET rejection, public TTL expiry, worker mutation, destination revisit without network and permanent close. CI includes all thirteen JVM suites, 211 Node tests, docs/design/founder safety, local D1, strict TypeScript and Wrangler dry-run. All gates M-003/M-004/M-005/M-007/M-008 remain unresolved and unchanged. Hindi in Devanagari and English only. No Finworkar changes or Cloudflare deployment. Require green PR plus independent exact merged-main CI before completion claim.
