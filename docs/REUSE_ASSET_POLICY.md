# Mandatory code reuse, cleanliness and zero duplicate assets

**Owner directive (2026-10-27):** JODLO must stay lightweight, reliable, clean and easy to evolve. **Reuse existing code and resources where behavior is genuinely shared; never write the same thing repeatedly.** Applies to Android, backend, web, media, tests and shared DTO/contracts. [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md).

## Before adding any code or resource

1. Search the target feature, core module, existing contracts, tokens and asset catalog for the same behavior. Reuse the existing tested API/component/helper first.
2. Extract a **small clear reusable function/component** when repeated behavior is real, rather than copying it. Keep ownership in core or the appropriate feature and expose stable interfaces. Do not create “everything utils” or premature overly generalized frameworks.
3. Each domain rule has one owner: API/business auth, pricing and ledger in Worker, client UI state in Android, shared *contract* only where needed. No duplicate validation drift—server remains authoritative.
4. Use one HTTP client, one navigation strategy, one media loader/cache policy, one unified error mapping, one localization source and one theme library; add adapters only for different providers.
5. Delete unreachable/obsolete code, unused imports/dependencies and redundant assets when replacing; do not retain compatibility machinery for legacy Finworkar. Preserve user safety constraints, not its technical debt.
6. Add concise tests demonstrating reusability and edge cases; measure resulting build size, complexity and latency instead of assuming dedup always wins.

## Android assets, icons and media

- One canonical icon/vector/illustration location and consistent naming. Prefer vector drawables, Compose primitives and shared design-system icons; avoid multiple near-identical JPG/PNG/WEBP/SVG files. Enforce matching byte duplicates automatically.
- Do not ship raw oversized photographs, unnecessary 3D models, unused animations, debug exports or multiple file formats for the same visual without explicit compatibility/performance need.
- Use sizes/densities required by Android and test resource shrinker + R8 in release; allow truly required variants only after documenting difference and ensuring they are not byte-identical.
- Correct content descriptions/labels from localized resources; no user details embedded in logs, assets or test fixtures.

## Theme, strings, layout constants

- Android user-facing strings: `res/values/strings.xml`, Hindi resources `res/values-hi/` when ready, and `stringResource(R.string.*)`; handle plurals and screen-reader labels. Backend error **codes** are contracts; client renders localized copy.
- All UI colors: `MaterialTheme.colorScheme` and semantic tokens (`Primary`, `Surface`, `OnSurface`, `Error`, `Outline`, etc.) in approved `core/designsystem`.
- Typography `MaterialTheme.typography`; radius/shape `MaterialTheme.shapes`; spacing, borders/strokes, elevations/shadows and animation curves/durations central tokens. Themes cover dark/light, contrast and semantic error/success.
- Component examples: primary/secondary button, service card, empty/error state, search bar, worker profile summary, chips/tabs, skeleton, confirmation modal, animation wrappers. Implement **after founder UI review**; no duplicate styling per feature.
- Exceptions to lint-like guards only for named design-system theme definitions and approved exceptional rendering code, each with reviewed rationale.

## PR gate

Explain in PR: **(a)** existing code/assets searched and reused; **(b)** why new code/component was needed; **(c)** any new tokens/strings/assets; **(d)** tests and binary/performance impact. Detecting semantic near-duplicates still requires review; static asset check detects byte-identical duplicates only.

**No UI code has been implemented or approved yet.** Use [Design System](DESIGN_SYSTEM.md), [Motion & 3D](MOTION_3D.md) and [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md).
