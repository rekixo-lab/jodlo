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
