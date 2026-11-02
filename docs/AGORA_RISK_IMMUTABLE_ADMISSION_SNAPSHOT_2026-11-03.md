# JODLO — Synthetic Agora risk evidence: immutable admission snapshot (2026-11-03)

**Engineering-only, local/offline.** JODLO's approved first contact remains a **customer-initiated in-app Agora Internet AUDIO call**, with the Worker's **independent, revocable, default-OFF** receiving-calls preference. This patch does **not** implement real call admission, presence, block/report databases, rate limits, device signals, RTC tokens or provider delivery. Founder gates M-003/M-005/M-006/M-007/M-008 and the unapproved M-005 operational decision matrix still apply.

## Concrete async authorization bug

Both offline invite helpers used to validate the caller/listing-bound `SyntheticAgoraInviteRisk` **before** awaiting a D1 current-consent/target read, but re-read the **original mutable risk object** after that `await`. The validity check accepted typed denial facts, e.g. `workerPresence: offline`, `workerAvailability: busy`, `blockedByWorker: true`, or `rateGate: deny`, so a test adapter/cache that modified those fields while D1 was pending could promote a previously denied risk into `prepared`. This is an unsafe time-of-check/time-of-use boundary, even in synthetic rehearsal.

The composer for the five separate scripted checks also accepted **invisible non-enumerable extra fields**, **symbol properties** and **accessor/getter data** because it used `Object.keys` to count fields. A getter or proxy could produce different facts on repeated property reads.

## New policy-neutral fail-closed contract

- **Before any asynchronous D1 operation**, the raw synthetic invitation risk is inspected through **own property descriptors**, not by invoking getters. Exactly the thirteen documented **own data fields** are copied once into an independent, frozen object; non-enumerable/symbol/excess/missing/getter fields and adapter/proxy exceptions are rejected.
- Only that captured, validated snapshot reaches the post-`await` `prepareForCurrentTarget` decision. Mutating the original availability, either block direction, abuse/rate, recipient verification, or privacy flag during D1 processing **cannot change** the decision.
- The five separate synthetic risk-evidence checks and source identity also use strict own-data descriptors, with a frozen detached value copy for each dimension. A safety check cannot hide a token/device field or flip a getter after passing its field validator.
- No default `allow` is inferred: a positive hypothetical result still needs explicit `online`, `available`, no bilateral blocks, `rateGate: pass`, verified recipient/privacy and current enabled worker preference. Current D1 consent read and exact original revision remain mandatory for the stricter offline epoch-bound helper.
- No new time threshold or M-005 presence/availability/rate policy is introduced. **An immutable test snapshot is not real-time evidence**: any future real D1/DO admission must separately use authoritative presence/block/quota stores and atomic reservations/rechecks to prevent external status changes after the snapshot; actual delivery and token issuance stay disabled.

## Test evidence

- `apps/api/tests/agora-invite-epoch-bound.test.mjs`: mutate every individual originally negative presence/availability/block/rate/recipient/privacy fact **inside the awaited D1 adapter** into an all-pass value. Both consent-epoch and legacy synthetic helpers must still deny. Reject raw invisible/symbol/getter evidence **before any D1 prepare**, without triggering getters.
- `apps/api/tests/agora-risk-evidence-matrix.test.mjs`: every one of five scripted check types, plus the caller/worker/listing identity, denies invisible extra properties, symbols, getters and throwing proxies. Already composed and frozen verdicts are not changed by later mutation to original source objects.
- Full Foundation CI also runs existing 576-state safety cross product, original epoch OFF→ON tests, SQLite two-writer consent revocation, fake outbox uniqueness/rollback/fencing, TypeScript and local workerd/D1 checks.

**No changes:** Android, public call routes, D1 production schema/migrations, live RTC/Agora SDK/FCM, real account data, location/retention design, new Category activation, payment, remote Cloudflare or Finworkar. Require exact PR-head and independently green merged-main GitHub Foundation CI before calling this change verified.
