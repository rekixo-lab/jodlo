# JODLO Google Play RTDN hints and durable revocation fences — 11 November 2026

## Local engineering only

PR #285 introduces a **fail-closed, read-only Google Play RTDN hint parser** and a **trusted-only revocation-tombstone D1 seam** with local migration `0026_play_revocation_fences.sql`. This is protection against an important *out-of-order delivery* failure: a refund or cancellation may arrive before the associated purchase grant. Once independently verified and recorded, that same purchase token can never be credited later by a delayed worker.

There is **NO Pub/Sub HTTP route, Google Cloud subscription, Play Console webhook, live credential, product ID/price, payment activation or external provider request** in this milestone. Just as in migrations 0024/0025, all data and tests are isolated/local.

## Two sharply separate trust levels

1. `decodeUntrustedJodloRtdnHint` accepts syntactically bounded Cloud Pub/Sub push JSON, strict base64, UTF-8, exact package `com.rekixo.jodlo`, valid `eventTimeMillis`, one notification family, supported one-time-product types (1 purchased, 2 canceled) or a one-time voided purchase (productType 2, refundType 1 or 2), and an opaque Play purchase token. It outputs only `purchase_hint`, `canceled_hint` or `voided_hint`, a canonical SHA-256 token fingerprint, event time and non-sensitive product ID (if present). **The parser never authenticates Google or mutates D1.** Purchase hints NEVER authorize credit.
2. `recordTrustedPlayRevocation` is a **separate internal privileged write** that requires a future coordinator to verify the Pub/Sub signed OIDC JWT **signature + issuer + audience + service account identity**, the expected push subscription, and the latest Google Developer API purchase/cancellation or Voided Purchases evidence before passing the digest/reason. The parsed `hint` itself is NOT sufficient. No current router invokes this function. Until those verification gates exist and are owner-approved, no RTDN-derived writes may occur.

Pub/Sub can redeliver notifications. Google recommends the Play Developer API after RTDN to retrieve current authoritative status; the notifications alone are not complete entitlement evidence. Product cancellations may represent pending payments, so a cancellation does not by itself justify a monetary debt or clawback.

## Durable fencing

The account-independent `play_revocation_fences` table stores **only one globally unique 64-character lowercase SHA-256 source digest, reason enum and recorded timestamp**, never a purchase token, provider order ID, email, phone, account ID, price, payment credential or raw JSON.

- A verified cancellation/void **before** any grant creates a permanent *logical* fence. Migration 0026 installs a `BEFORE INSERT` trigger on `play_consume_outbox` that aborts a later INSERT (and therefore its downstream credit event and balance update) with `PLAY_REVOKED_TOKEN`. `stageTrustedPlayConsumable` returns `void_hold` without credit. The check and grant happen atomically inside D1; application-level read/check alone would have a race.
- A verified cancellation/void **after** an earlier grant inserts the fence and atomically changes the existing outbox row to `void_hold`, including an in-flight `sending` claim. It clears the attempt lease; late callbacks, expired leases and unknown-state reconciliation cannot reopen the token. Direct SQL resurrection is independently forbidden by trigger.
- An identical repeated trusted notification is idempotent: one SHA-256 fence across accounts, regardless of Google message IDs. Separate purchase tokens remain independent. The provider-supplied raw token is never stored.
- **No money refund, reversal of already-spent minutes or debt adjustment is performed.** The existing credit ledger may still reflect an earlier grant after a refund; legal/commercial refund treatment requires approved product rules. An already-started network POST cannot be undone even if the DB fence becomes active between its last status read and the side effect; reconciliation and operational review remain mandatory.
- Because tombstones have no account foreign key, they can outlive account deletion. This is a deliberate *design placeholder*, **NOT an approved retention policy**. Legal/privacy review must specify how long to retain hashed revocation history, backup deletion/retention and customer erasure behavior before any remote migration. No production migration is approved.

## Local acceptance and release gates

Tests use disposable SQLite/D1 only and exercise corrupted/wrong-package/old/foreign Pub/Sub messages, multiple notification families, invalid cancellation/refund types, unauthenticated messages producing **zero writes**, global duplicate fences, cancellation preceding grant, cross-account claim prevention, credit event rollback, post-grant hold, live send racing a refund, prevention of late consume/recovery, SQL resurrection denial, identity erasure and independence of unrelated tokens. Founder CI guard checks the narrow migration and disallowed token/PII columns.

Still needed before releasing billing: authorized Play Console products and prices; signed Pub/Sub JWT verification and approved audience/service-account/subscription, robust Google provider state reconciliation and RTDN delivery handling; full entitlement coordinator; refund/debt policy and lawful hashed-tombstone retention; Android Billing Flow and real Play two-device checkout testing; genuine server-authoritative Agora billable seconds; Cloudflare D1 backup/migration runbook, 0024→0025→0026 sequencing, human catalog approval, production rollout approval and one consolidated physical-phone QA.

Google references:
- https://developer.android.com/google/play/billing/rtdn-reference
- https://developer.android.com/google/play/billing/lifecycle/one-time
- https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases

**No Google API calls, production Cloudflare/D1 operations, emails or Finworkar edits were performed.**
