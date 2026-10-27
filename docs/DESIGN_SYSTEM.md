# JODLO design-system specification — premium, coherent, reusable

**Status:** founder-approved **quality direction only**; individual colors, screen layouts, typography and animation storyboard are **NOT approved**. **Before styling/building UI:** propose alternatives with visual samples/wireframes, receive founder input/approval, then record chosen numeric tokens here. Native Android remains `com.rekixo.jodlo`.

## Visual intent

Premium yet practical Indian local-work app: refined visual hierarchy, clear contrast, high-quality icons, generous intentional whitespace, appealing but restrained accents, coherent shadow/depth, tactile components and smooth transitions. Smooth and light on budget Android devices and weak connections. Avoid visual noise, fake trust badges, huge animations or excessive translucent blur.

## Single source of truth (names are conceptual until UI sign-off)

| Token family | Central owner (Android) | Rules |
| --- | --- | --- |
| Color roles | `core/designsystem/theme/JodloColorScheme.kt` | Material 3 light/dark semantic color roles; primary/accent/surface/text/error/outline; no per-screen raw HEX |
| Type | `JodloTypography.kt` | One type scale, legible Devanagari/Latin fallbacks, density/accessibility font scaling |
| Shapes | `JodloShapes.kt` | Reusable corner radius scale, no ad-hoc DP corners |
| Spacing & sizes | `JodloSpacing.kt` | Common grid rhythm, touch target/safe-inset adaptation, avoid arbitrary per-screen spacing |
| Borders/strokes | `JodloStrokes.kt` | Subtle strokes/elevation/shadows; theme-aware contrast and tokenized stroke widths |
| Motion | `JodloMotion.kt` | Spring/easing/duration, shared transition primitives, system motion scale |
| Components | `core/designsystem/components/` | Buttons, tabs, cards, inputs, chips, alerts, sheets, placeholders with stable APIs |
| User text | `res/values/strings.xml`, localized `values-hi`, plural resources | `stringResource`; no inline user-facing copy or raw content descriptions |

**Naming and organization** are proposed code contracts, not files already created. Avoid generating placeholder files until the first reusable feature actually needs them. No unrelated third-party theme frameworks merely for novelty.

## Suggested premium directions for founder review — NOT decided

- **Option A — Midnight Ink + Bright Teal:** clean dark ink / soft neutral surfaces, jewel teal highlights and restrained warm support tone; professional/trustworthy.
- **Option B — Deep Graphite + Electric Violet:** crisp light/dark surfaces, violet accent, high-contrast typography and restrained gradients; modern tech-forward.
- **Option C — Royal Blue + Warm Amber:** confident blue primary with warm interactive accents; service-oriented and approachable.

Do not assign permanent HEX values, radius numbers, exact stroke widths, font or 3D art until founder selects/revises a direction. Present light+dark, Hindi labels, normal/large fonts, empty/error/loading states and perceived quality **for approval first**.

## Global invariants

- All screens consume the same theme; optional Material 3 dynamic color only if founder elects it and semantic contrast remains good.
- UI feedback colors always express semantic states, not decoration that conflicts with error/success warnings.
- Depth is built by measured elevation, overlay, outline and composited lighting; don't apply blur, glass effects or thick strokes to every row.
- Motion/haptics visual grammar is central and shared. See [Motion & 3D](MOTION_3D.md).
- Test 320dp-class compact screens, larger tablets, dark/light, Devanagari legibility, font scaling and accessibility. Don't promise perfect appearance without real device testing.

## Approval and acceptance

Before UI source, show founder two or three visual directions, tab/navigation motion feel and relevant 3D examples; get actual feedback, amend this doc with approved tokens and screenshots. Then implement shared tokens + components **once**, reuse everywhere, and verify no duplicate assets or constants. [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md) · [Android Structure](ANDROID_STRUCTURE.md).
