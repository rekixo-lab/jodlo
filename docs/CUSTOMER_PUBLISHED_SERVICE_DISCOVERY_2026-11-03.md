# JODLO — Customer published-service discovery and fresh Listing detail (3 November 2026)

**Product milestone:** actual end-to-end read-only customer path implemented in the existing backend API + Kotlin Core + native Android Compose + explicitly opted-in offline debug preview. **NOT** live customer/worker contact, activated Category seed or production deployment.

## What the customer can now do

1. Open the existing Customer screen, browse in **Hindi (Devanagari) or English**, or search by Category. The current backend has independently authorized Categories and public service listings.
2. Select **“Only categories with published services”** to request `availableOnly=1` in the existing public Catalog Browse and Search routes (including bounded keyset pagination). This means a Category has at least one *currently published/moderation-allowed public listing* according to existing D1 predicates. **It does not mean the Worker is online, accepting calls, nearby or free.**
3. Select a Category to see its paged currently published minimal public Listing entries. Tap a Listing to send **one fresh anonymous GET `/api/v1/listings?id=:listingId`**. A listing that disappeared or became hidden since the earlier category page returns **404 NOT_FOUND**, and the app displays a truthful “no longer public” state with back navigation. A transient backend failure can be explicitly retried; the UI never automatically resends writes because this flow contains no writes.
4. The detail response contains **only `{listing:{id,categoryId}}`** and never worker identity, phone, exact location, price, raw moderation reason, Google subject, verified badge, call/push state or contact action. It shares the identical current D1 active-account, worker-draft, approved Category, published/moderated predicates used for the existing paged public reader. The Kotlin response decoder rejects any extra or private fields and the repository checks that the server's ID and Category match the user's selection.
5. In the default **debug offline SAMPLE** mode, the sample adapter exercises exactly the same Kotlin repository + decoder and Compose navigation. Sample Categories `demo_service_26` through `demo_service_31` deliberately have no sample listings, so the published-only toggle visibly filters them. `demo_plumbing` has 27 synthetic listings for page continuation. It is clearly labeled **SAMPLE**, never real Workers or released Categories. Only the Customer preview reads local fake data; Worker sign-in and all other actions remain dependent on real server configuration.

## Backend detail contract

`GET /api/v1/listings/{opaqueId}` (anonymous, GET-only) is a strict opt-in detail query on the **existing approved public listings route**. It has the same no-cache and safety response headers as the existing router. Method mismatch returns 405. Malformed IDs, query parameters or body return 400. No configured D1 or SQL errors return sanitized 503. A currently hidden/unpublished/inactive/deleted Listing returns the same 404 as an unknown ID to prevent exposing moderation decisions. The existing collection route `GET /api/v1/listings?categoryId=...` and its original JSON envelopes remain unchanged.

The server does **not** infer new Worker presentation privileges or calling/availability consent. Direct Agora Internet audio first-contact remains the separately founder-approved *future transport*, not an automatic action on tapping a listing.

## Tests and acceptance

- Node local SQLite migration-backed API tests: minimal allowlisted detail, hidden and unpublished and inactive Category refusal; visibility changes **after** a previously public browse; worker/account disable and profile cascade; malformed GET/method/unknown backend/SQL failure, and stable paged-listing DTOs.
- Kotlin executable Core contract test: one anonymous GET, exact ID + Category response, reject extra worker/private fields and contradictory server responses, distinguish 404 from malformed data, no client-supplied worker bearer.
- Android-native APK compile under JDK 17 and JDK 21. Human phone smoke-test **still required**: enable sample, toggle published-only on/off, compare category list, select `demo_plumbing`, paginate listings, tap a listing, return to list and Category, change language; check large fonts and orientation. Compilation is not a physical-device acceptance.

**Release remains gated:** actual 889 Category review + explicit activation, M-003 safe public details/location/retention, M-005 live Worker presence/abuse/busy/report policy, M-006 Agora onboarding/token/signaling/ACK, M-008 real Google OAuth, M-007 controlled production-only release. Currently there is **no approved live Catalog seed, running Cloudflare backend or deployed Android release**. M-004 visual direction was approved on 2026-11-02; real-device usability review is separate.

This PR changes no live Worker metadata, D1 migration, location consent, payment, provider credentials, RTC/push sender or old Finworkar app. Historical Finworkar remains read-only.

Evidence links must be updated only after exact latest PR-head and independently merged-main **Foundation + Android-native** workflows pass.

Related: [Product-first milestones](PRODUCT_DELIVERY_MILESTONES_2026-11-03.md), [UI reference](UI_REFERENCE_2026-11-02.md), [Manual choices](MANUAL_ACTIONS.md), [Android developer APK](../apps/android/app/README.md).
