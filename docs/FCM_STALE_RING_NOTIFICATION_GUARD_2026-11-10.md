# JODLO delayed FCM ring ordering and failure-safe receiver — 2026-11-10

## Actual user-visible reliability improvement

JODLO intentionally uses **one incoming call notification and one PendingIntent** per installation: parallel incoming calls are constrained by server-owned receiver dispatch slots. However, FCM delivery is not ordered by delivery time. A late delivery for an older ring could update that one PendingIntent and replace the current, newer call's tap target. A generic cold-process wakeup also could overwrite the already verified notification for the same ring.

The new process-local `CallNotificationFreshnessGate` accepts a future-valid event only if no unexpired earlier notice exists, its deadline is newer than the currently shown *different* call, or the **same call** is being promoted from a generic push to server-confirmed receiver ring. It rejects duplicates, old/equal-deadline different IDs, downgrade to generic, and expired events. The gate's `toString()` does not expose event IDs; it stores no bearer, account data or device tokens and is reset on local logout, consent disable, permission-off and empty session cleanup.

`CallNotifications.ring` also catches provider/network/OS notification exceptions so a failed private ACK or notification permission race cannot crash the FirebaseMessagingService process. It does **not** fake a verified call on a failed ACK; a cold-process generic notification continues to require Google sign-in and same-account fresh server GET before call display.

## 12 November 2026 — Verified-notice priority and pending-intent guard (source only)

The single-notification gate now treats a server-confirmed ring as higher priority than an unverified, later-expiring push **for a different call**. Only a new **receiver ACK-verified** invitation with a later deadline may replace it. A duplicate for the same call with a different deadline cannot extend or replace that call's PendingIntent; the only allowed same-ID transition is **unverified → verified at exactly the original server deadline**. After the first notification expires or the account logs out/opts out, normal new-call admission is restored. This closes an out-of-order push overwrite path that could otherwise show the wrong call on tap.

Android FCM wraps PendingIntent creation and notification posting under the same exception recovery boundary; a local OS failure is not evidence that the proposed new notification was displayed. This gate is **not authorization**: a notification tap still requires a current session and a fresh exact-ID server GET before the receiver can answer. The existing source tests and executable Kotlin suite now cover shifted same-call deadlines, generic-after-verified downgrade attempts, authenticated newer-call replacement and post-expiry recovery.

No FCM/Agora provider send, D1 migration, real-phone validation, production rollout or Finworkar write. Real delivery remains subject to operator sender setup and the integrated two-phone acceptance.

## Regression validation

- Real Android FCM Kotlin uses the gate before constructing `PendingIntent.FLAG_UPDATE_CURRENT`; it compiles in JDK21 **combined FCM+Agora** CI along with Android JDK17/21.
- Headless Kotlin regression checks stale ring rejection, identical ring verified promotion, duplicate suppression, equal deadlines, expired events and redacted diagnostics, **folded into the existing 25-suite Kotlin coverage** to avoid unnecessary extra standalone Gradle suites.
- Existing Node native UI source-wiring test now enforces the actual FCM use/catch and clear paths.
- Normal PR-head CI is required once all integrated changes are ready. Merge only on green Foundation + Android, followed by independent postmerge main CI; no local provider calls or remote deployment.

## Still deliberately open

Firebase delivery is not guaranteed (especially after Android Force stop), the killed-process path still cannot authenticate/ACK without user sign-in, and no persistent credential/device-identifying information is introduced. This is source correctness, **not** proof of a live notification or two-device Agora call. Real provider setup, deployed Cloudflare D1 migrations and ownership/retention/legal approvals, approved services, payments, and one final integrated physical-phone QA remain release gates. No Finworkar modifications, external email, cloud D1 writes or provider sends.
