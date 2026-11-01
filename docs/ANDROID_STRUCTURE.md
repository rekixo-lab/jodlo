# JODLO Native Android — Activity, component and feature architecture

**Stage (2026-10-28):** A [standalone Kotlin networking core](../apps/android/README.md) has been introduced and compiled in CI, with **no Android APK, Activity, Android SDK integration or UI screen created/approved**. The visual architecture below remains an unimplemented proposal. Android application ID must be **`com.rekixo.jodlo`**. Kotlin native, targeting lower-end Android devices; Hindi (Devanagari) and English ONLY (ADR-0008).

## Why we are changing the current structure
Finworkar has ~2472-line `HomeActivity.java`, ~3508-line `GuidedAddPostActivity.java`, ~2254-line `CallService.kt`, and central `FinFirebase.java` exposing Auth/Firestore/Functions/Storage directly. This is a source-level observation. JODLO **must not** reproduce oversized Activities which own networking, permission state, business rules, sorting, analytics and UI simultaneously. Keep useful requirements and safety tests, not implementation baggage.

## Architecture pattern (proposed)
- **One Android Activity** (`MainActivity`) to host approved navigation and platform lifecycle. Splash/startup as an Android splash policy, not a chain of splash Activities. Separate Android components such as a narrowly scoped foreground call Service, BroadcastReceiver or Worker exist only if a real Android background lifecycle requires them.
- **Single source of truth for each screen:** typed `UiState` emitted from `ViewModel`, plus distinct events/actions. StateFlow and lifecycle-aware collection (Android recommended app architecture). No direct API/D1/R2 calls in UI.
- **Layered dependencies:** `UI -> ViewModel -> use case (only where justified) -> Repository interface -> API/cache adapter`; `core/*` does not depend on `feature/*`.
- **Proposed Jetpack Compose** for screen implementation, subject to founder's UI design review. The core architectural separation does not require Compose to be approved immediately.
- **Prefer feature folders first, not 15 Gradle projects.** Split into independent Gradle modules only when compilation time, test isolation, feature ownership or dynamic delivery justifies the overhead.

## Target package and directory blueprint (not yet created)
```text
apps/android/
  settings.gradle.kts
  app/src/main/java/com/rekixo/jodlo/
    JodloApplication.kt         # only app-wide SDK initialization
    MainActivity.kt             # lifecycle/navigation host; thin
    navigation/                 # graph after founder reviews journeys
    core/
      network/                   # HttpClient, AuthInterceptor, ApiError, RetryPolicy
      session/                   # SessionStore, SessionRepository
      data/                      # app repositories, remote/local adapters
      database/                  # Room database + bounded offline cache if needed
      model/                     # platform independent DTO/domain models
      preferences/               # DataStore, non-sensitive preferences
      security/                  # validated auth/session, encrypted token storage
      location/                  # optional location + selected area; no forced GPS
      image/                     # compression, thumbnails, upload coordinator
      push/                      # FCM adapter + token registration when needed
      designsystem/              # founder-approved colors/type/components, later
      testing/                   # fixtures, fakes, test dispatchers
    feature/
      onboarding/               # language and value proposition (after UI review)
      authentication/           # login state and account lifecycle
      discovery/                # area/category/search/feed
      workerprofile/            # skills, real work portfolio, trust clarity
      listings/                 # service CRUD/draft/publishing
      contacts/                 # contact request and safe interactions
      calling/                  # call coordinator/provider (after RTC evaluation)
      payments/                 # UI adapter for eligible product/payment channel
      settings/                 # privacy, permissions, account deletion
  app/src/test/                  # ViewModel, policy, state/repository tests
  app/src/androidTest/           # device UI + lifecycle/permission tests
```
Only create a feature folder when its first real implementation/test exists; the diagram is a contract, not an inventory of shipped files.

