-- Local-only, private Play consumable credit/consume outbox.
-- NO checkout, real Play sender credential, public route or production rollout.
-- Never store a raw Play purchase token, OAuth token, order ID or price.
CREATE TABLE play_consume_outbox (
  source_key_hash TEXT PRIMARY KEY NOT NULL
    CHECK(length(source_key_hash)=64 AND source_key_hash NOT GLOB '*[^0-9a-f]*'),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL CHECK(length(product_id) BETWEEN 3 AND 100
    AND product_id NOT GLOB '*[^a-z0-9._]*'),
  seconds INTEGER NOT NULL CHECK(seconds BETWEEN 60 AND 30000 AND seconds % 60=0),
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK(status IN ('ready','sending','unknown','consumed','void_hold')),
  attempt_id TEXT CHECK(attempt_id IS NULL OR length(attempt_id)=36),
  attempt_deadline_ms INTEGER CHECK(attempt_deadline_ms IS NULL OR attempt_deadline_ms>0),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=created_at_ms),
  CHECK(
    (status IN ('sending','unknown') AND attempt_id IS NOT NULL AND attempt_deadline_ms IS NOT NULL)
    OR
    (status IN ('ready','consumed','void_hold') AND attempt_id IS NULL AND attempt_deadline_ms IS NULL)
  )
);
CREATE INDEX idx_play_consume_outbox_pending
  ON play_consume_outbox(status,updated_at_ms,source_key_hash);

-- Exactly one SQL INSERT gives both the durable Play consumption outbox
-- and the existing private minute-credit event. The preexisting ledger
-- trigger also updates the balance in this same atomic transaction.
-- Any unique/foreign-key/CHECK failure aborts the entire grant/outbox.
CREATE TRIGGER grant_play_outbox_credit
AFTER INSERT ON play_consume_outbox
BEGIN
  INSERT INTO call_credit_events(id,account_id,source_key_hash,kind,seconds,created_at_ms)
  VALUES (
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
      substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) ||
      '-' || hex(randomblob(6))),
    NEW.account_id,NEW.source_key_hash,'purchase_grant',NEW.seconds,NEW.created_at_ms
  );
END;
