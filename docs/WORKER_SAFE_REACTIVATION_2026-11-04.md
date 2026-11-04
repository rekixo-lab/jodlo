# Worker Service reactivation — exact paused-row CAS (4 November 2026)

## Existing user journey completed by this feature

An authenticated Worker may create an approved Category-only Service, view owned Services, explicitly unpublish a Service (hide it from Customer), and later **review reactivating the SAME existing Listing** rather than searching the Category picker to use the generic publish-upsert pathway.

On the Android Worker screen, select an owned Service which is **not currently publicly visible**. This is *not* evidence that it was paused: an inactive Category, moderation or other eligibility failure may also make a Listing invisible. The UI consequently says **Review reactivating**, explains those limitations, shows the original Category, requires a separate final review and a user-tapped **Confirm: reactivate**. Only after explicit confirmation does the app issue one authenticated Owner request. A confirmed response triggers existing bounded owner read; the Customer's current public visibility requires another explicit anonymous Listing detail read. On an ambiguous/offline POST, the existing `HeadlessWorkerWriteScope.NeedsReview` requires manual acknowledgment and never auto-repeats a write.

## Server contract, backwards compatibility and privacy

`POST /api/v1/me/listings?resume=1` accepts exactly canonical JSON
`{"listingId":"<opaque-id>","expectedCategoryId":"<active-category-id>"}`.
Every other query shape, duplicate/escaped JSON key, unrelated field, missing bearer or malformed ID fails closed. The usual `POST /api/v1/me/listings` remains the original approved-category publish action; `PUT` remains Category-only edit; `DELETE` remains unpublish; all original `GET` owner/public DTOs remain **unchanged**.

A single prepared SQLite/D1 UPDATE requires **all** of:
- Exact existing Listing ID, verified current owner account ID and expected Category ID.
- Current row state is **unpublished** (not already published); moderation is **allowed**.
- Current owner Account is active, Worker is opted-in draft, Category is active and approved.
- Exactly one row changed, or the server returns indistinguishable `409 CONFLICT` without disclosing moderation reason, owner, status or private data.

The UPDATE changes **only** `status='published'`, not `id`, `category_id`, `worker_account_id`, `created_at` or moderation. It can never INSERT, change Category, impersonate a Worker, resurrect a deleted record or bypass moderator hide. Successful response is the pre-existing strictly public `{listing:{id,categoryId}}` only. This feature adds no D1 migration, user profile field, phone, GPS, text, price, media, verified badge, account lookup, Agora or FCM functionality. There is **no new public endpoint**.

## Software acceptance (not device testing)

- Local Node + in-memory SQLite/D1 HTTP integration: pause→resume→same original ID + public Customer read; fail on already published, moderator hidden, inactive Category/account, foreign owner, missing worker, wrong expected Category, repeat resume, malformed/colliding query, spoofed status/PII and duplicated JSON keys.
- Kotlin Core strict route body and owner-only bearer; repository refuses wrong ID/Category or extra private fields; disallows malformed IDs, masks offline errors and never automatically retries.
- `GuidedWorkerServiceActions` in-memory review bound to exact current Owner row, visibility snapshot and session epoch. Changed row/Category/account or cancel destroys confirmation; a nonvisible/hidden row cannot self-authorize server mutation.
- `HeadlessWorkerWriteScope` shares one-shot state, token/epoch fencing, uncertain mutation blocking, owner recheck as observation only, read-cache invalidation and session replacement race disposal.
- Native Worker screen bilingual en/hi translation and existing outlined design system. Native JDK17/JDK21 APK compile + all Kotlin Core suites + Foundation D1/workerd/TS/Node pass on exact PR branch SHA and independently after merge on exact main SHA.

## Important current limits

The exact Service ID remains public only if **current** moderator/worker/Category rules allow it. A server rejection never proves which condition failed. This does **not** implement Worker descriptions, rates, service area, images, full four-stage editing, presence, direct calling, payments, deletion or staff moderation.

Human Catalog approval is still unsigned ([issues #216–#224](https://github.com/rekixo-lab/jodlo/issues/221)); the last owner-verified live D1 had 0 Categories/0 public Listings. The merged source is **not a live Cloudflare deployment**. Do not run remote D1 changes, deploy, send emails or modify old Finworkar. Founder requested **defer all physical-phone testing until one final complete-app acceptance**; this milestone is software-only. Continue whole-app backlog [#235](https://github.com/rekixo-lab/jodlo/issues/235).
