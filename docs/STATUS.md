# JODLO — current project status (2026-10-27)

Project identity: Android package `com.rekixo.jodlo`; planned domain `jodlo.rekixo.com` (not deployed).

## Verified, committed to GitHub
- [x] New repo `rekixo-lab/jodlo` initialized and authenticated write access verified.
- [x] 36 initial files imported into `feature/cloudflare-foundation-20261027`, including README, AGENTS, AI_HANDOFF, Android/Cloudflare infrastructure and module boundaries, legacy comparison, payment ADR, status/roadmap and TypeScript Cloudflare Worker starter.
- [x] [PR #1](https://github.com/rekixo-lab/jodlo/pull/1) merged into `main`; **38 source/documentation files**. Latest confirmed green `main` commit `2b447de586e0c9d655edc188203acf843e4dc66f` — [Actions run 40466265299](https://github.com/rekixo-lab/jodlo/actions/runs/40466265299): documentation, 7/7 Node tests, strict TypeScript, base/staging Wrangler dry-runs passed.
- [x] Old Finworkar Android, backend and website remain unmodified; their production data stays where it is.
- [x] Foundation has no customer data, storage, auth, payments, voice provider, or UI source. Only `GET /api/v1/health` is implemented, local test only.

## Payments — product direction (not implemented)
- Founder prefers **Google Pay** India/UPI for eligible merchant sales, not old **Razorpay**. **Google Play Billing** remains the route for Play digital SKUs unless enrolled compliant alternative or exception is applicable.
- **No payment API, checkout, ledger, real charging or refunds have been implemented.**

## Open and blocked
- [x] Staging workflow/config are committed, **both Wrangler dry-runs green on main** (40466265299); all future commits require fresh checks.
- [x] PR #1 merged after green PR CI. New work goes via review branch and independent CI.
- [ ] Cloudflare access/account for JODLO not connected to ChatGPT; neither staging nor production Worker deployed. Founder must place **CLOUDFLARE_API_TOKEN** and **CLOUDFLARE_ACCOUNT_ID** in JODLO's GitHub Actions Environment `jodlo-staging`, or connect a supported Cloudflare deployment tool. **Never paste credentials in chat**.
- [ ] Deploy staging health endpoint and verify actual publicly reachable response; only then consider reviewed production domain routing. `jodlo.rekixo.com` and DNS NOT changed.
- [ ] Lockfile/reproducible dependency installation and staging dry-run verified after workflow update; prepare D1 schema only after founder MVP data decisions.
- [ ] Native Android Kotlin UI and web layouts not implemented: founder approval required before design/UI work.
- [ ] Google Pay merchant onboarding and Play policy eligibility remain owner/manual tasks.

## Next action and working agreement
1. Staging-only deployment workflow is already committed at `.github/workflows/deploy-staging.yml`, tested by CI, and merged to main. Founder must configure Cloudflare credentials securely; then trigger the manual deployment.
2. Founder securely adds scoped Cloudflare deployment token and account ID as GitHub Secrets (never in chat) and triggers staging deploy.
3. Verify staging Worker URL and actual `GET /api/v1/health` response; no user data/payment until approved.
4. Continue new product requirements, indexed D1 schema and real pilot validation, asking founder before any UI.

**Always consult [AGENTS](../AGENTS.md), [AI HANDOFF](AI_HANDOFF.md), [README](../README.md), [Roadmap](ROADMAP.md), [Cloudflare infrastructure](CLOUDFLARE_INFRASTRUCTURE.md). Do not overstate CI/deployment.**
