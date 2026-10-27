# JODLO product requirements — proposed, awaiting founder validation

## Core user goals
- Nearby customers must find real relevant workers/services quickly even with GPS denied: opt-in locality selector; approximate public area, never exact coordinates.
- Workers create reliable service profiles/listings with category, service area, available hours, image and safely provided contact availability.
- Discovery supports Hindi/Hinglish/English catalog matching, category filter, area scope, bounded pagination and safe error/offline states.
- Contact request must be auditable and not disclose private phone details by default.

## MVP candidates, NOT implemented
1. Public discovery and localized search; no sign-in to browse, no forced location permission.
2. Secure sign-in + minimal worker onboarding with permissions and deletion.
3. Worker profile and listing CRUD, moderation, abuse report/block.
4. Customer contact request lifecycle; verified work outcomes by both parties.
5. Observability (real contact rate, completed outcome, app stability, cost) and controlled admin tools.

## Explicitly deferred
Complex recommendation engine, paid growth boosts, stories, ads, big referral system, automatic face/KYC claims, full wallet, and per-feature Worker microservices.

## Paid features policy
Owner prefers **Google Pay** for eligible India UPI merchant payments; **Google Play Billing** controls digital SKUs unless an approved program/exception applies. No checkout until policy, ledger and refunds are verified. No legacy Razorpay.

## Questions requiring owner decision before UI
Pilot city/area, category set, worker/customer roles, trust/verification rules, post photos, contact channel/calling proposition, UI design and accessibility.

See [PROJECT](PROJECT.md), [MODULE BOUNDARIES](MODULE_BOUNDARIES.md), [PAYMENTS](PAYMENTS.md), [STATUS](STATUS.md).

## Accepted account model (2026-10-27)

**M-001 founder-approved:** one JODLO login/account supports customer use and optional worker enrollment; enrolling must not itself prove identity or make a public worker profile. The current backend implementation is private draft-only. Identity/OTP provider M-002, locality/privacy M-003 and specific UI M-004 remain undecided; see [ADR-0006](decisions/0006-shared-account-opt-in-worker.md) and [Manual Actions](MANUAL_ACTIONS.md).
