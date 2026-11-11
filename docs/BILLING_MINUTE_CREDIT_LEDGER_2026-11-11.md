# JODLO minute-credit accounting — software-only (11 Nov 2026)

## Scope
Finworkar had 5/20/50/100/300/500 minute Razorpay packs. These sizes are historical reference, **not approved JODLO SKUs or prices**. The JODLO Play product IDs, pricing, purchase validation, refunds and measured billable media seconds remain unset.

This change adds a private D1 accounting seam only. It exposes no checkout, purchase, credit or balance HTTP route. It does not connect to Google Play, collect money, enable minute spending or send payments/FCM/Agora. It is not a product release.

## Implemented
- The local-only forward D1 migration 0024_private_call_credit_ledger.sql has two account-cascading private tables: call_credit_balances and call_credit_events. An event records an opaque account ID, **globally unique SHA-256 event digest**, integer seconds, kind and timestamp; never a raw provider token, price, phone, address, payment details or purchase JSON.
- Internal purchase_grant and verified_usage events are idempotent by digest. A replay must match the same active account, event kind and quantity. Cross-account reuse is denied.
- A SQL AFTER INSERT trigger atomically updates a bounded seconds balance and revision. A duplicate cannot double credit; an insufficient debit, oversized quantity or overflow aborts the insertion rather than leaving a partial journal entry.
- A current hashed-session private balance read returns zero when no grant exists. No HTTP route calls it. Account deletion cascades the synthetic local records, but real regulated purchase records and provider/backup retention require legal and founder decisions.
- The technical upper limit per event is 30,000 seconds. It does **not** approve a real 500-minute product.

## Evidence and release boundary
The SQLite/D1 tests cover concurrent duplicate grant, lost-response replay, foreign account claim, mismatched quantity, partial verified consumption, overdraft rollback, invalid/large inputs, disabled accounts, private-session isolation, account deletion, FK integrity and absence of payment routes. The founder guard restricts new billing tables to migration 0024 and enforces hashed, bounded, private-only schema.

The future trusted adapter must independently verify product ownership, Play purchase status, refund/chargeback and paid entitlement **before** crediting. Future usage debits require a reliable server-authoritative measure of chargeable Agora media seconds. Call signaling and call history do not prove paid usage. No one should directly use these internal seams with client-supplied quantities or receipt keys.

## Still required
1. JODLO-specific SKUs/prices, free/intro allowance, usage rounding and refund/expiry/debt policies, Play Billing eligibility and user-visible terms.
2. Provider verification, purchase acknowledgement, correct-account binding, idempotent backend reconciliation, reversals and support.
3. Measured media-duration settlement, end-user balance/recovery UI, full authorization/security and actual-device QA.
4. Legal and deletion/backup retention decisions, controlled Cloudflare D1 migration/rollback, Catalog activation and real two-device calling acceptance.

**Do not remotely migrate 0024 or activate billing now.** No real provider requests, production writes, external emails or Finworkar modifications were made.