# JODLO — Worker Service Profile draft validation (2026-11-12)

## Customer/Worker problem

Worker → select own Service → Manage service profile → enter public display name,
description, optional experience and estimated INR visit rate → Submit for review.
Previously the Compose button allowed length-valid drafts containing a phone
number, URL, @ sign, markup or control character, then the server rejected them
with only a generic failure message.

## Implementation

- Android Core performs trim/NFC, Unicode code-point size checks (name 2–60,
  description 10–400), the existing server contact/link restriction, optional
  integer experience 0–80 and optional INR rate 1–10,000,000.
- The native form shows specific English/Hindi corrections only after an edit.
  Submit is disabled when invalid and re-validates the typed profile at tap.
- The existing server remains authoritative; revisions stay private until
  moderator approval. No visibility gate, owner/session-generation check,
  uncertain-write recovery or backend behavior was weakened.

## Verification and limits

An executable headless Kotlin suite covers Hindi, English, Unicode/NFC/code
points, phone-like text, links, markup, controls, numeric limits and optional
fields. A native source-wiring test checks the submit/feedback/localization
contract. Require exact-head Foundation + Android JDK17/21 success and
independent merged-main CI before calling the source verified.

This is code-only. It does not approve any Worker profile, Category, provider,
price, database migration or production rollout, and cannot replace final
physical-phone QA or real human Catalog and moderation reviews.
