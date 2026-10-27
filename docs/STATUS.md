# JODLO — current project status (2026-10-27)

Project identity: Android package `com.rekixo.jodlo`; planned domain `jodlo.rekixo.com` (not deployed).

## Verified, committed to GitHub
- [x] New repo `rekixo-lab/jodlo` initialized and authenticated write access verified.
- [x] 36 initial files imported into `feature/cloudflare-foundation-20261027`, including README, AGENTS, AI_HANDOFF, Android/Cloudflare infrastructure and module boundaries, legacy comparison, payment ADR, status/roadmap and TypeScript Cloudflare Worker starter.
- [x] [PR #1](https://github.com/rekixo-lab/jodlo/pull/1) created for owner review. Latest known green commit before staging deployment prep: `4210fac4802c10a9adb9504f062cfcfe7e01fa18`, [Actions run #40465566596](https://github.com/rekixo-lab/jodlo/actions/runs/40465566596): documentation, 7/7 Node tests, TypeScript, Wrangler dry-run all passed.
- [x] Old Finworkar Android, backend and website remain unmodified; their production data stays where it is.
- [x] Foundation has no customer data, storage, auth, payments, voice provider, or UI source. Only `GET /api/v1/health` is implemented, local test only.

## Payments — product direction (not implemented)
- Founder prefers **Google Pay** India/UPI for eligible merchant sales, not old **Razorpay**. **Google Play Billing** remains the route for Play digital SKUs unless enrolled compliant alternative or exception is applicable.
- **No payment API, checkout, ledger, real charging or refunds have been implemented.**

## Open and blocked
- [ ] **Review new SHA CI** after any additional staging configs/workflow; previous green checks do not carry across commits.
- [ ] PR #1 merge to `main` only after green and necessary owner review.
- [ ] Cloudflare access/account for JODLO not connected to ChatGPT; neither staging nor production Worker deployed. Founder must place **CLOUDFLARE_API_TOKEN** and **CLOUDFLARE_ACCOUNT_ID** in JODLO's GitHub Actions Environment `jodlo-staging`, or connect a supported Cloudflare deployment tool. **Never paste credentials in chat**.
- [ ] Deploy staging health endpoint and verify actual publicly reachable response; only then consider reviewed production domain routing. `jodlo.rekixo.com` and DNS NOT changed.
- [ ] Lockfile/reproducible dependency installation and staging dry-run verified after workflow update; prepare D1 schema only after founder MVP data decisions.
- [ ] Native Android Kotlin UI and web layouts not implemented: founder approval required before design/UI work.
- [ ] Google Pay merchant onboarding and Play policy eligibility remain owner/manual tasks.

## Next action and working agreement
1. Complete safe **staging-only** deployment workflow, verify fresh GitHub CI green, then merge reviewed PR.
2. Founder securely adds scoped Cloudflare deployment token and account ID as GitHub Secrets (never in chat) and triggers staging deploy.
3. Verify staging Worker URL and actual `GET /api/v1/health` response; no user data/payment until approved.
4. Continue new product requirements, indexed D1 schema and real pilot validation, asking founder before any UI.

**Always consult [AGENTS](../AGENTS.md), [AI HANDOFF](AI_HANDOFF.md), [README](../README.md), [Roadmap](ROADMAP.md), [Cloudflare infrastructure](CLOUDFLARE_INFRASTRUCTURE.md). Do not overstate CI/deployment.**
