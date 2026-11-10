# JODLO FCM call notice privacy race at logout / consent boundary — 2026-11-10

## Problem fixed

A call FCM event may be processed concurrently with a Worker changing accounts, signing out, erasing their account, withdrawing call consent or Android notifications being disabled. The old `CallNotifications.clearLocal` called `NotificationManager.cancel(NOTICE)` and cleared the freshness gate **without the same lock as `showNotice`**. An in-flight ACK or generic notification could pass the earlier owner check, then publish the **previous account's** notice after local cancellation. Even if the notice text is generic, tapping could still point at an old invitation. This is an actual notification race, not an approved identity/session restoration mechanism.

## Behavior now

- `cancelNotice(context, suppressGeneric)` and `showNotice(...)` both hold the `CallNotifications` monitor, serializing cancellation, notification-slot freshness state and notification publication.
- An **explicit** local sign-out, account replacement, account erasure, Worker opt-out or notification disable cancels the notice and turns on process-local generic-notice suppression. The locked `showNotice` checks the current coordinator **again** immediately before delivery.
- Verified notices additionally require the exact signed-in `InMemorySessionCoordinator` and **post-ACK account/write marker**; a stale ACK from an old owner cannot pass the last check.
- Generic unverified notices require a still-unauthenticated coordinator and no explicit suppression. A **fresh process** with no bearer remains eligible for a generic FCM wakeup. A normal foreground no-session sync may clear a stale notice but **does not create** new opt-out state; prior explicit suppression stays. Only successful, fresh owner-bound server call-consent GET on the same account epoch lifts local suppression.
- No auth secrets, account IDs, call references, FCM token or user preference state are persisted. The Firebase service still does not authenticate or ACK an invitation after Android process death. An event arriving in a **brand-new OS process** after previous-process logout cannot be distinguished from a valid wakeup without persistent state, so a full cross-process guarantee requires separate owner-approved session/consent policy.

## Automated verification

- Existing Node actual native FCM/Compose source contract asserts synchronized cancellation and `showNotice`, fresh verified owner equality, generic suppression, opt-out/clear paths, and correct post-ACK owner/write marker. It also retains notification expiry/ordering and Android no-persistence checks.
- Existing Kotlin `CallNotificationFreshnessGateTest.kt` verifies stale-older event rejection and notice-slot reset; no redundant new Gradle Kotlin suite.
- Final PR head requires Foundation, Android JDK17/JDK21 and **combined FCM+Agora synthetic Firebase APK compilation**, then independent merged-main checks. CI does not claim a physical-phone notification was delivered.

No real provider send, production Cloudflare D1 migration/deploy, email, or Finworkar modification. Live Firebase/Agora, approved catalog, privacy/legal/consent/retention, payments and a single final two-phone QA remain gated.
