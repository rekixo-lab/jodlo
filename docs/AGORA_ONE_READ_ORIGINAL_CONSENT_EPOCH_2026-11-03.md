# JODLO — One-read original Agora consent epoch capture (2026-11-03)

**Offline backend engineering only.** JODLO first contact remains customer-initiated **Agora Internet AUDIO**, no PSTN or compulsory pre-call Request; Worker must separately opt in to receiving voice calls (default OFF, ADR-0014). Real provider use, presence, blocking, retention, delivery and quota policy remain M-003/M-005/M-006 founder-gated. This is not an approved ring, notification, token grant, public route or production release.

## Issue and improvement

The local synthetic invitation transaction formerly read a caller-bound opt-in target and then independently selected the Worker's current preference revision. This was safe in the test's `BEGIN IMMEDIATE` transaction but created an avoidable risk for an adapter to **copy the second/current revision without proving it came from the same live caller/listing eligibility read**. The non-epoch-bound helper is deliberately retained for earlier offline tests, but must never become a real call admission source.

The new `prepareSyntheticConsentEpochBoundAgoraInvite` uses the pre-existing `readCallerSessionBoundAgoraConsentEpoch` query: **one** current-session/listing/owner/moderation/Category/explicit-worker-consent D1 SELECT returns both the validated request target and original preference revision. It checks the existing synthetic risk evidence and returns an explicitly frozen `{kind:"prepared", call, originalConsentRevision}` only when all checks pass. No worker bearer, client-selected worker, client-provided revision or phone number is needed. A separate, privileged epoch can no longer be substituted into the prepared result.

The **test-only SQLite** call-plus-UNSENT-intent admission fixture now starts `BEGIN IMMEDIATE` before using this helper and records the returned `originalConsentRevision` directly in the same local transaction. It no longer performs a free-standing second revision query. Its existing offline outbox/recovery preflight additionally requires its own one-read current consent epoch to equal the previously saved **original** revision; OFF → ON never resurrects a stale invite.

## Evidence and constraints

- Real local D1-backed regression `agora-invite-epoch-bound.test.mjs` checks default OFF, correct caller-only admission evidence, one exact SQL SELECT with hashed bearer, no worker bearer, invalid/duplicate/malformed data, unsupported risk, and original epoch 1 vs new epoch 3 after OFF → ON.
- Existing `agora-invite-sqlite-atomicity.test.mjs`, `agora-original-epoch-dual-writer-sqlite.test.mjs`, `agora-revocation-active-boundary-sqlite.test.mjs` and `agora-rtc-consent-epoch-preflight.test.mjs` cover local crash/rollback, concurrent OFF vs call/accept, outbox tombstone and stale RTC-join prerequisites.
- **One atomic D1 read is not an atomic real call admission.** Only the disposable local SQLite **write transaction** protects that read through its fake writes. Future real admission requires an approved transactional/worker coordination design, fresh presence/blocks/abuse facts and a separate, consent-checked provider dispatch, with revocation and retained data rules decided by the founder. No M-005 P01/P02/P03/P04/B01/B02/A01/A02/T01/T02/D01/D02/U01/S01 values are assumed.
- No Android change, production/staging Cloudflare, migrations, new public API, Agora SDK/token/Signaling/FCM, payment, real user data, archived category activation, or Finworkar writes.

Merge gate: independent PR-head Foundation CI success and independent post-merge main Foundation CI success are both needed before treating this engineering change as verified.
