# JODLO — instructions for any new AI/engineer session

**Start here, every time.** This file is a repository-resident handoff, NOT a claim that the chat has durable Memory. A new assistant must be given this repository/ZIP, or have GitHub access, to read it.

## Required read order
1. [`README.md`](README.md): mission, fixed product identity and the architecture at a glance.
2. [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md): source-of-truth facts, decisions vs hypotheses, last known status and exact next task.
3. [`docs/STATUS.md`](docs/STATUS.md): what is actually done, not just planned, and blockers.
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) + [`docs/CLOUDFLARE_INFRASTRUCTURE.md`](docs/CLOUDFLARE_INFRASTRUCTURE.md): backend/infra.
5. [`docs/ANDROID_STRUCTURE.md`](docs/ANDROID_STRUCTURE.md): native Kotlin Activity/ViewModel/module rules.
6. [`docs/MODULE_BOUNDARIES.md`](docs/MODULE_BOUNDARIES.md): feature boundaries, data/adapter contracts.
7. [`docs/ROADMAP.md`](docs/ROADMAP.md), [`docs/MANUAL_ACTIONS.md`](docs/MANUAL_ACTIONS.md), [`docs/PAYMENTS.md`](docs/PAYMENTS.md), ADRs: sequence, founder gates and policy.
8. [`docs/ARCHITECTURE_RESEARCH_20261027.md`](docs/ARCHITECTURE_RESEARCH_20261027.md) + [`docs/reference/LEGACY_MAPPING.md`](docs/reference/LEGACY_MAPPING.md): evidence and former code mapping.

## Hard facts and owner decisions (DO NOT alter silently)
- New app **JODLO**, GitHub `rekixo-lab/jodlo`, Android `com.rekixo.jodlo`, planned domain `jodlo.rekixo.com`.
- Separate greenfield system; **do not modify existing production Finworkar Android, Firebase backend, website, data or repositories**. Treat them as read-only references.
- Cloudflare-first backend, native Kotlin Android. Cloudflare does not host the Android runtime, Google Play, FCM/device pushes, bank/PSP processing, or automatically provide voice-media connectivity.
- Start with **one small modular TypeScript Cloudflare Worker**, add D1/R2 when their features are implemented, Queues/DO only when justified; do not prematurely split per-feature microservices.
- Proposed Android: one `MainActivity` host with screens composed using ViewModels/StateFlow, feature-domain-data boundaries; **Jetpack Compose is a proposed implementation choice, not founder-approved UI artwork**.
- **UI approval gate:** before implementing ANY new Android/web UI layout/theme/screen or Play listing media, show founder intended wireframe/flow, invite suggestions, and receive approval.
- New project payments: **Google Pay India/UPI preferred where eligible, legacy Razorpay must NOT be ported**. Google Play Billing or legally enrolled alternative program is a distinct mandatory review for digital products; no real checkout without owner authorization + bank/PSP verification and audit-grade ledger.
- No pre-established fixed 30/60/90-day finish date. Do not skip needed tests, safety, privacy or legal gates for speed.
- No claims of GitHub green CI, prod deployment, created database, live domain, or installed client without real evidence.

## Engineering operating contract
- First understand the existing branch, CI state and source; small branch+PR changes, never force-push or merge a failing change.
- Maintain strict module boundaries, stable versioned `/api/v1` contracts, safe logging, server-authoritative authorization/prices, idempotency, tests, performance budgets, rollback.
- Founder handles manual GitHub integration authorization, Cloudflare zone/billing, Play Console, payment onboarding, design decisions, worker/customer interviews and final release. Never request passwords, API tokens, signing keys, OTPs or raw customer data.
- At session end write dated **Done / Evidence / Pending / Blocked / Manual / Next exact action** to `docs/STATUS.md`, update roadmap/ADRs if decisions changed, run `npm run docs:check` + applicable code tests.
- If repository write access regresses, keep an updated verified ZIP ready. Explicitly state "not committed"; do not claim another AI can see local files unless linked/shared.
- Old findings are from static source inspection; production costs, source-vs-deployed versions, live cloud traffic and app behavior were **not measured**.

## Exact safe resumption (unless updated STATUS says otherwise)
1. Open `rekixo-lab/jodlo` **main**, confirm status and latest CI. Foundation PR #1 merged 2026-10-27 with green main run 40466265299.
2. Main contains 38 initial files including staging-only GitHub Actions deployment workflow. GitHub CI GREEN for main commit `2b447de586e0c9d655edc188203acf843e4dc66f` (run 40466265299); any subsequent commit needs new tests. No Cloudflare account/deployment has been connected.
3. Verify Cloudflare account/zone and environments without changing existing `rekixo.com` production DNS; plan local/stage/prod separation.
4. Confirm MVP product roles and auth/area model before D1 schema. **No UI without founder sign-off.**