# ADR-0003 — Native Android single-activity architecture

Date: 2026-10-27 · Status: technical proposal only; **founder UI approval is required**.

App identity `JODLO`, `com.rekixo.jodlo`. Use Kotlin, lifecycle-aware unidirectional `UiState` + ViewModels/StateFlow; `MainActivity` manages only application lifecycle/navigation. Each feature owns its screen/use cases/repository interfaces and isolated tests. Typed API client accesses Cloudflare Workers; offline/local cache is UI convenience, never server billing authority. No Firebase/Firestore business logic in Activity. Proposed Jetpack Compose is an implementation choice, not approved visual design. Verify low-end Android performance and accessibility.

Legacy 2,000–3,500-line Activities are deliberately not ported. Founder reviews welcome/navigation/worker/customer journeys and designs before any UI implementation. See [Android blueprint](../ANDROID_STRUCTURE.md).

## Amendment: mandatory reusability and high-quality animation direction (2026-10-27)

Founder requires reuse of tested shared Compose components/contracts, centralized Android localization and semantic light/dark tokenized colors, typography, shapes/corners, strokes, spacing and motion. No duplicate icons/media or unneeded dependencies. Premium animated navigation, tabs, actions and selective efficient 3D/2.5D are necessary where meaningful; low-end hardware, accessibility and reduced-motion are mandatory. **Specific UI styles and animations require explicit founder approval before code**, not granted here. See [ADR-0005](0005-reuse-tokens-premium-motion.md), [Design](../DESIGN_SYSTEM.md).
