-- Durable machine-only notification dead-letter audit, NOT a live Queue/FCM feature.
-- No recipient, payload, phone, device token, preference, category or location.
-- Opaque event IDs and retention are subject to later founder privacy approval.
CREATE TABLE notification_delivery_dead_letters (
  event_id TEXT PRIMARY KEY NOT NULL
    CHECK(length(event_id) BETWEEN 8 AND 128),
  reason TEXT NOT NULL
    CHECK(reason IN ('PERMANENT_FAILURE','RETRIES_EXHAUSTED')),
  recorded_at_ms INTEGER NOT NULL
    CHECK(recorded_at_ms >= 0)
);
-- Primary key enforces idempotent first-write-wins across retries/isolate restarts.
