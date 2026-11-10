# JODLO lost incoming-call Answer response recovery — 2026-11-10

## Fixed real Worker failure

Previously tapping **Answer** sent one receiver `ACCEPT` PUT. A slow gateway could commit the transition to `accepted` in D1 but drop the HTTP reply (or throw while returning). Android then displayed a generic unavailable error, exited its call poll, and never joined audio. The Customer would see the call accepted, while the Worker thought it had failed, creating a stranded live session. This is **not** the same as earlier Caller dial retry or uncertain HANGUP recovery.

The native receiver now records **acceptance uncertain** on any failed/unknown ACCEPT outcome. It does *not* claim success, auto-retry an HTTP write, or join Agora. In this state the dialog explicitly offers **Check whether call was answered** (an authenticated read-only GET for the exact invitation ID) or a reviewed **Close locally** warning that the other person may still see the call.

The GET requires the **same current signed-in account generation and exact owner/write marker**. Only a server-confirmed `receiver + accepted` makes the UI proceed to audio. If the fresh server read says `receiver + ringing` with a future deadline, the uncertain state clears and the Worker may tap **Answer** again explicitly; a replay of a committed ACCEPT is already idempotent on the API. If terminal, the correct finished state displays without rejoining. If offline, stale session, wrong role, pending/not-eligible or expired, acceptance remains uncertain, without pretending the Customer was disconnected.

Android Back when acceptance is uncertain requires the local-close warning. Local ring expiry cannot overwrite the uncertain outcome with an unverified `MISSED` phase.

## Executable verification

- Existing Kotlin session suite expanded with a fake backend where receiver ACCEPT commits but response is lost as 503; checks **exactly one PUT** and one explicit correct-account GET revealing accepted state, and stale write-marker denial. Pure `CallAcceptRecovery` contract tests assert receiver-only, accepted-vs-ringing, terminal, caller and expiry behavior.
- Existing Node actual Compose wiring tests assert all recovery branches, same owner marker, no implicit retry, English/Hindi strings and explicit local-close warning.
- Existing Foundation (Node/API, SQLite, workerd, TypeScript and Kotlin) and Android JDK 17/21 + optional Agora+FCM build gates apply to the final PR head and independent merged `main`; **no additional redundant Kotlin suite**.

## Boundaries

This is source reliability, not proof of live two-phone Agora/FCM. Secure, owner-approved provider configuration, real push delivery, production D1 migrations/backup, approved live categories, legal/privacy/retention/payments and **one final consolidated phone QA** still require separate gates. No provider send, production deployment, emails or Finworkar change.
