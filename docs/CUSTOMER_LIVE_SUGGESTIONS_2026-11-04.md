# Customer Search: opt-in live approved Category suggestions
4 November 2026 — engineering acceptance and owner actions

## End-to-end Customer journey
JODLO now has bilingual real Catalog Browse, full Search/ambiguity choices, Category → public Listing pages → fresh anonymous Listing detail → device-only Saved Services. This addition makes the **typed Customer search interactive without silently transmitting text**.

From Customer Home the person can deliberately enable **Suggest categories as I type** (OFF by default). A notice explains that entered work text goes to the configured JODLO API, but never Google, a worker, third-party search or device location. After a 450ms idle pause, the already-existing read-only `GET /api/v1/catalog/search?lang=hi|en&q=...` is called for at most eight approved Category candidates. The native view distinguishes ambiguity/choices, matches, no suggestion, offline error and loading. A result may say that more matches exist; **See full search results** invokes the preexisting explicit search and its exhaustive cursor mode. Every result requires a tap to open a Category; no automatic Category acceptance, Worker opt-in, Listing creation or Agora attempt. The user can disable suggestions instantly.

### Identity, safety, locale
- No new API route, D1 schema/seed, personal-data column, billing, provider secret, account login or location permission.
- Default-OFF means typed text cannot be sent as the person types until they explicitly opt in. The existing deliberate **Search** button continues to work with the option OFF.
- Only normalized NFC, 2–64 codepoint, control-free user queries are eligible. A changed language, filter, query, tab/destination, opt-out or explicit Search cancels stale UI effects; a network call already on the wire cannot be undone, but canceled replies do not repaint the view.
- The repository's strict JSON and server checks still enforce approved active Categories, bilingual locale and opt-in published-only filter. This limit is **not** worker availability/presence or a trust/rating badge.
- In an unconfigured build, the API cannot be queried. An explicitly enabled DEBUG-only offline Catalog preview may display synthetic hints but **never** contacts production and cannot create public listings.
- No query history is copied to local favorites, account export, analytics or debug logs. It remains only current nonsecret Customer input state and an in-flight HTTP query to JODLO on opt-in.

### Automated acceptance
The existing `HeadlessCustomerPresentationTest` Kotlin JVM executable suite now verifies opt-in candidate policy, normalization, invalid/control/overlong denial, eight-row cap, duplicate/category mismatch and cross-language denial, ambiguity/empty/offline/next-page behavior, and no implicit Worker/Listing calls. All preexisting server/public visibility tests still run. Android Native JDK 17+21 builds compile UI and en/hi strings; Foundation exercises Kotlin test suite, real isolated workerd/D1 HTTP and API safety tests. Exact PR-head GREEN then independent merged-main GREEN required for source completion, and **no Cloudflare auto-deploy**.

### Owner manual work required for real-world use
1. **Live approved Categories:** Last owner-observed remote `jodlo-production` D1 check had **0 approved active Categories and 0 published Listings**. A qualified reviewer and founder must explicitly approve real bilingual work scope/mappings before activating any Category; do not seed the 889 historical Finworkar Categories or 7,267 Services automatically.
2. **Production source/Google connection:** Follow [real connection runbook](REAL_PRODUCTION_CONNECTION_RUNBOOK_2026-11-03.md) only after verifying Worker ownership, correct Cloudflare account, exact API custom domain/DNS/TLS, reviewed D1 migrations and configured Google OAuth; never paste tokens into chat. Controlled Cloudflare deployment is a separate founder/operator action, not implied by GREEN.
3. **Actual Android phone:** With a build configured for `https://api.jodlo.rekixo.com`, test opt-in OFF (typing makes zero searches), explicitly ON after disclosure, Hindi/English complete/ambiguous/empty, pause-then-type-again races, available-only filter, tap chosen Category, Search full pagination, offline retry, saved details, screen rotation/font scaling and leaving Customer tab. Need a real active Category and Listing, not debug samples.
4. **Broader product policy pending:** public Worker profile name/trust, optional description/rates, consented approximate service area, moderated images and data retention; provider-backed Agora first-contact/FCM requires separately verified credentials and explicit call/safety decisions. Do not announce these live yet.

The new feature is a functioning **read-only Customer discovery enhancement** on top of real existing contracts, not complete Finworkar parity or a released production app.
