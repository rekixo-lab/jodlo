# 2026-11-05 — opt-in approved Group → Family → Category navigation

This is a full non-phone **Customer-only discovery path** on JODLO's actual Cloudflare/D1 contract. It is **not** approval of historical Finworkar Groups/Families, a public worker profile, a production migration, an actual live launch, or a phone QA result.

## Journey and limitations

- Customer Home → **Browse approved Groups / Families / Categories** → select an actual currently approved Group → Family → Category → existing Customer Category page re-reads current eligible Listings. A Category is never proof of a contactable, verified or online Worker.
- Bilingual en/hi UI, explicit published-listings-only option, manual refresh and 20-row keyset continuation. Each level requires its own fresh anonymous GET. Changing parent, language or filter invalidates earlier results, and no result persists across app restarts.
- Continue to offer the **original flat Category Browse/Search**. This is essential while no human-reviewed hierarchy is activated or when a live server has an older API. HTTP 404 (route not deployed), 503, invalid payload and empty hierarchy are honestly represented, never replaced by fake Group names.
- No location permission, Google identity, saved service, request history, worker private data, false trust badge, contact, mutation or provider invocation. Existing public `GET /api/v1/catalog`, Search, feed, listing details, Worker and account contracts are untouched.

## API schema (new opt-in read)

`GET /api/v1/catalog/hierarchy?level=groups|families|categories&lang=hi|en&limit=1..25[&parentId=...][&availableOnly=1][&after=...]`

- Groups **must not** carry a parent; Families require Group ID; Categories require Family ID. Cursor is the current last row's public taxonomy ID, not an offset, Worker identifier or private token. Strict duplicate/unknown parameter and overlong ID rejection.
- Response exactly `{language, level, parentId, items, nextCursor}`. Group/Family item: `{id,name}`; Category item: `{id,slug,name}`; no PII or availability counts. English/Hindi uses the same approved-name policy with fallback to English.
- Single SQL statement provides an approval-filtered CTE, rechecks cursor membership in that same current snapshot, returns at most `limit+1` candidate rows and emits only `limit`. A revoked anchor yields an empty page; a stale continuation is never used to imply a different parent/locale/filter.
- `availableOnly=1` requires at least one **currently** published, moderation-allowed Listing whose worker/account and Category also satisfy the identical public eligibility rules used by existing Category listings. False or unknown availability is never inferred from a Category name.
- Missing D1 binding or missing forward migration fails with nonleaking 503, not automatic data insertion.

## Local-only migration `0010_approved_catalog_hierarchy.sql`

Three **empty** tables: `catalog_groups`, `catalog_families`, `catalog_family_categories`. Groups, Families and family-to-Category mappings are **default OFF**, each require explicit `is_approved=1`; Group/Family also require active status. Original `categories.is_active=1` remains a separate mandatory gate. No category row, label, mapping or worker identity is generated or imported, and no new administration write route exists.

**Production deployment is not part of this PR.** Only after verified bilingual editorial, independent occupational/legal and source-ID mapping review, specific founder activation approval and a separate operator D1 ownership/backup/query-plan/rollback review should a carefully scoped mapping/import and migration be considered. Last owner-read production D1 had 0 approved Categories and 0 public Listings. Older Worker deployments lack the new endpoint; the native screen must fall back to old Browse without claiming hierarchy live.

## Automated acceptance

- Node/SQLite HTTP fixtures: default-OFF/empty table result, three independent approval gates, current Category active gate, Hindi/English names, parent segregation, current Listing/moderation/worker/account available-only filtering, 25-row traversal, revoked anchors, hostile or duplicated query parameters and nonleaking 503.
- Kotlin Core: no-bearer route construction, strict parent/cursor/limit, 404 legacy route as unavailable, actual Group/Family/Category DTO allowlists, wrong language/level/parent/fields/duplicates rejected, monotonic cursors, network fail-closed.
- Native Android: UI is one explicit Home choice, approved Group→Family→Category navigation, original category discovery handoff, language/filter transitions, cancellation/invalidation, manual page retries, localized empty/error and full Browse fallback.
- Exact-head Foundation tests and Android JDK17/21 APK compile, then independently green merged-main checks. **Only after all complete product/provider/reviewer gates:** one consolidated founder physical-phone acceptance (#235).

## Remaining full-product gates

Actual reviewed approved Category data and mappings, complete moderated Worker profile/rates/experience/media, consent-safe approximate area, Agora/FCM, account erasure and retention, block/report/admin, payments, website, production deployment and release safety. [Master backlog #235](https://github.com/rekixo-lab/jodlo/issues/235), [human reviews #221](https://github.com/rekixo-lab/jodlo/issues/221), [current live-versus-code ledger](CURRENT_STATE.md) and [production runbook](REAL_PRODUCTION_CONNECTION_RUNBOOK_2026-11-03.md).

No emails, remote Cloudflare/D1 writes, new provider enablement, Finworkar changes or incremental physical-phone testing in this milestone.
