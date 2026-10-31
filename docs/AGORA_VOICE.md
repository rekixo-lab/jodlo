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
