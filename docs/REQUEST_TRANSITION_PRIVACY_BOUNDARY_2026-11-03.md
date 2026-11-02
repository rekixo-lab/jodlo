# JODLO — Synthetic request transition private-projection boundary (2026-11-03)

**Non-Android backend security.** This is a strict validation improvement to the existing **pure, synthetic** request state reducer, **not** a restored request-first product experience. The founder's approved first contact remains a **customer-initiated Agora in-app Internet AUDIO call** with no mandatory preliminary service request. The request reducer is not connected to an HTTP endpoint, D1 production table, real notifications, call signaling or payments.

## What was unsafe

The reducer previously trusted the TypeScript shape of a runtime `current` object and built its `result` using `{ ...current, state, revision }`. A D1 adapter, fake fixture or future integration passing extra fields (contact details, OAuth identifiers, bearer tokens, trust flags) could cause those extra properties to be copied into a transition result and stored retry receipt. A replay path also accepted receipts containing additional unknown fields.

## Enforced contract

- Exactly five enumerable own **snapshot** properties: `requestId`, `ownerAccountId`, `categoryId`, `state`, `revision`.
- Exactly four **command** properties: `actorAccountId` (server-session-owned, never client-origin), `expectedRevision`, `idempotencyKey`, `toState`.
- Exactly six **receipt** properties: `requestId`, `actorAccountId`, `idempotencyKey`, `expectedRevision`, `toState`, `result`; the nested result is the same five-field snapshot.
- Reject missing, extra, hidden or symbol properties at the admission and replay boundaries. Validate ownership before replay, and preserve existing state/revision/idempotency checks. Reject before any result/receipt is emitted.
- Construct a new, frozen, **explicit five-field result**, not a spread of a runtime row. Valid, owner-only CAS decisions and historical exact-key replays remain unchanged.

The new unit regressions cover extra contact/Google/bearer/privilege flags, non-enumerable and symbol properties, malformed nested receipts, and legitimate replay after later revisions. Existing local SQLite CAS/unique-receipt tests remain in the Foundation CI suite.

## Critical limits

The TypeScript helper **does not** establish authenticity of server-held snapshots, enforce actual multi-writer transactions, grant any client right to transition, or verify real identity/session itself. Any future M-005-approved request/retry or Agora call writer must bind current session and mutable status, verify both roles, enforce unique receipt and atomic CAS against an approved D1 transaction, and replay no provider send. No founder policy values are invented here.

No new public API, phone/worker contact exposure, Category activation, Android UI, Agora RTC/notification, payment, staging/production Cloudflare deployment, secrets or historic Finworkar writes. The isolated PR and subsequent merged-main GitHub CI need separate successful runs before describing this change as verified.
