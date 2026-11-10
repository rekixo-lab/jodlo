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
