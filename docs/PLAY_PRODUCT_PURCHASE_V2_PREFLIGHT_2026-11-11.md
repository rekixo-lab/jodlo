# JODLO Google Play ProductPurchaseV2 verification preflight — 2026-11-11

## Scope and authority

The existing local-only D1 minute-credit ledger in migration 0024 is **NOT** a payment integration. This milestone adds a **read-only, internal-only Google Play Developer API preflight** under `apps/api/src/modules/interactions/google-play-purchase-preflight.ts`. It cannot acknowledge, consume, charge, refund, grant minutes or modify D1. It adds no API route, Android billing UI, product IDs, secrets, release flag or live provider dependency.

The default is **unconfigured**: an independent trusted integration must explicitly provide nonempty, owner-approved JODLO product IDs and integer minutes. The example product ID in tests is synthetically named `jodlo.testpack5` and is NOT a configured Google Play Console SKU.

## Google-authoritative checks

The future backend uses Android Publisher's read-only `purchases.productsv2.getproductpurchasev2` endpoint at a hard-coded package `com.rekixo.jodlo`. The verifier:

- Requires an exact JODLO account-derived, 64-hex obfuscated account ID (SHA-256 of versioned package/account binding). The future Android BillingFlowParams must receive the binding from a server-authorized same-account process. **Never** send raw account ID, email or Google subject to Play.
- Refuses missing/cross-account ownership, absent/unknown SKUs, unknown purchase state, PENDING or CANCELLED transactions, Google test purchase context, missing/suspect order/completion time, previously acknowledged or consumed purchases, quantity other than exactly one, partially/full-refunded quantity, rental/preorder, or a multi-line transaction.
- Returns only a non-privileged **candidate**, with exact preapproved seconds and a SHA-256 digest based on the canonical Play package plus the token. The token, OAuth access token, order ID, personal details and raw provider JSON are **never** persisted or returned. The digest is independent of SKU to prevent claiming one Play token for multiple products.
- Caps the entire OAuth/HTTPS/read+parse path to a five-second monotonic budget and its JSON body to 16 KiB. All errors and ambiguous provider states produce no candidate; absent SKU config produces no HTTP request. No automatic retry can mint a credit.

**A candidate is NOT a verified paid entitlement**: this read does NOT check historical voided purchases, refunds/chargebacks that arrived after the last product read, replay inside a provider reconciliation job, entitlement support policy, or completion of Play consumption/acknowledgement. Do not pass its result straight to `recordTrustedCallCreditEvent` or show it as balance.

Official source documentation:
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2/getproductpurchasev2
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2
- https://developer.android.com/google/play/billing/lifecycle/one-time
- https://developer.android.com/google/play/billing/security

## Automated acceptance

`apps/api/tests/google-play-purchase-preflight.test.mjs` uses synthetic Google responses and local SQLite/D1 only. It verifies exact fixed HTTPS endpoint, no POST/ack/grant or public route, no balance or ledger mutation, exact account linkage, stable token fingerprint, SKUs denied by default, malformed tokens, missing/invalid OAuth, 404/500/429, pending/cancelled/test/refunded/consumed/acknowledged/multi-item denial, timed-out OAuth, stalled provider/body, oversized response and excessive deadlines.

## Remaining release gates

Before any actual Play entitlement grant: owner-approved JODLO SKU IDs/prices and in-app billing terms; Play Console products and service account access; Android Google Play Billing integration with account binding; backend purchase verification and ongoing RTDN + Voided Purchases API reconciliation; durable token ownership/acknowledgement/consumption lifecycle and crash recovery; explicit refund/chargeback policy for already-spent minutes; synthetic-to-real ledger integration with a fully audited entitlement coordinator; support/privacy/deletion and paid-minute measurement; **one final consolidated physical-phone QA** and controlled Cloudflare D1 rollout approval.

There are no known JODLO prices or Play product IDs to activate. No real Play API calls, payments, emails, production data writes or Finworkar modifications occur in this engineering PR.
