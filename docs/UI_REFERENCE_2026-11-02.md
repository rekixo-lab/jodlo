# JODLO — founder-approved UI reference (2026-11-02)

**Status: APPROVED and binding for the entire JODLO product.** This is the
founder's explicit screenshot-based visual direction, overriding previously
proposed light themes, violet/amber palettes, 3D/depth requirements and any
"UI needs founder color sign-off" placeholders. All future Customer, Worker,
sign-in, listing, notification, support, calling and marketplace screens must
reuse the same design system. **This approves visuals only**; it does not
authorize live payments/ads/Agora calls or manufacture missing API policies.

## Original user-provided reference screenshots

The original screenshots are attached to the 2026-11-02 project conversation:

- **Screenshot-20261101-103539.png** (602 × 261): black canvas with a
  thin charcoal 10px-radius outer outline; "अभी का Flow" vs "नया Smart Flow"
  side-by-side; right-hand dark-green hairline outlined Home Offer and Smart
  Action cards; small white labels, muted explanatory copy, no gradients,
  shading, drop shadows or 3D effects. The comparison is **design/flow
  reference only**, not approval to turn on payments, advertising or unlocks.
- **Screenshot-20261102-174755.png** (166 × 63): three near-black
  40px-square rounded action outlines, phone / green-chat / grid; white line
  icons with restrained teal-green active accent; gaps ~7px. This is a
  **component shape reference**, not proof of active call/chat services.

The GitHub-tracked SVGs at [reference-flat-flow.svg](assets/reference-flat-flow.svg)
and [reference-icon-actions.svg](assets/reference-icon-actions.svg) are compact
visual **redraws** for design reviews, not byte-for-byte copies of the
uploaded PNGs. The originals live in the project chat attachments.

## Measured colors / engineering tokens

Samples taken from the original screenshots, not guesses about an unrelated
template. PNG antialiasing means some text/edges contain blended pixels.

| Role | Observed / applied | Android single source |
| --- | --- | --- |
| Canvas and flat card fill | \`#000000\` (most common RGB pixel) | \`JodloPalette.Canvas/Surface\` |
| Neutral outline | \`#262626\` (38,38,38) | \`JodloPalette.Outline\` |
| Active deep-green hairline | \`#08391A\` (8,57,26) | \`JodloPalette.AccentOutline\` |
| Accent green readable text/icon | \`#40C877\` (sample green icon) | \`JodloPalette.Accent\` |
| Primary text | near-white \`#EDEDED\` | \`JodloPalette.Text\` |
| Secondary copy | muted gray \`#929292\` | \`JodloPalette.MutedText\` |

Exact Android DP sizes cannot be inferred from PNG screenshots without screen
density; choose coherent device-independent implementation tokens instead.
These values are centrally implemented in
\`apps/android/app/src/main/java/com/rekixo/jodlo/ui/theme/JodloTheme.kt\`.
\`JodloComponents.kt\` owns reusable input/button/card/chip/icon-action styling.

- **Stroke:** 1dp neutral #262626; selected/CTA outline #08391A.
- **Radii:** 10dp cards/filters/text inputs; 12dp action and icon controls.
- **Layout:** 16dp outer spacing, 12dp card inset/section rhythm, 8dp compact gaps.
- **Tap target:** at least 48dp even when the visual affordance is compact.
- **Depth:** 0dp shadow / 0dp card elevation. No blur, glass, glossy gradients,
  visual noise, floating bulk, mandatory 3D, or oversized animated surfaces.
- **Typography:** compact but accessible 11–23sp, scale-safe Devanagari and
  Latin system fonts, restrained weight hierarchy.
- **Dark-only:** do not automatically switch the app to a white background
  because the system uses light mode; surfaces remain almost black.
- **Motion:** minimal, optional and meaningful; respect accessibility/reduced
  motion; no perpetual UI animation or heavy 3D.
- **Localization:** preserve both Hindi and English resources.
- **Interactions:** no clickable dead ends, fake success, or invented
  availability. Missing phone/chat/payment services stay unenabled.

## Engineering and acceptance

Shared palette, sizes, Material theme and components are reusable by every
Android screen. Feature files must not set their own raw hex colors, arbitrary
shape radii or unrelated filled button styles. CI validates this contract and
still separately compiles the native APK; device review at large font size,
talkback/high contrast, 320dp compact widths and light-system-mode dark theme
is still required. Never confuse matching visual style with product release
readiness.
