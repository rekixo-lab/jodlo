ALTER TABLE private_call_invitations ADD COLUMN phase TEXT NOT NULL DEFAULT 'ringing'
  CHECK(phase IN ('ringing','accepted','declined','cancelled','ended'));

ALTER TABLE private_call_dispatch_slots ADD COLUMN caller_session_hash TEXT
  REFERENCES auth_sessions(token_hash) ON DELETE CASCADE;
CREATE INDEX idx_private_call_dispatch_caller_session ON private_call_dispatch_slots(caller_session_hash);

ALTER TABLE private_call_invitations ADD COLUMN received_at_ms INTEGER
  CHECK(received_at_ms IS NULL OR received_at_ms BETWEEN created_at_ms AND ring_deadline_ms);

ALTER TABLE private_call_invitations ADD COLUMN accepted_session_hash TEXT
  REFERENCES auth_sessions(token_hash) ON DELETE SET NULL;
CREATE INDEX idx_private_call_accepted_session ON private_call_invitations(accepted_session_hash);

ALTER TABLE private_call_invitations ADD COLUMN availability_revision INTEGER
  CHECK(availability_revision IS NULL OR availability_revision>0);
