-- The media issuer already requires these current authorization facts on
-- every grant/renewal. An accepted invitation must end in the SAME statement
-- that withdraws one, so the peer sees the end and usage cannot bill until the
-- next token refresh. Existing terminal/history/usage-cap triggers perform
-- the journal work; no provider duration, credit or refund is invented here.
-- Ringing invitations continue through their existing current-eligibility
-- checks. A later opt-in, unblock or republication never revives an ended call.
-- Account-presence checks avoid inserting history during account erasure;
-- account erasure already cascades its invitations and operational usage.

CREATE TRIGGER end_call_after_consent_change
AFTER UPDATE OF account_id,calls_enabled,revision ON worker_agora_call_preferences
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (receiver_account_id=OLD.account_id AND (NEW.account_id<>OLD.account_id OR NEW.calls_enabled<>1 OR consent_revision<>NEW.revision))
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_before_consent_delete
BEFORE DELETE ON worker_agora_call_preferences
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (receiver_account_id=OLD.account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_after_availability_change
AFTER UPDATE OF account_id,accepting_calls,revision ON worker_agora_availability_preferences
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (receiver_account_id=OLD.account_id AND (NEW.account_id<>OLD.account_id OR NEW.accepting_calls<>1 OR availability_revision IS NOT NEW.revision))
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_before_availability_delete
BEFORE DELETE ON worker_agora_availability_preferences
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (receiver_account_id=OLD.account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_after_relationship_block
AFTER INSERT ON agora_account_blocks
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND ((caller_account_id=NEW.blocker_account_id AND receiver_account_id=NEW.blocked_account_id) OR (receiver_account_id=NEW.blocker_account_id AND caller_account_id=NEW.blocked_account_id))
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_after_block_target_change
AFTER UPDATE OF blocker_account_id,blocked_account_id ON agora_account_blocks
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND ((caller_account_id=NEW.blocker_account_id AND receiver_account_id=NEW.blocked_account_id) OR (receiver_account_id=NEW.blocker_account_id AND caller_account_id=NEW.blocked_account_id))
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_after_listing_withdrawal
AFTER UPDATE OF status,moderation_status,report_hold,worker_account_id,category_id ON worker_listings
WHEN NEW.status<>'published' OR NEW.moderation_status<>'allowed' OR NEW.report_hold<>0
  OR NEW.worker_account_id<>OLD.worker_account_id OR NEW.category_id<>OLD.category_id
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (listing_id=OLD.id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_before_listing_delete
BEFORE DELETE ON worker_listings
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (listing_id=OLD.id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_before_worker_profile_delete
BEFORE DELETE ON worker_profiles
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (receiver_account_id=OLD.account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_after_category_withdrawal
AFTER UPDATE OF is_active ON categories
WHEN NEW.is_active<>1
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (listing_id IN(SELECT id FROM worker_listings WHERE category_id=NEW.id))
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_before_original_session_delete
BEFORE DELETE ON auth_sessions
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (accepted_session_hash=OLD.token_hash OR id IN(SELECT invitation_id FROM private_call_dispatch_slots WHERE caller_session_hash=OLD.token_hash))
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

CREATE TRIGGER end_call_after_participant_disable
AFTER UPDATE OF status ON accounts
WHEN NEW.status='disabled'
BEGIN
  UPDATE private_call_invitations SET phase='ended',accepted_session_hash=NULL,
    terminal_at_ms=MAX(created_at_ms,unixepoch()*1000),history_outcome='ended'
  WHERE phase='accepted' AND (caller_account_id=NEW.id OR receiver_account_id=NEW.id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=caller_account_id)
    AND EXISTS(SELECT 1 FROM accounts WHERE id=receiver_account_id);
END;

