-- Signed, provider-linked chargeback requests awaiting an explicit HUMAN
-- recommendation. It is sent only on authenticated RTDN redelivery, with a
-- durable single-attempt fence. No automatic recommendation or usage guess.
-- This inbox cannot grant, reserve, debit, consume or refund any purchase.
-- Raw pending refund tokens, order IDs and provider responses never enter D1.
-- Open cases remain unacknowledged so Pub/Sub can supply the original transient
-- token again. Unknown submissions require external evidence, never a retry.
CREATE TABLE play_pending_refund_reviews (
  case_id TEXT PRIMARY KEY NOT NULL CHECK(length(case_id)=64 AND case_id NOT GLOB '*[^0-9a-f]*'),
  source_key_hash TEXT NOT NULL REFERENCES play_consume_outbox(source_key_hash) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_binding TEXT NOT NULL CHECK(length(account_binding)=64 AND account_binding NOT GLOB '*[^0-9a-f]*'),
  order_hash TEXT NOT NULL CHECK(length(order_hash)=64 AND order_hash NOT GLOB '*[^0-9a-f]*'),
  purchase_environment TEXT NOT NULL CHECK(purchase_environment IN ('production','license_test')),
  provider_message_id TEXT NOT NULL UNIQUE CHECK(length(provider_message_id) BETWEEN 1 AND 64
    AND provider_message_id NOT GLOB '*[^0-9]*'),
  event_time_ms INTEGER NOT NULL CHECK(event_time_ms>0),
  response_deadline_ms INTEGER NOT NULL CHECK(response_deadline_ms=event_time_ms+86400000),
  received_at_ms INTEGER NOT NULL CHECK(received_at_ms>0),
  policy_version TEXT NOT NULL CHECK(policy_version='jodlo-play-refund-hold-v1'),
  approval_hash TEXT NOT NULL CHECK(length(approval_hash)=64 AND approval_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL DEFAULT 'open'
    CHECK(state IN ('open','queued','submitting','submitted','unknown','reviewed','expired')),
  refund_preference TEXT CHECK(refund_preference IN ('APPROVE','DECLINE','NEUTRAL')),
  sample_content_provided INTEGER CHECK(sample_content_provided IN (0,1)),
  decision_evidence_hash TEXT CHECK(decision_evidence_hash IS NULL OR
    (length(decision_evidence_hash)=64 AND decision_evidence_hash NOT GLOB '*[^0-9a-f]*')),
  decision_at_ms INTEGER,
  submission_started_at_ms INTEGER,
  submission_finished_at_ms INTEGER,
  reviewed_at_ms INTEGER,
  resolution_evidence_hash TEXT CHECK(resolution_evidence_hash IS NULL OR
    (length(resolution_evidence_hash)=64 AND resolution_evidence_hash NOT GLOB '*[^0-9a-f]*')),
  CHECK((refund_preference IS NULL AND sample_content_provided IS NULL
      AND decision_evidence_hash IS NULL AND decision_at_ms IS NULL) OR
    (refund_preference IS NOT NULL AND sample_content_provided IS NOT NULL
      AND decision_evidence_hash IS NOT NULL AND decision_at_ms IS NOT NULL AND decision_at_ms>=received_at_ms
      AND decision_at_ms<response_deadline_ms)),
  CHECK(submission_started_at_ms IS NULL OR
    (decision_at_ms IS NOT NULL AND submission_started_at_ms>=decision_at_ms
      AND submission_started_at_ms<response_deadline_ms)),
  CHECK(submission_finished_at_ms IS NULL OR
    (submission_started_at_ms IS NOT NULL AND submission_finished_at_ms>=submission_started_at_ms)),
  CHECK((state='reviewed' AND reviewed_at_ms IS NOT NULL AND reviewed_at_ms>=received_at_ms AND resolution_evidence_hash IS NOT NULL) OR
    (state<>'reviewed' AND reviewed_at_ms IS NULL AND resolution_evidence_hash IS NULL)),
  CHECK((state='open' AND decision_at_ms IS NULL AND submission_started_at_ms IS NULL AND submission_finished_at_ms IS NULL) OR
    (state='queued' AND decision_at_ms IS NOT NULL AND submission_started_at_ms IS NULL AND submission_finished_at_ms IS NULL) OR
    (state='submitting' AND decision_at_ms IS NOT NULL AND submission_started_at_ms IS NOT NULL AND submission_finished_at_ms IS NULL) OR
    (state IN ('submitted','unknown') AND decision_at_ms IS NOT NULL AND submission_started_at_ms IS NOT NULL AND submission_finished_at_ms IS NOT NULL) OR
    (state='expired' AND submission_started_at_ms IS NULL AND submission_finished_at_ms IS NULL) OR
    state='reviewed')
);
CREATE INDEX idx_play_pending_refund_reviews_due
  ON play_pending_refund_reviews(state,response_deadline_ms,case_id);
CREATE INDEX idx_play_pending_refund_reviews_owner
  ON play_pending_refund_reviews(account_id,event_time_ms,case_id);

CREATE TRIGGER bind_pending_play_refund_review BEFORE INSERT ON play_pending_refund_reviews
WHEN NEW.state<>'open' OR NOT EXISTS(SELECT 1 FROM play_consume_outbox AS o
  WHERE o.source_key_hash=NEW.source_key_hash AND o.account_id=NEW.account_id
    AND o.purchase_environment=NEW.purchase_environment AND o.settlement_policy_version IS NOT NULL
    AND o.settlement_approval_hash IS NOT NULL AND o.verified_purchased_at_ms IS NOT NULL)
  OR NOT EXISTS(SELECT 1 FROM play_refund_policy AS p WHERE p.singleton=1
    AND p.policy_version=NEW.policy_version AND p.approval_hash=NEW.approval_hash)
BEGIN SELECT RAISE(ABORT,'PLAY_PENDING_REFUND_BINDING_REQUIRED'); END;

CREATE TRIGGER immutable_pending_play_refund_review BEFORE UPDATE ON play_pending_refund_reviews
WHEN NOT ((OLD.state='open' AND NEW.state IN ('queued','reviewed','expired')) OR
  (OLD.state='queued' AND NEW.state IN ('submitting','reviewed','expired')) OR
  (OLD.state='submitting' AND NEW.state IN ('submitted','unknown')) OR
  (OLD.state IN ('unknown','expired') AND NEW.state='reviewed')) OR
  OLD.case_id<>NEW.case_id OR OLD.source_key_hash<>NEW.source_key_hash OR
  OLD.account_id<>NEW.account_id OR OLD.account_binding<>NEW.account_binding OR
  OLD.order_hash<>NEW.order_hash OR OLD.purchase_environment<>NEW.purchase_environment OR
  OLD.provider_message_id<>NEW.provider_message_id OR OLD.event_time_ms<>NEW.event_time_ms OR
  OLD.response_deadline_ms<>NEW.response_deadline_ms OR OLD.received_at_ms<>NEW.received_at_ms OR
  OLD.policy_version<>NEW.policy_version OR OLD.approval_hash<>NEW.approval_hash OR
  (NOT (OLD.state='open' AND NEW.state='queued') AND
    (OLD.refund_preference IS NOT NEW.refund_preference OR
     OLD.sample_content_provided IS NOT NEW.sample_content_provided OR
     OLD.decision_evidence_hash IS NOT NEW.decision_evidence_hash OR
     OLD.decision_at_ms IS NOT NEW.decision_at_ms)) OR
  (NOT (OLD.state='queued' AND NEW.state='submitting') AND
    OLD.submission_started_at_ms IS NOT NEW.submission_started_at_ms) OR
  (NOT (OLD.state='submitting' AND NEW.state IN ('submitted','unknown')) AND
    OLD.submission_finished_at_ms IS NOT NEW.submission_finished_at_ms)
BEGIN SELECT RAISE(ABORT,'PLAY_PENDING_REFUND_REVIEW_IMMUTABLE'); END;
