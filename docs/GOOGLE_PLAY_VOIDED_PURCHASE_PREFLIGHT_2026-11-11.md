# Google Play Voided Purchases safety preflight — 11 November 2026

## Status — source only, NO payment grant

This adds `apps/api/src/modules/interactions/google-play-voided-preflight.ts` on top of the already merged JODLO ProductPurchaseV2 read-only preflight. The new internal `inspectJodloPlayPurchaseWithVoids` verifies an account-bound JODLO purchase via Google's current ProductPurchaseV2 read, **then** exhaustively scans a bounded set of Google's in-app Voided Purchases API pages before returning the *non-privileged* `screened_candidate` result.

**The screened candidate still MUST NOT credit minutes or be passed directly to the credit ledger.** It is not a settlement, checkout, purchase acknowledgement, purchase consumption, refund reversal, or entitlement approval. There are no HTTP routes, Android billing flows, D1 migrations, catalog activations, provider credentials, source-code paths to grant credit, or production changes in this milestone.

## Google API contracts

- V2 read checks the signed-in JODLO-account obfuscated binding, verified purchased state, full refundable quantity, single approved SKU and unconsumed/unacknowledged state. The trusted product-map default remains **unconfigured**.
- A follow-up **read-only** GET to `/androidpublisher/v3/applications/com.rekixo.jodlo/purchases/voidedpurchases` explicitly requests `type=0` (one-time products), `includeQuantityBasedPartialRefund=true`, start/end milliseconds, and `pageSelection.maxResults=200`. Subsequent pages use `pageSelection.token` from Google's returned `tokenPagination.nextPageToken`.
- A matching one-time purchase token in any valid voided entry returns `not_eligible`, including partial refunds and chargebacks. The raw purchase token and OAuth bearer are compared only in memory. They are never logged, stored in D1, emitted to the caller, or embedded in event records. A positive-screened candidate contains only product ID, seconds and stable purchase-token SHA-256 fingerprint.
- A clean result is possible **only after the entire available scan has completed**; missing/malformed token rows, invalid or looping cursors, missing/malformed JSON, broken continuation, HTTP failures, zero progress, oversized streamed responses (128 KiB/page), more than eight pages, or total deadline expiry all return `unavailable`. Never interpret a partially read page as clean.
- Google's Voided Purchases history is limited to the last **30 days of records being seen as voided**. This preflight intentionally refuses purchases completed more than **29 days** before its current clock; it does not infer anything about older historical refunds, nor about refunds after the scan. The voided API may also exclude refunds where entitlement is not revoked.
- A single post-V2 voided scan has a five-second all-in deadline for fresh OAuth, GET pages and bounded JSON reads, and limits to eight pages at 200 entries each. Large stores may need a separate durable reconciliation architecture rather than a synchronous preflight. Safety wins over availability.

Official documentation:
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list
- https://developers.google.com/android-publisher/voided-purchases
- https://developer.android.com/google/play/billing/integrate

## Local acceptance coverage

Synthetic Google replies in `apps/api/tests/google-play-voided-preflight.test.mjs` check the exact fixed-package URL and explicit in-app/refund query, all continuation pages, a refund in the first and later page, foreign-account refusal **before** scanning, stable hashed fingerprint, 29/30-day boundary, malformed/missing refund-token records, incomplete/looping/too-many pages, 403/429/500 failures, oversized and malformed streamed bodies, stalled OAuth/HTTP/body deadlines, and **zero credit-journal writes**. Existing ProductPurchaseV2 tests also retain their verified completion-time contract. No actual Google, financial or mobile provider calls are made.

## Still missing before any real paid minute

- JODLO Play Console merchant setup, approved SKUs and pricing, policy approvals, billing UI, device-account binding and provider access.
- Server-authoritative verified purchase ownership + a **durable settlement/consume/acknowledge state machine**, account erasure and lawful receipt retention, idempotent event sourcing and crash recovery.
- Realtime Developer Notifications (RTDN), voided-purchase backfill and long-term reconciliation, order-level refund/revocation support including already-used minutes, entitlement suspension and dispute policy. **A synchronous scan alone never replaces these.**
- Real measured Agora media seconds, independent caller quota/consent, balance display/support, controlled D1 production rollout, end-to-end one final consolidated real-device QA and founder release approval.

Never activate checkout or deploy to production from this PR; Finworkar is read-only and no emails are authorized.
