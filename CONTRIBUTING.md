# Contributing to JODLO

1. Read `AGENTS.md`, `docs/AI_HANDOFF.md`, `README.md`, `docs/STATUS.md`, `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/ANDROID_STRUCTURE.md`, `docs/CLOUDFLARE_INFRASTRUCTURE.md`, `docs/MODULE_BOUNDARIES.md` and ADRs.
2. Use small, reviewable feature branches. Specify intent, affected modules, privacy risk, test commands and manual migration/deploy steps.
3. No production deployment, migration, paid feature, old-repository modification or UI creation without the required owner review.
4. Keep business rules out of route handlers. Avoid heavy libraries without measured benefit.
5. Run `npm run docs:check`, tests and typecheck; never call CI green unless the remote check run actually passed.
6. Update the roadmap with actual completed work and remaining blockers, not estimated results.
7. In public code/comments, write **why** constraints exist; avoid superfluous comments and secrets.
## Mandatory PR code-reuse + visual-quality checklist

Use [PR checklist](.github/PULL_REQUEST_TEMPLATE.md). No repeated shared logic/components/DTOs or duplicate media; explain any new SDK/abstraction. All visual resources central and semantic: localized strings, founder-approved theme color/typography/spacing/radius/stroke/elevation/motion tokens. Premium interaction animation and selective useful 3D/2.5D with reduced-motion and frame/memory testing **only after founder UI proposal approval**. `npm run design:check` and hosted green GitHub CI required; see [ADR-0005](docs/decisions/0005-reuse-tokens-premium-motion.md), [Design](docs/DESIGN_SYSTEM.md), [Motion](docs/MOTION_3D.md).