## Examples: how classes communicate
```text
Approved DiscoveryScreen
  -> DiscoveryViewModel (state/intent handling, cancellation/debounce)
  -> SearchWorkersUseCase (only if orchestration warrants)
  -> WorkerDiscoveryRepository (interface)
  -> CloudflareDiscoveryDataSource (typed HTTPS /api/v1/search)
  -> D1 query executed ONLY by API Worker (never inside Android)

Approved ListingEditorScreen
  -> ListingEditorViewModel
  -> DraftRepository / ListingRepository
  -> API (auth + validation) / private R2 upload authorization
```
Never put Worker auth secrets, R2 keys, D1 credentials, pricing authority, wallet mutation or RTC token signing in Android binary. Calls/payments require server-verified state.

## Call handling remains a separate subsystem
Voice call quality depends on Android background delivery, notifications, device lifecycle, audio focus and chosen RTC provider, not solely on Cloudflare. When real calling is implemented:
- `CallCoordinator` pure state machine (unit-testable) separate from UI.
- `CallSignalingRepository` HTTPS/WebSocket transport; `CallMediaProvider` interface for chosen WebRTC/RTC media provider.
- `CallForegroundService` limited to a real active-call lifecycle; `IncomingCallReceiver`/FCM handler carefully permission-tested.
- Never debit on unanswered call; server records lifecycle and reconciles terminal events.
- Test foreground/background/terminated, no notification permission, network switch, lock screen, dual answers, out-of-order signals, 2G/3G/4G conditions, API retries, and Android versions.
No vendor/provider selected. No WebRTC media transmitted through the JSON Worker API.

## Performance and UI quality constraints
- One network client, structured cancellation, typed errors and bounded retries (only replay idempotent methods).
- Guest discovery/manual area before forced GPS; opt-in location and clear privacy.
- Bounded Room/Disk image cache, DataStore settings, avoid huge bitmaps, lazy lists, loading/error/empty states.
- Limit dependency/SDK size; remove unused Ads/vision/animations/RTC from initial build until required.
- Track startup time, frame jank, memory, ANR, APK size, API p95 and payload sizes on real low-end Android hardware; values in architecture research are **targets, not measured results**.
- Hindi (Devanagari) and English copy only, accessible touch targets and offline/slow-mobile UX. Exact visuals require founder approval.

## UI approval checkpoint: mandatory
Before writing Compose screens, XML layouts, themes, colors, wireframes, screenshots or store videos, present founder with **what is being proposed**, ask for their design ideas/suggestions and get explicit approval. Technical module plans can be prepared ahead of this gate. Document the final UI decisions in an ADR and roadmap. Don't claim a proposed class hierarchy is an approved design.

## Later definition of done
- Clear ViewModel/module interface and unit tests.
- Accessibility, RTL/locale where appropriate, permission denial and no-network handling.
- Emulator + physical budget phone smoke tests and performance baseline.
- No forced background GPS or public exposure of private contact details.
- Founder-approved UI before implementation and a single controlled final production release (no staging); never auto-publish to Play.
## Hard quality rules: reusable UI, theme tokens and premium animations

**Founder directive 2026-10-27:** Any repeated screen/widget/business code MUST reuse existing tested components/feature helpers and approved API contracts, not copy-pasted duplicates. Design-system primitives only when real reuse is established. Eliminate extra APK dependencies and repeated media.

- Central Android `core/designsystem`: `MaterialTheme.colorScheme/typography/shapes` plus semantic spacing, border/stroke, elevation, radius and motion tokens **after founder palette approval**. Strings/content descriptions/plurals in localized XML (`values`, `values-hi` etc.), render via `stringResource`.
- Reuse one approved button, tab, card, search, state component and media loader design across features. No screen-level HEX constants, font sizes, corner radii, border widths, random animation timing or duplicated icon PNGs.
- Professional animation is required where informative: tab indicator, screen navigation/gesture transitions, press states, sheets, loading/success/error and occasional immersive depth/3D highlights; **not endless motion on every list cell**.
- Start with low-cost 2.5D layer transforms and optimized illustrations. Only add actual 3D renderer/complex animation SDK if justified by approved prototype and measured binary/memory/CPU/GPU/battery cost. Provide static/no-motion fallback, TalkBack and safe system animation-scale handling.
- Run `npm run design:check` now; later Android Lint/Detekt, dark/light screenshot tests and release-mode Macrobenchmark/frame tracing on low-end devices. Static checks alone do not prove smoothness.
- **No UI has yet been implemented or founder-approved**—the new nonvisual Kotlin request/transport core is NOT an approval for theme, navigation or screens.

