ALTER TABLE private_call_invitations ADD COLUMN terminal_at_ms INTEGER
  CHECK(terminal_at_ms IS NULL OR terminal_at_ms>=created_at_ms);
ALTER TABLE private_call_invitations ADD COLUMN history_outcome TEXT
  CHECK(history_outcome IS NULL OR history_outcome IN ('ended','declined','cancelled','missed'));

-- One summary per participating account. Never infer connected seconds from
-- signaling alone. An unseen invitation does not create a receiver entry.
CREATE TRIGGER record_private_call_history
AFTER UPDATE OF terminal_at_ms ON private_call_invitations
WHEN OLD.terminal_at_ms IS NULL AND NEW.terminal_at_ms IS NOT NULL
  AND NEW.history_outcome IS NOT NULL
BEGIN
  INSERT INTO call_history(id, account_id, direction, outcome, ended_at, connected_seconds)
  VALUES (NEW.id, NEW.caller_account_id, 'outgoing', NEW.history_outcome, NEW.terminal_at_ms/1000, 0);
  INSERT INTO call_history(id, account_id, direction, outcome, ended_at, connected_seconds)
  SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))), NEW.receiver_account_id, 'incoming', NEW.history_outcome, NEW.terminal_at_ms/1000, 0
  WHERE NEW.received_at_ms IS NOT NULL OR OLD.accepted_session_hash IS NOT NULL
    OR NEW.history_outcome='declined';
END;
