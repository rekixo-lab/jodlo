## Early owner-initiated clearing — 12 November 2026 (source only)

A signed-in JODLO account may now deliberately **Clear call history** from the existing Account history section after a separate bilingual, non-reversible confirmation. The private `DELETE /api/v1/me/call-history` route is behind the **existing default-OFF CALL_HISTORY_ENABLED** flag, requires a current session, rejects all query/body input and deletes only the matching active owner's terminal call-history summaries in D1. No other participant's history is touched. A second clear is idempotent. A lost response is **not** silently retried; previous page data is hidden and the user can explicitly reread.

This is narrower than full erasure: active calls, account identity, call admission/rate counters, external Agora/FCM/Play records, remote copies, legal holds and D1 backups are **not** deleted. The existing 90-day automatic retention remains. No new migration, credentials, default-on flag, production Worker release, email or device QA. It becomes usable against a real API only after the existing controlled migration/deployment/retention/rollback gates and a configured Android build have been verified.

# JODLO Account Call History — continuous reviewed pages (2026-11-10)

## User-visible change
Account → Call History → **Read history** opens a fresh current-account page. When 25 records have another cursor, **More** now appends older calls under already visible calls instead of replacing the screen with only the next page. An explicit **Read history** action starts a new snapshot.

Each row remains a minimal server-owned direction/outcome/date summary. This change does not show a caller identity, telephone number, token, contact, provider metadata, price, or a promise that a call connected.

## Safety contract
- A page is applied only to the exact in-memory authenticated account session generation and Worker-write revision that requested it. Account replacement, logout, and write changes cannot install a slow old response.
- More is manual; its requested cursor must match the currently loaded page's `nextCursor`. No blind auto-pagination or speculative retry.
- A strict typed network decoder accepts at most 25 unique valid rows and an explicit cursor. The headless `CallHistoryTimeline.merge` additionally rejects repeated IDs across pages, a wrong cursor, descending timestamp/ID order violations, oversized pages, empty continuation and a cursor not equal to a full page's last ID. Failed/expired continuation leaves previously reviewed rows intact with a retry/error state.
- The UI clears rows when a user explicitly refreshes or the account marker changes. Existing server authorization/retention checks still apply; no added persistent cache, schema, API route, Google/Agora/FCM integration or remote write.

## Evidence
- Native `CallHistorySection.kt` uses `CallHistoryTimeline.merge` in its actual session-bound read and renders accumulated entries.
- Existing Kotlin `JodloReplyDecoderTest.kt` executes strict backend JSON page decode plus two-page 30-record merge and negative cases.
- Existing foundation Node `worker-owner-private-ui.test.mjs` asserts the native wiring and no legacy page replacement.
- Acceptance requires exact PR-head and independent merged-main Foundation checks, plus Android JDK17/21 compilation. These prove source/test quality, not live provider or physical-phone quality.

## Unresolved production gates
Live D1 migrations, authenticated real-call history insertion/retention/cleanup, FCM/Agora two-device evidence, publisher-approved catalog, payment/legal/privacy controls, current Cloudflare deployed SHA, and one final integrated physical-phone acceptance remain open. No Finworkar writes, email, provider activation or Cloudflare deployment.
