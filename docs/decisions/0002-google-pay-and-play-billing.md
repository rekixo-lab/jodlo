# ADR-0002 — Google Pay-first payment preference; Google Play Billing policy preserved

- **Date:** 2026-10-27
- **Status:** Accepted product direction; **provider onboarding, policy mapping and implementation blocked/pending**
- **Owner:** JODLO founder

## Context
The former Finworkar system used Razorpay. The founder explicitly wants **Google Pay** for the clean-slate **JODLO** project. The new Cloudflare-first system is independent; old live Finworkar repositories, payment data and merchant integration stay untouched.

## Decision
- Prefer **Google Pay (UPI, India)** for eligible merchant payments, subject to approved merchant bank/PSP and authoritative server verification.
- **Do not port Razorpay** into JODLO by default.
- Treat **Google Pay (UPI)** and **Google Play Billing** as entirely different systems. Follow Play's mandatory billing rules for digital goods in the Play-distributed Android app, unless applicable allowed exceptions or properly enrolled alternative-billing conditions apply.
- Maintain modular payment provider / policy / ledger / reconciliation boundaries, not payment logic embedded into UI or business modules.
- **Deny checkout by default** until SKU classification and enrollment are documented. Do not ship a fake Google Pay integration or silently grant credits from client callback.

## Consequences
- Some product categories may need Google Play Billing even though Google Pay is the stated preference.
- UPI merchant onboarding, bank status API, Play policy choice/reporting, user copy, dispute/refund process, and security review are owner-dependent.
- No checkout, bank integration, Play Billing integration or deployment exists yet.
- Founder's UI approval is required before displaying payment screens.

See [../PAYMENTS.md](../PAYMENTS.md) for implementation gates and official sources.