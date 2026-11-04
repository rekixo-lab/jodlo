# JODLO native guided Worker service review — 4 November 2026

## Why this is a product change (not a synthetic Listing demo)

Legacy Finworkar guided posting had four distinct stages: Category/work → experience and rate → location/area → review/media. The new JODLO currently has an approved, intentionally **Category-only** Worker Listing API. It cannot truthfully show an experience/price/GPS/photo entry and claim it was saved: these fields have **no reviewed JODLO schema, disclosure, consent, moderation or pricing policy** yet.

This release builds an **honest, usable two-step slice within the full guided workflow** using the real existing Google session, Catalog, owner listing and public discovery contracts:
1. **Choose your work**. Worker opts in (draft-only) and browses/searches the actual approved, active bilingual Categories. Category rows are fetched from the real JODLO API, not an arbitrary typed ID or an imported Finworkar seed. Only an explicit tap selects a returned Category. New search, Browse or language switch invalidates the choice/review.
2. **Review before posting**. A separate native review card displays the selected approved Category name and explains the only published fields, limitations, absence of calling/identity verification. The user may go back without a write. Only a second **Publish selected** tap supplies that same current ID to the existing `HeadlessWorkerWriteScope.publishExplicitCategory`; the authenticated D1 backend rechecks the active Worker, Category, account and moderation state.
3. **Manage owned services**. A confirmed publication triggers the existing read-only first owner Listing page, never treating owner state as current Customer visibility. Owner may select any of their current items, request explicit **Review service removal**, see a clear warning and either cancel or perform exactly one `unpublish` owner DELETE. Previously removed rows remain in the owner's scope; the original server-owned publication uniqueness contract permits later explicitly approved reactivation.
4. **Recover safely**. Unknown POST/DELETE outcomes never auto-retry. Existing NeedsReview state blocks another mutation, allows a bounded owner read and an explicit acknowledgement without pretending this proves the original mutation. Fresh anonymous public Listing detail must be checked separately; no contact or live calling promise.

## Safety and non-visual acceptance

The new immutable `GuidedWorkerServiceActions` is free of network requests and stores no token, address, GPS, profile claims, session identity or media. A non-secret current session generation marker and membership in the current Category/owner page are required at final confirmation. This prevents stale reviews from being reused after logout, account replacement, changed result page, failed or pending search, or selection of another Category/Listing.

Worker UI Category reads also capture a generation and account marker, so late results cannot repaint state after a language/query/session change. Owner Listing reads reject old-account responses. All real server calls run on IO threads; review/cancel states do not call HTTP.

Executable Kotlin contract regression cases verify: no publication before review; rejected forged Categories; review invalidation after changing selection/current rows/account; safe cancel; explicit publication using existing Owner write scope; removal review bound to the current owner Listing; no unpublish on cancel or changed owner. Existing Kotlin pagination/uncertain-write, D1 public visibility and Cloudflare API regressions must continue passing.

## Not yet the entire Finworkar guided form

**Still blocked/pending:** new JODLO Worker profile fields, display names and trust disclosure; editable service description, experience, rates, availability and area with explicit consent and moderation; image uploads and safety scanning; saved multi-field drafts, idempotent revisions; useful public service profile and nearby discovery. These are separate integrated product features needing a reviewed D1/R2 schema, safe public projection and legal/policy decisions. Never label the above limited Category-only flow a complete legacy four-stage post.

**Real phone acceptance remains separate from CI:** configured owner Google login → opt in → choose approved Category in Hindi/English → review/back/confirm → owner refresh → anonymous Customer detail → select owned row → review/cancel unpublish and review/confirm unpublish → public 404 → later explicit reactivation. Verify small-screen and large font behavior and loss-of-response recovery. Last known production Catalog count was **zero approved active categories**; no test, PR or sample record automatically changes that. Do not activate unapproved historical Finworkar categories.

## Release rules

Exact PR-head Foundation and native JDK17/21 must be green, then squash merge and verify independent merged-main results. No Cloudflare deployment, D1 mutation, real Category activation, Google credentials change or Finworkar access is performed by this code change. Approved physical-device testing follows separately.
