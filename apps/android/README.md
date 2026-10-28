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
