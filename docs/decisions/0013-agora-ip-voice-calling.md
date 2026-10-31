# ADR-0013 — Agora in-app voice calls, no telephone-number dialing

**Status: ACCEPTED founder clarification — 2026-10-31.** Updates the meaning of ADR-0012 and resolves M-006's **voice provider choice**, but does NOT approve onboarding, credentials, production calling, user-facing UI or data retention.

## Founder clarification and binding transport

The founder corrected an earlier assistant question about whether to show a worker's phone number: **"हम तो Agora IP calling use करेंगे ना"**. JODLO's first customer-to-worker contact is therefore **in-app Internet voice calling powered by Agora RTC**, not a carrier telephone call, PSTN/SIM dial, `tel:` link, telephone-number lookup, phone-number masking relay or number exposure flow. The word **"सीधे फोन कॉल"** in ADR-0012 means a customer can directly initiate an **in-app Agora voice call** to the worker; **no mandatory separate service request/worker acceptance workflow first**.

An *incoming-call Accept/Decline action* in the worker's future app is part of answering a live call; it is NOT the forbidden mandatory service Request→Accept step. The actual UI and how alerts are shown remain gated by M-004 and separately reviewed notification consent and capabilities.

**Phone numbers:** JODLO must **not require, collect, store, display or disclose a worker's mobile number for Agora app-to-app calling**. An account's server-owned opaque JODLO identity, an Agora voice channel and server-authorized RTC participants replace phone-number routing. Google Sign-In remains the chosen initial sign-in method (ADR-0007), not phone OTP. Other eventual phone needs, if ever proposed, require a separate explicit founder/privacy decision. Do not re-ask the "display worker number vs masked telephone number" question for the first-contact feature.

## Reference design — NOT implemented / NOT approved for live traffic

1. The customer signs in with a real server-verified JODLO session. Server rechecks an active worker, an approved, active Category and published, allowed listing, no self-contact, and future worker call opt-in/current availability/mutual block/rate-abuse limits. The existing one-query session-bound D1 target read is an **internal preflight only**, not permission to join a call.
2. Only a trusted, atomic call-admission process (not yet implemented) allocates a distinct unpredictable **Agora RTC channel** and exactly authorized caller/worker participant identities. Never allow arbitrary client-supplied channel names/Agora UIDs or derive channel names from public listing/worker IDs.
3. A trusted backend signs **short-lived Agora AccessToken2 RTC tokens** scoped to the right channel and participant/privileges, returning each participant **their own** credentials. Agora App Certificate/signing secrets never enter the Android client, GitHub or chat. On expiry, token renewal is handled securely. Do not claim these tokens or the Agora SDK exist in JODLO today.
4. RTC transports **audio media only**. The incoming-call invitation, online/offline wakeup, busy/timeout/cancel/decline behavior and push consent require **separate signaling/notification design** (Agora Signaling and/or other approved options). Do not assume Agora RTC by itself supplies incoming-call ringing, offline reachability or call screening.
5. Android runtime microphone consent/permissions, audio focus, foreground/background restrictions, ringing/answer/reject, poor connectivity, battery/data use, accessibility, lifecycle cleanup and call privacy must be verified after **founder M-004 storyboard** approval. No hidden microphone activation, recording, call-history retention or public peer ID without specific permission and policy.
6. Defend against replay, unauthorized channel joining, stale eligibility, token renewal after account disable/block, guessing channels, call spam/abuse, and endpoint credential leakage. Recheck status at actual call start/token issuance; design atomic, idempotent admission and revocation/expiry semantics, including the limits of an already granted external RTC token. Never claim the earlier one-query read eliminates the external authorization race.

## Founder gate accounting

- **M-005 contact modality:** **DONE:** customer first initiates a direct in-app Agora audio call. No compulsory pre-call service request. Worker call opt-in, blocking/reporting, availability and anti-spam policy **pending**.
- **M-006 voice vendor:** **DONE: Agora RTC Voice selected by founder.** Agora App ID/certificate creation, commercial terms/budget, token server integration, Signaling SDK/notifications provider choice and live service onboarding are **DEFERRED**; no secret or console task during local-only engineering.
- **M-003:** No phone number is required for calling. Any future persistent *call metadata*, consent, session retention/deletion, identifier exposure and location still require privacy decisions.
- **M-004:** No Android or web call screen, dialer/ringing controls, layouts/themes, notifications UI, or auto-answer before founder storyboard approval.
- **M-007:** No Cloudflare staging, remote D1/Worker service, actual Agora connection or production rollout until final release approval.
- **M-008:** Real Google OAuth/client-device testing remains pending.

## Technical evidence and next safe work

Official Agora docs: [RTC Quickstart](https://docs.agora.io/en/realtime-media/rtc/get-started-sdk), [Use tokens](https://docs.agora.io/en/realtime-media/rtc/build/authenticate-users/authentication-workflow), [Deploy token server](https://docs.agora.io/en/realtime-media/rtc/build/authenticate-users/deploy-token-server), [Signaling authentication](https://docs.agora.io/en/realtime-media/rtm/build/connect-and-authenticate/authentication-workflow).

Allowed now: local-only provider-neutral RTC state/authorization contracts, synthetic call signaling mocks, disposable SQLite tests, strict no-PII/no-live-call/no-deployment guards and technical design of server-side Agora tokens **without keys or external calls**. No Android SDK/UI, D1 call/contact tables, public call endpoints, actual users/telephony, paid account operations, or Finworkar changes without their approvals.
