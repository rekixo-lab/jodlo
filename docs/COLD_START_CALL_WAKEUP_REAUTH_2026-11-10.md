# JODLO cold-start call wakeup and explicit reauthentication — 2026-11-10

## What the Android source now does

When the **optional real FCM build** receives a `call_ring` data event while its process has no signed-in in-memory account, it can show a **generic, short-lived notification**: “Check a JODLO call.” The notification reveals no caller, Worker, service, phone, price, session token, call ID, or account details in its text. It has an expiry capped to 90 seconds. This is only an *unverified wakeup*: receipt of a data event alone does not prove a call is genuine or still ringing.

Tapping the generic notification opens JODLO and takes the user to Account. It does **not** accept/ACK the call, join an Agora voice channel, restore a bearer token, or grant account access. An explicit **Google sign-in** establishes a new JODLO server session. Only then does the app make an authenticated **GET for the exact opaque call ID**, bound to the current session generation/write marker; it opens the receiver call screen only if the response is receiver-owned, `ringing`, with exactly matching server deadline and nonexpired time budget. Every failure, expired event, incorrect role, or mismatched deadline fails closed with a generic unavailable message. Foreground session already present follows the old authenticated ACK path and rechecks the server before showing the verified notification.

No FCM id/token is persisted as a bundle, saved state, shared preferences or backup, and intent extras are validated as **untrusted** input because MainActivity is exported. Account logout and erasure continue to clear local notices; a cancelled/changed account cannot display a prior owner's server response.

## Automated coverage, cost controls

- Executable headless Kotlin `IncomingCallWakeupTestKt` verifies bounded ID/deadline and role/phase/server-deadline admission, registered in the lazy entire-headless Gradle suite (now **25** explicitly inventoried runnable suites).
- Node source-wiring regression checks the actual Android FCM implementation, notification intent extras, logout-safe Account sign-in and server GET fence, correct Hindi/English resources, and no accidental persistence.
- Existing Android JDK17/21 and **combined FCM+Agora** compile checks remain; no per-file manual full CI cycles. PR-head Foundation plus Android run once after integrated code, merge only when green, then independent main CI.

## Limits: important before release

- This is **not automatic cold-start call answering or authenticated cold-start ACK**. A fresh Google login could take longer than the remaining ringing window, so a wakeup does not guarantee a call can be answered.
- FCM high-priority data delivery is **not guaranteed by Android**, especially if the app was force-stopped or the device restricts background service. Optional Firebase auto-init is disabled pending explicit worker consent/configuration; a trusted operator still needs to verify real FCM token lifecycle, provider project and notification permissions.
- No persistent refresh tokens, private credentials or account-data storage were added. Provider auth strategy, operator-managed Firebase + Agora configuration, remote D1 deployment/migrations, consent/privacy/legal and one final two-real-phone QA remain blocked. No provider send or production/Finworkar write occurred.
