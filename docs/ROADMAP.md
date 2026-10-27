# JODLO — Living delivery roadmap

**Status 2026-10-27: GitHub Foundation merged with GREEN CI; Cloudflare NOT YET DEPLOYED.** No fixed deadline, no dropped tasks.

## Phase 0 — Repository foundation / NOW
- [x] Lock JODLO name, Android ID `com.rekixo.jodlo`, website `jodlo.rekixo.com`.
- [x] Write mission, team agreement, legacy-reference boundaries, architecture ADR.
- [x] Develop minimal Cloudflare Worker API scaffold and local tests (verify test results before accepting).
- [x] GitHub App write access works; 38 Foundation files committed to `main` via PR #1.
- [x] GitHub Actions green for final merged `main` commit [40466265299](https://github.com/rekixo-lab/jodlo/actions/runs/40466265299); **reverify each new head**.
- [ ] Founder provision/approve Cloudflare account and secure GitHub Environment `jodlo-staging` secrets; avoid unrelated `rekixo.com` DNS and all legacy systems.
- [ ] Decide staging/production resource naming, budgets, logging retention and alerts.

## Phase 1 — Product/legacy behavior specification
- [ ] Read-only audit of old Android/Backend/Web capabilities and feature state.
- [ ] Requirements interviews: real workers/customers/lapsed users, accessible pilot area.
- [ ] Define MVP: buyer intent, worker profile, actual request model, rating/trust rules.
- [ ] Record privacy/identity/verification, payments, push and calling requirements.
- [ ] Founder UI review & approval before UI work.

## Phase 2 — Secure cloud infrastructure
- [ ] Cloudflare Worker staging deployed, Cloudflare D1 + migrations with tested rollback; choose residency/security requirements.
- [ ] Auth/session implementation, identity provider decision; abuse and rate limits.
- [ ] Private R2 media validation; approved Queue workflows and idempotency as needed.
- [ ] Automated tests: unit, integration, authorization, privacy, data recovery, latency and cost.

## Phase 3 — Native Android after UI approval
- [ ] New Android Kotlin applicationId `com.rekixo.jodlo`, environment-aware networking.
- [ ] Founder's confirmed screen layouts, navigation and copy; no legacy theme copy.
- [ ] Guest discovery, sign-up, profiles, service creation and search under weak network tests.
- [ ] Native privacy settings, permissions, offline/error states and push consent.

## Phase 4 — Useful local contacts and safety
- [ ] Reliable contact/calling provider & secure tokens, refunds/timing after consent.
- [ ] Verification distinctions, ratings only after real interactions, report/block/audit.
- [ ] Moderation and case workflows, independent admin auth.
- [ ] Verify genuine work outcomes through privacy-safe consent.

## Phase 5 — Website, trust, payments & launch
- [ ] Founder website design review; publish at `jodlo.rekixo.com`, verify TLS and links.
- [ ] India digital purchase / Play policy and platform review before integrating paywall.
- [ ] Device integration tests, cost budgets, load tests, staged rollout and rollback.
- [ ] Honest Play screenshots/video storyboard agreed with founder, real build captures.
- [ ] Publish new app only after owner approval, policy, security and real-world validation.

## Phase 6 — Growth only after useful outcomes
- [ ] Pilot first locality with genuine willing workers and customers.
- [ ] Measure search → contact → mutually confirmed work, worker reachability and retention.
- [ ] Optimize D1 index/Worker CPU/R2 usage; expand modularly with evidence.

## Session status format
`Date | Work ID | Done (link/test) | Pending | Blocked/manual owner action | Next exact action`

## Known blockers as of 2026-10-27
- RESOLVED: GitHub read/write works, Foundation present on main; actual green main CI run 40466265299.
- Legacy GitHub Actions account had pre-run failures in previous project; GitHub runner/billing permission may require owner attention if reproduced here.
- No Cloudflare credentials, DNS zone permission, database, deployed Worker or production data yet. These require founder or connected account access.
## Payment policy alignment — 2026-10-27

JODLO prefers **Google Pay** for eligible merchant India UPI transactions, never the legacy Razorpay connector. **Google Play Billing** is the default Play-distributed digital-goods channel unless legally eligible exception or enrolled alternative billing permits otherwise. No money movement is enabled until bank/PSP verification, idempotent ledger, refund tests and owner approval. See [PAYMENTS](PAYMENTS.md).
