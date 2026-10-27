# ADR-0005 — Mandatory reuse, design tokens and premium motion

- **Date:** 2026-10-27
- **Status:** **Accepted, founder-enforced engineering + future visual-design requirements**
- **Applies to:** Android `com.rekixo.jodlo`, web `jodlo.rekixo.com`, Cloudflare API, shared contracts, assets, tests and future PRs.
- **Scope caveat:** Requirements are approved, **the final UI layouts, palette, component styling and specific animations are NOT yet designed/approved**; founder review precedes any UI implementation.

## Non-negotiable engineering contract

1. **Reuse before copy/paste.** Search existing code/components/contracts/helpers/assets before implementing. When a behavior repeats or a second verified reuse case appears, extract a small shared function, composable, repository abstraction, API contract or token in the correct owner module; write unit tests for it. Do not split into unnecessary modules or invent giant generic abstractions for a one-off.
2. **Do not duplicate business logic** across Android, Worker routes and feature packages. Android is presentation/state, server decides auth/prices/ledger; share API schemas/contract definitions or generate typed clients rather than manually diverging models. Provider integrations hide behind dedicated ports/adapters.
3. **Single visual source of truth.** No scattered hardcoded UI strings, HEX colors, typography, corner radii, strokes/borders, elevations, shadows, spacing or animation timings. Android uses `stringResource`/localized `strings.xml` and founder-approved Material 3 theme/design tokens. Web uses locale resources and CSS/TypeScript tokens when built. Allowed literal exceptions must be documented and narrowly reviewed.
4. **No duplicate assets.** One owned, optimized, correctly licensed asset per purpose, referenced from a shared location. Prefer vectors/shape drawing and existing icon library, rather than copied PNGs or bundled duplicate density files. Asset reuse must not cause huge decompression/battery costs.
5. **Premium motion is part of UX quality.** Thoughtful, consistent, responsive animations for approved tabs, transitions, gestures, buttons/feedback, navigation, loading/success/error states, expandable cards and meaningful content hierarchy. Do not animate everything perpetually: motion must clarify state and **never delay core action**.
6. **Elegant depth / selected 3D.** Founder wants immersive visual quality. Use subtle depth, lighting, layers, perspective and *selective* high-value 3D effects or interactive 3D only where justified. Start with composited 2.5D effects; introduce actual 3D renderer/model only with strong evidence, reusable implementation, size/memory/battery budget, fallback and prior founder design approval. Not one huge 3D SDK for the whole app.
7. **Performance + access always win.** Target smooth low-end Android scroll/navigation and responsive touch; animate draw/layer properties when possible, avoid repeated layout/recomposition and main-thread work. Honor Android animator-duration scale/reduced-motion preferences, battery/data saver, TalkBack semantics and no-animation fallbacks. Measure frame timing and APK size; don't promise a universal 60fps without measurement.
8. **Clean repo discipline.** Remove dead code, unused Gradle packages, obsolete assets/translations/icons, experimental animations and undocumented SDKs. Build only modules that are needed. Avoid duplicate source-of-truth, copy-paste utils and comment noise.
9. **Hard review/CI gates.** Every UI/feature PR documents *reused component/contract*, *new shared abstraction reason*, *new tokens/assets*, *motion/reduced-motion fallback*, *performance tests* and *founder design approval*. Repository guard script rejects common hardcoded patterns and identical asset bytes. Automated checks **cannot prove semantic duplication or visual smoothness**: code review + on-device benchmarks are additional mandatory gates.
10. **Founder has final visual direction.** Provide premium palette/style proposals and animated interaction prototypes *for feedback* before creating layout/theme/screens/3D artwork. Record the approved choices in design system docs. Do not claim this ADR approves a specific visual theme.

## Why

A consistent reusable design system reduces inconsistency, repeated bugs, bundled media size and changes-to-many-files. Purposeful, high-quality motion with performance guardrails makes the app feel professional without turning each screen into a heavy GPU workload. **Reuse when justified**, not abstraction for abstraction's sake.

## Verification

- CI runs `npm run design:check` and tests in [scripts/verify-design-guards.test.mjs](../../scripts/verify-design-guards.test.mjs) as Android/web source is introduced.
- Android resource/Compose checks will be tightened with ktlint/Detekt + Android Lint/Compose previews/screenshot tests when an actual Android Gradle project exists. This script is a **first guard**, not complete static analysis.
- Source-of-truth docs: [Reuse and Asset Policy](../REUSE_ASSET_POLICY.md), [Design System](../DESIGN_SYSTEM.md), [Motion + 3D](../MOTION_3D.md), [Native structure](../ANDROID_STRUCTURE.md).
- No Cloudflare staging/deployment; code-first per [ADR-0004](0004-local-first-no-staging-until-production.md).
