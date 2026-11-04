# Worker My Services: truthful owner-published vs paused management

**Date:** 4 November 2026. **Scope:** a complete authenticated owner-management read → native state → action-control safety slice. No physical phone QA.

## User journey and truthfulness

The Worker signs in with their existing Google-based JODLO session, explicitly opens **My Services / मेरी सेवाएँ**, and loads the first private management page. The existing manual "Load more" and "Refresh" controls continue to support all owned Categories without a fixed five/ten-category cap. Each owned row now distinguishes:

- **Paused / बंद** — the owner had deliberately unpublished this Listing. The already-implemented **Review → Confirm Reactivate** path is enabled, using the exact existing Listing ID and expected Category. D1 still rechecks current moderation, account and Category eligibility atomically.
- **Published and publicly visible** — the current owner intent is published and the server's managed eligible check is true. The Worker may review and explicitly unpublish; public visibility is not Worker verification or contact permission.
- **Published but not publicly visible** — owner has **not** paused it, but current Category, moderation or Worker draft eligibility prevents visibility. Do **not** offer a misleading "reactivate" action. Owner may still review/unpublish an existing published row without learning private moderation details.

A publication intent is **not** a moderation verdict and neither owner status is permission to contact another user. An explicit customer-side anonymous Listing detail read remains necessary for current public eligibility.

## Server and wire contract

Opt-in private route **`GET /api/v1/me/listings?limit=1..25&view=management[&after=<opaque-own-listing-id>]`**, within the existing authenticated owner endpoint. Required session bearer and existing active-account gates. `view` must exactly equal `management`, appear once, and require explicit `limit`. Duplicate/ambiguous params, unsupported filters, invalid/foreign cursor, extra request body, revoked session, missing DB or server error fail closed. No background polling/prefetch.

Owner-managed response:
```json
{"ok":true,"data":{"listings":[
  {"id":"<opaque-id>","categoryId":"<approved-or-own-id>",
   "visible":false,"publicationStatus":"unpublished"}
],"nextCursor":null}}
```

`publicationStatus` is exactly `published|unpublished`, derived from the owner's EXISTING database publication status; it is **never** shared in public listing APIs. `visible` uses active owner + current Worker draft, approved active Category and allowed moderation, without returning its private reason. No worker identity, Google proof, phone, address, GPS, price, comments, verification, trust or moderator reason. A foreign cursor does not disclose its owner; existing atomic keyset paging and a fixed bounded limit are reused. A corrupt DB publication status fails closed.

**Backward compatibility:** `GET /api/v1/me/listings` retains the exact original 100-row, three-field owner DTO; `GET ?limit=n[&after=id]` retains its exact existing paginated three-field DTO. Both reject `publicationStatus` as an unrequested field. Anonymous `GET /api/v1/listings` remains the original two-field public DTO. **All POST/PUT/DELETE shapes, including `?resume=1`, remain untouched.** No D1 migration or new persistent data/retention rule.

## Android/Kotlin boundaries

`OwnListing.publicationStatus` is **nullable** only for legacy three-field owner reads; a legacy/unknown value must *never* authorize pause or resume in the native Worker UI. `JodloReplyDecoder.managedOwnListingPage` strictly requires the fourth field and refuses invalid/extra fields, implausible `visible=true,status=unpublished`, duplicate rows and malformed cursors. A dedicated `ManagedOwnListingPageRepository` and `InMemorySessionCoordinator.pageManagedOwnListings` reuse verified account generation, read consistency, and same-account mutation fences. The Worker screen uses only this explicit management read for its management actions; a read error does not silently downgrade to an ambiguous legacy status. Logout, session replacement, attempted writes and refreshed pages invalidate old management display/reviews.

`GuidedWorkerServiceActions.beginResume` and `resumeConfirmed` now *require* `OwnPublicationStatus.UNPUBLISHED` in the current authenticated owner page; hidden-but-published and legacy-unknown cannot pass even if `visible=false`. Existing atomic server restrictions continue to apply independently.

## Automated acceptance and remaining gates

- Isolated SQLite/D1 HTTP tests: published/paused/hidden/inactive all correctly distinguished, owner-only isolation, foreign cursor denial, duplicates/bad queries, public/legacy DTO parity, immediate visibility changes, no moderation reason/PII.
- Kotlin JVM: strict URL and response allowlists, status-visibility consistency, no bearer leakage, malformed status/extra fields rejected, bounded cursor safety, session replacement/logout race, no old legacy "nonvisible means paused" resume.
- Native Compose Hindi/English owner status captions and correct buttons. Exact-head Foundation + Android JDK17/JDK21 checks before merge; repeat both independently at exact merged-main commit. CI compilation is **not** physical device acceptance.
- **Full JODLO still incomplete:** real moderated public Worker profile/detail/rates/service area/photos, Agora/FCM, moderation+blocking, account erasure/legal retention, payments, website, true human Catalog review/signoffs, controlled Cloudflare release. The last founder-confirmed production D1 had zero active Categories/Listing data. **No remote database mutation/deployment/Finworkar change/email or phone test.** The founder reserves one integrated final phone QA, as tracked in [issue #235](https://github.com/rekixo-lab/jodlo/issues/235).
