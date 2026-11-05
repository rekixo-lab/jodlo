# Worker exact owner-selected Service read — privacy-safe editing improvement

**Scope (2026-11-05):** Complete the missing exact-selected private status read across the existing JODLO Worker API, Kotlin Core and native Worker Dashboard. This is one non-phone **read-only** part of guided Service editing, **not** an approved public Worker profile, a new information policy, a service-description/rate/media write, or a full release acceptance. See master [engineering backlog #235](https://github.com/rekixo-lab/jodlo/issues/235).

## Current feature

- From **My Services**, a Worker can select an existing own Listing and manually request a **fresh exact one-Listing private status**. The result has only `id`, `categoryId`, `visible` and `publicationStatus` (published/unpublished). A currently published Listing may be invisible owing to moderation or inactive Categories; no reason or trust status is projected.
- New optional GET on the **existing** authenticated `/api/v1/me/listings`: `?id=<opaque-listing-id>&view=management`. Server validates one each `id` and `view=management`, empty GET body, current authenticated account, and a single SQL row belonging to that account. Missing, foreign and disabled-owner rows produce the same generic 404. SQL/data errors are nonleaking 503; invalid input is 400, bad/missing authentication is 401.
- Precisely **one** owner row is read. This works even if the selected Listing is beyond the legacy 100 cap and the worker has not loaded every owner page. No pagination scan, no public publication inference, no GPS, phone, account ID, Google subject or moderator reason.
- The Kotlin API route builder has an opaque-ID-only path and header-only bearer; a shared strict management DTO parser rejects extra fields and inconsistencies (`unpublished` + `visible=true`). Response ID must match the requested ID; a replaced account, logout, expiry or overlapping local Worker write rejects stale responses through the existing session epoch.
- The Android selected-Service action first clears previous pending review/preview, then uses one manually invoked IO read. It accepts the reply only while the same Worker session, selection and pre-read owner row remain current; if status/Category differs, replaces just the selected local owner row and explains that the earlier review is invalid. If the selection no longer belongs to the account, clears it instead of repeating an edit. Unknown/old API/network failures remain **unconfirmed** and the original editing route retains its backend compare-and-swap.
- Existing Category-only publish/edit/pause/resume, legacy 100-row owner GET, managed page, Customer public Listing, Search and the Android public Customer preview remain unchanged. No new database column/migration, no personal upload or new public field.

## Important limits

A fresh private status GET reports current server state at the time of that read; it **cannot** prove that an earlier lost-acknowledgement write committed, cannot guarantee another device did not edit afterwards, and does not certify current Customer visibility. Existing server-side atomic expected-Category checks and unique owner/Category constraint remain the final edit authority. A separate anonymous current public Service detail check is still needed for what Customers actually see. This does **not** amount to full, versioned multi-field Worker editing or a moderated public Worker profile; field-specific moderation, consent, retention, revision schema and user disclosure policy still require decisions.

## Automated evidence / exit conditions

- Real local D1/SQLite HTTP tests: owner A vs owner B, beyond first 100 rows, 401/404/400/503, current status changes, disabled account/Category, moderation-hidden, no extra private fields and unchanged legacy/public response shapes.
- Kotlin JVM checks: correct GET/bearer boundary, one strict DTO, malformed payload/ID mismatch denied, old API 404/offline, stale account replacement and concurrent mutation rejection.
- Android JDK17/21 debug build on exact same feature SHA and independently after squash merge. Tests are non-device and cannot guarantee appearance/accessibility on the founder's phone.
- **No** production deployment or D1 mutation, no emails, no Finworkar changes, no historical Catalog activation, no real provider calls. The final consolidated physical-phone acceptance is still deferred until the entire product is integrated.

## Next unfinished work

Owner-approved private/public field-level policy, full Worker service details editing (optional scope, rate, experience and media only after decisions), safe public Worker/Service cards and moderation, local revisions/optimistic conflict semantics, data erasure and support, approximate area, Agora/FCM, payment, release automation and incident recovery remain separately gated in #235.
