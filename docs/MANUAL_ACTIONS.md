# JODLO — manual actions and timing

**Founder decision 2026-10-27: code first; no staging; no deployment now.** Cloudflare access/DNS and production credentials are **deferred** until JODLO's complete product is ready. No manual Cloudflare action is blocking development. [ADR-0004](decisions/0004-local-first-no-staging-until-production.md) · [Readiness](RELEASE_READINESS.md).

## Needed while designing/building
- Founder suggests/reviews/approves actual visible Android/web UI before screen implementation. Choices for pilot area, service categories, customer-worker flows and trust signals at their design gate.
- Later owner selects/approves vendor for RTC/calling and authentic payment pathway. Google Pay India UPI preferred where permitted; Google Play Billing required for many Play digital goods unless applicable alternative. Do not copy old Razorpay; use mocks until approved.

## Deferred until final production release
- Cloudflare account and `rekixo.com` domain control, production-scoped API tokens securely in secrets, production D1/R2/Queues setup, security and budget controls.
- Play Console/signing, real Android release, payment/RTC/FCM merchant/provider approval and secrets. Never send secrets or user data here.
- Founder sign-off for tested production migrations/backup, first deployment to `jodlo.rekixo.com`, monitored smoke tests and rollback.

**Not required now:** `jodlo-staging`, Cloudflare staging Worker, `CLOUDFLARE_API_TOKEN` in GitHub, or any deployment workflow. Those earlier instructions are explicitly revoked.

Read [Status](STATUS.md), [Payments](PAYMENTS.md), [Release Readiness](RELEASE_READINESS.md).
