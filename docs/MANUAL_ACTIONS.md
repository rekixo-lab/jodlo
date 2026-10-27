# Manual founder actions — JODLO

This is the smallest set of external account actions required; never give the AI passwords, OTPs, bearer tokens, signing keys or private customer data.

## GitHub (M-01, complete)
- [x] Authorize GitHub connector for `rekixo-lab/jodlo`. Read/write now verified.
- [ ] Inspect JODLO PR checks; confirm any GitHub Actions usage/billing/runner limitations if pre-step failures persist. Do not blindly retry.
- [x] Foundation PR #1 merged after green GitHub Actions [main run 40466265299](https://github.com/rekixo-lab/jodlo/actions/runs/40466265299).

## Cloudflare account (M-02, founder only, required for real deployment)
1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/), log into an account where `rekixo.com` DNS is managed, or confirm whose zone it is.
2. Do not edit unrelated DNS or legacy `finworkar.rekixo.com`. Verify `jodlo.rekixo.com` has no existing record/service first.
3. Create a **scoped Cloudflare Workers API token** with only the required Worker deployment rights, and obtain Cloudflare account ID privately. Do not paste token/account ID into chat.
4. In GitHub `rekixo-lab/jodlo` repository Settings → Environments → create `jodlo-staging`, set *environment secrets* `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Use minimal Cloudflare Workers Scripts permissions; do not expose tokens in chat/public issue. Keep `jodlo-prod` separate if created.
5. Allow a first **separate staging Worker** (no production DNS). Only after health verification and explicit owner approval add the reviewed `jodlo.rekixo.com` custom domain; verify TLS and DNS.
6. Review account usage alerts/costs and environment segregation; create D1/R2 only when schema/privacy and backup plans are approved.

## Merchant/payments (M-03, later)
Google Pay India merchant UPI/bank PSP onboarding, SKU classification, Google Play Billing or eligible alternative program enrollment, refund/dispute terms, and user-approved checkout UI. No Razorpay import. Never share merchant secrets in chat.

## Native app/UI/launch (M-04, later)
Founder chooses first locality/categories and approves flows/wireframes **before UI code or Play Store media**. Review new Play package `com.rekixo.jodlo`, signing, policies and final release gates.

See [Payments](PAYMENTS.md), [STATUS](STATUS.md), [Cloudflare Architecture](CLOUDFLARE_INFRASTRUCTURE.md).

## M-02 next exact action — staging Cloudflare credentials

1. Create environment `jodlo-staging`: [GitHub Environment Settings](https://github.com/rekixo-lab/jodlo/settings/environments).
2. Add two **environment secrets** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` securely in GitHub UI; do **not** send either value here.
3. Once configured, start [Deploy JODLO staging](https://github.com/rekixo-lab/jodlo/actions/workflows/deploy-staging.yml) with `Run workflow` on main. Workflow verifies docs/tests/types/build and creates only `jodlo-api-staging` in your Cloudflare account at a workers.dev staging subdomain. Do not attach `jodlo.rekixo.com` or change other DNS yet.
4. Confirm the deployment URL and request `GET /api/v1/health`, expected `{\"ok\":true,\"data\":{\"service\":\"jodlo-api\",\"status\":\"ok\"}}`. Share only the public staging URL or sanitized errors.
