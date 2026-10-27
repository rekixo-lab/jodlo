# Manual founder actions — JODLO

This is the smallest set of external account actions required; never give the AI passwords, OTPs, bearer tokens, signing keys or private customer data.

## GitHub (M-01, complete)
- [x] Authorize GitHub connector for `rekixo-lab/jodlo`. Read/write now verified.
- [ ] Inspect JODLO PR checks; confirm any GitHub Actions usage/billing/runner limitations if pre-step failures persist. Do not blindly retry.
- [ ] Review and approve merge once actual CI is green; keep changes on feature branch until verified.

## Cloudflare account (M-02, founder only, required for real deployment)
1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/), log into an account where `rekixo.com` DNS is managed, or confirm whose zone it is.
2. Do not edit unrelated DNS or legacy `finworkar.rekixo.com`. Verify `jodlo.rekixo.com` has no existing record/service first.
3. Create a **scoped Cloudflare Workers API token** with only the required Worker deployment rights, and obtain Cloudflare account ID privately. Do not paste token/account ID into chat.
4. In GitHub `rekixo-lab/jodlo` repository Settings → Secrets and variables → Actions, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Prefer GitHub Environment protection (staging/prod separation). Restrict token permissions and rotate after bootstrap.
5. Allow a first **separate staging Worker** (no production DNS). Only after health verification and explicit owner approval add the reviewed `jodlo.rekixo.com` custom domain; verify TLS and DNS.
6. Review account usage alerts/costs and environment segregation; create D1/R2 only when schema/privacy and backup plans are approved.

## Merchant/payments (M-03, later)
Google Pay India merchant UPI/bank PSP onboarding, SKU classification, Google Play Billing or eligible alternative program enrollment, refund/dispute terms, and user-approved checkout UI. No Razorpay import. Never share merchant secrets in chat.

## Native app/UI/launch (M-04, later)
Founder chooses first locality/categories and approves flows/wireframes **before UI code or Play Store media**. Review new Play package `com.rekixo.jodlo`, signing, policies and final release gates.

See [Payments](PAYMENTS.md), [STATUS](STATUS.md), [Cloudflare Architecture](CLOUDFLARE_INFRASTRUCTURE.md).
