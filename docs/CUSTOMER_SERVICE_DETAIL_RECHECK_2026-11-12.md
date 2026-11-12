# JODLO — Refresh checked public Service details and photo (12 Nov 2026)

## Customer scenario

Customer taps a live Service in Browse/Feed or opens a Saved reference and
gets an exact public Category/Worker-approved Service projection. While that
screen remains open, the Worker might resubmit text, upload a new photo, switch
city, unpublish, or lose moderation approval. The display must offer an explicit
new server check; an old image must not survive that new check as local UI state.

## Source behavior

- Feed now offers a clearly labelled **Recheck current Service details and
  photo** action, with Hindi text. Saved already has an explicit Check Now.
- Both entry points clear the checked detail *before* the authenticated or
  anonymous (as appropriate) exact public detail GET returns. While loading,
  no formerly approved name, rate, photo or permission can be displayed as
  currently checked. A not-found/failed response leaves no old detail visible.
- ApprovedServicePhoto ties decoded Bitmap, request-in-progress and failure to
  the exact customer detail-check revision as well as repository, Listing and
  city, so a newly checked detail does not reuse a previous approved photo.
  The image is still fetched on user action through its own public eligibility
  and approved-photo gate, and no raw image is stored on device.
- Real API + migrated local D1 regression walks owner edit → pending/hide old
  approved profile → reviewer approval → pending/hide old approved photo →
  reviewer approval → city change invalidates previous-city detail/photo →
  photo clear; it never seeds or approves actual historical Catalog data.
- Native source wiring checks guard Feed and Saved plus both locales.

## Boundaries

This is an explicit **time-of-check** UX, not a live or background
subscription and not a guarantee that approval cannot change milliseconds
after a GET. Server privacy and review gates remain authoritative. No live
D1/Worker deployment, FCM, Agora, billing, unreviewed Category activation,
Finworkar or phone acceptance action was performed. Run exact PR-head Foundation
and Android JDK17/21 CI, then independent merged-main checks.
