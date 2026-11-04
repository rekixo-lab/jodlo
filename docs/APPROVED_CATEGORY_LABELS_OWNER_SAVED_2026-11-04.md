# JODLO live Category names: Customer Saved and Worker owner service management
4 November 2026 — bounded public-only API + Android connected journey

## Why

Customer live Search already shows approved bilingual Category names, but an owned Worker Listing or a device-Saved reference previously showed an opaque technical Category ID as the only description. The local saved reference is not a public service or a consent to contact, so storing invented/cached names on device or reopening inactive historical Categories would mislead Customers. The same worker can have private owner listings that are unpublished and must not be treated as publicly visible just because a category label is active.

## Complete path and API contract

The existing public `GET /api/v1/catalog` gains **explicit bounded exact-ID mode**: `?lang=hi|en&ids=catA,catB`. It allows only exactly `lang` and `ids`, 1–20 unique canonical opaque Category IDs, no wildcards/unknown filters/duplicates. The response is the existing strict Catalog Browse envelope with `language,categories,nextCursor:null`. A single bound D1 SELECT returns **only rows with `is_active=1`** and exactly the same public allowlist `{id,slug,name}`. Inactive, unknown or unapproved IDs are simply omitted, never identified or described; the endpoint does not inspect a Worker, Listing, account, moderation status, identity, price, location, call permission or saved-device state. This is *not* a category activation/approval interface. Original Browse, Search, pagination and owner Listing GET remain compatible.

Android Kotlin Core adds the strict anonymous `approvedCategoryNames` route, typed `ApprovedCategoryNamesRepository`, and a volatile `ApprovedCategoryNameSnapshot` keyed by current language and exact set of requested Category IDs. A response with any unknown/duplicate ID, wrong language, cursor, extra private field or badly formatted reply is rejected. A snapshot cannot label a different selection/account/language context.

**Customer Saved tab:** The user may explicitly choose Hindi/English and tap **Show current approved Category names**. This triggers at most three 20-item public GETs for at most 50 *distinct Category IDs*, not saved Listing IDs. Only fully successful responses are presented, never partial stale success. Each saved card displays the verified name when returned, with its old Category ID and an unchanged warning that the saved service is not proof of current visibility. Tapping a saved service still performs its independent fresh public **Listing detail GET**; a category name does not substitute for it. Individual removal and confirm-clearing remain device-only.

**Worker mode:** After an authenticated owner-page read, the worker can explicitly fetch approved names for up to 50 currently displayed distinct Category IDs. No owner bearer, account ID, owned Listing ID or Google identity is sent on this *public* name GET. Owner rows, their visible/unpublished status, Category editing and two-step publish/unpublish confirmation are unchanged. Owner-generation/selection and language changes discard old name responses; absent/inactive Category IDs fall back to technical IDs. The existing edit review displays the verified current Category label if available, otherwise its ID.

## Automated acceptance and remaining manual work

- Local SQLite/D1 API integration tests verify names in Hindi/English, omission of inactive/unknown IDs, disabled-after-query, no private fields, bad/repeated/21+ IDs, query injection, write denial, absent D1 fail-closed, and unchanged existing Browse.
- Kotlin Core repository and headless contract tests verify bearer-free bounded URL, strict language/ID/nextCursor/unknown-field rejection, offline one-shot failure, current-ID and language snapshot guard; the already exhaustive suite registry is unchanged.
- Native Android JDK17/JDK21 compile checks and Foundation local workerd/D1/Node/Kotlin checks must pass on exactly the same PR-head SHA and then independently on the squash-merged main SHA. No CI production deployment.

**Manual owner work:** last actual owner check of remote `jodlo-production` reported 0 approved active Categories and 0 published public Listings. Human/qualified reviewer approval of bilingual Category names/work scope is required before enabling any real marketplace result, including the 889 historical reference Categories (never auto-activate them). Confirm correct Cloudflare API Worker ownership, exact `api.jodlo.rekixo.com` DNS/TLS, safe production DB migration/config, and separate controlled manual deploy. Build a real configured native APK and test Saved/Worker name lookup in both languages, 50-entry pagination, owner login/logout/account-switch races, inactive-after-display and offline; confirm private Listing IDs and bearer do not appear in category-name request, and check that saved Listing details continue to fail closed if the Listing is unavailable.

Still out of scope: full public Worker profile, experience/rates, service area, photos/media moderation, real Agora/FCM calling, billing/admin and eventual device/production acceptance. Do not interpret a green build or label as a verified, callable person.
