# Worker My Services — exact fresh Customer Service Details preview

**5 November 2026.** Read-only native product milestone; no false public Worker profile, human Category approvals, live calling or physical-phone acceptance.

## User workflow

Worker signs in with the existing single Google/JODLO account, enables their existing draft Worker profile if they choose, opens **My Services / मेरी सेवाएँ**, and explicitly selects one owned Listing (existing authenticated management page). The owner-only row and owner-cached Category name are **NOT** accepted as current public state.

The **Customer view check / ग्राहक को दिखने वाली सेवा जाँचें** card now has a local Hindi/English choice and a manual **Check Customer-visible Service details** button. On that click Android issues exactly **one anonymous** `GET /api/v1/listings?id=<selected-id>&view=service&lang=hi|en` via the **existing** `RemoteCatalogRepository.approvedServiceDetail`. It is the exact same public API read and strict DTO used by the actual Customer Browse, all-Category Services and Saved Service Details screens.

A successful response displays the **current approved Catalog Category name** in that language, the **same original public Listing and Category reference**, and clear text that the Service was **public at the last check**. This is not an online Worker, verified identity, worker-written profile description, phone number, location, service area, price, availability, contact/call permission, customer rating or booking. Workers can manually repeat the check.

One current-public **404** gives the existing *Not public* notice without claiming whether the Worker paused it, Category changed or moderation hid it. **Any other failure** or mismatched public data means *Could not confirm*, not "public" or "removed".

## Isolation and correctness

- No new D1 migration, API route, Worker personal data field, server mutation, stored preview, background checking, bearer in the public URL, offline fake fallback or private moderator reason. The server still uses the current published Listing + moderation allowed + active Worker draft/account + active Category criteria and returns the approved Category label **in the same SQL query**.
- Kotlin Core `WorkerCustomerServicePreview` is a pure, no-I/O projector. It accepts only the original selected Listing/Category/locale with an approved nonblank Category name, or an explicit NOT_FOUND. Bad/extra/mismatched fields are rejected by the existing strict `approvedServiceDetail` repository before reaching it.
- The Compose reader brackets its request with the verified **account generation**, selected **owned Listing row**, requested **language** and **preview generation**. A selected-row change, ownership page refresh, write, logout, account replacement, language switch or late reply cannot turn a stale old response into a current Customer preview. Switching the language also discards pending Category selection/search and prior preview.
- The preview is always **read-only**: publishing/unpublishing/resuming/editing existing Service remains behind existing separately confirmed owner-authenticated guarded paths and their original IDs.

## Automated and remaining acceptance gates

- Kotlin Core tests verify accurate Hindi and English approved names, exact selected ID+Category+language matching, nonpublic 404, network/rate/authorization/503/bad-reply uncertainty, blank/forged Category data and the impossibility of using a cached owner status to certify public visibility.
- Native Android JDK17/JDK21 APK compilation checks Compose UI, with exact PR-head Foundation+Android CI success before squash merge and new exact merged-main independent Foundation+Android CI success required. These are software checks, not physical-phone or live-provider acceptance.
- The current D1 schema **explicitly forbids publishing unreviewed Worker descriptions, prices, address, areas, photos or verification labels** (see `infra/migrations/0004_worker_service_listings.sql`). This enhancement does **not** quietly relax that policy. An actually useful moderated public Worker Profile/Service biography will require its own privacy, retention, consent, editorial and abuse controls, then real provider and human approval gates. The 889 Category / 7,267 Service historical reference is not automatically public or reviewed.
- No email access/sends, no Finworkar legacy writes, remote D1/Cloudflare deploy, provider-account change or physical phone tests. The founder wants only one final integrated physical-phone QA once the complete app is ready. Full JODLO backlog [#235](https://github.com/rekixo-lab/jodlo/issues/235) remains OPEN.
