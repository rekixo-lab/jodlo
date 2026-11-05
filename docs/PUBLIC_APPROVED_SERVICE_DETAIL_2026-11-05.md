# Public Service Details — current approved Category label, no Worker disclosure

**5 November 2026.** Software-only JODLO customer journey completed by this change, NOT a real Worker profile or provider-enabled calling surface.

## Behavior

In the Customer Category results, anonymous all-Category Services feed, and device-only Saved Services, tapping a Listing performs **one new anonymous, current-public API read**:

`GET /api/v1/listings?id=<opaque-listing-id>&view=service&lang=hi|en`

That exact opt-in read returns only:
```json
{
  "ok": true,
  "data": {
    "language": "hi",
    "listing": {"id": "<same-public-listing-id>", "categoryId": "<approved-category-id>"},
    "category": {"id": "<same-approved-category-id>", "slug": "<approved-slug>", "name": "<current-approved-catalog-name>"}
  }
}
```

The name comes from the **currently approved active Category** in the requested language, with an explicitly approved English fallback when Hindi is absent. SQL performs the exact existing **published Listing + moderator allowed + active account + opted-in Worker draft + active Category** joins and name selection in **ONE query**; there is no stale second Catalog lookup between eligibility and label. User sees the approved service **Category** name, Listing reference and an explicit statement that approved Category is *not* Worker verification or promised availability. No fake Worker biography, photos, status, proximity, rating, experience, price, phone, email, personal location, private account ID, contact button or call permission.

A revoked Category/owner/Worker/publication/moderation or missing Listing results in the same 404 as the existing current-public detail. SQL errors and missing database are 503, not a fake service card. The UI never saves a Listing until the full new detail is confirmed; Saved remains **device-only** and a Saved row is always stale until a fresh check.

## Compatibility and safeguards

The existing `GET /api/v1/listings?id=<id>` keeps the **exact** prior `{listing:{id,categoryId}}` shape; every public category/listings feed, owner listing, publish/unpublish/edit/resume method remains unchanged. The new request must have exactly one of each `id`, `view=service` and `lang=hi|en`, no other parameters, and an empty GET body. Any mismatches, duplicate/forged parameters or extra identity fields fail closed. No new database migration, stored state, field on Worker profile or Cloudflare permission.

Kotlin `PublicApprovedServiceDetail` rejects unexpected response keys, malformed or mismatched ID/Category, spoofed language, private fields, blank labels, invalid IDs and invalid transport. `RemoteCatalogRepository.approvedServiceDetail` validates exact requested locale, original Listing ID, and expected Category ID. All three Compose detail screens use this validated object instead of old feed/category-name caches. The existing `PublicListing` in local Saved and other APIs is unchanged.

## Automated acceptance and limits

- Node isolated local D1 and workerd: English/Hindi names, English fallback, names changed after old feed read, 404 for publication/moderation/account/Category revocation, missing ID, no DB, invalid methods/params/PII, old API response parity.
- Kotlin JVM: anonymous URI, no bearer/body; exact locale/Listing/Category compare; bad/extra/hidden fields rejected; no retried requests after network failure.
- Android native JDK17 and JDK21 APK compilation and tested Core suites on PR exact SHA; independent same merged-main SHA Foundation and Android Green required. No founder physical-phone test.

**Hard boundary:** This improves **verified Catalog Category disclosure only**. The final, useful moderated public **Worker Service profile** (name/experience/rate/service area/media) still awaits founder/operator approval of privacy, content and eligibility policy. It does not create, approve or seed the historical 889 Categories/7,267 Services, no remote D1/write/deploy/finworkar repository changes, provider setup, emails or physical device testing. Track the entire remaining implementation under [#235](https://github.com/rekixo-lab/jodlo/issues/235), and request only one complete-app final physical-phone acceptance.
