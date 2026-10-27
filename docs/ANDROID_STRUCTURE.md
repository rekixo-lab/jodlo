# JODLO Native Android — Activity, component and feature architecture

**Stage:** Architecture proposal only. No Android application code or UI screen has been created/approved. Android application ID must be **`com.rekixo.jodlo`**. Kotlin native, optimized for lower-end Android devices and Hindi/Hinglish.

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
- Hindi/Hinglish copy, accessible touch targets and offline/slow-mobile UX. Exact visuals require founder approval.

## UI approval checkpoint: mandatory
Before writing Compose screens, XML layouts, themes, colors, wireframes, screenshots or store videos, present founder with **what is being proposed**, ask for their design ideas/suggestions and get explicit approval. Technical module plans can be prepared ahead of this gate. Document the final UI decisions in an ADR and roadmap. Don't claim a proposed class hierarchy is an approved design.

## Later definition of done
- Clear ViewModel/module interface and unit tests.
- Accessibility, RTL/locale where appropriate, permission denial and no-network handling.
- Emulator + physical budget phone smoke tests and performance baseline.
- No forced background GPS or public exposure of private contact details.
- Founder-approved UI and staging release; never auto-publish to Play.