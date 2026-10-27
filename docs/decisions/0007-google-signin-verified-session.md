# ADR-0007 — Initial Google Sign-In with server-verified ID tokens and revocable JODLO sessions

- Date: 2026-10-27 (India)
- Status: **Accepted founder login choice (M-002)**; backend source and synthetic tests subject to real PR/main CI. Real Google Console credentials/device/provider flow are **NOT configured/verified**.
- Founder expressly selected **Google Sign-In** for the first release (no phone OTP initially).

## Decision

1. Android will later request a Google ID token for an owner-configured **web/server OAuth client ID** using an approved native library (Credential Manager evaluation). **No Android UI until M-004 design approval.** A Google ID token is not itself a JODLO role, session or verified worker.
2. Cloudflare Worker `POST /api/v1/auth/google` accepts strictly bounded JSON and validates token signature using Google's rotating public JWKs, accepted issuer, exact configured audience, RS256, issuance/expiry and stable Google numeric `sub`. No `tokeninfo` endpoint in production. Verification uses the maintained WebCrypto-compatible `jose` dependency rather than a custom JWT parser. Never trust client-supplied IDs, email, role or verification flag.
3. **Only Google `sub`** is linked via `google_identities` to the internal, opaque JODLO account. Use a D1 transactional batch so concurrent first sign-ins cannot create multiple linked accounts or orphan records. Customer capability remains implicit and worker opt-in remains private draft (ADR-0006).
4. JODLO issues a 256-bit random, one-hour, opaque Bearer access token. Store only its SHA-256 hash, enforce expiration and active-account checks per request, permit logout revocation; send `Cache-Control: no-store`. Never log raw tokens. A renewed Google proof can start a fresh session; no refresh token is stored. Include authenticated session revocation on account closure in later reviewed deletion flow.
5. No Google email/name/photo/phone/OTP/refresh token is required or stored. Fail closed (503) without approved `GOOGLE_CLIENT_ID` and local D1; fake identity verifier in unit tests is not a production bypass. Add request throttling and provider outage handling before public launch.

## Limits and deferred gates

- **M-002 DONE:** login method selected and backend implementation started; this does not certify live Google authentication.
- **M-008 UPCOMING:** founder-controlled OAuth consent project, Android signing certificate SHA and Android client plus public web/server client ID setup; only when the real Android integration is ready. No passwords, signing keys or private OAuth secrets in Git/chat.
- **M-003 UPCOMING:** location data/privacy/retention and deletion specifications.
- **M-004 UPCOMING:** approval of all visible Android/web layouts/colors/animations before visual work.
- **M-007 DEFERRED:** controlled production-only Cloudflare provision/launch after readiness. No staging and no change to Finworkar systems.

## Verification

Automated checks should include locally generated RSA/JWK signature-positive and negative tests, wrong audience/issuer/alg/expiry, failed/duplicate DB account linking, session expiry/disable/revoke, no role escalation, and migration to disposable local D1. **GitHub green PR and latest main run must be observed before declaring code milestone done.**

References: [Manual Actions](../MANUAL_ACTIONS.md), [Status](../STATUS.md), [Android Structure](../ANDROID_STRUCTURE.md), [ADR-0006](0006-shared-account-opt-in-worker.md), [Google backend token rules](https://developers.google.com/identity/sign-in/android/backend-auth), [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Cloudflare WebCrypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
