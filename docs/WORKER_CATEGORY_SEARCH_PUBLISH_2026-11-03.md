# Worker Category Search → explicit Listing publication (3 November 2026)

## Why this is a product milestone

The real native Worker Dashboard previously offered only 20 Hindi Categories at a time through Browse. JODLO's all-889-category review target makes selecting the right trade by scrolling impractical. The underlying API and headless Kotlin Core **already implement** active-only Hindi/English Search and authenticated Worker publication, so adding a second endpoint or a second HTTP stack would be unnecessary duplication.

## Real end-to-end behavior in this change

1. With an approved backend and genuine Google Worker session, Worker opens a private draft and sees **Hindi / English** Category selection. The language switch clears previously fetched results, previous cursor and selected Category.
2. Worker can enter a 2–64 Unicode-code-point query and tap **Search**. The existing `RemoteCatalogRepository.searchCursor(query, language, limit=20)` performs one public GET through `GET /api/v1/catalog/search?cursor=1`. Cursor paging uses the stored submitted query and language, **not whatever is currently typed**. The existing decoder/repository verifies language, query, page size and bounded keyset. The same screen can **Browse approved Categories** using the existing `GET /api/v1/catalog` and its keyset.
3. Only *approved, active* Categories can be returned by the server. Worker selection is a separate explicit tap; merely searching, changing language or browsing does **not** publish. Publishing uses the **unchanged authenticated** `HeadlessWorkerWriteScope.publishExplicitCategory`, and the server still validates worker account/draft, active Category and moderation.
4. A new query or language clears previous rows and the selected Category, so an old selected Category is not silently published under a different query. The page continues after its own cursor only; a mismatched stale cursor is rejected. Failures are visible without treating a failed fetch as an empty catalog; earlier pages remain visible, and a user must request Retry. An empty successful result offers another search or Browse.
5. The entire flow uses the founder-approved flat black/green outlined components and localized Hindi/English strings. Blocking repository operations remain off the UI thread, single-flight with no automatic write retry. Worker access is never provided by the debug-only Customer sample.

## Acceptance matrix

| Case | Expected |
| --- | --- |
| Browse in Hindi, then select English | Prior cursor, selected row, labels and page are invalidated; new English GET required |
| Search for a real Category | Only approved active matches from the existing public Search repository; no location/phone/worker identity |
| Search empty, one character, control text or over 64 code points | No request; validation shown |
| Search reaches 20 results | Next Page preserves the submitted query, selected language and server cursor; typed edits do not alter existing page request |
| New Search or Browse | Clear previous selected Category and cursor before opening the new result set |
| Failed first page | Failure + Retry, not a dishonest “no Categories” message |
| Failed continuation | Previously verified rows remain; retry the same cursor |
| Select Category, then Publish | Existing owner-authenticated write only, existing safe unknown-outcome UI, no background duplicate writes |
| No configured backend / OAuth / active Categories | Existing truthful unconfigured / empty states; no fake Worker data or privilege |

## Boundaries and pending real-world verification

No D1 migration, new public field, provider credentials, Google OAuth bypass, Worker identity disclosure, calling permission, payment, production deployment, Finworkar writes or automatic 889-Category activation. This is source-level Android functionality using **existing** API/backend and core infrastructure, **not a working production Worker account**. It must pass Foundation and Android-native JDK 17/21 GitHub Actions at the exact PR head, and independently on merged main. Device verification still needs an authorized test account, a separately approved reachable backend and reviewed active Categories; never claim native compilation equals phone acceptance. Cloudflare staging remains prohibited by project decision.

Next meaningful milestone: a fully authenticated Worker on-device creation/unpublish journey with reviewed public metadata and actual production configuration at the approved launch stage; M-003 privacy disclosure, M-005 safety rules, M-007 release and M-008 OAuth remain independent gates.
