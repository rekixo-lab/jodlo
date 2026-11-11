-- Offline-only, account-independent token-hash tombstones.
-- A verified Play cancellation/refund can arrive BEFORE a purchase grant.
-- Store NO provider receipt, raw purchase token, order, price, account or PII.
-- Tombstone retention and backup/erasure policy require founder/legal approval
-- before these tables are considered for production.
CREATE TABLE play_revocation_fences (
  source_key_hash TEXT PRIMARY KEY NOT NULL
    CHECK(length(source_key_hash)=64 AND source_key_hash NOT GLOB '*[^0-9a-f]*'),
  reason TEXT NOT NULL CHECK(reason IN ('one_time_canceled','voided_purchase')),
  recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms>0)
);

-- This check runs BEFORE the grant/outbox AFTER INSERT trigger from 0025.
-- The entire grant INSERT is rejected, including its ledger/balance effects.
CREATE TRIGGER reject_revoked_play_outbox
BEFORE INSERT ON play_consume_outbox
WHEN EXISTS(
  SELECT 1 FROM play_revocation_fences AS f
  WHERE f.source_key_hash=NEW.source_key_hash
)
BEGIN
  SELECT RAISE(ABORT,'PLAY_REVOKED_TOKEN');
END;

-- A previously granted token is quarantined even if its consume attempt
-- is in-flight. This NEVER silently claws back spent paid seconds.
CREATE TRIGGER freeze_outbox_after_play_revocation
AFTER INSERT ON play_revocation_fences
BEGIN
  UPDATE play_consume_outbox
     SET status='void_hold',attempt_id=NULL,attempt_deadline_ms=NULL,
         updated_at_ms=MAX(updated_at_ms,NEW.recorded_at_ms)
   WHERE source_key_hash=NEW.source_key_hash AND status<>'void_hold';
END;

-- Do not let any delayed worker/reconciler resurrect a voided claim.
CREATE TRIGGER deny_void_hold_resurrection
BEFORE UPDATE OF status ON play_consume_outbox
WHEN OLD.status='void_hold' AND NEW.status<>'void_hold'
BEGIN
  SELECT RAISE(ABORT,'PLAY_REVOKED_TOKEN');
END;
