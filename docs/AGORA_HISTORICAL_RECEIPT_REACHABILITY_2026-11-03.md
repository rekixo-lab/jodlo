# JODLO — Agora synthetic historical-receipt reachability guard (2026-11-03)

**Engineering-only, LOCAL TEST REHEARSAL.** The founder-approved first contact remains a customer-initiated **Agora in-app Internet AUDIO call**; the Worker must separately enable incoming calls (default OFF). This change neither approves operational M-005 values nor creates a real call route, provider signaling, RTC credentials, durable call database, push messages or Android UI.

## What was unsafe

The pure `decideSyntheticAgoraCallEvent` reducer already verified actors, event timing, exact receipt identity and monotonically increasing revisions. However, for **historical** receipt replay it checked that the stored receipt revision was not from the future, without proving the receipt's phase could actually lead to the **current phase**.

A valid but losing `cancel`/`decline`/`busy`/`ring_timeout` receipt at revision 1 could therefore be replayed against a separate winning `accept` → `connected`/ `ended` state at revision 2/3. Likewise, a competing `accepted` → `ended` receipt at revision 2 could replay against an `accepted` → `connected` → `ended` winner at revision 3. This would incorrectly describe mutually exclusive outcomes as successfully replayed if the receipt store were corrupt or inconsistent.

## New fail-closed check

A historical receipt is replayable only when its result is a **reachable ancestor** in the existing fixed, acyclic synthetic state graph:

- Exact same revision: phase **must** match.
- `accepted` at revision 1 may be followed only by `connected` at revision 2, `ended` at revision 2, or `ended` at revision 3.
- `connected` at revision 2 may be followed only by `ended` at revision 3.
- `declined`, `busy`, `cancelled`, `missed`, and `ended` receipts are terminal; **none** may precede a later revision.
- Future-revision receipts and all other combinations fail with the existing `KEY_CONFLICT` code. A rejected or replayed event emits **no new signaling intent**.

The new test matrix in `apps/api/tests/agora-call-phase-revision-guard.test.mjs` checks competing customer cancel, worker decline/busy, trusted server timeout, shorter accepted→ended branches, and valid same-state/later-state replays via both the reducer and its synthetic signaling-intent adapter. Existing SQLite two-connection CAS/unique receipt/outbox tests continue to exercise atomic **local-only** transaction rehearsal.

## Safety boundary

The code does **not** prove authenticated receipt provenance, current session ownership, current worker consent epoch, real presence, mutual block state, rate limits, actual provider delivery or global distributed exactly-once signaling. A future **approved** operation must atomically authenticate actors, compare a server-held call state and revision, reserve allowed capacity, enforce durable unique receipt and idempotent sending, and recheck privacy/abuse/consent at the proper admission boundary.

M-003 metadata/privacy/retention, M-005 operational availability/block/busy/rate/timeout policy, M-006 Agora provider/signaling, M-007 production release and M-008 live Google OAuth remain gated. No Android, Cloudflare deployment, real user data, Category activation, payment, real call or Finworkar modification. Verify exact PR-head Foundation CI and independently verify merged-main CI before calling this fix complete.
