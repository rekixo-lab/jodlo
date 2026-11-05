# 2026-11-05 — Guest-local Hide / Restore public Services (actual native control)

## End-to-end Customer journey

The Android Customer can now **explicitly hide one opaque public Service reference on this device** while inspecting it in either Category Browse, all-public Feed or their local Saved list. Hidden entries are excluded from the same device's Category result cards and global Feed cards. Saved review operates only on the **unhidden subset** so the app cannot silently make a fresh Service-detail GET for a reference the user already hid. The unmodified Saved bookmark list is retained: hiding is never deletion.

**Hidden** is a distinct native screen accessible from the top navigation tab and the existing Home/Account Help page. It shows only the locally stored **opaque public Listing IDs** and offers one-by-one **Show again**, plus a two-step **Show all again** confirmation. An unhide makes a Service eligible to appear on future public pages or in Saved again; it does **not** prove current public eligibility. If every Service on one server page is hidden, the UI tells Customers that this is a filtered loaded page, not that the server has no Services; manual next-page pagination remains available.

The selection persists **only in this app installation** through Android `MODE_PRIVATE` SharedPreferences, with auto-backup disabled by the existing manifest. It never travels to JODLO API, a signed-in account, another device, an employee, moderation, Agora, a report queue, Google or the legacy Finworkar app. No new permissions, SQL, backend routes, identities, Category labels, addresses, contact info, search history, analytics or location are collected. This is **not** an authenticated relationship block, a complaint, a verified moderation report or a ban on future listings by the same Worker.

## Storage/failure semantics

- Core `HiddenPublicServices` allows at most **100 distinct valid opaque Listing IDs**, with a bounded newline serialization. Duplicate, malformed, unexpected secret fields and oversized local preferences fail closed to the empty set, without leaking the value in error messages.
- A hide/unhide/clear uses a synchronous `SharedPreferences.commit()`. Only a true durable commit advances the in-memory state; a failure or full 100-entry capacity shows the bilingual failure notice. No automatic retry or silent success.
- A hide blocks future **display of the exact Listing ID** (regardless of Category changes), not other Listings or all Services by that Worker. The server still owns pagination, approval, revocation and whether each unhidden Listing is currently public; the model cannot manufacture public availability.
- Saved bookmarks remain separate storage. `withoutHidden` returns only a *presentation/review* subset, so the saved durable list can be restored unchanged on unhide. Clearing Saved still deliberately removes bookmarks, while clearing Hidden only restores display eligibility.
- Saved approval-label reads gather Category IDs only from unhidden entries. Hidden Saved IDs are never sent to the current-public one-by-one review endpoint unless the user first restores them. Neither hiding nor clearing itself makes an HTTP request.

## Automated acceptance and release boundary

A real standalone Kotlin JVM suite `HiddenPublicServicesTestKt` is registered in the aggregate `:core:verifyHeadlessCore`, validating valid/invalid IDs, duplicates, 100 limit, restore/clear, opaque ID Category changes, Saved retention and local-only behavior. Normal Foundation `npm test` also checks native routes across Browse/Feed/Saved/Hidden/Help, no-server-action messaging in **Hindi and English**, and no false Block/Report API or call authorization. Android APK builds on JDK 17/21 must pass on the final PR head and **independently on merged main**.

**Still OPEN (#235):** actual authenticated *two-sided* Worker/Customer blocking with permission and policy; trusted reporting, moderation/appeal/audit, legal erasure/retention, abuse rate limiting and real call admission. A local hide cannot replace any of these. No live publication, production DB migration, report submission, support email, account erasure, historic Catalog activation or physical-phone testing. The final phone acceptance stays one consolidated whole-app test after the remaining implementation and provider gates.
