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

## M-002 authentication tests — local only (2026-10-27)

- Synthetic RSA/RS256 JWKS signed tokens test issuer/audience/expiry/issued-at/Google `sub` validation, tampering, wrong keys, clock claims and resolver failure without calling Google's services. The only new cryptographic dependency is maintained `jose` v6 (Worker-compatible); `npm install` now precedes tests in Actions.
- Local SQLite schema `0003` and migration tests assert stable subject account mapping, idempotent repeat sign-in, distinct hashed one-hour bearer tokens, session expiry/disable/logout revocation, no client account role or cross-user draft access, atomic failure handling and invalid/oversized request errors. No real OAuth client, phone/email, Android UI or live provider validation.
- **Green CI must be independently observed** before claiming this change verified. Full real Google integration, mobile Credential Manager, callback/revocation policies, quota/rate-limiting, WAF and Play device tests remain release gates.

- Concurrent first-time Google sign-in requests also must yield exactly one account/identity row and distinct revocable sessions; fake D1 `batch` wraps operations in a SQLite transaction. These are synthetic checks, not a distributed/concurrency load benchmark.

**Verified source checkpoint:** [PR #12](https://github.com/rekixo-lab/jodlo/pull/12) merged as `494fc1ee3a41757d4099df40532759526afa5e66` with actual [green main GitHub Actions #40479368370](https://github.com/rekixo-lab/jodlo/actions/runs/40479368370) (37/37 tests, D1 migrations 0001–0003 locally, docs/design checks, strict TypeScript, both Wrangler dry-run builds). Do not interpret synthetic JWT/D1 tests as a live Google/provider or low-end Android device test.

## Next authentication-hardening tests (2026-10-27)

- Assert concurrent verified Google sign-ins cannot exceed six active sessions, receive HTTP 429 and Retry-After when capped; invalid/disabled accounts create no new sessions, logout frees a slot.
- Insert 105 expired records and verify each subsequent sign-in prunes only 100 using indexed bounded D1 SQL; expired bearer remains unusable even before cleanup.
- Test logout-all revokes only the authenticated account's own sessions; rejects missing, expired and reused tokens, incorrect methods and claimed `X-Account-ID` header. D1 cleanup failures return sanitized 503.
- This is an atomic **per-account session cap**, NOT an IP/global login rate limit, WAF or complete data retention program. Require actual green GitHub PR/main Actions.

**Actual completed verification for security-hardening:** [PR #14](https://github.com/rekixo-lab/jodlo/pull/14) squash-merged as `c234961204c0c2586748c52bcd1976a8611c7197`, and [main Actions #40481385874](https://github.com/rekixo-lab/jodlo/actions/runs/40481385874) completed **SUCCESS** (41 automated tests, docs/design guard, local D1 migrations, TypeScript and both Wrangler dry-runs). These synthetic tests establish the local adapter and strict worker build only, not real Cloudflare edge throttling, real Google/device login, distributed concurrency load or legal account deletion controls.

## Abuse-admission and deletion rehearsal (local-only; 2026-10-27)

- Simulate Cloudflare `LOGIN_BURST_LIMITER` and `ACCOUNT_LOGIN_LIMITER` with fake local binding responses; verify check order before JWT vs after verified `sub`, hash-only subject keys, ignored spoofed IP headers, 429 `Retry-After`, malformed/missing/outage fail-closed 503 and no denied-account D1 writes.
- SQLite D1 migrations 0001–0003 retained; synthetic account cascade and rollback tests verify private draft, Google-sub mapping and session hashes removed together, while unaffected accounts remain. Real delete endpoint stays unimplemented pending M-003 retention/consent.
- Production edge/WAF/dynamic rate-limit behavior, distributed concurrency, anti-bot protections and IP-based limits are **NOT validated by these tests**. Approximate Cloudflare per-location limits may be exceeded and shared pre-auth bucket can cause false positives. No remote bindings/deployment.

**Verified local admission/cascade milestone:** [PR #16](https://github.com/rekixo-lab/jodlo/pull/16) merged as `17ea0b882977ad0bd3a695e49b0112dde64fc9d6`; [main Actions #40482955589](https://github.com/rekixo-lab/jodlo/actions/runs/40482955589) completed **SUCCESS** on that exact commit (49/49 Node tests, docs/design checks, local D1 migrations, TypeScript and both Wrangler dry-run builds). This proves mocked counter behavior, strict module types and local migration builds, not strict production PoP rate limits or privacy compliance.

## Privacy-safe public taxonomy search (2026-10-27)

- Synthetic SQLite seeded *only in tests* to verify `GET /api/v1/catalog/search`: English/Hindi and fallback, active-only draft exclusion, id/slug/name projection, ordered page navigation (limit ≤25, offset ≤100), Unicode NFC, literal `instr` behavior for `%`/`_`/SQL injection, strict parameter rejection and no private worker/area/contact routes.
- Reuse catalog D1/SQLite adapter, no migration/dependency or actual service inventory. Require latest PR and main CI confirmation; **not** worker discovery, location search, production scale/performance evaluation or founder-approved pilot data.

**Actual verified CI:** [PR #18](https://github.com/rekixo-lab/jodlo/pull/18) merged as `36c9d83ad8f720d4eb7244364e789f5fc4bd7879`; [main GitHub Actions #40484455029](https://github.com/rekixo-lab/jodlo/actions/runs/40484455029) **SUCCESS** on the exact main head (55/55 Node tests, local D1 migrations, documentation/design guards, strict TypeScript, local and normal Worker dry-run builds). Native SQLite cases are local only; performance/load tests, real worker discovery, pilot category inventory and live end-user/device behavior remain unverified.

## Pure request/matching decisions — test-only (2026-10-27)

- Generic synthetic request states (not product defaults): owner-first authorization, immutable decision/receipt, replay after current state advances, idempotency-key conflicts, optimistic revision, unapproved transition denial, malformed IDs/keys and fake in-memory transaction journal.
- Matching synthetic candidate IDs: no assumed verification, no implicit eligible candidates, approved-policy callback, category match, self-exclusion, deduplication, strict batch/result cap, non-PII projection and invalid policy failure. No new public routes, real worker/customer data, D1 request storage or external services.
- These unit/fake integration tests **do not** prove distributed D1 unique-key/CAS atomicity or a founder-approved M-005 request lifecycle; verify hosted GitHub PR/main CI for actual implementation evidence.

**Verified request/matching contract CI:** [PR #20](https://github.com/rekixo-lab/jodlo/pull/20) merged as `31839e4c5eca44251db85e3d4c220ea1be3bd296`, and [main GitHub Actions #40486525096](https://github.com/rekixo-lab/jodlo/actions/runs/40486525096) **SUCCESS** on this exact commit: 68/68 Node tests, local D1 migrations, docs/design checks, strict TypeScript, both Worker dry-run bundles. Node tests are pure/synthetic, not an integration test for a request persistence DB, distributed CAS, real matching, device or provider behavior.

## Legacy behavior safety regression foundation — 2026-10-27

- Read-only source map in [Legacy behavior study](LEGACY_FINWORKAR_BEHAVIOR.md), with separate JODLO clean-room pure contact-safety decision tests for active requester/worker, owner/listing match, worker opt-in **versus** publication, moderation/status, two-way blocking, self-contact, missing required facts, stale discovery eligibility and non-leaking output.
- No real user data, personal GPS/contact, public worker endpoint, D1 mutable-request transaction, call provider, production login or Firebase/Android code. Test-only pure guard is NOT proof of authorized transactional contact creation. Confirm latest PR + main green CI before claiming done.

**Verified read-only behavior-based contact guard:** [PR #22](https://github.com/rekixo-lab/jodlo/pull/22) merged as `24ed69e735e136cc95b6ac43f74d83f08d019e6a`; [main GitHub Actions #40489994251](https://github.com/rekixo-lab/jodlo/actions/runs/40489994251) **SUCCESS** on the same commit (76/76 Node tests, local D1, docs/design guards, strict TypeScript, both Wrangler dry-run builds). This tests only pure synthetic rules, not an actual authenticated, transactional contact request or live service.

## Natural spoken-language service intent tests (2026-10-27)

- Pure bounded analyzer + local SQLite/Worker integration: `मुझे प्लंबिंग का काम चाहिए`, `मैं प्लंबिंग का काम करता हूँ`, `main plumbing ka kaam karta hu`, `I need painting`, no hallucinated synonym for `plumber`, unknown multiple trades/only generic speech produce no artificial match.
- Preserve existing literal catalog queries including `%`, `_`, SQL punctuation; prepared term predicates, cap at 6 content terms and existing 25/page; prevent drafts, phone/GPS/workers leaking.
- No real voice capture, speech transcription, curated vocabulary or published worker search tested. Await exact PR/main CI proof.

## Mandatory founder language-only test matrix — 2026-10-27

- Positive: natural search `मुझे प्लंबिंग चाहिए`, `मैं प्लंबिंग का काम करता हूँ`, `I need plumbing`, `I need painting service`; keep `lang=hi|en` output labels and bounded SQL active-only filtering.
- Negative: `mujhe plumbing chahiye`, `main plumbing ka kaam karta hu`, `मुझे plumbing चाहिए`, `I need प्लंबिंग`; no transliteration, mixed-script or third language matching. No unsupported language UI/copy.
- All other existing catalog injection, privacy and pagination tests still must pass. Use actual exact PR/main GitHub Actions evidence; no voice/audio or real workers claimed. [ADR-0008](decisions/0008-hindi-english-only.md).

## Two-connection SQLite synthetic request CAS stress rehearsal (2026-10-27)

Use disposable local tempfile to validate owner-read and policy decision within serialized write, revision compare-and-swap, unique request/retry composite key, exact-once receipt on retry, stale different key rejection, rollback after interrupted SQL step, lock collision on separate SQLite connections, rollback-resilient receipt validation. No durable schema, public API, D1 remote contention test, or M-005-approved request lifecycle. Future production-specific D1 transaction strategy must be independently validated after founder signoff.

**Two-connection SQLite request consistency verification:** [PR #27](https://github.com/rekixo-lab/jodlo/pull/27) merged as `68d89e593fa34760aec1af9a04c8c64f11360590`; [main GitHub Actions #40495912363](https://github.com/rekixo-lab/jodlo/actions/runs/40495912363) **SUCCESS** on the exact commit (93/93 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Wrangler dry-run bundles). Tests prove only disposable local SQLite behavior and pure contract decisions, not remote D1 distributed consistency or approved booking workflow.

## Worker draft to public visibility — synthetic projection tests, 2026-10-27

- Internal `projectVisibleListing` is **fail closed** for invalid or missing typed flags/IDs, owner mismatch, inactive account/category, worker who is only a private draft, inactive/unpublished/moderated listing and absent explicit founder-policy disclosure approval.
- Deliberately fake approved listing yields **ONLY** immutable `id,categoryId` fields. D1 local fixture proves **real schema stays status='draft'** and SQL disallows `published`; no private-worker/listing/contact HTTP endpoints exist. This does not simulate actual moderation, Google device/provider, GPS/PII or deployed D1 worker listing.
- Existing Hindi/English-only tests remain; no Hinglish. Await exact PR/main CI confirmation before claiming green.

**Verified worker privacy guard milestone:** [PR #29](https://github.com/rekixo-lab/jodlo/pull/29) merged as `f4009f3b207d3ab828b4b0a1738163233bd81f7c`; [main GitHub Actions #40497728947](https://github.com/rekixo-lab/jodlo/actions/runs/40497728947) **SUCCESS** on that exact commit (102/102 Node tests, local D1 migrations, docs/design guards, strict TypeScript and both Worker dry-run builds). Nine tests added; synthetic all-approved projection is **not** an approved business listing or actual publication. Real local D1 schema still blocks a status change away from private `draft`; no cloud/runtime proof beyond CI dry-run bundle.
