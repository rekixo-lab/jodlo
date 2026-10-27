# Status and resumption record — 2026-10-27

## Important status rules
- **Local ZIP/docs are not GitHub commits and not ChatGPT saved memory.** New AI must be shown this repo after it is pushed, or given the latest ZIP.
- **Proposed** is not **implemented**, source inspection is not production measurement, and passing local tests is not remote CI success.
- README, [`AGENTS.md`](../AGENTS.md) and [`AI_HANDOFF.md`](AI_HANDOFF.md) are mandatory handoff entry points.

## Done locally
- [x] JODLO identity established: app ID `com.rekixo.jodlo`, planned host `jodlo.rekixo.com`.
- [x] Independent Cloudflare-first charter, architecture, ADR, product scope, road map, manual actions, legacy read-only mapping.
- [x] Minimal TypeScript Cloudflare Worker with strict versioned public health route only. No auth/storage/payment/media methods implemented.
- [x] Local native Node 22 test run: **7/7 passing on 2026-10-27**. Local `tsc --noEmit` succeeded with TypeScript 5.8.3 installed in preparation environment.
- [x] GitHub Actions workflow specification authored, deliberately no deployment.
- [x] Detailed research from read-only Finworkar source (native Activities, backend/Firebase, Firestore indices, calls, wallet, Cron, old site) captured in [`ARCHITECTURE_RESEARCH_20261027.md`](ARCHITECTURE_RESEARCH_20261027.md).
- [x] New local docs: [`AGENTS.md`](../AGENTS.md), [`AI_HANDOFF.md`](AI_HANDOFF.md), [`ANDROID_STRUCTURE.md`](ANDROID_STRUCTURE.md), [`CLOUDFLARE_INFRASTRUCTURE.md`](CLOUDFLARE_INFRASTRUCTURE.md), [`MODULE_BOUNDARIES.md`](MODULE_BOUNDARIES.md), plus linked README and ADR. **No app UI was created**.

## Payment decision newly recorded — 2026-10-27
- [x] Founder requests **Google Pay** for JODLO in place of the legacy Finworkar **Razorpay** payment arrangement; decision documented in README, [Payments](PAYMENTS.md), [Architecture](ARCHITECTURE.md), [Roadmap](ROADMAP.md), [Product Requirements](PRODUCT_REQUIREMENTS.md), [Manual Actions](MANUAL_ACTIONS.md), [Legacy Mapping](reference/LEGACY_MAPPING.md) and [ADR-0002](decisions/0002-google-pay-and-play-billing.md).
- [x] Official distinction checked: Google Pay India UPI is **not** Google Play Billing. Play's digital goods/payment rules and eligible India programs must be honored.
- [ ] Google Pay India merchant onboarding/bank-PSP verification integration **not started**.
- [ ] Play Console SKU classification and billing eligibility **not confirmed**.
- [ ] No payment API, checkout, ledger, billing SDK, merchant keys or live transaction created.
- [x] GitHub connector write access restored. Foundation PR branch exists; **remote CI and merge remain unverified**.

## Documentation preservation update — 2026-10-27
- [x] README contains infrastructure, proposed Android `MainActivity`/ViewModel layering, Cloudflare service-choice table, legacy keep/rebuild/drop and explicit approval gates; links to all detailed files.
- [x] Wrote `AGENTS.md` and `docs/AI_HANDOFF.md` as new-chat read order and specific next steps.
- [x] Wrote `docs/ANDROID_STRUCTURE.md`, `docs/CLOUDFLARE_INFRASTRUCTURE.md`, `docs/MODULE_BOUNDARIES.md`, and native Android architecture decision ADR-0003.
- [x] Added `npm run docs:check` and GitHub workflow docs gate. **20 required docs, 90 relative documentation links verified; 7/7 native Node tests and TypeScript strict check passed locally**, as verified again after correcting a missing Google Pay policy reference in older docs.
- [x] Documentation transferred to JODLO feature branch. Verify complete GitHub tree, CI and PR before claiming green/merged.

## Blocked/pending
- [x] Repository initialized by founder; GitHub read/write verified 2026-10-27. Feature branch `feature/cloudflare-foundation-20261027` is receiving the full foundation; `main` is not changed yet.
- [ ] Native GitHub CI run GREEN: pending actual hosted GitHub Actions run; local tests do not count.
- [ ] Cloudflare preview dev server with Wrangler: not executed; package registry network unavailable in preparation environment. Local API route was tested using Node Request/Response; typechecked.
- [ ] Lockfile: npm registry was unavailable. Generate and commit `package-lock.json` with npm install before switching CI to npm ci and before deploying.
- [ ] Production Cloudflare Worker / domain / storage / identity / Android: not created or deployed.
- [ ] Founder approvals for UI and the initial product vertical: required before UI creation.

## Architecture decisions now clearly documented
- `MainActivity` only hosts Android lifecycle/navigation; feature ViewModel/StateFlow -> repository -> typed API; single-Activity + Compose is a proposal pending founder UI approval.
- One small API Worker; D1/R2 feature-gated; Queues for asynchronous work; Durable Objects only on measured realtime need; Android FCM and voice/payments providers may require non-Cloudflare systems.
- Server authority for wallets, prices, calls; no direct database/secret access in Android; bounded geo search, private media, simple module contracts and cleanup/reconciliation even at zero traffic.
- Google Pay India/UPI preferred where eligible, legacy Razorpay not imported; digital Play purchases require Google Play Billing or eligible valid alternative program, review before code.

## Exact next steps
1. GitHub access is now restored. Verify every expected foundation file is committed to the feature branch and open a PR.
2. Await actual PR GitHub Actions checks and inspect errors; never merge failed/unknown checks.
3. Verify dependencies with real npm installation and a lockfile; run local Wrangler smoke check in a configured dev sandbox.
4. Confirm Cloudflare ownership/zone without touching existing records or old services. Plan cost limit and staging vs production only when founder access is ready.
5. When payment work begins, classify JODLO SKUs, verify Google Pay merchant/UPI availability and Play Billing program requirements before enabling any checkout.
6. Review JODLO MVP product flow with founder and obtain UI sign-off before any Android/website UI code.

**Never claim GitHub green, cloud deployment complete or UI approved on the basis of this local archive.**