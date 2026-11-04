# Customer Saved Services — native-only, current public recheck

**Source milestone, 4 November 2026.** This implements a real Customer return journey on top of the existing Category Search/Browse → public Listing → anonymous Listing detail. It does not introduce a new Cloudflare API, D1 migration, Firebase profile, worker contact data, location, billing or live calling.

## User journey

1. On a **configured real HTTPS JODLO API**, a Customer browses/searches an approved active Hindi/English Category, opens a returned public Listing, and the Android app makes its existing fresh anonymous `GET /api/v1/listings?id=...` detail read. Only a successfully validated detail can show **Save this service on my device**. The debug-only synthetic sample preview can NEVER be bookmarked to permanent device storage.
2. A deliberate Save adds exactly `listingId|categoryId` to a max-50-item private phone preference; it is not associated with a Google account and **never sent to the JODLO API**. No Android storage, contacts or location permissions are required. JODLO's Android manifest already sets `android:allowBackup="false"`. An actual SharedPreferences `commit()` failure is shown rather than claiming success.
3. A new **Saved** tab lists these old references explicitly as **unchecked**, not as current published services. Tapping **Check current public status** performs one new anonymous existing Listing-detail GET, validating the exact saved ID and Category, with no bearer or Worker account data. If the Listing was unpublished, moderated hidden, disabled, deleted or moved to another Category, the UI cannot label it public and instead shows a safe stale/unavailable message. No background auto-refresh, polling, prefetch, online-status claim, contact permission or location is implied.
4. A Customer can remove a single bookmark, or review/cancel/confirm clearing all saved references locally. Neither action modifies the actual published service, Worker account, permissions or D1.

## Strict safety and privacy contract

- `SavedPublicServices` core validates both opaque public IDs and category IDs, rejects duplicate/conflicting IDs, unknown fields, delimiter/control injection, entire malformed strings, >50 entries or >10,240-byte payloads. Identity (Google subject/account ID), session bearer, phone, address, GPS, price, image, chat, query text and call metadata are **never stored**.
- An existing bookmark's Category cannot silently be changed by an incoming mismatched Listing. Instead, a new user-selected current public detail must establish a new preference after the old bookmark is removed. Saves do not convey moderation or trust decisions.
- All network reads happen only on explicit tap off the Android UI thread, using the existing strict public Listing-detail repository; stale requests cannot repaint after navigating back or tab disposal. A 404 means a previously saved service is not presently public **under that saved Category**; other network errors remain unconfirmed rather than being reported hidden.
- No permissions or external connector used; local preferences can still be seen by someone with physical access to an unlocked/shared device. Users can delete them. This is not an encrypted personal vault or a cloud account-synced favorites feature.

## Automated and device acceptance

The new `verifySavedServices` Kotlin Core suite exercises bounded bookmark parse/encode round trips, duplicate/malformed/overlimit failures, add/remove/clear, no cross-category replacement, no implicit HTTP, fresh anonymous server read, 404 after removal, category moved response and private field denial. Existing Kotlin suite coverage guard requires explicit verifier registration. Native Android JDK17/21 builds and Foundation/API local workerd D1 suite must both pass on the **same PR-head SHA** before merge; independently run on merged main. No CI deploys to Cloudflare.

**Real-phone checks pending:** configured JODLO HTTPS + actual approved active Catalog with a real public Listing; open in Customer and Save, switch to Saved, force-close/reopen (persist on same device), verify current status; unpublish or change the old Listing Category on Worker account and verify Saved does **not** claim still public; remove/clear and verify restart; test no Google sign-in needed, offline behavior, back/cancel, Hindi/English and large text. The last observed production Catalog had zero approved active Categories, so these checks cannot be falsely claimed as complete.

## Whole-product gap

Saved Services is one connected Customer journey, **not** a substitute for service discovery's missing useful Worker public profile, approved display identity/disclosure, consensual approximate area, live Agora calls/FCM, trusted moderation and full four-stage Worker posting. Never seed old Finworkar user data or historical Categories without review, claim a private bookmark is an available worker, or auto-deploy this source code.
