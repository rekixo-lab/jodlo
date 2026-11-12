# JODLO uncertain call recovery — 2026-11-10

## Fixed native Customer → Worker behavior

An HTTPS timeout or dropped reply after **Start call**, **Cancel**, **Decline**, or **End call** is not proof of the server state.

- **Outgoing call:** the first attempt creates an in-memory idempotency key, reused on an explicit retry of the same dialog. No automatic second invitation is sent after an uncertain POST. The dialog shows the uncertain outcome and offers retry or explicit review before a local-only close.
- **Cancel/decline/hangup:** the device immediately closes local audio, but the dialog closes normally **only** when a current-session, correct-role server response reports a terminal phase. A network failure or a still-ringing/accepted phase leaves the recovery UI open instead of falsely saying “Call ended.”
- **Recovery:** **Check call status** performs only an authenticated GET; if the other participant accepted just before a cancel, the next explicit end action switches to hangup. **Try ending again** is a user-initiated request, not a hidden network retry. **Close locally** requires a second explicit action after a warning that remote teardown was not confirmed.
- **Session safety:** current private markers are captured for each request, server results are fenced by the original account generation, and no Agora connection restarts while ending. The UI does not expose phone numbers, provider tokens, backend errors or another user's call.
- All recovery actions and warnings have distinct Hindi and English strings.

## 12 November 2026 — Restored polling after recovery and lost-session local-audio guard

The native call dialog previously launched continuous authenticated status polling with only `invitationId` as its effect key. After an uncertain receiver **ACCEPT**, the error stopped that polling loop; a successful explicit **Check whether call was answered** cleared the error but did **not** restart the loop. The recovered call could therefore continue without reflecting a new server-side decline, cancellation or hangup. Polling now re-enters when an explicit recovery resolves the error, but never silently retries an uncertain mutation or auto-reconciles while an error/ending remains.

A new pure Kotlin `CallPollSafety` policy and native call dialog distinguish **revoked, replaced or expired session** and definitive owner/call `401/403/404` denial from temporary service/offline failures. A lost session or definitive denial immediately stops **local microphone and Agora audio**, then shows the existing bilingual **remote teardown not confirmed** warning and a **Close locally** action. The dialog does not falsely claim that the other side stopped ringing or that a remote HANGUP succeeded. A temporary network timeout keeps the user's confirmed call state and polling; no hidden mutation retry or new provider grant is introduced. This also guards an ACCEPT/DECLINE/HANGUP reconciliation return and an async session replacement while the RTC join effect is scheduled.

Coverage: executable Kotlin failures-vs-transient policy tests in the existing headless suite, native Compose source-wiring recovery test, opt-in Android FCM+Agora compile. Source-only change: not a substitute for production sender setup or a two-real-phone acceptance run.

## Regression evidence

- Existing executable Kotlin reply decoder suite checks terminal vs accepted/ringing/pending server phases and role mismatches.
- Existing executable Kotlin session suite simulates a successful server invite whose response was lost, exercises explicit *same-key* retry, and simulates a successful cancel with a lost response recovered by GET.
- Existing Node native UI contract suite checks actual Compose end confirmation, user actions, same-key replay, and both locale resources.
- The pinned PR-head and merged-main Foundation checks and Android JDK17/21 plus optional Agora compile remain required before marking source complete.

## Not production acceptance

A local-UI recovery path does **not** provide cold-start FCM with a persisted login (sessions currently stay in memory), prove real two-device Agora audio, guarantee real remote delivery after unconfirmed termination, or verify deployed Cloudflare D1 migrations, operators, moderation, privacy/retention/policy sign-offs, approved catalog, payments or the final consolidated real-phone QA. No secrets, legacy Finworkar writes, remote D1 updates, app-store or provider activation are included.
