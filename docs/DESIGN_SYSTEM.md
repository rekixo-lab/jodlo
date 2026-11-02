# JODLO design system — founder-approved flat black + subtle teal (2026-11-02)

**Status: APPROVED visual direction.** The founder selected and supplied two
original UI screenshots on 2026-11-02. The binding design reference is
[UI_REFERENCE_2026-11-02.md](UI_REFERENCE_2026-11-02.md); the tracked
[flow redraw](assets/reference-flat-flow.svg) and
[outlined-action redraw](assets/reference-icon-actions.svg) illustrate it.
Earlier "visual colors/motion not approved" and alternative palette sections
are superseded. Android application ID remains \`com.rekixo.jodlo\`.

## Selected identity

- **Dark-only**, flat, almost fully black (\`#000000\`), with near-white text
  and a muted secondary gray (\`#929292\`).
- **Hairline borders**, neutral \`#262626\` and deep green selected/CTA stroke
  \`#08391A\`, no gradient, glass/blur, shadow, 3D or thick outlines.
- **Green-teal active state**, \`#40C877\`, sparingly for actionable text and icons.
  Never use green alone as the sole selected/disabled/error indication.
- **Corner language:** quiet rounded 10dp cards/fields, 12dp buttons/icon tiles.
  Size and 48dp touch targets are density-independent accessibility adjustments,
  not claims that PNG pixel radii equal device DP.
- **Motion:** optional subtle state feedback only; always obey reduced motion
  and avoid perpetual transitions. See [MOTION_3D.md](MOTION_3D.md).
- **One reusable component set**, two localized resource dictionaries (Hindi,
  English), and no per-screen invented colors or radius numbers.

## Authoritative Android owners

| Role | Current code |
| --- | --- |
| Colors, shapes, typography, dark-only theme, spacing | \`apps/android/app/src/main/java/com/rekixo/jodlo/ui/theme/JodloTheme.kt\` |
| Outline buttons/chips/cards/fields, square action controls | \`apps/android/app/src/main/java/com/rekixo/jodlo/ui/theme/JodloComponents.kt\` |
| Customer browse/search/listings and primary navigation | \`apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt\` |
| Worker sign-in/opt-in/owned-listing views and guarded actions | \`apps/android/app/src/main/java/com/rekixo/jodlo/WorkerDashboard.kt\` |
| Localization | \`apps/android/app/src/main/res/values/strings.xml\` and \`values-hi/strings.xml\` |
| Static UI tripwire | \`scripts/verify-approved-flat-ui.mjs\` |

For **all future** JODLO screens use \`JodloTheme\`, \`JodloSizes\` and
shared \`JodloButton\`, \`JodloTextAction\`, \`JodloChip\`, \`JodloCard\`,
\`JodloSearchField\`, \`JodloSquareAction\` rather than raw Material filled
widgets. Do not convert conceptual "Smart Action" payment/advertisement/phone
icons into live UX until corresponding backend authorization, payment/calling
policy and real integration are implemented.

## Quality gates

GitHub CI checks design source conventions and Android APK compilation; neither
is a device screenshot review. Android phones with 320dp width, long Hindi
labels, accessibility font scaling, TalkBack, display cutouts, contrast and
hardware back navigation still need interactive testing. Only measurable
device results can establish real visual/polish or motion smoothness. Later
screens may extend tokens without diverging from the approved look.
