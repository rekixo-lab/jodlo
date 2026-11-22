# JODLO Google Play Billing — complete offline lifecycle rehearsal and production blockers

Status: **offline integration verification only**. There is **no live payment, Play checkout, customer purchase submission/credit endpoint, activated SKU/price, or release authorization**. All sample token values and account identities in tests are invented; no Cloudflare production writes, service-account secrets, Play purchases, Google Pay transaction or Finworkar access.

## Full bounded engineering task completed

Run the existing comprehensive project suite (`npm test`), including `apps/api/tests/play-billing-lifecycle-integration.test.mjs`. The integration test executes an entire **synthetic** purchase lifecycle against the existing isolated in-memory D1/SQLite adapter:

1. Read Google ProductPurchaseV2 and check the exact obfuscated JODLO account binding, approved one-time SKU, full refundable quantity, `PURCHASED` state, unacknowledged/unconsumed receipt and purchase age.
2. Read Google Voided Purchases, including quantity-based partial refund checks, before returning an **unprivileged** screened candidate. Confirm this initial scan makes no D1 credit or purchase POST.
3. Model a **separate test-only trusted grant approval** by invoking the private outbox seam; verify exactly one atomic outbox/credit-event/balance update, repeated purchase idempotency and foreign-account rejection. **Do not connect the preceding candidate directly to this seam in production.**
4. Claim once and issue at most one synthetic consume POST; verify no second send on replay, no extra credit, and a matching preexisting purchase token.
5. Model an independently confirmed cancellation/refund arriving before or after that grant; the D1 revocation fence blocks late grants and freezes further sends.
6. Simulate an ambiguous timed-out consume and later **GET-only** owner/SKU/ack/consumption reconciliation, with one POST total.
7. Confirm unconfigured public checkout, purchase/grant and consume API paths remain HTTP 404.

The individual tests for authentication, void pagination, OAuth, RTDN signed pushes, consume races and stream size/deadlines remain in place. Android's read-only Billing 9 adapter is optional and explicitly not an entitlement provider.

## What is not finished and must remain disabled

- **Android checkout:** The opt-in BillingClient adapter only lists products or unverified purchases. It has no live `launchBillingFlow`, owner binding on a checkout, or purchase-token handoff to the signed-in Cloudflare backend.
- **Owner-bound Cloudflare credit issuance:** No production purchase-coordinator or authenticated customer payment submission route is present. ProductPurchaseV2 preflight and a recent-window refund scan are intentionally only candidates; checking a 29-day window does not prove historical refund status or prevent a refund immediately afterward. A refund/revocation/retention policy and additional trusted evidence are needed before granting minutes.
- **Settlement and recovery:** Production-owned consume/acknowledgement scheduling, ambiguous-provider recovery, safe restore across devices, delayed/refund debt policy, customer support intervention, and reconciliation reporting are not connected into a live system.
- **Operations:** No approved JODLO SKUs, prices, active service-account/API grants, valid real Google Play purchases, signed Play Console release, RTDN topic/subscription deployment, monitored alerts or real-device acceptance evidence.
- **Refunds:** Current revoked purchase is frozen; historical credited or spent seconds are **not automatically clawed back**. This is deliberate pending clear business/legal rules.
- **Cloudflare:** Local Worker, D1 migrations and CI checks are not proof of a remote production deployment or security review.

## Exactly what the JODLO owner must provide or do

These are **owner-controlled decisions/actions**, not instructions to paste passwords or JSON keys into GitHub issues/chat.

1. **Confirm the Play Console JODLO app** uses package `com.rekixo.jodlo`; arrange application ownership, developer agreement, payments profile, identity verification, tax/compliance status and closed testing eligibility.
2. **Approve each digital credit pack** as a one-time in-app Play product: exact product ID, minutes per purchase, India price/currency and intended availability. No sample IDs in the tests are live products. Confirm whether the business truly needs subscriptions too (separate lifecycle).
3. **Approve the refund/chargeback policy:** how unspent credit, partially spent call time, partial refunds, unknown consumes, revoked purchases, history/erasure requests and support appeals should be handled. Do not invent debit or debt rules.
4. **Provision and protect Google integration:** grant only necessary Android Publisher API permissions to a dedicated service account, configure Google Play RTDN/Pub/Sub push identity + subscription, and put runtime secrets in Cloudflare's secret management under owner access. Never provide the private key in chat, source, README or test logs.
5. **Authorize controlled testing:** test-only Play accounts, closed-track APK/AAB, Google-signed package, actual purchase/restore/refund tests, physical-device/network interruption tests and operational reconciliation, after the coordinator and client are implemented.
6. **Approve the financial go-live gate:** manual review of data retention for hashed revocation fences, privacy/data safety, published refund/customer-support disclosures, purchase-ledger accuracy, independent release CI, Cloudflare remote configuration, rollback and incident procedure.

## Completion boundary

The **offline synthetic billing-lifecycle QA task is complete after exact PR-head foundation CI passes**; it does not imply Google Play Billing feature completion. The **real billing milestone cannot be marked complete** until all owner-controlled prerequisites, Android checkout, backend reconciliation, refund/restore rules, real Play acceptance and operator approval are completed.

Infrastructure remains Cloudflare-first. Google Play is the Android in-app billing provider; Google Pay is only a potential checkout method offered by Google Play and must not be equated with the integration itself. Finworkar and its payment data remain untouched.
