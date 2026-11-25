-- A configured settlement records WHICH reviewed policy authorized its grant.
-- Existing internal/test journals remain readable with all metadata NULL.
-- No credentials, purchase tokens, receipts, orders or prices are persisted.
ALTER TABLE play_consume_outbox ADD COLUMN settlement_policy_version TEXT
  CHECK(settlement_policy_version IS NULL OR settlement_policy_version='jodlo-play-minutes-v1');
ALTER TABLE play_consume_outbox ADD COLUMN settlement_approval_hash TEXT
  CHECK(settlement_approval_hash IS NULL OR
    (length(settlement_approval_hash)=64 AND settlement_approval_hash NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE play_consume_outbox ADD COLUMN verified_purchased_at_ms INTEGER
  CHECK((settlement_policy_version IS NULL AND settlement_approval_hash IS NULL
    AND verified_purchased_at_ms IS NULL) OR
    (settlement_policy_version IS NOT NULL AND settlement_approval_hash IS NOT NULL
    AND verified_purchased_at_ms IS NOT NULL AND verified_purchased_at_ms>0));

CREATE TRIGGER preserve_play_settlement_authority
BEFORE UPDATE OF settlement_policy_version,settlement_approval_hash,verified_purchased_at_ms
ON play_consume_outbox
WHEN OLD.settlement_policy_version IS NOT NEW.settlement_policy_version
  OR OLD.settlement_approval_hash IS NOT NEW.settlement_approval_hash
  OR OLD.verified_purchased_at_ms IS NOT NEW.verified_purchased_at_ms
BEGIN
  SELECT RAISE(ABORT,'PLAY_SETTLEMENT_AUTHORITY_IMMUTABLE');
END;
