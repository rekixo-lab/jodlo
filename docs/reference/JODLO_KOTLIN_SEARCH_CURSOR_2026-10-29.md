# JODLO — Headless Android Kotlin cursor Search (2026-10-29)

**ADR-0011 / all legitimate trades, no ten-category cap.** The Worker already supports optional `GET /api/v1/catalog/search?q=...&cursor=1&limit=25&after=...` for exhaustive active-Category discovery. This change adds a **separate opt-in route, DTO decoder and repository interface** to the already compiled nonvisual Kotlin Core; existing offset Search, human-ambiguity confirmation, fake adapters, and old API response contracts are unchanged.

## Developer integration

```kotlin
val publicSearch: CatalogSearchCursorRepository = RemoteCatalogRepository(sender)
var after: String? = null
do {
    val result = publicSearch.searchCursor(
        query = "सेवा", language = Language.HI,
        availableOnly = true, limit = 25, after = after
    )
    when (result) {
        is ApiOutcome.Ok -> {
            // Surface only these existing active Category id/slug/name values.
            // A user's own explicit Category choice is required for any action.
            after = result.value.nextCursor
        }
        is ApiOutcome.Failed -> {
            // Stop; no silent fallback, retries or guessed future cursor.
            break
        }
    }
} while (after != null)
```

The example is headless illustration only, not a new Android UI or Activity. The blocking transport must run off Android's main thread. The caller must not fabricate anchors, reuse a cursor with different language/query/availability, treat a completed page as human approval of an original historical Category, or auto-publish listings. The server's cursor is a public `sort_order:CategoryId` pagination position, **not a signed snapshot** or an identity/verification claim. Network errors must not be retried blindly. No bearer token, personal location, worker identity, contact information or saved history is involved.

The new `JodloRoutes.searchCursor` refuses malformed input, overlong/unsafe Unicode, pages larger than 25 and invalid `after`. `JodloReplyDecoder.searchCursor` accepts exactly `language/query/categories/nextCursor` (the last field is REQUIRED, but may be null); rejects legacy `nextOffset`, `needsChoice/choices`, private/extra fields, unsupported locale, duplicate IDs and invalid cursor grammar. `RemoteCatalogRepository.searchCursor` additionally checks reply language, normalized query echo, maximum page size, full-page continuation, last-result cursor ID and monotonically advancing public position. The interface is independent of the old `CatalogRepository.search` contract to avoid changes to existing Kotlin flows.

Already-wired compiled Kotlin JVM suites cover route/decoder/repository faults, one-shot offline failures, private-field rejection and **889 synthetic active categories over 36 local fake-network pages**. The server's own local D1 integration tests check 889 equivalent rows, active eligibility and `availableOnly=1`. No actual 889 historical Categories are seeded, approved or activated.

Run with `gradle -p apps/android :core:verifyContracts :core:verifyReplies :core:verifyRepositories --no-daemon` or repository CI (which exercises all pinned Kotlin suites). No Android application UI, real Google OAuth, precise location, contact request flow, staging/production Cloudflare deployment, private records, Finworkar writes or owner/legal approvals are introduced. M-003/M-004/M-005/M-007/M-008 remain independently gated; an overall founder instruction to continue engineering does **not** certify each regulated or specialist trade, exact worker scopes, translations or future release gates.
