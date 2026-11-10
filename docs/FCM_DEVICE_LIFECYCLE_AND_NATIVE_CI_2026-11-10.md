# JODLO FCM call-device lifecycle and optional native build — 2026-11-10

## User journey actually improved
After a Worker explicitly enables Internet voice calls and grants notification permission, the FCM-enabled Android variant now checks the **current** authenticated Worker preference and Android notification permission immediately before registering its device token. A delayed Firebase token callback cannot rely on a former account's consent or a stale private write revision. The last successful registration is remembered **only in process memory** for that account's current session generation, so repeatedly returning to the foreground does not create another server-side device write for an unchanged token; Firebase token rotation still registers the new token.

When the Worker disables calling or notification permission is revoked, the app cancels the local incoming-call notice and attempts to unregister its **last confirmed current-session** device token. If that delete fails/offline, it retains the local registration evidence for a future consent/permission sync instead of falsely claiming the remote token was deleted. Existing D1 migration `0021_private_call_devices.sql` has an opt-out trigger that atomically removes all of an opted-out Worker's session devices on the server (once migration 0021 is actually applied). The backend continues to check live Worker consent, active session and destination ownership on dispatch.

After a successful Google sign-in, the Android Account screen dismisses any former account's incoming-call notification and resyncs only with freshly verified new-account permission. After a local sign-out or confirmed erasure, it clears the notice. The no-FCM build stays functional with an inert matching method; no new storage permission, foreground service, persistent FCM token, account ID, phone number or secret was added.

## Same-Worker device token rotation and account isolation (API + D1)

A genuine device may sign in to the **same Worker account** again before its previous server session expires. Previously, a UNIQUE registration token held by that old session caused the fresh session's PUT to fail (403), and its FCM ring ACK could not use the new authenticated session. `registerOwnCallDevice` now uses an **atomic D1 batch** to transfer that one token from any older session of the SAME live, opted-in Worker account to the current session, then reads back the exact session-token binding and consent before returning success. A different account cannot claim or delete the other account's registration, even if it submits the same token. This does not allow a logged-out, unauthenticated client to take over a device. Existing opt-out trigger still erases that Worker's session-bound device tokens.

Local real SQLite/D1 router tests cover same-account second login, exact token move, repeated registration, cross-account refusal preserving the existing binding and opt-out purge. No new schema or unverified remote operation was introduced.

## End-to-end compile safety
Previously, default Android CI compiled the **no-FCM variant** only; the FCM real source set, Firebase Google Services Gradle plugin and combined Agora+FCM graph were not compiled in PR CI.

The JDK 21 Android job now generates a **synthetic, non-secret `google-services.json`** solely on the isolated CI runner, compiles the FCM+Agora Android debug APK using both opt-in Gradle flags, and deletes that temporary JSON via a shell EXIT trap. `.gitignore` already excludes the operator's real Firebase JSON. Neither the CI synthetic project nor the resulting APK is deployed or used for provider authentication. JDK 17/21 base APK builds and the optional Agora-only build remain.

Existing executable Kotlin JVM session suite tests token-rotation dedup, account-generation binding, and in-memory clear/retry rules. Existing Node private UI suite enforces actual native FCM call/permission/login/logout wiring and CI graph; Android compile checks the real optional sources.

## Explicit remaining release gates
- **Cold-start FCM receiving is still NOT supported:** server sessions intentionally exist only in process memory. A FirebaseMessagingService started after process death has no authenticated Worker coordinator and cannot verify or ACK a call; persistent secure session restoration needs a separate founder-approved security/privacy design. Do not claim calls ring when the app is killed.
- Real Firebase project files/FCM credentials, real Android notification permission, provider delivery/ACK, two-device Agora and network transitions remain unverified without an operator-controlled provider setup and the **one final consolidated physical-phone QA**.
- Only JODLO source/CI/test code changed. No remote Cloudflare/D1, provider send, Google console, Finworkar, published catalog or external email operation.
