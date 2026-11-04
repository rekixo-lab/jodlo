# JODLO — all-category public Services feed (4 November 2026)

## User journey and status
A Customer with a **configured HTTPS JODLO API** can open a separate **Services / सेवाएँ** tab to browse *all currently eligible* published Service Listings across approved active Categories. It is independent of the existing Category browse/Search and does not restrict public launch scope to the first five reviewer Categories. One bounded page is loaded when the user opens the tab; more pages require a deliberate tap. Every row uses the existing exact two-field anonymous Listing DTO `{id,categoryId}`. No PII, owner/profile, phone, email, rate, location, trust badge, calling availability, count or creation timestamp is disclosed.

- Customer may switch Hindi/English. Names are looked up only through existing active, approved public `GET /api/v1/catalog?lang=...&ids=...`, in at most 20 distinct Category IDs per page. If lookup fails or a name becomes unavailable, the Category ID remains visible; neither name nor feed membership implies ongoing eligibility.
- A Listing card tap performs a **fresh anonymous `GET /api/v1/listings?id=...`** and checks both returned ID and original Category. Save/remove works only after that successful read, using existing device-only Saved Services; the UI never assumes previous page eligibility is still valid.
- The Services tab is not shown in unconfigured debug/offline sample builds. No automatic notification, Google login, GPS, Agora, contact or paid transaction occurs.

## Backend, privacy and stability contract
`GET /api/v1/listings?feed=all&limit=1..25[&after=<opaque-listing-id>]` is a new **opt-in mode of the same read-only endpoint**. It does not modify any existing `categoryId=...` or `id=...` GET response. `limit` is mandatory (max 25). Unknown, duplicate, mixed category/feed, malformed cursor, request body and non-GET requests fail closed. A disabled/missing D1 returns sanitized 503, never source SQL or owner details.

The same existing `PUBLIC_LISTING_ELIGIBILITY` D1 join checks the worker's active account, opted-in draft profile, **current** active Category, publication and moderation. The cross-Category cursor is a previously public Listing ID, and its CURRENT full eligibility is checked inside the *same SQL statement* as continuation. A hidden/unpublished/deleted/disabled anchor yields an empty page, with no cross-Category historical ordering leak. Pages sort by the existing `created_at,id` stable keyset; no offset, timestamp, identity, location or client scores.

New migration `0009_public_cross_category_feed_index.sql` creates a **partial read index only** on existing `worker_listings(created_at,id)` under published + allowed. It does **not** insert/update/delete a row or activate the historical Catalog. CI applies it **locally**. The real production D1 already has 0001–0008 per owner evidence; 0009 is **NOT verified applied remotely** and must not be executed except by a separately authorized operator after actual backup, identity, safety and read-path checks. The existing deployed API does not gain this mode until a controlled upgrade.

## Acceptance and gates
- Backend synthetic SQLite/Worker tests: current public 32-row cross-Category paging, stable ties and exact DTO; hidden/moderated/inactive/unpublished exclusion; cursor revocation, invalid query and SQL leakage failures; partial index query plan.
- Kotlin Core route and Repository tests: anonymous `feed=all` URL, malformed cursor/limit refusal, reject private fields, forged next cursor, duplicates, offline recovery. Original Category-only reads retain their DTOs and behavior.
- Android UI: new live-only Services tab with approved dark/outline components and full `values`/`values-hi` translations; explicit pagination, language refresh, stale-request generation guard, fresh detail and device-only Save action.
- **Verification required before considering merged work completed:** exact PR-head Foundation and **native Android JDK 17/21 APK** Green; independent merged-main workflows Green. No physical-device acceptance or newly deployed API is claimed from CI.
- **Unresolved product gates:** all 889 historical Categories are only review targets; production Catalog was 0 approved Categories/0 public Listings at last owner check. No publicly useful Worker profile/rates/media, service-area, real Agora+FCM, moderation workflows, retention/account erasure, billing or phone/release approval has been supplied. New code does not replace those approvals.

No legacy Finworkar write, email, provider call, secrets, D1 production mutation, app signing or release was performed by this engineering task.
