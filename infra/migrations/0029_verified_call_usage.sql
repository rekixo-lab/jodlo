-- Provider-authenticated RTC session accounting. Disabled until the operator
-- configures the reviewed policy and a dedicated Agora Notifications secret.
-- Reservations hold existing seconds; only confirmed overlapping RTC sessions
-- can create an idempotent usage debit. Uncertain intervals are never charged.
CREATE TABLE call_usage_sessions (
  invitation_id TEXT PRIMARY KEY NOT NULL CHECK(length(invitation_id)=36),
  caller_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  receiver_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL CHECK(policy_version='agora-overlap-v1'),
  approval_hash TEXT NOT NULL CHECK(length(approval_hash)=64 AND approval_hash NOT GLOB '*[^0-9a-f]*'),
  source_key_hash TEXT NOT NULL UNIQUE CHECK(length(source_key_hash)=64),
  reserved_seconds INTEGER NOT NULL CHECK(reserved_seconds BETWEEN 0 AND 30000),
  authorized_from_ms INTEGER NOT NULL CHECK(authorized_from_ms>0),
  authorized_until_ms INTEGER NOT NULL CHECK(authorized_until_ms>authorized_from_ms),
  ended_at_ms INTEGER CHECK(ended_at_ms IS NULL OR
    (ended_at_ms>=authorized_from_ms AND ended_at_ms<=authorized_until_ms)),
  settle_after_ms INTEGER NOT NULL CHECK(settle_after_ms>=COALESCE(ended_at_ms,authorized_until_ms)),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','settled')),
  evidence_conflict INTEGER NOT NULL DEFAULT 0 CHECK(evidence_conflict IN (0,1)),
  charged_seconds INTEGER NOT NULL DEFAULT 0 CHECK(charged_seconds BETWEEN 0 AND reserved_seconds),
  settled_at_ms INTEGER,
  CHECK(caller_account_id<>receiver_account_id),
  CHECK(reserved_seconds>0 OR ended_at_ms IS NOT NULL),
  CHECK((state='active' AND settled_at_ms IS NULL AND charged_seconds=0) OR
        (state='settled' AND settled_at_ms IS NOT NULL AND settled_at_ms>=authorized_from_ms))
);
CREATE UNIQUE INDEX idx_call_usage_one_active_caller
  ON call_usage_sessions(caller_account_id) WHERE state='active' AND ended_at_ms IS NULL;
CREATE INDEX idx_call_usage_due ON call_usage_sessions(state,settle_after_ms,invitation_id);
CREATE INDEX idx_call_usage_receiver ON call_usage_sessions(receiver_account_id);

-- Terminal signaling/revocation only CAPS provider-measured billing. It
-- never invents a connected second. These triggers run in the authorization
-- mutation's transaction, before a concurrent cron can settle stale bounds.
CREATE TRIGGER close_usage_after_call_terminal
AFTER UPDATE OF terminal_at_ms ON private_call_invitations
WHEN NEW.terminal_at_ms IS NOT NULL
BEGIN
  UPDATE call_usage_sessions SET ended_at_ms=MAX(authorized_from_ms,
    MIN(COALESCE(ended_at_ms,NEW.terminal_at_ms),NEW.terminal_at_ms,authorized_until_ms))
  WHERE invitation_id=NEW.id AND state='active';
END;

CREATE TRIGGER close_usage_before_session_revocation BEFORE DELETE ON auth_sessions
BEGIN
  UPDATE call_usage_sessions SET ended_at_ms=MAX(authorized_from_ms,
    MIN(COALESCE(ended_at_ms,unixepoch()*1000),unixepoch()*1000,authorized_until_ms))
  WHERE state='active' AND invitation_id IN (
    SELECT id FROM private_call_invitations WHERE accepted_session_hash=OLD.token_hash
    UNION SELECT invitation_id FROM private_call_dispatch_slots WHERE caller_session_hash=OLD.token_hash
  );
END;

CREATE TRIGGER close_usage_after_account_disable AFTER UPDATE OF status ON accounts
WHEN OLD.status='active' AND NEW.status='disabled'
BEGIN
  UPDATE call_usage_sessions SET ended_at_ms=MAX(authorized_from_ms,
    MIN(COALESCE(ended_at_ms,unixepoch()*1000),unixepoch()*1000,authorized_until_ms))
  WHERE state='active' AND (caller_account_id=NEW.id OR receiver_account_id=NEW.id);
END;

-- Stop reserving seconds that cannot possibly be charged after the first
-- server-observed end. The remaining hold is a conservative rounded-up bound
-- on the still-unsettled provider overlap, not a duration-based debit. Ending
-- releases the caller's ongoing-call slot in the same transaction, while any
-- next reservation must continue to subtract these remaining held seconds.
CREATE TRIGGER cap_ended_call_usage AFTER UPDATE OF ended_at_ms ON call_usage_sessions
WHEN NEW.state='active' AND NEW.ended_at_ms IS NOT NULL AND
  (OLD.ended_at_ms IS NULL OR NEW.ended_at_ms<OLD.ended_at_ms)
BEGIN
  UPDATE call_usage_sessions SET
    reserved_seconds=MIN(reserved_seconds,
      CAST((NEW.ended_at_ms-authorized_from_ms+999)/1000 AS INTEGER)),
    settle_after_ms=MIN(settle_after_ms,NEW.ended_at_ms+120000)
  WHERE invitation_id=NEW.invitation_id AND state='active';
END;

