# ADR-0004 — Local-first development, production-only release

- Date: 2026-10-27
- Status: **Accepted founder decision.** Supersedes all former JODLO staging-deployment directions.
- Identity: JODLO; Android `com.rekixo.jodlo`; eventual website `jodlo.rekixo.com`.

## Decision
Complete the native Android app, Cloudflare Worker API, D1/R2/Queue-backed features and all feasible RTC/payment/notification integration code **before any Cloudflare deployment**. A deployed **staging environment is NOT required and must not be created**. Use local Wrangler/workerd and simulated D1/R2/Queues, fixtures, mocks/fake payment and RTC providers, Android emulator/physical-device tests and GitHub CI instead. No Cloudflare API token, DNS, live data, merchant account or provider secret is needed during routine coding.

At *final product readiness* request explicit founder authorization to provision a **production** Worker and resources, connect `jodlo.rekixo.com`, configure secure secrets, enable real services, verify backups/restore, controlled smoke tests, observability, and rollback. Never automatically deploy on GitHub push. Retain low-traffic rollout/abort controls even without staging.

## Important limitations
Local tests cannot prove real Cloudflare permissions, production DNS/TLS, bank/PSP/Google Play Billing callbacks, FCM delivery or live RTC reliability. Mark those `UNVERIFIED` until controlled production launch tests. Code complete != production validated. Founder must approve visible UI before UI code. Legacy Finworkar remains read-only. Google Pay India preferred for eligible transactions; Google Play Billing rules for digital purchases; do not port Razorpay.

## Repository enforcement
Remove `.github/workflows/deploy-staging.yml`, `apps/api/wrangler.staging.jsonc` and CI staging-only checks. Keep docs and security tests and Wrangler production-config `--dry-run` builds. See [Release Readiness](../RELEASE_READINESS.md) and [Status](../STATUS.md).

Official docs: [Cloudflare local development](https://developers.cloudflare.com/workers/local-development/), [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/), [production gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/).