[Design System](DESIGN_SYSTEM.md) · [Motion/3D](MOTION_3D.md) · [Reuse/Assets](REUSE_ASSET_POLICY.md) · [ADR-0005](decisions/0005-reuse-tokens-premium-motion.md).


## 2026-10-28 — Nonvisual Repository boundary exists; views still pending approval

`apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/JodloRepositories.kt` now defines **actual compiled** `CatalogRepository` / `WorkerRepository` interfaces and transport/decoder-backed implementations. Future approved Android `ViewModel` components should depend on these interfaces rather than importing `HttpsTransport` / JSON directly. The injection surface is tested with fake network data, without app code or UI. `WorkerRepository.publishExplicitCategory` must only be invoked after explicit user Category confirmation, and existing server-active/opted-in checks still decide publish eligibility. M-004 UI approval remains necessary before implementing any Activity, screen, Compose theme, navigation or animation.

## 2026-10-28 — Headless session state, NOT a user screen

A nonvisual `InMemorySessionCoordinator` can supply a later approved ViewModel with public SignedOut/SignedIn and Worker draft-only state, not bearer strings. Expiry is monotonic; logout is local-first; stale network responses cannot resurrect state. No Activity, UI, Google SDK, credential store or GPS has been built. M-003/M-004/M-008 remain separate.

## 2026-11-01 — Headless Kotlin HTTPS response progress bound (PR CI pending)

The existing no-UI Android-compatible `HttpsTransport` now uses `readBoundedUtf8Reply` with a **20-second monotonic whole-response read budget** and a cumulative maximum of **eight anomalous zero-byte reads**. Previously a broken `InputStream` repeatedly returning 0 for a nonempty buffer could spin without progress, while a server trickling one byte per socket timeout could extend the response indefinitely. A ninth zero read (including zeros interleaved with productive bytes), excessive aggregate read duration, the existing 65,536-byte size bound or invalid UTF-8 all raise the same content-free `InvalidReplyBodyException`. The valid 65,536-byte/strict UTF-8 contracts and existing route builders remain unchanged.

New real Kotlin/JVM tests use synthetic streams and a fake monotonic clock for always-zero, mixed-zero and slow productive drip cases, plus an exact just-under-deadline successful response. **Caveat:** this budget is checked before and after each blocking read, rather than asynchronously interrupting a read; `HttpsURLConnection.readTimeout=10s` still separately bounds an individual socket read. No Android SDK, approved UI, Activity, Google device OAuth, persistence, network request to a real server, Cloudflare deployment, provider token or Finworkar change. M-004 and M-008 still require their own approvals.

## 2026-11-01 — Ambiguous duplicate JSON keys rejected in Kotlin reply decoder (PR CI pending)

The already-existing headless `JodloReplyDecoder` now rejects **repeated JSON object keys** in *every* level of an accepted response (root envelope, nested data/error, listing/category arrays and backend-issued Google session). JSON-object parsers can otherwise discard the first value when a later key repeats, while DTO `keysOnly` sees just one field. A small, bounded lexical pass happens **only after** the existing strict `Json.parseToJsonElement` syntax parse; independent object frames distinguish a repeated property within one object from legitimate reused field names in sibling objects. JSON-escaped key spellings are normalized by the same JSON parser (for example `"id"` equals `"\\u0069d"`). Invalid duplicates become the existing non-retryable, body-redacted `BAD_RESPONSE` outcome, not a token or useful DTO.

Real Kotlin/JVM tests cover repeated root `ok`, duplicate/nested `id` and `name`, escaped equivalent object keys, repeated session `accessToken`, duplicated error codes, and unchanged valid sibling-object and quoted-string replies. Response maximum **65,536 UTF-8 bytes**, strict UTF-8, no redirects, one-shot transport and session privacy rules remain unchanged. This is **reply-integrity hardening**, not server authenticity verification or live Android/UI/Agora functionality. No new public API, D1 migration, provider SDK, OAuth device registration, personal data storage, Cloudflare deploy or Finworkar modification.
