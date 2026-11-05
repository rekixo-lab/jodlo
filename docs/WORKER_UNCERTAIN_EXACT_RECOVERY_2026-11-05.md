# Worker uncertain-write owner-exact recovery — 2026-11-05

## Behavior completed in source (not a live release)

A lost Worker mutation reply must not become a success or a safe replay. The existing `HeadlessWorkerWriteScope.NeedsReview` fence stays active for ambiguous **Category edit, versioned Category edit, pause/unpublish, resume and publish**. There is **no automatic POST/PUT/DELETE retry**.

For an already-selected existing Service, the action carries one validated opaque Listing ID. The native bilingual Worker Dashboard now offers an explicitly requested **read-only exact owner status** action alongside its earlier one-page owner-scan fallback. This calls the pre-existing authenticated `GET /api/v1/me/listings?id=<id>&view=management` through the current in-memory session; it uses the existing `ExactManagedOwnListingRepository`, not a new endpoint, migration or public DTO.

- A success may show **only** the current owner Category ID, owner publication setting and current owner visibility. These can have changed on another device, by moderation or by catalog activation; they do **not** establish what happened to the original uncertain write.
- A generic owner 404 means absent, foreign, deleted or otherwise unavailable to the current account, **not** that a prior unpublish or edit succeeded or failed.
- A read failure, invalid returned ID, missing management status, old server or lost session yields **no trusted observation**. No raw network error body, bearer, Google subject, phone, user identity, moderation reason, rate, GPS or media is ever rendered.
- The scope stays in `NeedsReview` after any current observation. Explicit acknowledgement only clears the local write fence, and a later write still needs a new deliberate review and user action.
- A lost Publish response provides no trusted new Listing ID, so an exact read is **not offered** for Publish; users can deliberately inspect one bounded owner page at a time. Current page count, current matching visibility and whether the scan ended are displayed truthfully; no result claims causal write success.
- One exact read clears outdated paged-scan evidence; a later page read clears outdated exact evidence. Logout/session replacement cancels the in-flight read and forgets its private result. No read occurs automatically on launch, on write timeout or after acknowledgement.

## Verification

`apps/android/core/src/test/kotlin/.../HeadlessWorkerWriteScopeTest.kt` covers an uncertain edit with a changed Category, a generic 404, SQL/network error and mismatched Listing ID, prevention of a duplicate write, unknown-ID Publish refusal, exact pause/resume, single-flight races and account replacement while reading. Android native JDK 17 and JDK 21 compilation verifies bilingual screen integration.

**Source-only acceptance gate:** exact PR-head Foundation and Android workflows **and independent merged-main checks** must both succeed before this milestone may be called completed. Green checks are not real physical-phone proof, live Cloudflare deployment or proof of any prior write.

## Remaining gates

The full multi-field guided Worker editor and moderated public Worker profile are still open pending human-approved field-level data policies. No experience/rate/area/name/photos, provider call, real FCM, unapproved Catalog item, D1 migration, production write, legacy Finworkar modification, outreach email or phone test is part of this change. Actual production rollout and final single consolidated device acceptance remain separate gates under [#235](https://github.com/rekixo-lab/jodlo/issues/235).
