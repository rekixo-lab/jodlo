# JODLO — instructions for any new AI/engineer session

> **MOST RECENT OWNER INSTRUCTION (2026-10-27): No staging, no deployment while building JODLO.** Finish all code with local Worker/D1/R2/Queue simulations, fake payment/RTC/FCM adapters and green GitHub CI. No Cloudflare tokens or DNS work until final approved production release. Previous staging workflow has been deleted. See [ADR-0004](docs/decisions/0004-local-first-no-staging-until-production.md), [Release Readiness](docs/RELEASE_READINESS.md).


**Confirmed latest implementation evidence:** [PR #14](https://github.com/rekixo-lab/jodlo/pull/14) squash-merged as `c234961204c0c2586748c52bcd1976a8611c7197`, and [main Actions #40481385874](https://github.com/rekixo-lab/jodlo/actions/runs/40481385874) completed **SUCCESS** (41 automated tests, docs/design guard, local D1 migrations, TypeScript and both Wrangler dry-runs). No Cloudflare deployment, Android UI, production provider or real device tests. Recheck latest head.

**NEW MANDATORY OWNER RULE (2026-10-27):** Reuse existing tested code/components/contracts/assets; do not write repeated logic or duplicate media. User-facing text MUST be localized; colors, radius, strokes, typography, spacing and motion MUST be driven by centralized founder-approved design tokens, not hardcoded per screen. Deliver polished animated tabs/navigation/actions and **selective** immersive 3D/2.5D without sacrificing reduced-motion, accessibility, low-end Android FPS/memory/battery. Before ANY UI/theme/screen/visual implementation, show founder proposed design and obtain approval. Run `npm run design:check` and PR review checklist. Read [ADR-0005](docs/decisions/0005-reuse-tokens-premium-motion.md), [Reuse Policy](docs/REUSE_ASSET_POLICY.md), [Design](docs/DESIGN_SYSTEM.md), [Motion](docs/MOTION_3D.md).

**Start here, every time.** This file is a repository-resident handoff, NOT a claim that the chat has durable Memory. A new assistant must be given this repository/ZIP, or have GitHub access, to read it.

## MANUAL-GATE — mandatory founder-action notification protocol (2026-10-27)

At **every JODLO session**, read [`docs/MANUAL_ACTIONS.md`](docs/MANUAL_ACTIONS.md) with `docs/STATUS.md` **before starting dependent tasks**. The AI/engineer owns routine code, local simulations, tests, commits, PRs, CI fixes and truthful docs. **Do not silently wait for the founder or delegate automatable engineering.**

**When a genuine founder/manual decision, permission, approval, account/onboarding action or external operation becomes necessary, tell the founder directly in the active conversation at that point**, in simple Hindi: action ID, what exactly to choose/do, why it is required, what becomes blocked, whether it is needed now or only later, and what autonomous work can still proceed. Prefer one blocking question at a time; never demand credentials, tokens, signing keys, OTPs or private customer data in chat. Do not repeatedly ask for answered decisions.

Record the gate in `docs/MANUAL_ACTIONS.md` (stable ID, state, trigger, owner, resolution evidence); mirror only the **currently blocking** items in `docs/STATUS.md` and the next roadmap/handoff step. Owner proposals are **not approvals**. Once the founder answers, record the approved decision and resume its gated work via PR and real CI. **A chat assistant cannot independently send unscheduled future alerts**; check/notify on every active project session, not by promising background monitoring.

**M-001 DONE:** founder approved **one account for customers with optional private worker draft** on 2026-10-27; [ADR-0006](docs/decisions/0006-shared-account-opt-in-worker.md). Do not re-ask. **M-002 DONE:** founder chose Google Sign-In (not phone OTP) on 2026-10-27; see [ADR-0007](docs/decisions/0007-google-signin-verified-session.md). Google OAuth console/SHA setup is **M-008 UPCOMING** only when Android integration/testing requires it; M-003 location and M-004 visual UI remain unapproved. No Cloudflare staging, production credentials, UI implementation or old Finworkar mutation.

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
2. Foundation PRs #1/#2 merged; latest earlier confirmed green `main` run 40466624240. Founder revoked the staging plan; PR #3 removed staging workflow/config and merged successfully after green checks. Check **latest** CI before every merge. No Cloudflare resources are provisioned.
3. **Do not configure Cloudflare or deploy.** Public catalog is merged and green; M-001 shared account is approved, with account/worker draft schema implemented and verified by [PR #10](https://github.com/rekixo-lab/jodlo/pull/10) merged as `e01dbde44cbe46aadf3d563c66f411a8c9d96818`; [main GitHub Actions #40476898497](https://github.com/rekixo-lab/jodlo/actions/runs/40476898497) SUCCESS on that commit (27 Node tests, docs/design guard, both dry-run builds, local D1 migration 0001+0002 and strict TypeScript). Next: Google Sign-In backend JWT, D1 account linking and revocable sessions are now implemented locally and main CI green (PR #12). Do not reimplement. Next manual gate **M-008** is future Google OAuth console and Android SHA setup only when real app integration is ready; M-003 before location and M-004 before UI. Continue non-UI backend safeguards, e.g. rate limits and session retention tests. No UI before M-004 approval.
4. M-001 is already confirmed; do not re-ask. Confirm remaining M-002/M-003 only at their integration gates. **No UI without founder sign-off.**
## Mandatory future UI/feature PR review

- [ ] Reused existing tested small feature/core components/contract/adapter rather than copy-pasting; justified only genuinely needed abstraction/dependency.
- [ ] No duplicate assets, dead code, raw literal strings/colors/strokes/radii/font/spacing/motion; central theme & localized resources.
- [ ] Founder **explicitly approved** particular layout, palette, 3D/motion storyboard before implementing visual code; accepted quality brief is NOT specific design approval.
- [ ] High-quality animation for meaningful tabs/navigation/actions/feedback plus selective 3D/depth, interruptible/responsive, reduced-motion fallback; real low-end frame, APK/memory/battery and accessibility checks when UI exists.
- [ ] `npm run design:check`, tests, typecheck, actual green GitHub CI; no Cloudflare deploy/staging while coding.

### Latest safe next engineering task (2026-10-27)

[PR #14](https://github.com/rekixo-lab/jodlo/pull/14) squash-merged as `c234961204c0c2586748c52bcd1976a8611c7197`, and [main Actions #40481385874](https://github.com/rekixo-lab/jodlo/actions/runs/40481385874) completed **SUCCESS** (41 automated tests, docs/design guard, local D1 migrations, TypeScript and both Wrangler dry-runs). Implemented the six-active-session atomic cap, bounded indexed expired-session pruning and owner-scoped logout-all. **Do not redo those features**; next safe nonvisual backend tasks are auth abuse protections and disposable-data/session tests. Real-user retention/deletion & locality decisions remain M-003; design M-004, Google OAuth console M-008, first production launch M-007. No manual Cloudflare action now.
