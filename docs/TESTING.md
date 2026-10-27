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

## Code-first local test policy — 2026-10-27

No staged Cloudflare deployment or remote resource tests during normal development. Test Worker APIs with Wrangler local workerd, D1/R2/Queues simulations, mock Google Pay/Google Play Billing bank/PSP callbacks, fake RTC/FCM adapters, Android emulator and real-device tests, schema migration/restore, security/rate-limit, idempotency and failure/retry cases. CI must be green and must not deploy. Live Cloudflare permission, real DNS/TLS and provider transport/payment behavior remain `UNVERIFIED` until owner-approved production rollout. See [ADR-0004](decisions/0004-local-first-no-staging-until-production.md) and [Release Readiness](RELEASE_READINESS.md).

## Hard rule tests: reuse, theme strings/colors, premium motion quality

- `npm run design:check` scans future Android Kotlin/XML screens and media assets to reject common hardcoded user strings, colors, radius, stroke, type and animation duration; and byte-identical image/vector files across Android/web. Six synthetic tests exercise allowed/rejected cases. **No Android UI/assets yet; guard is preventive.**
- Semantic duplicate business rules, visually near-identical assets and needless abstraction cannot be fully caught by static checks—mandatory PR code review remains necessary.
- After founder approval and UI implementation, add Android Lint/Detekt, snapshot/accessibility tests, release-mode Macrobenchmark/frame/jank, touch responsiveness, low-end phone battery and memory analysis, reduced-motion static fallback validation, 3D SDK asset size budget.
- Specific palette/layouts/3D design NOT YET APPROVED. See [Reuse](REUSE_ASSET_POLICY.md) · [Design](DESIGN_SYSTEM.md) · [Motion](MOTION_3D.md) · [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md).

## Catalog D1 slice (2026-10-27)

- `npm test` runs Node 22 built-in SQLite schema/constraint/index/explain-plan tests plus synthetic fake-D1 API tests for bilingual catalog, rejected writes/query validation, lack of binding and non-leaking DB errors.
- `npm run db:migrate:local` applies only to the disposable local D1 database named `jodlo_catalog_local`; never remote. CI runs this command after installing Wrangler and builds `apps/api/wrangler.local.jsonc` with `--dry-run`.
- No seeded localities, user identifiers, payments, Android screens or live infrastructure; future auth/ownership/migration/restore tests remain pending.

## Shared-account M-001 regression tests (2026-10-27)

Local synthetic DB and fake trusted-auth tests assert one customer account + optional worker draft, idempotent opt-in, no cross-account leaks, disabled accounts, default closed route, strict bearer validation, no client-declared account/verification, and database FK/draft-only constraints. New tests reuse `apps/api/tests/helpers/local-db.mjs`; no new SDK. **Verified:** [PR #10](https://github.com/rekixo-lab/jodlo/pull/10) merged as `e01dbde44cbe46aadf3d563c66f411a8c9d96818`; [main GitHub Actions #40476898497](https://github.com/rekixo-lab/jodlo/actions/runs/40476898497) SUCCESS on that commit (27 Node tests, docs/design guard, both dry-run builds, local D1 migration 0001+0002 and strict TypeScript). There are no live-auth, real-user PII, Android device or production-load tests yet.
