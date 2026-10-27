# Verification gates — JODLO

## Foundation
- `npm run docs:check`: tests required permanent JODLO docs, identity/payment/UI gates and repository-relative document links.
- `npm test`: seven native Node 22 tests for health JSON/methods/privacy and Google Pay/Google Play Billing documentation.
- `npm run typecheck`: TypeScript strict check once dependencies are installed.
- `npm run build:api`: Wrangler `deploy --dry-run`, builds only, NEVER deploys.
- CI lives at [checks.yml](../.github/workflows/checks.yml), runs on PR and main. Local passes are **not** a green remote GitHub check.

## Future feature tests
- Auth denied/expired token, first-time user, logout and account deletion.
- Worker profile ownership, photo scanning, safe content, abuse rate limit.
- Nearby search 0 / sparse / dense neighborhoods, bounded queries, GPS deny.
- Call request concurrency, ring timeout, duplicate accept, media failure, reservation/release, refund and idempotent close.
- Payment pending/success/failure/refund and duplicate callbacks; compare only verified server or bank/PSP/Google Play state.
- Performance budgets based on recorded p50/p95, device startup, payload and database reads, plus incident rollback.

Read [Roadmap](ROADMAP.md) and [Status](STATUS.md). Never merge failing checks or claim a green CI before it is observed.
