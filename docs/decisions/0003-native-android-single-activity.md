# ADR-0003 — Native Android single-activity architecture

Date: 2026-10-27 · Status: technical proposal only; **founder UI approval is required**.

App identity `JODLO`, `com.rekixo.jodlo`. Use Kotlin, lifecycle-aware unidirectional `UiState` + ViewModels/StateFlow; `MainActivity` manages only application lifecycle/navigation. Each feature owns its screen/use cases/repository interfaces and isolated tests. Typed API client accesses Cloudflare Workers; offline/local cache is UI convenience, never server billing authority. No Firebase/Firestore business logic in Activity. Proposed Jetpack Compose is an implementation choice, not approved visual design. Verify low-end Android performance and accessibility.

Legacy 2,000–3,500-line Activities are deliberately not ported. Founder reviews welcome/navigation/worker/customer journeys and designs before any UI implementation. See [Android blueprint](../ANDROID_STRUCTURE.md).
