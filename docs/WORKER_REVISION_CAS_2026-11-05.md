# Worker Service revision-safe Category edits — 2026-11-05

**Purpose:** finish a meaningful conflict-safe **Category-only** Worker editing slice across current D1 SQL, authenticated API, Kotlin Core and Android Compose. This is source engineering **only**, not a complete multi-field Worker profile, worker identity verification, a phone-ready product, migration approval or live deployment.

## Why old expected Category alone was insufficient

An old client could load Category A, while a second device (or old v1 route) changed A→B→A. The original expected-Category CAS then saw A again and could accept a stale A→C edit. The new opt-in **revision** CAS sees revision 2 instead of old revision 0 and rejects with generic HTTP 409. The same version increments for a *real* moderation status change or publish/pause/resume transition, even when an older client performs it. Read-only Category/account activation changes are still enforced separately by current authorization and active-destination SQL.

## Forward-only migration 0011 (local only)

`infra/migrations/0011_worker_listing_revision.sql` adds exactly one **private** `worker_listings.revision INTEGER NOT NULL DEFAULT 0 CHECK(0..2147483647)` column; **no rows** or public/personal fields are inserted. One `AFTER UPDATE OF category_id,status,moderation_status` trigger increments it exactly when one of the three values actually changes; its own `UPDATE revision` cannot recursively fire the field-specific trigger. The new CAS requires `0 ≤ expectedRevision ≤ 2147483646`, checks current authenticated owner, Worker draft, account active, current moderation allowed, distinct approved next active Category, original Category and unique owner/Category before atomic write. SQL CHECK prevents overflow. Existing v1 writes and current two-field public Listing DTOs remain compatible and also increment revision through the trigger.

**Production must not receive migration 0011 from CI or this PR.** Live Worker/API version and remote D1 schema are not freshly verified. A later owner-operated release needs verified database and API ownership, backup and rollback drill, migration ordering 0009→0010→0011, reviewed operations, and a separate delivery acceptance. An old deployed API cannot fulfill new revision read/edit; the Android edit UI blocks instead of doing an unsafe downgrade. All other Worker actions continue to use their preexisting authenticated contracts.

## Opt-in authenticated API

`GET /api/v1/me/listings?id=<opaque-listing-id>&view=revision` returns exactly `{ok:true,data:{listing:{id,categoryId,visible,publicationStatus,revision}}}`. The revision belongs only to the authenticated Worker owner and is not included in older `view=management`, legacy owner pages, public Customer Listings or Worker profiles. Absent/foreign/deleted/inactive-owner rows are the same 404. No account ID, moderation reason, GPS, phone, rate, experience, media or verification.

`PUT /api/v1/me/listings?revision=1`, with **only** canonical JSON `{"listingId":"…","expectedCategoryId":"…","nextCategoryId":"…","expectedRevision":2}` requires a numeric 0..2147483646 revision and returns `{listing:{id,categoryId,revision:3}}` only after the successful single-row CAS. Unknown/duplicate/escaped keys, invalid content type, quoted revision, leading zeros, extra metadata, mismatched owner, stale Category/revision, duplicate own Category and hidden/ineligible rows fail closed. One conflict response deliberately cannot reveal whether the ID, Category, revision, account, moderation or unique Category check failed. Errors are generic 400/401/409/503.

## Native Worker journey

My Services → select own Service → **Edit Category** triggers one manual, authenticated, exact v2 revision snapshot. A changed server row clears the previous edit and shows the newer status; absent/other-owner selection is cleared. An older API/network failure forbids a versioned edit, **never** silently retries or downgrades. On success, choose a fresh approved Category → Review → Confirm. The immutable session-scoped revision and selected original Category are checked again before one v2 PUT. The same existing single-flight `HeadlessWorkerWriteScope` and `NeedsReview` uncertainty barrier apply: lost POST/PUT acknowledgement is never proof of failure or success and is never auto-retried. After a confirmed PUT, the owner list can be explicitly read and the Customer public Service separately rechecked.

This does not provide a fully versioned schema for future Worker descriptions/rates/experience, and source-only testing does not certify exact live Worker API version or phone UX.

## Local automated gates

- SQLite/D1 public/private HTTP tests: fresh owner-only revision, legacy and public response byte-shape compatibility, A→B→A from legacy PUT, valid CAS, stale/foreign/disabled/hidden/inactive/duplicate denial, trigger in recursive mode, read-no-op and version overflow.
- Canonical bounded JSON and method/query input; no PII or moderator detail; old server refusal and SQL error redaction.
- Kotlin strict typed parser and route/repository validation; app in-memory selected revision state, rejection of wrong owner or expired epoch, no automatic mutation retry after uncertain outcome.
- Android JDK17/21 APK compile and full Foundation/worker/D1/Kotlin suites on the exact PR head **and**, independently, on squash-merged `main` before asserting complete source milestone.

## Still open

P1 Worker **full** service details and public Worker cards remain unapproved: public name/description/experience/rates/media, field-level consent and review, safe location scope, moderation/legal deletion, providers, account safety, billing, live migration and final **one** consolidated physical-phone acceptance. See [master backlog #235](https://github.com/rekixo-lab/jodlo/issues/235) and [code-versus-live ledger](CURRENT_STATE.md).

No email, physical-phone test, production D1 mutation, Cloudflare deploy, unreviewed Catalog activation, Agora credentials or Finworkar change in this milestone.
