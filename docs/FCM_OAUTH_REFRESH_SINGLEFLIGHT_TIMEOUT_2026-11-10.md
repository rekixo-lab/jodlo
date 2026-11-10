# JODLO Firebase OAuth refresh single-flight recovery — 2026-11-10

## Why the prior fix was incomplete

PR #277 bounded the *caller-facing* FCM provider request to five seconds, including OAuth and device resolution. But the shared `createFcmAccessTokenSource` held a **per-isolate `pending` Promise** for the entire Firebase OAuth refresh. Its HTTP fetch had a three-second `AbortSignal.timeout`, but signing, a mock/transport ignoring abort, or `response.json()` could still hang forever. All later calls within that Worker isolate rejoined the same unresolved promise, failing every subsequent ring despite their own provider timeouts.

Even worse, merely timing out the outer source while continuing to let a stale refresh update `cached` could cause an obsolete token to overwrite a newer working token.

## Implemented

- A **single shared, bounded 3,000-ms maximum** for signing, OAuth request and parsing the OAuth JSON response, including adapters that do not honor the network AbortSignal. This is scoped to each isolate and never persists credentials.
- Simultaneous callers share one `pending` promise and still avoid redundant OAuth refreshes. On timeout, the pending slot clears, so the next Worker request can retry with a fresh OAuth operation.
- `refresh()` itself **never writes to the cached token**. Only a fully validated, nonexpired response returned *before* the outer deadline may update the cache. An older timed-out response finishing after a newer successful refresh is ignored.
- A test-only timeout parameter allows small budgets, rejects values outside **1..3,000 ms**, and production defaults to 3,000 ms. Real credentials and Firebase/Google endpoints are not contacted in tests.

## Verification

The existing Node notification-delivery test file now exercises signed **synthetic RSA JWT** assertions with an injected OAuth fake, concurrent callers sharing a stalled first request, timeout and later recovery, a late stale response after successful second refresh that must **not** overwrite current cache, and a successful HTTP response whose JSON stream never completes. These are source-level regressions, not a live token exchange. Foundation Node/API/D1 workerd, strict TypeScript and Kotlin CI remains the merge gate; native Android source is unchanged, so no redundant Android CI is necessary for this API-only fix.

## Limits

A timeout does not guarantee that an adapter which ignores abort physically stops its underlying I/O. It does guarantee the isolate's shared pending result is released and a late response never overwrites the cached result. Nothing promises Firebase device delivery, consent across app process deaths, voice call completion, or production readiness. Owner-approved live FCM/Agora credentials, two-real-phone QA, Cloudflare D1 migration/backup checks, consent/retention/legal, approved catalog, payments and release gates remain. No production deploy, external mail or Finworkar changes.
