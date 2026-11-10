# JODLO late FCM destination callback fence — 2026-11-10

## Exact failure and boundary

PR #277 introduced a shared five-second provider deadline for Google OAuth, D1 destination discovery and the actual Firebase HTTP POST. A timed-out `Promise.race` returns from `send()`, but **does not automatically stop the underlying asynchronous recipient lookup**. If that lookup returned *later*, the old `sendPrivateCallRing` callback could still perform `claimPrivateCallDispatch` against D1, permanently reserving the Worker's receiver slot for a call that had already returned **not_sent** without any Firebase POST. A later legitimate call then could not ring until the old slot's 90-second expiry.

## New behavior

- The provider passes its destination resolver a **read-only `mayContinue()` deadline fence**. This checks the same monotonic 5-second budget, event expiry and whether the provider `send()` is still active.
- A receiving call's callback checks this fence **immediately after any asynchronous device lookup**, *before* starting the side-effecting D1 dispatch-slot claim. If the provider has already timed out, the late callback returns with **no D1 claim and no Firebase send**.
- After a D1 claim returns, the callback checks again before offering the token for a provider POST. The provider itself checks the deadline again after destination resolution. The server still owns all consent/device/dispatch checks, and a dropped response does **not** claim FCM device delivery.
- A smaller `timeoutMs` remains allowed **only for internal tests**, bounded by the existing 5,000-ms maximum; production uses the fixed default.

## Real tests

- Existing API `private-call-invitation.test.mjs` uses a local SQLite D1-compatible database to create an invitation and hold the injected reachable-device lookup open until **after** its 60-ms provider budget. Once the lookup is released, it asserts **zero D1 dispatch slots and zero provider POSTs** for that timed-out attempt. It then performs a fresh legitimate same-Worker call send and checks that the slot and provider send succeed.
- Existing `notification-delivery-core.test.mjs` tests the deadline fence directly: a late resolver cannot begin any external mutation or FCM POST after `send()` returns.
- Exact PR-head Foundation CI runs the whole existing Node/API/D1, local workerd, TypeScript and Kotlin verification. Android code unchanged, so native Android CI intentionally remains path-filtered.

## Limitation

If the D1 dispatch claim **already began before** the timeout and itself completes afterward, its server-side mutation cannot be rolled back by cancelling a JavaScript Promise. The system conservatively avoids any late Firebase POST; claim-uncertain handling may retain a slot until the normal deadline. The new fence prevents the more common **late device-lookup** path from starting a fresh side effect after a timed-out request. No production Cloudflare D1 writes, real Firebase/Agora provider requests, emails, or Finworkar changes; live delivery, two-device QA, D1 rollout approvals, catalog/privacy/legal/payments and single final physical-phone QA remain separate.
