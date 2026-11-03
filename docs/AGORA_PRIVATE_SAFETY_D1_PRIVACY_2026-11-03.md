# JODLO — Local D1 private Agora safety state and privacy design (2026-11-03)

**Founder approval received:** The founder explicitly said **"pemission aproovd do it"** on 2026-11-03, authorizing backend implementation and privacy/schema preparation for Worker availability, mutual blocks and abuse-control. That approval **does not specify** operational presence rules, an abuse quota/window, retention duration, user disclosure, report resolution, or permission for a live Agora call or remote deployment. These details remain separate founder decisions under M-003/M-005.

## 0008 minimal local-only D1 migration

All three tables start **EMPTY**; only synthetic local SQLite and Wrangler workerd tests may insert fixtures. No remote D1 binding, data import or public route is made.

| Table | Allowed data | Missing/unapproved interpretation | Actual personal-data impact |
| --- | --- | --- | --- |
| `worker_agora_availability_preferences` | Worker-profile opaque ID, `accepting_calls` 0/1, optimistic `revision` | No row means unavailable; **not online presence**. Independently requires ADR-0014 `calls_enabled=1` | Account-linked private intent; cascade on worker/profile/account deletion |
| `agora_account_blocks` | Directional opaque `blocker_account_id`, `blocked_account_id`; no reason or timestamps | **Either direction denies**; never expose whether another party blocked the caller | Sensitive relationship pairs; cascade on either account deletion; no phone/location/reason |
| `agora_abuse_window_counters` | Opaque actor, enum `invite`, window start/end (millis), bounded `attempt_count`, optimistic revision | **Never infer `rateGate:pass` from no row**. No real counter writer/quotas are enabled until operational choices | Pseudonymous activity aggregate, no per-attempt events, recipient, device, IP or raw provider identifiers; expiry-indexed for future approved purge |

Mandatory DB constraints prevent self-blocking, duplicate directional block pairs, orphaned account/worker references, impossible revisions, invalid counters and non-positive windows. Existing account deletion cascades apply; no data is surfaced in customer or public listing responses.

## Internal authenticated operations, no HTTP exposure

`apps/api/src/modules/interactions/agora-private-safety-state.ts` adds:

- `setOwnWorkerAvailability`: an authenticated **worker-owned** availability preference insert/update with single-statement revision CAS; a caller cannot set a Worker's preference. It does not enable worker call consent, which is separate and still default OFF.
- `setOwnAgoraAccountBlock`: directional block/unblock with an **authenticated actor's own** bearer-derived account ID; no client-supplied blocker ID, no public reverse-block lookup, no arbitrary worker bearer. Disabled/revoked sessions and invalid targets deny.
- `readLocalCallerAgoraSafetyFacts`: a **caller-session-bound private D1 read**, verifying current published/approved listing, its actual owner, Category, both active accounts and current default-OFF worker call consent; it observes separate Worker availability and both directions of blocks. It always returns `workerPresence: unknown` and `rateGate: unknown`, not an Agora permission. Unknown/malformed/absent data fails closed. Never substitute this read for a transactionally rechecked provider dispatch.

**No real presence, location or busy-slot collector is implemented.** Logout does not mean offline; explicit availability alone does not prove the app is reachable. Any future presence mechanism needs a documented consent and device/push privacy policy before it can turn a synthetic unknown into online.

## Data minimization, lifecycle and outstanding decisions

- **Minimization:** no phone, GPS/area, email, full name, call/RTC channel/UID, audio, transcript, text/chat, block reason, report body, IP, device ID, raw token, per-attempt event or unreviewed Category association. The block pair itself and counter window remain **private personal data**, never safe for public disclosure.
- **Retention NOT YET APPROVED:** do not guess a block-history or abuse counter lifetime. The schema holds no block timestamp at all (current relationship only); users' rights, operational unblock, export/delete, safety appeals and account-closure policy still need M-003 review. A window end is **not a founder-approved purge interval**. Before any actual counter writer, approve a duration/window, account-level thresholds, clock-skew and rate reset rules, a deletion schedule and backup/restore retention. Any expired counter must be removed by a separately approved cleanup mechanism; currently none runs because no real writes exist.
- **Availability and blocks M-005 open:** how workers become online/busy, who can block/unblock, whether any restriction on unblock or appeals applies, report enforcement, user-facing disclosure, authoritative availability source, coordinated multi-writer admission, rate quotas and abuse appeals remain unapproved. No default numbers are selected.
- **Production gates:** M-004 Android design, M-006 Agora provider onboarding/token and signaling, M-007 production release, M-008 live Google OAuth; no staging or remote provision and no Finworkar modification. Even after an M-005 decision, an approved atomic call/RTC writer is still needed.

## Migration and regression proof

Versioned migration `infra/migrations/0008_agora_private_safety_state.sql` is automatically applied **only to disposable local D1** by `npm run db:migrate:local` and local GitHub CI. `apps/api/tests/helpers/local-db.mjs` loads it in-memory for all fixtures. `apps/api/tests/agora-private-safety-state.test.mjs` checks constraints, empty-by-default behavior, owner/session CAS, owner-scoped block direction, private no-leak facts, current consent, stale/disabled sessions, moderation denial and cascade deletion. PR-head and separate merged-main Foundation CI must both succeed before claiming verified.

**Important:** Local schema installation is not operational activation; permission for preparation is recorded DONE, while actual retention/abuse thresholds/presence and provider release decisions remain NOT YET SPECIFIED.
