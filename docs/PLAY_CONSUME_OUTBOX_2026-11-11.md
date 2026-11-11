# JODLO Play consumable settlement + one-shot consume outbox — 11 November 2026

## Implementation state: internal/offline only

The code now provides **one cohesive server-only engineering module** for local-first Play consumable settlements: `apps/api/src/modules/interactions/play-consumable-outbox.ts`, forward D1 migration `0025_play_consumable_outbox.sql`, and synthetic SQLite regression tests. **No live Play products, prices, SDK, server sender secrets, HTTP purchase route, checkout, or public minute credit are enabled.** The source is not deployed, and even production migration 0024 has not been independently verified.

**Important distinction:** unlike earlier read-only preflights, `stageTrustedPlayConsumable` is a real internal D1 write capability: if a future authorized coordinator explicitly calls it with validated, owner-approved SKU/quantity and *independently verified* external settlement evidence, it **atomically grants credit** through an SQL trigger. A preflight `candidate` or `screened_candidate` is NOT that evidence. As shipped, no public HTTP route and no deployed integration invoke this function. It is a building block, **not an active payment implementation**.

## Safe ordering and crash/retry semantics

1. A future trusted coordinator independently validates signed-in account binding, PURCHASED state, approved exact JODLO SKU, age/refund/RTDN/voided checks, fraud/eligibility rules and final settlement policy. The only products allowed by this outbox are explicit, nonempty, server-authoritative product maps. The default is **no products**. No Android/client-supplied quantities may reach this point.
2. The local `play_consume_outbox` row stores only globally unique SHA-256 **purchase-token fingerprint**, opaque account ID, SKU ID, integral seconds, bounded state and a random one-attempt ID/deadline. No purchase token, order ID, email, Google sub, price, billing credential, personal address or receipt body is stored.
3. A single D1 `INSERT` plus `AFTER INSERT` trigger writes both the Play outbox and the existing `call_credit_events` journal, whose own trigger updates the private minute balance **atomically**. Duplicate/foreign-account/collision/overflow/grant errors abort without leaving a partial credit or outbox.
4. **Only after credit is durable** may a trusted backend claim an unconsumed outbox row exactly once. A matching raw ephemeral token is re-fingerprinted and compared before a fixed-package `purchases.products:consume` HTTPS POST. A missing token match, no OAuth or no active D1 claim means **zero provider calls** and narrowly releases a certainly-unsent attempt.
5. On HTTP success, the same random attempt completes to `consumed`. On any ambiguous HTTP failure, timeout or lost response, it becomes durable `unknown`. **No automatic consume retry after a possibly sent POST**, even after attempt deadline: expired `sending` becomes `unknown` through an explicit quarantine operation. A late callback or old claim cannot reopen the same token for a second POST.
6. An `unknown` delivery can be reconciled only by a fresh read-only ProductPurchaseV2 GET for the **same account, token and SKU**, with PURCHASED, CONSUMED, ACKNOWLEDGED, refundable quantity 1 and no test-purchase context. Such reconciliation never grants a second credit or issues POST.
7. A trusted void/refund signal places `ready`, `unknown` or `consumed` rows into `void_hold`. It prevents future sends or reconciliation, but **does not silently debit already-spent minutes**. Founder-approved debt/refund/chargeback reversal and account support must be designed separately. In-flight sends require resolution/quarantine before applying hold.

Google's official guidance says to grant an entitlement before consuming a consumable and to do server-side consumption; consumption fulfills acknowledgement. Unacknowledged purchases can be automatically refunded after the applicable window. An order ID is **optional** on legitimate promo purchases; purchase-token fingerprint is the globally unique key, not order ID.

References:
- https://developer.android.com/google/play/billing/integrate
- https://developer.android.com/google/play/billing/security
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/consume
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2

## Local acceptance (no real provider)

The isolated Node SQLite/D1 tests exercise atomic credit/outbox creation, default-off SKU map, concurrent identical grants, cross-account token protection, duplicate and edited SKU refusal, unexpected credit-event collision rollback, active user isolation and account-erasure cascades, legitimate promo code without order ID, one POST only after completed grant, no POST for wrong purchase token/OAuth refusal, no stale-claim release, timeout-to-unknown, never resend, explicit expiry quarantine, independent authenticated ProductPurchaseV2 GET reconciliation and prevention of refund-hold resurrection. New founder guards restrict migration 0025 to a hashed/owner-cascading/atomic schema without raw provider fields.

**No recorded refund order, backend RTDN listener or real-money purchase is processed in this milestone.**

## Still required before real billing

- Founder-approved JODLO Play SKU IDs, prices, paid/free minute allowance, eligibility, rounding, refund/debt/chargeback/expiry/retention/support policies, tax/Play policy and purchase terms.
- Authorized Play Console account, service-account scopes, Play Billing Android purchase UI, secure account-binding/session flow, authenticated protected backend route and provider validation. Current internal stage function must NEVER be wired to an Android-supplied preflight candidate.
- Durable backend token re-delivery/recovery coordination (no raw token persisted), RTDN + Voided Purchases API reconciliation/backfill and robust handling of refunds after consumption, multi-device purchase restoration, account export/deletion and lawful finance-record retention.
- Server-authoritative billable Agora media measurement (not signaling or client duration), transaction receipts, observability/budget/rate limits, security and independent owner release review.
- Cloudflare D1 operator backup/restore and migration sequencing 0024→0025, reviewed product catalog activation, real FCM/Agora two-device calling and **one consolidated physical-phone final QA**.

Finworkar is read-only. No production Cloudflare/D1 changes, no real Google/Play API requests, no email or payment activation took place.
