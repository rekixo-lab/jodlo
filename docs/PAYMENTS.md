# JODLO payment strategy — founder decision (2026-10-27)

**Decision:** JODLO prefers **Google Pay (India / UPI)** as the merchant-facing payment experience, instead of carrying the legacy Finworkar **Razorpay** integration into JODLO. The old production app and repositories must remain untouched. **This is a product preference and architecture direction, NOT a claim that Google Pay is live or that Google Pay alone can be used for every in-app SKU.**

## Two different Google payment products — never conflate them

| Product / payment | Default approach and release gate |
| --- | --- |
| **Google Pay for India (UPI)** | Preferred candidate for eligible merchant/physical-world transactions. Requires verified/acquirer-supported merchant, business/Google Pay onboarding, merchant VPA, a bank/PSP status verification API, unique transaction reference, and approval. Support generic UPI flows where required; do not hardwire Google Pay as the only UPI app. |
| **Google Play Billing** | Required for in-app **digital goods/services** in Play-distributed Android apps unless an applicable policy exception or enrolled alternative-billing program permits otherwise. Examples to classify carefully: digital post credits, premium boosts, extra app call minutes, subscriptions, digital memberships and feature unlocks. |
| **India alternative/user-choice billing** | If the founder later opts into an applicable Google Play program, follow enrollment, user choice UX, transaction reporting, fees, tax, safety and other official requirements *before* activating a Google Pay or other external checkout for digital SKUs. Never treat a generic UPI intent as an automatic exemption. |
| **Payments for an actual offline/physical job** | May have a different Play Billing treatment. First define what JODLO charges for (worker's physical service? a lead? platform credits?), who is the merchant of record, settlement/refunds and applicable regulation. Do not ship an escrow/marketplace payout mechanism without legal/payment-provider validation. |

**No production checkout is implemented.** Payment method selection and pricing screens also require the founder's UI review before implementation.

## Payment subsystem boundaries (proposed, not coded)

- A **payment policy router** decides permitted method based on *product type, region, app distribution/channel, approved Google Play program enrollment, and verified merchant availability*. Default to **no purchase allowed** when classification is missing.
- Keep interfaces separable: `PaymentCatalog`, `CheckoutPolicy`, `PaymentProvider`, `PaymentOrder`, `PaymentVerification`, `Ledger`, `Refunds`, `Entitlements`, `Reconciliation`, and `Audit`.
- Native Android: Google Play Billing client for digital SKUs where required; Google Pay UPI intent/payment APIs only for approved eligible use cases. Never rely on an Android intent callback to conclude funds are settled.
- Cloudflare Worker: create orders server-side, bind expected `amount/currency/order/user/product`, verify trusted bank/PSP or Play purchase status server-to-server, then atomically apply an **idempotent** ledger entry and entitlement. Verify callbacks/signatures, expiry and replay; log no bank details or UPI identifiers by default. Refunds and chargebacks need their own event state machine.
- Model transaction states: `CREATED -> PENDING -> VERIFIED -> FULFILLED` with appropriate `FAILED/EXPIRED/REFUNDED/DISPUTED` transitions. Never fulfill directly from client-provided `SUCCESS`, screenshots, a UPI transaction reference alone, or an unsigned webhook.
- New JODLO data stores and merchant accounts only; never import Finworkar wallet balances, keys, orders or Razorpay secrets.
- Price/SKU, region, and entitlement definitions are explicitly versioned. Test duplicate webhooks/callbacks, late confirmations, tampering, timeouts, retry, partial failures, refunds, subscription renewal/cancellation, Play billing policy compliance, and reconciliation.
- Cloudflare is the **backend platform, not a bank/payment processor**. External bank/PSP/Google APIs and the Android billing client remain required.

## Manual owner/merchant prerequisites (NOT complete)

- [ ] Define **exactly what customers pay JODLO for** (physical service transaction vs premium listings/credits/call minutes). Avoid assuming that old Finworkar products will carry over.
- [ ] Founder confirms Google Pay for India business eligibility, verified merchant VPA and acquiring bank/PSP APIs for trusted transaction verification; do not share account details or credentials in chat.
- [ ] Founder confirms Play Console developer registration, in-app SKU classification, billing enrollment/alternative-billing eligibility and regional restrictions with current official policy.
- [ ] Founder approves payment UX, pricing, billing disclosure and refund/support policy before implementation.
- [ ] Only after above: build staged/sandbox payment adapter, backend validation, idempotent ledger, security tests, audited reports, then obtain explicit founder approval for live launch.

## Primary official references (checked 2026-10-27)

- Google Pay India Android API: https://developers.google.com/pay/india/api/android/overview
- Google Pay India merchant setup: https://support.google.com/console/answer/10945206?hl=en
- Google Pay Android in-app flows: https://developers.google.com/pay/india/api/android/in-app-payments
- Google Play Payments policy: https://support.google.com/googleplay/android-developer/answer/9858738?hl=en
- Play policy explanations and country programs: https://support.google.com/googleplay/android-developer/answer/10281818?hl=en-IN

**Re-check official program/fees before actually enabling payments.** This document is not legal advice, provider approval or an implemented checkout.