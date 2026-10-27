# JODLO Motion, micro-interactions, premium visuals and selective 3D

**Founder requirement: professional, polished animation and visual depth everywhere it helps UX** (tabs, navigation changes, actions, buttons, cards, loading, confirmations, transitions). **Quality > quantity; never perpetual or laggy decoration.** All visual designs and prototypes need founder suggestions/review **before UI code is implemented**. See [Design System](DESIGN_SYSTEM.md) and [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md).

## Motion grammar (proposed, timings subject to device testing/owner approval)

| User event | Purposeful motion recommendation | Performance/clarity gate |
| --- | --- | --- |
| Tap, checkbox, like, primary CTA | Immediate subtle state transition; press scale/elevation/haptic only where appropriate | Input should feel immediate, no delay to execution |
| Bottom tab or segmented switch | Active indicator glides, content crossfades or small direction-aware slide | Keep scroll position/state stable; do not rerender list unnecessarily |
| Screen navigation/back | Short, consistent entrance/exit with predictable direction; optional shared element when useful | Back gesture works; focus/order/accessibility correct |
| Card expand/collapse, sheets | Spring/size transformation with clipped overflow and clear hierarchy | No excessive reflow in long lists |
| Search/loading/success/error | Skeleton or optimistic feedback, state change transition; don't trap touch behind decorative animation | Network result wins immediately; loading must terminate |
| Empty state or occasional brand hero | Sparse illustrative motion/controlled depth | Low-memory static fallback; skip on data saver/low power |
| 3D/depth effects | Layered 2.5D parallax, tilt/depth/perspective on a **small** hero/component | Avoid permanent 3D renderer on scrolling content |

Provisional feel: short tactile responses often about **90–160 ms**, navigation **180–280 ms**, hero reveal **250–400 ms**. These are **design explorations, not fixed acceptance numbers**. Prefer platform springs when velocity/interruption matters and a single shared token library for durations/easing/stiffness. Never hardcode timings across 25 screens.

## 3D decision ladder — lightest wins

1. **First**: shadows, consistent elevation, perspective/tilt and simple composited transforms.
2. **Next**: pre-rendered transparent WebP/AVIF or optimized vector/illustration with discrete entrance motion when a 3D visual adds clear comprehension.
3. **Only if needed**: animated Lottie/Rive or equivalent after examining binary size, licensing, runtime load, battery, maintainability, accessibility and ability to reuse across flows.
4. **Actual runtime 3D engine/model** only for a clearly valuable interaction and founder-approved prototype. Need artifact/model size budgets, proper touch/assistive alternatives, reduced-motion/static fallback and device metrics. Never force an engine into all tabs/cards.

## Android Compose implementation guidance (after approval)

- Favor `AnimatedVisibility`, `AnimatedContent`, `animate*AsState`, `updateTransition`, shared transitions when justified, driven by stable `UiState` not scattered local animation flags.
- Prefer layer/draw property changes (`alpha`, `translation`, `scale`, `rotation`) using draw/graphicsLayer or deferred state reads where appropriate; avoid expensive relayout and per-frame recomposition in large lists.
- No main-thread image decoding, synchronous IO during scroll, unbounded loops or giant animated assets. Use lazy list keys, appropriate image sizing/cache, debounced requests and cancelable animations.
- All movement must be interruptible and coherent with navigation back/cancel; no one-off animation that masks data inconsistencies.
- Respect system animator scale zero and reduced-motion/accessibility preferences. Offer equivalent nonanimated feedback; avoid flashing or constant high-frequency motion. Battery/data saver and slow-device graceful fallbacks are mandatory.

## Measurable quality gates

- Test representative low-cost devices in **release/profileable build** (not just debug); record frame duration percentiles/jank, startup, memory, binary/media asset footprint, ANR and battery/thermal behaviors.
- 60 Hz display frame budget is about 16.7 ms, 120 Hz about 8.3 ms; these are device frame intervals, **not guaranteed performance**. Aim to meet device refresh where feasible, prioritize scrolling, taps and navigation over brand flourishes.
- Benchmark realistic heavy screens (dense local listing feed, search, images, keyboard entry, permission transitions), dark/light themes, screen readers and large text.
- CI: run static token/string/asset checks; on-device Macrobenchmark/frame tracing later, screenshot/animation-state regression tests and manual design approval. Static checks alone cannot prove smoothness or GPU overhead.

### Reusable motion wrappers envisioned (not yet built)

`JodloTabTransition`, `JodloPressFeedback`, `JodloScreenTransition`, `JodloExpandableCard`, `JodloLoadingState`, `JodloHeroDepth`. Only create these on actual feature demand; otherwise no empty boilerplate packages.

### Official implementation references

- [Google Compose animation quick guide](https://developer.android.com/develop/ui/compose/animation/quick-guide)
- [Compose performance](https://developer.android.com/develop/ui/compose/performance)
- [Material 3 theme](https://developer.android.com/develop/ui/compose/designsystems/material3)
- [Compose stability](https://developer.android.com/develop/ui/compose/performance/stability)
