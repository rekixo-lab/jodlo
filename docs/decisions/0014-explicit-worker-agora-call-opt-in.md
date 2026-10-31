# ADR-0014 — Explicit, default-OFF worker consent for Agora voice calls

**Status: ACCEPTED founder decision — 2026-10-31.** M-005 *worker incoming-call opt-in* DONE. Approved after the founder answered **"करो"** to the single explicit question whether workers must independently switch on the ability to receive Agora calls.

## Binding behavior and precise scope

- Customer's first contact remains **in-app Agora RTC Internet AUDIO** (ADR-0013), not SIM/PSTN or telephone-number routing. No mandatory service Request→Accept step; worker answering a ringing call is a distinct action.
- A published worker listing / worker draft / successful Google login **does not imply consent** to receive calls.
- The worker must **explicitly enable** a distinct private setting **"कॉल प्राप्त करें"** / **"Receive voice calls"** before becoming eligible for an Agora voice invitation. **Default is OFF.**
- A worker may disable the setting at any time. **Future** call admission and token prerequisites must re-read the current value and deny when OFF. Turning it OFF cannot retroactively guarantee revocation of an already issued external Agora RTC token; a future real implementation needs bounded token TTL, termination and provider-side controls.
- A worker's call opt-in is **not the same as** online presence, availability for a particular service, microphone permission, notification consent, permission to be recorded, agreement to reveal a phone number, public profile verification or permission to bypass mutual blocks/reporting/abuse controls.
- This approval does **not** specify live UI styling, call screen, extra consent text, ring duration, call history/retention, offline wakeup/signaling provider, actual Agora SDK/token server, credential onboarding or deployment. M-003, M-004, the remaining M-005 safety policies, M-006 onboarding, M-007 and M-008 retain separate gates.

## Minimal local-first implementation and denial boundary

- New immutable additive D1 migration `0007_worker_agora_call_preferences.sql` creates only the **private** `worker_agora_call_preferences` table: `account_id` (FK to worker draft, cascade delete), `calls_enabled` (strict 0/1 DEFAULT 0), and optimistic `revision` (bounded integer). Missing row is OFF. No phone, location, name, device, provider identifier, timestamp, audio recording, call history or user-facing field.
- Internal `readOwnWorkerAgoraCallPreference` requires the current active worker's unexpired server-issued bearer session; a customer with no worker draft gets no preference. `setOwnWorkerAgoraCallPreference` requires that same session and exact expected revision. Creation and update are separate **single-statement** conditional writes with revision-CAS; corrupt, stale, foreign, disabled, expired or revoked requests fail closed, without passing an account ID from the client.
- `readTwoSessionBoundAgoraOptInTarget` joins the active worker's **current enabled preference** to BOTH current caller and worker authenticated sessions and current listing/Category/moderation in **one D1 SELECT**. It cannot be fooled by an old preflight if the worker turns OFF. The earlier session-only preview reader is preserved for non-authorizing inspection.
- The previously pure `assessSyntheticAgoraRtcPreflight` now uses the stronger opt-in-aware read, in addition to existing test-only current block, abuse, availability and privacy-policy flags. Its result is **only** `prerequisite_only`, not RTC admission or an access token.
- CI founder gate explicitly permits only this named table/migration and guards exactly three columns, draft-account FK, boolean CHECK and revision CHECK. Test-only D1 fixtures apply the additive migration and check both ON/OFF, ownership, CAS races, session revocation and absence of public call/setting APIs.

## What's NOT authorized

No Android/web setting UI before M-004 theme/storyboard approval. No public preferences route, live push/call invitation, phone number, Agora SDK/RTM/RTC connection, token signer, call history, worker real GPS, provider credentials, remote D1, Cloudflare staging or production deploy. No automatic category activation and no Finworkar writes.

## Next safe dependencies

M-005 **still pending** availability/busy/presence policy, mutual blocks/report and abuse throttles, safety/moderation and qualified Category sign-off. M-003 must govern any eventual call participant metadata retention or deletion and area collection. M-004 screens/microphone UX need founder design approval. M-006 real Agora provider onboarding, secure scoped short-lived AccessToken2 issuance, incoming-call signaling and notification permissions remain deferred. M-007 production-only launch; M-008 Google OAuth device testing. The opt-in decision should **not** be asked again.
