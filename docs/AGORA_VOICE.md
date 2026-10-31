# Agora Voice — local-only call lifecycle and RTC authorization design

**Binding product:** ADR-0013: JODLO's first customer–worker contact is Agora **in-app Internet audio**. No worker phone number, SIM/PSTN dialing or required pre-call service Request→Accept. Worker answering a ringing call is NOT service-booking acceptance. Hindi (Devanagari) + English only for future UI; no user-facing screen until M-004 approval.

## Actual source today

- `apps/api/src/modules/interactions/agora-call-lifecycle.ts` is a **pure offline rehearsal**, with `prepareSyntheticAgoraInvite`, `decideSyntheticAgoraCallEvent`, `assessSyntheticAgoraJoinPrerequisites`. It reuses `assessDirectCallCandidate`, which requires test-only complete worker-consent, destination, privacy, availability, block and abuse policy facts. Real production sources for those facts **do not yet exist**. Actual D1 caller session/listing/Category prereads are handled by the independently tested `readSessionBoundCallTarget`.
- No RTC channel, Agora UID, access token, App Certificate, Android SDK, notification event, signaled device, durable state, public route or newly activated Category. The initial call is an internal state *model*, NOT a delivered invitation or placed call.
- `prepareSyntheticAgoraInvite` requires an existing internal authenticated eligibility projection plus complete synthetic approvals and a test-generated opaque call ID. Its bounded ringing window is strictly an **offline test limit**, not a founder-approved ringing duration/availability policy.
- Only a worker actor may `accept`, `decline` or report `busy`; only the caller may `cancel` a ringing call. Only a trusted internal server/provider port may expire a ring or signal media ready/failed. Both participants may hang up after accept/connect. All terminal phases reject later transitions. Expired rings cannot be accepted. Each action requires an exact current revision; immutable receipts allow replay only with the exact stored idempotency signature.
- **CAS/receipt is currently pure**, not durable or atomic. A future policy-approved D1/DO implementation must enforce revision compare-and-swap and unique retry key within the **same transaction** across Worker instances; fake local tests are NOT exactly-once signaling guarantees.

## Demonstration event state chart (not approved product UI)

| Starting phase | Trusted event | Ending phase |
| --- | --- | --- |
| ringing | worker accept | accepted |
| ringing | worker decline / busy | declined / busy |
| ringing | caller cancel | cancelled |
| ringing | server ring_timeout (only at/after deadline) | missed |
| accepted | trusted media_ready (both joined, after real provider verification) | connected |
| accepted / connected | caller or worker hangup | ended |
| accepted / connected | trusted media_failed | ended |
| terminal | anything | rejected |

The reducer does NOT schedule a timeout, send push, detect busy state, authenticate a remote client, activate a microphone, connect Agora media or log a live call. Real offline delivery, retry, worker opt-in, call-consent semantics, cancel/delivery races and product-specific durations require explicit M-003/M-005 decisions.

## RTC security boundary still missing

The `assessSyntheticAgoraJoinPrerequisites` result deliberately says **`prerequisite_only`**, never `authorized`. It checks that a specific internal caller/worker belongs to the accepted/connected call at its current version AND that the caller-to-worker *current* eligibility still passes. It does not issue an Agora token, channel or UID. A future real token service must verify each participant's **own** live bearer session (the current D1 caller-target query cannot authenticate the worker by itself); use a fresh, atomic policy recheck; assign unpredictable per-call RTC channel and participant-specific UIDs; sign short-lived, channel/UID/privilege-limited **Agora AccessToken2** on the server only; and handle expiration, renewals, actor suspension, account blocks and races. RTC tokens already issued to external clients cannot be assumed instantly revocable; design bounded TTL and provider-side controls honestly.

RTC media is distinct from signaling. Incoming invitation, online/offline delivery, push consent, foreground restrictions, ringing/accept/reject/busy, notification retry and call termination need an separately reviewed signaling/notification port. No PII/account IDs or secrets in public signaling. No recordings or personal call-history storage without M-003 retention consent.

## Verification / remaining gates

`npm test` includes `apps/api/tests/agora-call-lifecycle.test.mjs` on disposable migrated local D1 SQLite and synthetic bearer sessions. It checks revision racing, actor ownership, expiries, cancellation, busy/decline, replay corruption, worker connection prerequisites, current deactivation/logout/moderation and absence of call routes/tables/phone data. GitHub PR-head and post-merge main CI must independently succeed.

**M-003:** privacy, consent and retention of voice-call participant metadata; **M-005:** worker phone-free call opt-in, blocks/abuse/availability and Category qualified human review; **M-004:** all visual call screens and microphone UX; **M-006:** real Agora App ID, secret-backed token generator, Signaling/FCM choice, SDK, billing/terms; **M-008:** real OAuth device; **M-007:** no Cloudflare staging/remote deployment before controlled production approval. No Finworkar writes.

## 2026-10-31 — Both participant sessions and signaling transition contract (local-only; PR CI pending)

The former `readSessionBoundCallTarget` protects only the caller's current session. For a potential **Agora RTC token issuer**, the new `readTwoSessionBoundCallTarget` must verify **both** independent active bearer credentials in one SQL SELECT: authenticated caller session + worker session whose account **owns this listing**. It also reads current moderation, active Category, requester/worker account status and listing publication. No client-controlled worker ID, raw bearer token, channel/UID or credential is persisted or emitted. All errors/missing session deny. This is still a read-only snapshot and cannot guarantee atomicity across an external issuance boundary.

`assessSyntheticAgoraRtcPreflight` composes this dual-session check with `assessSyntheticAgoraJoinPrerequisites` for an already accepted/connected, non-stale call and current synthetic worker call consent/availability/relationship blocks/privacy/abuse. It gives **`{kind:"prerequisite_only",role:"caller"|"worker"}`**, never an AccessToken2. Worker **online presence/offline push** is not established by the existence of a session; separate signaling and device eligibility remain mandatory. Future token issuer must require a real server-trusted call snapshot, atomic version/participant and current safety policy, server-only secret, unique unpredictable channel, distinct scoped participant IDs, short TTL and renewal/revocation design. Agora RTC token lifetime and join scope must be handled as documented by [Agora RTC authentication](https://docs.agora.io/en/realtime-media/rtc/build/authenticate-users/authentication-workflow) and [server token guidance](https://docs.agora.io/en/realtime-media/rtc/build/authenticate-users/deploy-token-server). Real signatures, credentials and provider requests remain disallowed now.

`assessSyntheticAgoraSignalingIntent` reuses `decideSyntheticAgoraCallEvent` to refuse forged actor, stale version, expired ring and disallowed transition. It emits role-only, **non-sending** conceptual updates for answer, decline, busy, cancel, missed, media ready/failure and hangup. An exact historical receipt replay is **suppressed** rather than re-sent. No public user IDs, numbers, content payloads, channel/UID, real RTM/RTC event, queue, push, device registration or call DB record. When future policy permits, a durable call store MUST commit the transition, revision compare-and-swap, unique idempotency receipt and outbox enqueue atomically; delivery afterward must recheck consent, recipient and expiry and tolerate retry/provider uncertainty. Existing RTC alone does not provide incoming call alerting, nor does this pure contract.

M-003 call metadata and consent/retention, M-005 worker opt-in, availability and abuse/block/report, M-004 UI screens, M-006 real Agora App ID/certificate/SDK/server-signed credentials and provider signaling/FCM, M-007 production-only cloud/no staging and M-008 OAuth device remain explicitly gated. No Finworkar modifications.
