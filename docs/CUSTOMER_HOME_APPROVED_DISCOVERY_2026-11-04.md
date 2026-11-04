# Customer Home → verified Category → public Services (4 November 2026)

## User journey

An actual **Home / होम** screen is the first tab in the native Android JODLO app. The UI offers real navigation to **Customer Categories/Search**, **all currently public Services**, **Saved Services on this device** and **Worker mode**, rather than advertising imaginary Worker cards or offline sample data. All buttons use the current shared outlined dark/green components.

When an HTTPS JODLO API is configured, Home reads one bounded (10) approved active Category page anonymously using the EXISTING `GET /api/v1/catalog?lang=hi|en&limit=10` contract. Users can explicitly change language, filter to Categories containing eligible published Listings, load the next Category page, retry, or refresh. No authentication, location, email, Google subject, Worker profile, phone number, price, trust badge, live presence, analytics or new API endpoint is involved.

Home tiles **only** originate from a freshly returned public Catalog page. In-memory `HomeCategorySnapshot` guards the exact language, public-availability filter, strict page size, unique IDs, cursor shape/order and non-overlapping page continuation. A stale Category from a previous language/filter or a fabricated title cannot be selected. Category tap enters the EXISTING Customer discovery screen via an ephemeral, non-SavedState Category handoff in the same activity. The destination still performs a fresh anonymous `GET /api/v1/listings?categoryId=...&limit=20` with its existing server-side status/moderation/current Category checks; a Category is never proof that a Worker is verified/online/available. Individual listing detail and Save still require an additional current-public `GET /api/v1/listings?id=...` check. Back navigation from this Home deep-link fetches a fresh Category page rather than displaying an empty pretend page.

When no live API is configured, Home displays an honest no-live-Catalog explanation, and the user may explicitly open **Customer** to access the existing clearly labeled, debug-only, offline sample. Home itself does **not** use preview fake Categories, and the all-public Services button is disabled without a live HTTPS API. All Home state and Category handoff remain in app memory, not Android preferences, saved bookmarks, analytics or D1 writes.

## Scope and automated validation

- Native Compose Home, first-tab default, scrollable accessible action entrypoints and bilingual English/Hindi string resources.
- Same `RemoteCatalogRepository`, public Catalog DTOs, safe error handling and Owner-independent read-only HTTP calls; **no new D1 migrations, route, permission, backend account data, service publication or provider setup**.
- Pure Kotlin/JVM `HomeCategorySnapshot` tests exercise valid first and next pages, language and filter switches, invalid forged labels, duplicate/overlapping results, bad/rewound cursors, page-size constraints, and empty approved Catalog.
- Exact feature PR-head and merged-main **Foundation + native Android JDK17/JDK21 CI** must pass for the source change to be considered built. CI APK compilation is not on-device acceptance.

## Explicit founder directive — defer manual phone tests

The founder requested on 4 November 2026 that **physical-phone testing be reserved for one consolidated end-of-development acceptance stage**. This Home feature is a code-only/software test milestone; do not request a new phone install or declare real-device release readiness here. Track remaining full-app software, consent/provider/legal and reviewer gates at [full-product issue #235](https://github.com/rekixo-lab/jodlo/issues/235).

There are still **zero human-approved active production Categories/zero public Listings at the last owner-observed remote D1 read**; production source feature changes including 0009 have not been verified deployed. A genuinely empty Home is correct until human-reviewed Catalog activation. Nothing here approves historical 889/7,267 records, changes Finworkar, sends emails, uses RTC/FCM, or modifies Cloudflare production.
