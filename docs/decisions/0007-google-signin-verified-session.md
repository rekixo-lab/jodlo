# ADR-0007 — Initial Google Sign-In with server-verified ID tokens and revocable JODLO sessions

- Date: 2026-10-27 (India)
- Status: **Accepted founder login choice (M-002)**; backend source and synthetic tests subject to real PR/main CI. Real Google Console credentials/device/provider flow are **NOT configured/verified**.
- Founder expressly selected **Google Sign-In** for the first release (no phone OTP initially).

## Decision

1. Android will later request a Google ID token for an owner-configured **web/server OAuth client ID** using an approved native library (Credential Manager evaluation). **No Android UI until M-004 design approval.** A Google ID token is not itself a JODLO role, session or verified worker.
2. Cloudflare Worker `POST /api/v1/auth/google` accepts strictly bounded JSON and validates token signature using Google's rotating public JWKs, accepted issuer, exact configured audience, RS256, issuance/expiry and stable Google numeric `sub`. No `tokeninfo` endpoint in production. Verification uses the maintained WebCrypto-compatible `jose` dependency rather than a custom JWT parser. Never trust client-supplied IDs, email, role or verification flag.
3. **Only Google `sub`** is linked via `google_identities` to the internal, opaque JODLO account. Use a D1 transactional batch so concurrent first sign-ins cannot create multiple linked accounts or orphan records. Customer capability remains implicit and worker opt-in remains private draft (ADR-0006).
4. JODLO issues a 256-bit random, one-hour, opaque Bearer access token. Store only its SHA-256 hash, enforce expiration and active-account checks per request, permit logout revocation; send `Cache-Control: no-store`. Never log raw tokens. A renewed Google proof can start a fresh session; no refresh token is stored. Include authenticated session revocation on account closure in later reviewed deletion flow.
5. The Google `sub` **is pseudonymous personal data**, although it is not a phone number or email; include it and session metadata in privacy notices, retention, deletion/export and breach planning before any real user collection. No Google email/name/photo/phone/OTP/refresh token is required or stored. Fail closed (503) without approved `GOOGLE_CLIENT_ID` and local D1; fake identity verifier in unit tests is not a production bypass. Add request throttling and provider outage handling before public launch.

## Limits and deferred gates

- **M-002 DONE:** login method selected and backend implementation started; this does not certify live Google authentication.
- **M-008 UPCOMING:** founder-controlled OAuth consent project, Android signing certificate SHA and Android client plus public web/server client ID setup; only when the real Android integration is ready. No passwords, signing keys or private OAuth secrets in Git/chat.
- **M-003 UPCOMING:** location data/privacy/retention and deletion specifications.
- **M-004 UPCOMING:** approval of all visible Android/web layouts/colors/animations before visual work.
- **M-007 DEFERRED:** controlled production-only Cloudflare provision/launch after readiness. No staging and no change to Finworkar systems.

## Verification

Automated checks should include locally generated RSA/JWK signature-positive and negative tests, wrong audience/issuer/alg/expiry, failed/duplicate DB account linking, session expiry/disable/revoke, no role escalation, and migration to disposable local D1. **GitHub green PR and latest main run must be observed before declaring code milestone done.**

References: [Manual Actions](../MANUAL_ACTIONS.md), [Status](../STATUS.md), [Android Structure](../ANDROID_STRUCTURE.md), [ADR-0006](0006-shared-account-opt-in-worker.md), [Google backend token rules](https://developers.google.com/identity/sign-in/android/backend-auth), [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Cloudflare WebCrypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).

## Later local-only security-hardening implementation note (2026-10-27)

Reuse `auth_sessions` and `idx_auth_sessions_expiry`: cap six simultaneous unexpired sessions per active account with conditional atomic SQL; when full, send HTTP 429 with retry delay rather than issuing more secrets. On verified sign-in, opportunistically purge at most 100 expired session hashes, no background cron or new tracking table. Add owner-scoped `POST /api/v1/auth/logout-all`. These are safe backend implementation constraints, **not** comprehensive HTTP/edge rate-limiting or a final retention/deletion policy. M-003/M-008 founder gates unchanged.

**Local security-hardening implementation proof:** [PR #14](https://github.com/rekixo-lab/jodlo/pull/14) squash-merged as `c234961204c0c2586748c52bcd1976a8611c7197`, and [main Actions #40481385874](https://github.com/rekixo-lab/jodlo/actions/runs/40481385874) completed **SUCCESS** (41 automated tests, docs/design guard, local D1 migrations, TypeScript and both Wrangler dry-runs). No further founder decision was assumed.

## Local sign-in admission safeguards (2026-10-27)

Use Cloudflare Workers' approximate per-location `ratelimits` binding for two separate gates before issuing JODLO sessions. First, a shared anonymous `google:login:unverified` burst gate (100/10s per PoP) before cryptographic verification to bound expensive JWKS requests. Second, after a cryptographically verified Google `sub`, use `google:verified:<SHA-256(sub)>` (20/60s per PoP) before D1 writes. Never trust `CF-Connecting-IP`, client role/ID, or `X-Forwarded-For` as limiter identities; avoid new personal-data tables. Denials are 429, no bindings/outages 503. The shared gate **may throttle legitimate users**; limits are approximate and per location, not global. Never claim this replaces WAF/bot screening. Both bindings are simulated **locally only**; production policy/config still requires M-007 review.

**Verified source checkpoint for local admission:** [PR #16](https://github.com/rekixo-lab/jodlo/pull/16) merged as `17ea0b882977ad0bd3a695e49b0112dde64fc9d6`; [main Actions #40482955589](https://github.com/rekixo-lab/jodlo/actions/runs/40482955589) completed **SUCCESS** on that exact commit (49/49 Node tests, docs/design checks, local D1 migrations, TypeScript and both Wrangler dry-run builds). Cloudflare counters remain approximate per location; actual production WAF/provider validation deferred. No additional personal-data policy approved.
