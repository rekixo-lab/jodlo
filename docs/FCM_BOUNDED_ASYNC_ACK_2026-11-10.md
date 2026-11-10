# Bounded asynchronous FCM ring ACK — 2026-11-10

## Correctness gap and fix

FirebaseMessagingService.onMessageReceived has a limited processing window. JODLO previously called `CallNotifications.ring()`, which performed the receiver's authenticated **HTTPS ACK** synchronously before returning. JODLO's HttpsURLConnection transport has 10-second connection and 10-second socket-read timeouts (and a separate 20-second response-read budget), so a slow network can occupy the Firebase callback for longer than the advisable window. Firebase can then interrupt processing or the worker can lose the chance to show a notification. This also harmed successive push callback throughput.

For a **fresh killed Android process with no memory-only session**, JODLO preserves the existing immediate generic no-PII wakeup path: check event bounds and OS permission, then show only a generic short-lived notice with untrusted intent extras and no ACK.

For a **currently authenticated Worker**, a short-lived ring event is handed to a **dedicated, single-thread, bounded FIFO `ThreadPoolExecutor`** with capacity two waiting tasks and a single running task. `onMessageReceived` returns promptly without doing network I/O. The ring executor is separate from the existing device-consent/FCM-registration executor so slow ACKs cannot block preference changes or device lifecycle. When all slots are busy, the callback fails closed and drops the incoming event: no unbounded queue, no invisible automatic retry or invented positive ACK.

Before the actual ACK the worker freshly checks the current `InMemorySessionCoordinator`, **exact account/write marker**, notification permission and ring expiry. After ACK it requires the exact post-ACK marker, current coordinator and **server-confirmed receiver RINGING with matching deadline** before showing a verified notification. Notice publication still shares the synchronized cancellation/consent gate added in PR #275. Any network/OS exception is handled without logging tokens, account IDs or call references.

## Tests and limitations

- Existing Node native-source regression tests assert the bounded `ThreadPoolExecutor`, non-overlapping separate consent executor, precise backend ACK placement **inside** its bounded task, callback path, current owner/expiry/permission checks, queue rejection fail-closed and no persistence.
- Android CI compiles the actual FirebaseMessagingService Kotlin implementation together with Agora using a synthetic CI-only Firebase configuration, plus default JDK17/21 variants. Existing headless Kotlin/session tests and API/workerd/D1 checks remain; no extra standalone Gradle suite.
- The executor is **process-local**, not guaranteed to survive Android process termination. This change avoids callback-thread network blocking, but does **not** guarantee FCM delivery/ACK if Android kills/force-stops the app or background execution is restricted. In particular the callback's return happens before queued authenticated ACK completes. A user-visible notification is **not** proof of remote call acceptance. A reliable process-independent service design would need explicit privacy/consent/lifecycle review and real-phone provider measurements before claiming more.
- No foreground service, wake lock, credential persistence, Firebase auto-init change, new backend API, schema migration or provider activation. Real Firebase/Agora accounts, two-phone calls, production Cloudflare/D1 migration approvals, catalog/legal/payment approvals and one consolidated physical-phone QA remain owner release gates. Finworkar untouched.
