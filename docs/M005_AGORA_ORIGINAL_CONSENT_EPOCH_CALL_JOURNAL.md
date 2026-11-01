# M-005 — Server-owned original worker consent epoch: proposed contract

**Status: DESIGN + OFFLINE TEST ONLY. NOT FOUNDER APPROVAL, STORAGE AUTHORIZATION OR DEPLOYMENT.**

Founder-approved ADR-0013 requires customer→worker **Agora in-app IP AUDIO**, not PSTN/SIM/worker telephone numbers. ADR-0014 requires an independent, explicitly enabled, revocable worker Receive voice calls switch, default OFF. **All 14 M-005 operational decisions remain PENDING**, including timing, availability, capacity, blocking, rate, delivery, retention, UX and release; M-003/M-004/M-005/M-006/M-007/M-008 and catalog approvals still apply.

## Why a consent-revision argument is insufficient

The existing read-only assessSyntheticAgoraRtcConsentEpochPreflight checks the worker's **original consent epoch** against the currently ON preference. If the original epoch is taken from caller JSON or from a freshly observed ON revision, however, an old call can be incorrectly rebased after OFF→ON. A client must not select the worker, origin epoch, call snapshot, or provider credential.

Proposed production trust chain, **not implemented**:

1. An authenticated **caller-own** session resolves the actual worker using the published/moderated listing, Category and worker's explicit current ON opt-in. Founder-gated authoritative presence, worker-wide availability, mutual blocks, quotas and privacy must also be enforced at their correct atomic boundary.
2. A future approved atomic call-admission writer compares current consent to that admitted generation and writes the new **server-owned call ID, fixed caller/worker/listing binding, immutable original consent epoch, initial lifecycle revision and UNSENT logical invitation/idempotency receipt** as one transaction. Missing/unknown evidence means no write or signal. Exact fields, recipients, ACLs, retention, deletion and encryption require **M-003/D02 founder/privacy approval**; no schema or defaults are chosen here.
3. Authorized Accept and provider events must use verified participant identity and a revision CAS, never rewriting the call's original consent epoch or reassigning its call ID to a new generation. Idempotent transitions and provider acknowledgements require further approved designs.
4. A future join requester may supply only an opaque existing call ID, their **own authenticated bearer**, requested role and expected lifecycle revision. The server loads the call and immutable **original** consent revision from its own protected history, and matches the role's live session, actual listing owner/Category/moderation, current worker opt-in **equal to that original epoch**, call phase/revision and all approved safety policy, **at the actual atomic token-grant boundary**. A positive separate read is not a token/grant and cannot close the read-to-send race.
5. Worker OFF prevents new permissions under the earlier epoch, even after OFF→ON. A formerly accepted/connected external media call must NOT be claimed ended just from a database opt-out: provider teardown and acknowledgements are separate founder-gated M-005/M-006 operations.

## Test-only SQLite rehearsal

The new apps/api/tests/agora-server-owned-epoch-journal-sqlite.test.mjs creates fake_server_owned_call_epochs with a primary-key call ID and fake_original_epoch_immutable trigger in disposable, local SQLite **after loading the unchanged production identity/catalog/worker-preference migrations**.

- A fake trusted server-side stage first checks the caller's own live session, worker owner and current preference via the existing D1 reader, then writes the **original** revision alongside a synthetic call snapshot under a local SQLite BEGIN IMMEDIATE write lock. This is **not** genuine server-controlled distributed admission and does not authenticate live presence, blocks, quota or real dispatch.
- A fake worker-owned Accept rechecks the worker's **own** bearer against that exact stored original epoch and makes a pure lifecycle CAS.
- A fake join preview accepts exactly four fields: opaque call ID, caller/worker role, participant's **own bearer**, and expected lifecycle revision. It reads the original epoch from the fake journal, never from input, and calls the current exact-epoch prerequisite reader. All unknown, extra, cross-role, stale or malformed facts withhold.
- Cases cover default OFF, accepted and connected read-only prerequisites for both roles, opt-out then opt-in without epoch resurrection, new-generation call ID, forbidding reuse, immutable identity/epoch fields, malformed local snapshot, outage-style synthetic admission rollback, session revocation and listing/Category changes.
- This journal is NOT a cryptographic or authenticated attestation: a privileged database actor could delete/reinsert records; SQLite cannot prove Cloudflare D1/DO distributed coordination. It stores **no** raw bearer, phone, RTC UID, Agora token, provider delivery proof or audio, and is not added to production migrations. No provider access occurs.

## Remaining gates

No fake fixture selects P01/P02/P03/P04/B01/B02/A01/A02/T01/T02/D01/D02/U01/S01. All 14 rows stay **PENDING**. M-003 call-metadata/privacy retention, M-004 user experience, M-005 operational policy, M-006 delivery/SDK, M-007 release and M-008 verification require explicit founder sign-off before implementing real call persistence, provider signaling/token, push or cloud resources.

**No production API, schema, migration, Android calling UI, Agora SDK/RTC/Signaling/push, Cloudflare remote or staging deployment, worker phone/PSTN or Finworkar write.**

## 2026-11-01 — Additional two-writer local atomicity regression (still design only)

A separate disposable, **file-backed SQLite** suite `apps/api/tests/agora-original-epoch-dual-writer-sqlite.test.mjs` now runs the **existing unmodified catalog/auth/worker preference migrations** under two connections and then adds fake journal and UNSENT-intent tables. Unlike the preceding single-connection in-memory rehearsal, it tests local write-lock contention: a caller's own active-session/current owner opt-in read, fixed original worker consent epoch and pending UNSENT intent are committed together, or rolled back together on injected crashes. A worker-own authenticated preference OFF transaction atomically tombstones only pending fake intents; an already locally claimed/accepted state remains **unverified active media**, not provably ended. Old call IDs and original epochs cannot be rebased after OFF→ON. Foreign bearers, client-forged epoch fields, mismatched local revisions and corrupted outbox states withhold read-only join prerequisites.

**Important:** A local SQLite BEGIN IMMEDIATE lock is not a Cloudflare D1/DO distributed safety proof and this fixture neither implements nor approves production call metadata or retention, P02 capacity, sender reliability, real provider token grant, active media cancellation, authoritative online presence, block relationship or quota policy. All 14 M-005 operational decisions and M-003/M-004/M-005/M-006/M-007/M-008/human approvals remain pending. No provider network, production schema, Android UI, PSTN or Finworkar changes.
