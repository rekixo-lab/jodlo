# JODLO — Headless Kotlin full-catalog Search pagination (2026-10-29)

**Nonvisual integration only · ADR-0011 full legitimate-trade breadth.** The Worker API and `RemoteCatalogRepository` already support strict `cursor=1` Search. Previously `HeadlessCatalogPaginationScope.startSearch/nextSearch` could use only the legacy 0..100 offset and first-page `includeChoices=1`, despite the cursor repository being able to traverse more than 125 matching Categories. The new optional state-machine entrypoints bridge that gap, preserving **all** old contract semantics.

## Public, explicit calls

```kotlin
val scope = HeadlessCatalogPaginationScope(
    catalog = remoteCatalogRepository,
    session = inMemorySessionCoordinator,
)
// CALL OFF THE Android main thread, only when a future approved user flow asks:
scope.startCursorSearch("सेवा", Language.HI, availableOnly = true, pageSize = 25)
val state = scope.snapshot().search
// When state is PageState.Ready and nextCursor != null:
scope.nextCursorSearch()
// Retry only after failed/expired state, never automatically:
scope.retrySearch()
```

- `startSearch`, `nextSearch`, existing legacy Search choices and `nextOffset` are **unchanged**. `startCursorSearch` uses a separately required `CatalogSearchCursorRepository`; a legacy mock that lacks the interface fails with `BLOCKED`, without replacing its prior page. `nextSearch` cannot advance a cursor result, and `nextCursorSearch` cannot advance an offset/choice result.
- The persisted **process-local intent only** includes `cursorMode` (default `false`), normalized query, language, availability and page size. `captureRevisitIntent`/`restoreRevisitIntent` retain no actual page, cursor, worker, location, token or private records; a restore sends **zero** GETs. `retrySearch` returns to the same chosen protocol at page one, not a stale cursor.
- Bounded 1..25 rows per explicit request; up to 1,000 user-triggered cursor pages in the same snapshot (sufficient to traverse all 889 reviewed-*when separately activated*-categories even with pageSize=1). No automatic multi-page fetch, background polling or uncontrolled API requests. Each page reuses the existing query echo, locale, bound cursor, full-page continuation and last-ID ordering safeguards. A duplicate across pages or a newly empty continuation invalidates the entire accumulated cursor view rather than displaying a mixed stale partial result. Backend is not a transactional cross-request snapshot.
- Shared `HeadlessCatalogPaginationScope` lane already drops late replies after a new query or explicit cancellation, invalidates cached public pages on worker writes, enforces a monotonic freshness window, blocks stale next pages, and preserves explicit customer Category selection without automatically posting. No unsupported Hinglish or transliteration; exactly Hindi Devanagari and English.

The compiled existing `:core:verifyPagination` suite now runs new **889 synthetic active Category** 36-page cursor navigation, 0 legacy offset sends, explicit ID selection, missing-cursor-repository fallback, invalid forged page, partial/duplicate conflict, choice/offset separation, human retry, intent restoration with zero automatic GET, expiry, in-flight worker write deferral and stale response rejection. All previously registered Kotlin suites run in CI via `:core:verifyHeadlessCore`; Node/D1/workerd, docs and Founder CI gates remain active.

**Not authorized or performed:** importing/activating 889 historical Categories or 7,267 Services, publishing unreviewed/high-risk occupations, assigning legal/regulated scopes, approving semantic translations, adding Android Activity/theme/visual UI, storing GPS/PII, enabling real contact, staging/remote Cloudflare, Google OAuth credentials, payments or modifying Finworkar. Founder gave general permission to continue work for all *legitimate* trades; qualified human trade/safety/language review and final category/region/contact/moderation policy remain necessary. M-003/M-004/M-005/M-007/M-008 gates remain independent.
