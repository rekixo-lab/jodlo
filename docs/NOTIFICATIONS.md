# JODLO — Cloudflare-first notification delivery foundation

**2026-10-30: locally implemented, NOT a live push feature.** JODLO is an original, lean, separate product, not a Finworkar/Firebase port. No external Cloudflare Queue, production D1, FCM, registered device tokens, approved event policy, real send, UI or remote deploy exists.

## Source that actually runs

- `apps/api/src/modules/notifications/delivery.ts` — generic Cloudflare Queue-shaped `ack/retry` processor. Exactly six minimal machine fields in each event, no content, phone, location or device token; checks fresh trusted recipient/consent/event/destination permission on **every attempt**, absolute provider call limit 5s, 24h event maximum, up to five attempts with bounded delay. Requires dead-letter acknowledgement for permanent or exhausted messages. Not connected to a consumer.
- `infra/migrations/0005_notification_delivery_receipts.sql` — versioned, locally applied D1-compatible SQLite table storing **only opaque event ID, claim/completed state, claim token, lease expiry and completion time**. No recipient ID, personal profile, Google subject, payment, message body, device token or real Category seed. Event-ID retention/deletion, if this ever goes live, remains a future privacy and operations decision.
- `apps/api/src/modules/notifications/d1-receipts.ts` — real D1 receipt adapter using a *single prepared SQLite UPSERT* to claim a new or expired event; fresh random UUID claim token; 15-second lease. A competing active lease blocks sending, a completed event remains completed, and a crashed claimant's expired lease can be reclaimed.
- **Fencing:** the delivery processor now passes the returned claim token to both completion and release. SQL completion requires the exact token **and** an unexpired lease, while release deletes only a matching token. A former worker cannot mark a stolen lease complete or delete its replacement. A stolen/expired completion fails, is never acknowledged as delivered, and may require retry.

## Evidence and boundaries

The existing eleven generic delivery tests now use the **actual migrated D1 receipt adapter** over disposable local SQLite instead of duplicating a fake receipt engine. Eight additional tests exercise migration shape, two independent file-backed SQLite connections, simultaneous claims, lease expiry and takeover, stale-worker fencing, completion persistence across new connections, restricted event isolation, bad input and a live delivery-processor stale-completion scenario. The local backup/restore test additionally asserts persisted completion survives an independent restored database file.

**At-least-once only:** D1 leases prevent two simultaneously active holders under the tested database semantics, but cannot guarantee exactly-once external push delivery. A provider may accept while the acknowledgement is lost or while a lease expires. A completed record means *provider accepted plus D1 receipt committed*, **not** delivery to the phone. A pending dead-letter store failure remains a retry, never a false acknowledgement.

**Still missing before any real notification:** founder-approved event types and recipient preferences/consent and deletion/retention (M-003/M-005), durable dead-letter store, Queue producer/consumer/bindings and local Queue runtime test, FCM provider and Android registration/permission handling (M-006/M-004), device delivery and operational checks, M-007 controlled production approval. This module is **not connected to `src/index.ts`**, so no push can be emitted.

No location/area schema, unreviewed 889 Category activation, customer contact API, real Google OAuth, visual UI, production deploy or Finworkar modification.

## 2026-10-31 — Durable local D1 dead-letter audit (PR verification pending)

- `infra/migrations/0006_notification_dead_letters.sql` creates a **machine-only** table with opaque event ID, strict permanent/exhausted reason and nonnegative recording time. The first committed record wins across retries. No account ID, destination, device token, notification body, location, approved event type or consent preference is stored.
- `apps/api/src/modules/notifications/d1-dead-letters.ts` implements the existing injected `NotificationDeadLetters` interface with one idempotent bound D1 INSERT, strict clock/identifier validation and fail-closed write errors. Existing delivery core will ACK after this `record` succeeds; a failed write retries instead.
- Local tests exercise two independent file-backed SQLite handles, replay, restart, malformed data, real delivery-core callbacks and backup/restore; CI founder guard pins the migration/table to the three exact fields.
- This **does not** configure a Cloudflare Queue consumer/producer, FCM, approved event/consent policy, actual notifications, dead-letter retention cleanup, UI, real-user data or deployment. Any actual retention/deletion policy is deferred to M-003/M-005/M-007. Validate exact PR-head and independent merged-main CI before calling this verified.
