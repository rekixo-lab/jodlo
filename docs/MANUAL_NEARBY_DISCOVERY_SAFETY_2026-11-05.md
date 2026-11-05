# 2026-11-05 — Manual-city Nearby discovery safety gate (source only)

## What is now a real native Customer path

**Home → choose a city → see transparent availability state → Browse all Services without a city filter → existing public-only Service detail.** The native view uses the same design components and Hindi/English localization as Customer Home, Feed and Saved. The city selection is only explicit, manual, and **ephemeral to this composable screen**. A second city choice replaces the first; Clear removes it. Leaving/reopening the screen constructs an empty state. No Google sign-in is required.

The only initially named example pilot choices are **Bilaspur** and **Raipur**. They are UI options, **not** assertions that approved Workers, service-area mappings, prices, exact locations or local availability exist there, and do not restrict JODLO's approved all-category Catalog coverage.

## Honest public Service profile facts, reused across three Customer journeys

After a **validated fresh exact public Service read** (not an unchecked Feed/Bookmark reference), Browse, all-public Services Feed and Saved now render the same reusable no-PII facts panel. It explicitly tells Customers that no public Worker identity/experience verification, public city/address/distance, rate/photograph or real call facility has been supplied or enabled. This is **not** a new public Worker profile, badge, eligibility check, or populated Worker data. It never appears as a fabricated checked profile for a missing, forged, stale or offline listing, and it reuses existing strict `CustomerServiceCard.publicWhenChecked` proof.

## Binding privacy and truthfulness boundary

The public listing contract currently provides **only an opaque Service reference and approved Category**. Neither it nor the Worker listing has a vetted public service area; there is no safe city→Worker match. Therefore:

- `ManualNearbyIntent` is a non-network Kotlin Core value with an optional fixed coarse city enum. It contains **no GPS, coordinates, address, contact, private Worker fields, account token or callback to a remote service**. Neither city choice nor a lookup is persisted, sent to JODLO API, linked to a login, or queried through Android location APIs. The Android manifest still requests **only Internet** permission.
- `nearbyLookupAllowed` remains **hard false**; `verifiedNearbyListings` stays **empty**, including after city selection. These are source safety gates, not a launch feature flag, server approval or a real geolocation implementation.
- Selected-city UI says explicitly: no nearby results can yet be verified and it does **not** imply zero Workers exist. The Browse All button is labeled **not city-filtered**, and navigates to the existing anonymous cross-Category feed (or plain Customer Browse when there is no live feed client).
- The existing public Service profile/content remains exactly the previously approved minimum: current checked Category and opaque Listing reference; **never** fabricate public Worker names, service radius, distance, rates, phone, ratings, verification, availability or call capability.
- No hidden query or location permission can be justified by choosing a city; clearing it is immediate. No analytics or retention is added.

## Why the genuine Nearby feature is still blocked

The founder/qualified authority must first approve under M-003/M-005 a precise Worker-entered service-area model (coarse city/approximate region, no mandatory GPS); field-level **private vs public** disclosure and explicit Worker consent; approved data provenance and moderation; supported city coverage; abuse resistance and query/retention/deletion/backup policy; query indexing, user privacy guarantees and legal review. Then implement independent authenticated Worker area edit + approved area public eligibility and explicit Customer nearby query. **Do not** send the presently selected city to an unspecified endpoint or filter the current city-less all-services feed and call that nearby.

No production migration/Worker deploy, Catalog import/approval, media, real FCM/Agora, payment, email, Finworkar mutation or phone testing occurs in this source change. One consolidated final physical-phone acceptance remains deferred under [#235](https://github.com/rekixo-lab/jodlo/issues/235).

## Source testing

The existing Kotlin Customer presentation test suite now checks no selected city, Bilaspur→Raipur replacement, clear/new-screen reset, permanent no-query eligibility and no manufactured nearby listings. Native Android JDK17/JDK21 APK compilation checks Home navigation and localization. Existing Foundation checks validate API/SQL remains unchanged. CI proof must include **exact PR head and independently merged-main SHA**, not simply an older successful run.
