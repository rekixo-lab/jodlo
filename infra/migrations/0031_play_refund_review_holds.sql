-- Configurable conservative review holds, not a debit, debt or bank refund.
-- This registry starts EMPTY. Only an explicitly approved server policy can
-- register the version/hash; migrations and default configuration do not.
CREATE TABLE play_refund_policy (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  policy_version TEXT NOT NULL CHECK(policy_version='jodlo-play-refund-hold-v1'),
  approval_hash TEXT NOT NULL CHECK(length(approval_hash)=64 AND approval_hash NOT GLOB '*[^0-9a-f]*'),
  activated_at_ms INTEGER NOT NULL CHECK(activated_at_ms>0)
);
CREATE TRIGGER immutable_play_refund_policy BEFORE UPDATE ON play_refund_policy
BEGIN SELECT RAISE(ABORT,'PLAY_REFUND_POLICY_IMMUTABLE'); END;

CREATE TABLE play_refund_reviews (
  source_key_hash TEXT PRIMARY KEY NOT NULL
    REFERENCES play_consume_outbox(source_key_hash) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  seconds INTEGER NOT NULL CHECK(seconds BETWEEN 60 AND 30000 AND seconds%60=0),
  reason TEXT NOT NULL CHECK(reason IN ('one_time_canceled','voided_purchase')),
  policy_version TEXT NOT NULL CHECK(policy_version='jodlo-play-refund-hold-v1'),
  approval_hash TEXT NOT NULL CHECK(length(approval_hash)=64 AND approval_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','released')),
  opened_at_ms INTEGER NOT NULL CHECK(opened_at_ms>0),
  resolved_at_ms INTEGER,
  resolution_evidence_hash TEXT CHECK(resolution_evidence_hash IS NULL OR
    (length(resolution_evidence_hash)=64 AND resolution_evidence_hash NOT GLOB '*[^0-9a-f]*')),
  CHECK((state='open' AND resolved_at_ms IS NULL AND resolution_evidence_hash IS NULL) OR
    (state='released' AND resolved_at_ms>=opened_at_ms AND resolution_evidence_hash IS NOT NULL))
);
CREATE INDEX idx_play_refund_reviews_owner ON play_refund_reviews(account_id,state,opened_at_ms,source_key_hash);

-- The same fence INSERT both blocks replay and reserves reviewed revoked
-- minutes. There is no asynchronous interval in which the confirmed revoked
-- grant can still fund a new call. A cancellation before any grant creates no
-- account record; it only leaves the original global token tombstone.
CREATE TRIGGER hold_reviewed_play_refund AFTER INSERT ON play_revocation_fences
BEGIN
  INSERT INTO play_refund_reviews(source_key_hash,account_id,seconds,reason,
    policy_version,approval_hash,opened_at_ms)
  SELECT o.source_key_hash,o.account_id,o.seconds,NEW.reason,
    p.policy_version,p.approval_hash,MAX(o.created_at_ms,NEW.recorded_at_ms)
  FROM play_consume_outbox AS o CROSS JOIN play_refund_policy AS p
  WHERE o.source_key_hash=NEW.source_key_hash AND p.singleton=1
    AND o.settlement_policy_version IS NOT NULL AND o.settlement_approval_hash IS NOT NULL
  ON CONFLICT(source_key_hash) DO NOTHING;
END;

CREATE TRIGGER immutable_play_refund_review BEFORE UPDATE ON play_refund_reviews
WHEN OLD.state='released' OR NEW.state<>'released' OR
  OLD.source_key_hash<>NEW.source_key_hash OR OLD.account_id<>NEW.account_id OR
  OLD.seconds<>NEW.seconds OR OLD.reason<>NEW.reason OR
  OLD.policy_version<>NEW.policy_version OR OLD.approval_hash<>NEW.approval_hash OR
  OLD.opened_at_ms<>NEW.opened_at_ms
BEGIN SELECT RAISE(ABORT,'PLAY_REFUND_REVIEW_IMMUTABLE'); END;

CREATE TRIGGER open_play_refund_review_revision AFTER INSERT ON play_refund_reviews
BEGIN UPDATE call_credit_balances SET revision=revision+1 WHERE account_id=NEW.account_id; END;
CREATE TRIGGER release_play_refund_review_revision AFTER UPDATE OF state ON play_refund_reviews
WHEN OLD.state='open' AND NEW.state='released'
BEGIN UPDATE call_credit_balances SET revision=revision+1 WHERE account_id=NEW.account_id; END;

DROP TRIGGER protect_reserved_call_seconds;
CREATE TRIGGER protect_reserved_call_seconds BEFORE INSERT ON call_credit_events
WHEN NEW.kind='verified_usage'
  AND (EXISTS(SELECT 1 FROM call_usage_sessions AS active
      WHERE active.caller_account_id=NEW.account_id AND active.state='active')
    OR EXISTS(SELECT 1 FROM play_refund_reviews AS review
      WHERE review.account_id=NEW.account_id AND review.state='open'))
  -- A provider-verified call already reserved these seconds before the hold.
  -- Its exact atomic settlement may consume that reservation, never a new one.
  AND NOT EXISTS(SELECT 1 FROM call_usage_sessions AS settled
    WHERE settled.invitation_id=NEW.id AND settled.caller_account_id=NEW.account_id
      AND settled.source_key_hash=NEW.source_key_hash AND settled.state='settled'
      AND settled.charged_seconds=NEW.seconds AND settled.settled_at_ms=NEW.created_at_ms)
  AND NEW.seconds>(SELECT MAX(0,b.available_seconds-
    COALESCE((SELECT SUM(u.reserved_seconds) FROM call_usage_sessions AS u
      WHERE u.caller_account_id=b.account_id AND u.state='active'),0)-
    COALESCE((SELECT SUM(r.seconds) FROM play_refund_reviews AS r
      WHERE r.account_id=b.account_id AND r.state='open'),0))
    FROM call_credit_balances AS b WHERE b.account_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'CALL_SECONDS_RESERVED'); END;
