# Saved Services — manual bounded current-public review

**5 November 2026. Software milestone only.** This completes a missing Customer bookmark-management journey without pretending a Saved reference grants contact, identity, verification, location, live presence or calling.

## User journey

The Customer opens device-only **Saved Services / सेव की गई सेवाएँ**, and optionally taps **Check next 10 saved services**. For each of *at most ten* exact saved Listing/Category references in Saved order, Android performs **one** anonymous `RemoteCatalogRepository.approvedServiceDetail(listingId,expectedCategoryId,language)` request **sequentially**, using the existing same-DB public eligibility and approved Category name contract.

Results are shown immediately as *at the time of checking*, never "available now":
- **Public when checked** — the exact currently public Listing/Category/language was verified by the existing strict decoder and repository. Does **not** identify or authorize calling a Worker.
- **Not public when checked** — the current public GET returned **NOT_FOUND (404)**. The user can optionally remove their bookmark; the app does **not** delete it automatically or infer why it was hidden.
- **Could not confirm** — all other errors, including network, timeouts, rate limit, auth failures, 503 and invalid/forged responses. It is NOT treated as removal.

Each manual tap checks **at most 10** IDs, with a visible 0–50 progress/summary and row-specific labels. The current request finishes before **Stop after current check** takes effect; remaining requests are not sent. A new tap explicitly checks the next unreviewed ten; resetting/discarding review results is a separate action. There is no background polling, queue, push, automatic retries, parallel flooding, auto-erase or upload of the user's full Saved list.

The ephemeral results exist only in current Compose memory and are **never written to SharedPreferences**. Stored device bookmarks remain the original minimal `id|categoryId` list, limit 50. Opening any row later always issues a **fresh** detail GET, regardless of the earlier result. Saved item changes, language changes and API origin changes invalidate the old review snapshot; stale in-flight replies cannot reappear in a new Saved set. Card, remove and clear actions are disabled while a review request is in flight.

## Implementation and privacy

- `SavedServiceReview` Kotlin Core holds an immutable exact Saved snapshot and result map keyed only by the already-saved opaque Listing ID; no personal data, contact details, success timestamp, Category names or persistent status. A status change requires a matching entry and language. Duplicate/late/foreign responses and altered Saved lists cannot authorize "public".
- Compose **SavedServicesDashboard** keeps all actual network calls on `Dispatchers.IO`, sequentially, with generation fences and cancellation between requests. Failed GETs are not automatically retried.
- API routes, D1 schema, public DTOs and previously implemented current-public detail verification are **unchanged**.
- UI localization includes meaningful English/Hindi notices for check state, uncertainty and cancellation. Uses existing flat dark outlined controls, never fake call/profile buttons.

## Acceptance and remaining gates

Automated JVM tests cover all 50 Saved entries in exactly five manual 10-item batches, deterministic Saved order, successful exact public read, single 404 → not public, all other failure kinds → unknown, fake language/Category → unknown, no double-count, mutated Saved snapshot → invalidated and no persistence. Android native JDK17/21 builds and Foundation Kotlin/Node/D1/workerd/TypeScript must each pass at the exact PR-head SHA before merge and again after merge on the independent `main` commit. Software checks are not physical-device acceptance.

**Still not finished:** Worker public identity/experience/rate/area/media approvals, human Catalog review (historic 889 Categories/7,267 Services not activated), real Agora/FCM delivery, moderation/block/report, erasure/retention, payments, web and provider-owned production readiness. No Gmail/email access, remote Cloudflare D1 mutation, deployment, provider secrets, Finworkar legacy writes or physical-phone QA. Founder wants ONE final consolidated phone acceptance only after entire application is ready. Full backlog [#235](https://github.com/rekixo-lab/jodlo/issues/235).
