# Worker → Customer public visibility contract (3 November 2026)

## What a Worker can now do in the real app source

1. Using a **genuine session and approved backend**, opt into private Worker mode, find an active Category in Hindi or English and **explicitly publish** it. The existing Worker Dashboard and unchanged owner-authenticated `POST /api/v1/me/listings` handle this.
2. Refresh **My listings**, tap an owned Listing and select **Check current public listing**. The app uses the same `RemoteCatalogRepository.listingDetail(id,categoryId)` as the Guest Customer detail screen, issuing **one anonymous GET** to the existing `/api/v1/listings?id=...` path. It supplies no Worker bearer, owner ID, phone, location, price, call permission or verification claim.
3. The result is **three mutually exclusive states**: (a) fresh public `{id,categoryId}` confirmed; (b) current 404, not public (without stating why); or (c) network/authorization/protocol failure, **unknown**, never misreported as hidden or visible. Strict DTO decoding rejects private/extra fields and wrong ID or Category.
4. Selecting a different Listing, refreshing owner rows, logging out or starting a publish/unpublish write clears the prior preview. While the verification GET is running, Worker screen actions are single-flight. Result from a previous selection cannot certify the new selection.
5. Worker can **explicitly unpublish** using the existing owner-only DELETE with no automatic retry on uncertain outcomes. Customer public list, available-only Hindi/English catalog/Search and fresh detail must then cease returning that service. The backend decides current public eligibility; `visible` in the owner's list is not sufficient proof of the Customer view. Re-publication is a separate intentional owner operation.

## Real local full-journey acceptance

New `apps/api/tests/worker-customer-public-journey.test.mjs` starts with clean current 0001–0008 migrations, uses the **actual Worker HTTP router and D1-shaped local adapter**, substitutes only an explicitly fake account-session verifier for external Google and demonstrates:

- Empty public available-only Categories before publication, but browsable approved Category for the first Worker
- Authenticated Worker opt-in and explicitly selected Category publication
- Current Hindi/English Customer available-only Browse and Search, paged public Listings and anonymous fresh exact-two-field detail
- Private other-account listing read isolation, denial of other-account unpublish, no public identity/badge/contact/call data
- Owner unpublish → public detail 404, public listings absent, available-only Browse and Search absent, owner row visible=false
- Explicit re-publication restores the same server-owned ID
- Moderator, Category or account deactivation immediately makes the public detail unavailable and reverses after server restore
- Missing DB gives 503 (unknown), never mistaken for the not-public 404 state

These are integration contract tests, **not real Google OAuth, deployed Cloudflare, production data, actual devices or live Workers**. Source-level Android UI compilation must pass JDK 17 and 21 and the existing Foundation checks; after any merge, independent merged-main checks should be confirmed. Real phone acceptance remains pending until an approved production backend, active reviewed Categories and configured OAuth are available. No staging by founder decision, no secrets in the repository, no Finworkar writes, worker call consent remains separate and default OFF.

## Remaining gates

M-003: public worker metadata and privacy retention/deletion; M-005: safety/presence/limits; M-006: Agora real provider, M-007: controlled production deployment and M-008: real Google OAuth client/configuration. This milestone does **not** authorize or implement those items.
