# JODLO FCM provider preflight deadline — 2026-11-10

## Actual reliability gap

The server-owned private-call push sender originally limited the **FCM HTTP POST** with AbortSignal.timeout but awaited **OAuth access-token acquisition** and **the live opted-in receiver/device lookup** without a timeout. A stalled Google signer or D1/provider dependency could keep the originating Customer's call request pending indefinitely, long after the 90-second ring had expired. The request should fail closed with delivery uncertainty, rather than claiming that Android received a call.

## Delivered behavior

- `createFcmProvider` now runs OAuth retrieval, current recipient/device resolution (including the server-owned dispatch-slot claim), and the outbound Firebase HTTP POST within **one shared monotonic elapsed-time budget** of at most `NOTIFICATION_PROVIDER_TIMEOUT_MS = 5_000` ms.
- Each awaited stage uses a bounded `Promise.race` with a cleared timer. The budget is based on `performance.now()`, **not** a mutable/injected wall clock, and each stage consumes what earlier stages have already spent. The FCM HTTP request keeps its own AbortSignal, but a misbehaving/mock adapter that ignores AbortSignal is also bounded by the enclosing promise deadline.
- If OAuth or destination lookup exceeds the budget, return `transient`; **do not** start a Firebase POST after a timed-out stage eventually resolves. The existing dispatch mechanism conservatively treats a possibly claimed slot as unconfirmed and never creates duplicate provider sends.
- A token is never logged, cached on disk, returned to the caller or placed in the push data. Existing event expiry, live consent/device selection, package restriction, high-priority Android `call_ring`, expiry TTL and redacted API contracts remain intact.
- `timeoutMs` is an injectable internal test budget for fast deterministic regression; it rejects values outside 1..5,000 ms. Production uses 5,000 ms with no configuration or provider credentials required.

## Executable regression

The existing Node API notification test suite exercises a never-resolving OAuth token promise, never-resolving device resolution, a device resolution completing **after** budget expiry (asserting **zero FCM POSTs**), a synthetic fetch implementation that ignores AbortSignal, and invalid excessive test deadlines. These tests do not call a real provider or change production resources. Standard Foundation (Node, D1 workerd, Kotlin) and Android JDK17/21 + combined FCM/Agora CI still gate merge.

## Release limitations

A timeout does **not** cancel an already dispatched D1 query or a real external request that has ignored abort; it does prevent this sender from continuing to an outbound FCM POST afterward. A provider request may be accepted while its reply is lost; source code must not promise exactly-once notification receipt. Real Firebase/Agora credentials, two-device QA, Android force-stop behavior, approved remote D1 migrations/backup, reviewed catalog, privacy/legal/retention, and payments remain owner-controlled release work. No live FCM send, Cloudflare deployment, emails or Finworkar modifications.
