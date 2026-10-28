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
