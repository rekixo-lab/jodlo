# ADR-0006 — One shared JODLO account; worker role by explicit opt-in

- **Date:** 2026-10-27 (India)
- **Decision authority:** JODLO founder, explicitly approved in this conversation (M-001)
- **Status:** **Accepted account/role model**. This decision does NOT approve an identity/OTP vendor, location/privacy policy, UI, or production deployment.

## Decision

- One JODLO account serves the same person as a customer and optionally as a worker: **no second login or separate worker account**.
- Active accounts can browse/act as customers by default. A private, one-to-one `worker_profiles` row is created only after a server-authorized explicit opt-in.
- Worker opt-in starts only with `draft` status. It does NOT automatically grant verified, published, contacted or payment-eligible worker authority. Public publication/verification require later rules and moderation.
- Actor identity is a **server-resolved internal opaque account ID**. Browser/Android input must not choose an account ID, role or verified status. Real provider choice and external-subject mapping are reserved for M-002.
- First D1 migration deliberately holds no phone, name, OTP, email, GPS, credentials or provider ID. Only minimal account ID/status/timestamps and private draft. Account deletion cascade is groundwork, not a complete legally reviewed deletion workflow.
- The opt-in command is transactionally single-statement, idempotent and active-account-only, with duplicate-safe uniqueness. Only the authenticated owner may see their private draft. No general public profile write/list endpoints.
- `GET/POST /api/v1/me/worker-profile` are closed by default: require future trusted `AUTH` verifier plus D1. This initial scaffold does not configure a live verifier. Tests use fake token validation and SQLite.

## Why and consequences

Single identity simplifies switching between finding services and offering services, avoids duplicate personal accounts and login friction. Trade-off: auth compromise could affect both capabilities; mitigate with server-authoritative scopes, moderation, audit, MFA/step-up where sensitive actions warrant it, explicit account closing and no public worker exposure without review.

## Follow-up gates

- **M-001 DONE:** this account model is approved and must not be re-asked.
- **M-002 DONE:** founder chose Google Sign-In only for initial login; [ADR-0007](0007-google-signin-verified-session.md) establishes verified Google `sub` + hashed JODLO sessions. M-008 future OAuth console setup still required for real-device/provider tests.
- **M-003 UPCOMING:** local area/consent/privacy, retention and deletion specifics **before any personal location schema**.
- **M-004 UPCOMING:** founder approves actual visuals before any Android/web UI code.
- No staging or Cloudflare deployment; no old Finworkar changes. Google Pay India preference/Google Play Billing rules unchanged.

See [Manual Actions](../MANUAL_ACTIONS.md), [Status](../STATUS.md), [Architecture](../ARCHITECTURE.md) and [ADR-0004](0004-local-first-no-staging-until-production.md).
