# JODLO authenticated Google Play RTDN ingress — 11 November 2026

## Shipping boundary

This milestone creates a **default-OFF**, fixed-route authenticated Google Pub/Sub push endpoint `POST /api/v1/play/rtdn`. It adds server-side Android Publisher OAuth and authoritative, read-only Google Play Developer API reconciliation for **cancellation and one-time voided/refund notifications**. A verified revocation is persisted via the existing 0026 SHA256-only D1 fence, which atomically blocks late grants and quarantines earlier consume attempts. It **never** grants minutes, makes a purchase, consumes/acknowledges a token, refunds money or debits an existing minute balance.

**Nothing in this PR sets the route ON, provides service credentials or applies remote D1 migrations.** In normal build/runtime environments the route stays **404**. Manually setting `PLAY_RTDN_ENABLED=1` *without all required trusted bindings* fails closed with **503**; missing JWT/wrong audience/issuer/service identity/subscription is rejected with **401**. Google-signed but unconfirmed cancellation or refund also returns **503** to request Google Pub/Sub retry rather than silently acknowledging an unprocessed change.

## Protocol

- `authenticateJodloPlayPubSubPush` validates a Google-signed RS256 OIDC JWT against Google's fixed rotating JWKS `https://www.googleapis.com/oauth2/v3/certs` (never a request-controlled `jku` or key URL). Signature, exact single audience, `accounts.google.com` issuer, expiry and issued-at, numeric Google subject, expected exact service-account email and signed `email_verified=true` are enforced. The declared Pub/Sub subscription and Android package must also be exact matches. The bounded JSON body is parsed only **after** JWT verification. Raw purchase tokens are ephemeral and never logged, persisted or sent back to the client.
- The parser accepts purchase, cancellation and one-time void hints. **A purchase hint ALWAYS returns retry/503**; the missing signed-in account-bound entitlement coordinator must be implemented before such events can be acknowledged or granted. No RTDN hint, including a signed one, is sufficient financial proof.
- For one-time cancellation, backend obtains an AndroidPublisher bearer using an explicitly configured Play-service-account key, then makes a **fixed-package, read-only** `purchases.productsv2.getproductpurchasev2` GET using the exact notification purchase token. Only a verified `CANCELLED` status and exactly matching product SKU allow a revocation fence. `PURCHASED`, PENDING, ambiguous/malformed or failed responses are **not** treated as cancellation proof.
- For void/refund, backend makes a read-only Google Voided Purchases API GET with explicit `type=0`, `includeQuantityBasedPartialRefund=true`, bounded 8-day range and up to 8 pages at 200 rows. A *matching token in an actual Google voided row* is required; nonmatching, incomplete, timed-out, malformed, multi-page-limit and failed scans return retry/503, never write a fence. Partial refunds count as revocation candidates.
- Only after passing both authenticated transport and fresh Google evidence is `recordTrustedPlayRevocation` called to add one durable hash fence. Duplicate Pub/Sub push and duplicate confirmed Google records are idempotent. DB-level 0026 triggers block a later 0025 grant even if refund arrived first.
- All provider calls are fail-closed: fixed Google HTTPS endpoints, GET-only reconciling, no redirects, bounded OAuth/JWT and streamed JSON, 5-second provider budget and no external account/PII/order/price/credential storage. Errors have generic responses without token or order details.

## Configuration — OWNER/OPERATOR RELEASE ONLY, NOT SET HERE

The following **all** must be configured in the Cloudflare Worker under a separately approved rollout after D1 migrations 0024→0025→0026, Play Console configuration and Pub/Sub IAM review:

| Binding | Role |
|---|---|
| `PLAY_RTDN_ENABLED` | Explicit `1` only after a secure release decision; default omitted/OFF |
| `PLAY_RTDN_AUDIENCE` | Exact HTTPS URL for the actual push endpoint, e.g. intended `https://api.jodlo.rekixo.com/api/v1/play/rtdn` **after deployment verification** |
| `PLAY_RTDN_PUSH_EMAIL` | Dedicated, exact Google Pub/Sub **push-authentication** service-account email (not invented; configure in Pub/Sub push subscription) |
| `PLAY_RTDN_SUBSCRIPTION` | Exact `projects/<owner-project>/subscriptions/<approved-name>` Pub/Sub subscription full resource |
| `PLAY_SERVICE_ACCOUNT_EMAIL` | Dedicated Android Publisher **API-reader** service account (can differ from push-signing SA) |
| `PLAY_SERVICE_ACCOUNT_PRIVATE_KEY` | Secure secret for Android Publisher OAuth signing; never put in source, public client or logs |
| `PLAY_RTDN_LIMITER` | Cloudflare rate-limit binding guarding signature/JWKS, OAuth and provider requests |
| `DB` | Cloudflare D1 with all local migrations reviewed and backed up before remote rollout |

Google Pub/Sub service agent must be allowed to create OIDC tokens for the push-authentication service account. The push subscription must be bound to the exact audience and that account. Play Console must have RTDN configured, the Android Publisher reader must have correct scoped Play API permissions, and operational IAM, quota and retry/poison-message policies must be reviewed.

**Important:** enabling the push route without the missing purchase-pending handler would lead repeated 503 for purchase notifications. A production release therefore also requires the full account-bound purchase coordinator, durable event processing, alarm/triage and safe purchase response strategy. Owner's generic engineering approval does not supply real SKU prices, Google service credentials or an automatic production change.

## Tests and next tasks

`apps/api/tests/google-play-pubsub-auth.test.mjs` uses generated RSA keys, synthetic Google-signed OIDC JWT, fake Publisher OAuth and fake Developer API HTTPS GET, plus isolated SQLite/D1. Tests cover valid/foreign JWT, issuer/email/email_verified/audience/subscription mismatch, unknown signing keys, no live endpoint by default, failed/limited/unconfigured handler, a verified cancellation and repeat creating **one** token-hash fence, refusing a noncancelled purchase, refund requiring an actual Google voided row, and denying all minutes grants from unprocessed purchase events.

Still required: owner-approved **JODLO Play product IDs/prices and refund/retention policies**, Android Billing SDK integration, user-session account binding and signed purchase coordinator, actual RTDN subscription/IAM/credentials, operational refund debt/used-minute adjustments, media-duration verified usage, controlled D1 migrations, founder-reviewed catalog activation and **one final consolidated physical-phone end-to-end QA**.

Sources:
- https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions
- https://developer.android.com/google/play/billing/rtdn-reference
- https://developer.android.com/google/play/billing/lifecycle/one-time
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases

No live Google API call, remote migration, deployment, email or Finworkar mutation occurred in this engineering PR.
