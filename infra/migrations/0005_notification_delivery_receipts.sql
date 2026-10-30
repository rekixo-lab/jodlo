-- Durable, provider-neutral notification delivery CLAIMS only.
-- NO delivery is enabled: no Queue binding, consumer, FCM adapter, token,
-- contact request, event-type approval, recipient identifier or message body.
-- Event IDs are opaque server-generated references. Retention/deletion policy
-- remains a future privacy/operations review, not silently fixed here.
CREATE TABLE notification_delivery_receipts (
  event_id TEXT PRIMARY KEY NOT NULL
    CHECK(length(event_id) BETWEEN 8 AND 128),
  state TEXT NOT NULL CHECK(state IN ('claimed','completed')),
  claim_token TEXT,
  lease_until_ms INTEGER,
  completed_at_ms INTEGER,
  CHECK(
    (state='claimed' AND claim_token IS NOT NULL AND length(claim_token)=36
      AND lease_until_ms IS NOT NULL AND lease_until_ms > 0
      AND completed_at_ms IS NULL)
    OR
    (state='completed' AND claim_token IS NULL AND lease_until_ms IS NULL
      AND completed_at_ms IS NOT NULL AND completed_at_ms >= 0)
  )
);
-- Primary-key lookup covers acquisition, replay and completion; no index scan
-- across recipients, categories, GPS, device tokens or message bodies.
