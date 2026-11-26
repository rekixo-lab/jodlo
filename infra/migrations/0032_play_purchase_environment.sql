-- All previously admitted purchases rejected every Google test context.
-- New license-test grants require explicit server allowlisting; the immutable
-- environment keeps restore/replay/refund audit tied to the original receipt.
-- There are no account allowlist values or credentials in this migration.
ALTER TABLE play_consume_outbox ADD COLUMN purchase_environment TEXT NOT NULL
  DEFAULT 'production' CHECK(purchase_environment IN ('production','license_test'));

CREATE TRIGGER preserve_play_purchase_environment
BEFORE UPDATE OF purchase_environment ON play_consume_outbox
WHEN OLD.purchase_environment IS NOT NEW.purchase_environment
BEGIN SELECT RAISE(ABORT,'PLAY_PURCHASE_ENVIRONMENT_IMMUTABLE'); END;

CREATE TRIGGER require_play_license_test_authority
BEFORE INSERT ON play_consume_outbox
WHEN NEW.purchase_environment='license_test' AND
  (NEW.settlement_policy_version IS NULL OR NEW.settlement_approval_hash IS NULL
    OR NEW.verified_purchased_at_ms IS NULL)
BEGIN SELECT RAISE(ABORT,'PLAY_LICENSE_TEST_AUTHORITY_REQUIRED'); END;
