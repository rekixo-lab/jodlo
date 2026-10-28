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