CREATE TRIGGER reserve_call_usage_revision AFTER INSERT ON call_usage_sessions
BEGIN UPDATE call_credit_balances SET revision=revision+1 WHERE account_id=NEW.caller_account_id; END;
CREATE TRIGGER release_call_usage_revision AFTER UPDATE OF state ON call_usage_sessions
WHEN OLD.state='active' AND NEW.state='settled'
BEGIN UPDATE call_credit_balances SET revision=revision+1 WHERE account_id=NEW.caller_account_id; END;
CREATE TRIGGER shrink_call_usage_revision AFTER UPDATE OF reserved_seconds ON call_usage_sessions
WHEN NEW.reserved_seconds<OLD.reserved_seconds
BEGIN UPDATE call_credit_balances SET revision=revision+1 WHERE account_id=NEW.caller_account_id; END;
CREATE TRIGGER delete_active_call_usage_revision AFTER DELETE ON call_usage_sessions
WHEN OLD.state='active'
BEGIN UPDATE call_credit_balances SET revision=revision+1 WHERE account_id=OLD.caller_account_id; END;
CREATE TRIGGER protect_reserved_call_seconds BEFORE INSERT ON call_credit_events
WHEN NEW.kind='verified_usage' AND EXISTS(SELECT 1 FROM call_usage_sessions
  WHERE caller_account_id=NEW.account_id AND state='active') AND NEW.seconds>(
  SELECT b.available_seconds-COALESCE((SELECT SUM(u.reserved_seconds) FROM call_usage_sessions AS u
    WHERE u.caller_account_id=b.account_id AND u.state='active'),0)
  FROM call_credit_balances AS b WHERE b.account_id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'CALL_SECONDS_RESERVED'); END;

CREATE TABLE call_usage_intervals (
  event_hash TEXT PRIMARY KEY NOT NULL CHECK(length(event_hash)=64),
  invitation_id TEXT NOT NULL REFERENCES call_usage_sessions(invitation_id) ON DELETE CASCADE,
  uid INTEGER NOT NULL CHECK(uid IN (1,2)),
  client_seq INTEGER NOT NULL CHECK(client_seq>=0),
  started_at_s INTEGER NOT NULL CHECK(started_at_s>0),
  ended_at_s INTEGER NOT NULL CHECK(ended_at_s>=started_at_s),
  reason INTEGER NOT NULL CHECK(reason BETWEEN 0 AND 999),
  received_at_ms INTEGER NOT NULL CHECK(received_at_ms>0),
  UNIQUE(invitation_id,uid,client_seq)
);
CREATE INDEX idx_call_usage_intervals_call ON call_usage_intervals(invitation_id,uid,started_at_s);

-- A contradictory duplicate must fence settlement in the SAME SQL statement
-- that observes it. A later application-level update could lose a race with
-- the settlement cron between its evidence read and final debit.
CREATE TRIGGER conflict_verified_call_interval BEFORE INSERT ON call_usage_intervals
WHEN EXISTS(SELECT 1 FROM call_usage_intervals AS old WHERE old.event_hash=NEW.event_hash
  AND (old.started_at_s<>NEW.started_at_s OR old.ended_at_s<>NEW.ended_at_s OR old.reason<>NEW.reason))
BEGIN
  UPDATE call_usage_sessions SET evidence_conflict=1
  WHERE invitation_id=NEW.invitation_id AND state='active';
END;

-- The state transition, debit event and existing balance trigger are one
-- SQLite statement. A failed balance constraint rolls all of them back.
CREATE TRIGGER settle_verified_call_usage AFTER UPDATE OF state ON call_usage_sessions
WHEN OLD.state='active' AND NEW.state='settled' AND NEW.charged_seconds>0
BEGIN
  INSERT INTO call_credit_events(id,account_id,source_key_hash,kind,seconds,created_at_ms)
  VALUES(NEW.invitation_id,NEW.caller_account_id,NEW.source_key_hash,
         'verified_usage',NEW.charged_seconds,NEW.settled_at_ms);
END;

CREATE TRIGGER immutable_verified_call_usage BEFORE UPDATE ON call_usage_sessions
WHEN OLD.state='settled' OR NEW.caller_account_id<>OLD.caller_account_id OR
     NEW.receiver_account_id<>OLD.receiver_account_id OR
     (NEW.reserved_seconds<>OLD.reserved_seconds AND NOT (
       NEW.state='active' AND NEW.ended_at_ms IS NOT NULL AND
       NEW.reserved_seconds=MIN(OLD.reserved_seconds,
         CAST((NEW.ended_at_ms-NEW.authorized_from_ms+999)/1000 AS INTEGER)))) OR
     (NEW.settle_after_ms<>OLD.settle_after_ms AND NOT (
       NEW.state='active' AND NEW.ended_at_ms IS NOT NULL AND
       NEW.settle_after_ms=MIN(OLD.settle_after_ms,NEW.ended_at_ms+120000))) OR
     NEW.authorized_from_ms<>OLD.authorized_from_ms OR
     NEW.authorized_until_ms<>OLD.authorized_until_ms OR
     (OLD.ended_at_ms IS NOT NULL AND (NEW.ended_at_ms IS NULL OR NEW.ended_at_ms>OLD.ended_at_ms)) OR
     NEW.source_key_hash<>OLD.source_key_hash OR
     NEW.policy_version<>OLD.policy_version OR NEW.approval_hash<>OLD.approval_hash
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CALL_USAGE'); END;
