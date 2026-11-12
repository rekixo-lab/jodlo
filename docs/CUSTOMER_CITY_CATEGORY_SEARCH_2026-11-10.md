## 12 November 2026 — City-qualified Search now excludes empty city Categories

A user who deliberately picks **Raipur** or **Bilaspur** and searches for an approved trade now uses the same `GET /api/v1/catalog/search` with opt-in `cursor=1&availableOnly=1&city=raipur|bilaspur`. Search returns only approved/active Categories with at least one **currently published, moderation-allowed, active Worker Listing declaring that city**. This is evaluated atomically in D1 with the same public eligibility predicate as city-filtered `/listings`; it does **not** infer GPS or Worker presence. Selecting the result still requires a fresh city+Category feed and exact public Detail read before any Customer action.

The older global Category Search and legacy offset/curated choice response remain unchanged. `city` is rejected unless both cursor mode and `availableOnly=1` are explicit; foreign cities, duplicate city keys and extra owner filters are rejected. This avoids a global Category shown as if a Worker were available in a city. Exact city predicate is applied to the current cursor anchor, conflicting curated aliases and page query—losing the only city Listing invalidates continuation. No new migration, permissions or user tracking.

Real local HTTP/D1 regressions cover two cities, distinct trades, moderation removal, invalid input, multi-page city results and stale anchor. Kotlin route and actual Compose source wiring tests enforce the new mode. Source-only: neither qualified human Catalog approvals nor actual real Worker availability, Firebase/Agora or final physical-device QA is evidenced here.

# JODLO Customer city + approved Category search (source-only, 10 November 2026)

## What actually changes
The native **Public Services Feed**, including the explicit Bilaspur/Raipur city-scoped mode entered from Nearby, can now search the **already approved and active Category taxonomy** in Hindi or English. Search is user-initiated, bounded to 2–64 Unicode code points and uses the existing exhaustive public `GET /api/v1/catalog/search?cursor=1` through `RemoteCatalogRepository.searchCursor`. The operator must still independently approve/activate Categories before any real public results exist. No legacy catalog is auto-imported.

A user taps a Category from Search results; **only then** does the native client load `GET /api/v1/listings?feed=service&lang=...&categoryId=...&city=...`. The server must independently enforce the current public listing, account, Worker, Category and moderation predicates and the Worker-declared city. A Category being found in a global search says **nothing** about whether a Worker serves that city. If none qualify, the existing localized empty-state is shown. A service card must still pass a fresh exact public Service Detail GET (including city) before showing reviewed profile or any contact action.

## Safety and reliability constraints
- Search returns Category IDs and approved names, never people, worker IDs, phone, GPS, address, scores, verification or availability. No background keystroke/search request. No device or account location used; city is selected explicitly.
- All Search continuation uses the submitted query/language and current public Category cursor, not text edited afterward. Ambiguous or rejected search never fabricates a match.
- Changing city, Category filter, language, repository or selected detail invalidates stale async generations, clears old feed/search results and removes old checked-public evidence. A former city's listings must not survive city switching.
- City scope requires currently public Worker-declared city; **it does not verify that a Worker is physically near the Customer**, that they are online, or that the Worker can accept a call.
- No new API route, migration, D1 write, staff moderation bypass, provider integration, production deployment, manual human account or paid service.

## Test gates
- `apps/api/tests/nearby-city-search-journey.test.mjs`: real router plus synthetic fully migrated SQLite/D1, 3 fake Worker accounts, published services in two cities, approved-category Search followed by exact city+Category feed and current public Detail. Moderator revocation removes service from both public feed and exact Detail. Invalid cities/owner query filters are rejected.
- `scripts/nearby-city-search-integration.test.mjs`: verifies native explicit Search, exact route wiring, session-free Category search, city-scoped feed, fresh reviewed detail and lifecycle invalidation.
- JODLO Foundation CI and native Android JDK 17/21 builds must pass on the same PR head before merging; postmerge main checks are separate. Real-device end-to-end, Catalog review/activation and provider acceptance still require a future release gate.

## What remains blocked
The historical 889 Categories / 7,267 Services are **reference-only**; the initial five Category review issues (#216–#220) have no independently verified specialist signoffs or founder activation. Do not seed the production D1, suggest that a current Worker exists, or infer an active marketplace from a successful synthetic test. This is one component of the still-open overall product milestones in #235.
