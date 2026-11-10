# JODLO delayed FCM ring ordering and failure-safe receiver — 2026-11-10

## Actual user-visible reliability improvement

JODLO intentionally uses **one incoming call notification and one PendingIntent** per installation: parallel incoming calls are constrained by server-owned receiver dispatch slots. However, FCM delivery is not ordered by delivery time. A late delivery for an older ring could update that one PendingIntent and replace the current, newer call's tap target. A generic cold-process wakeup also could overwrite the already verified notification for the same ring.

The new process-local `CallNotificationFreshnessGate` accepts a future-valid event only if no unexpired earlier notice exists, its deadline is newer than the currently shown *different* call, or the **same call** is being promoted from a generic push to server-confirmed receiver ring. It rejects duplicates, old/equal-deadline different IDs, downgrade to generic, and expired events. The gate's `toString()` does not expose event IDs; it stores no bearer, account data or device tokens and is reset on local logout, consent disable, permission-off and empty session cleanup.

`CallNotifications.ring` also catches provider/network/OS notification exceptions so a failed private ACK or notification permission race cannot crash the FirebaseMessagingService process. It does **not** fake a verified call on a failed ACK; a cold-process generic notification continues to require Google sign-in and same-account fresh server GET before call display.

## Regression validation

- Real Android FCM Kotlin uses the gate before constructing `PendingIntent.FLAG_UPDATE_CURRENT`; it compiles in JDK21 **combined FCM+Agora** CI along with Android JDK17/21.
- Headless Kotlin regression checks stale ring rejection, identical ring verified promotion, duplicate suppression, equal deadlines, expired events and redacted diagnostics, **folded into the existing 25-suite Kotlin coverage** to avoid unnecessary extra standalone Gradle suites.
- Existing Node native UI source-wiring test now enforces the actual FCM use/catch and clear paths.
- Normal PR-head CI is required once all integrated changes are ready. Merge only on green Foundation + Android, followed by independent postmerge main CI; no local provider calls or remote deployment.

## Still deliberately open

Firebase delivery is not guaranteed (especially after Android Force stop), the killed-process path still cannot authenticate/ACK without user sign-in, and no persistent credential/device-identifying information is introduced. This is source correctness, **not** proof of a live notification or two-device Agora call. Real provider setup, deployed Cloudflare D1 migrations and ownership/retention/legal approvals, approved services, payments, and one final integrated physical-phone QA remain release gates. No Finworkar modifications, external email, cloud D1 writes or provider sends.
