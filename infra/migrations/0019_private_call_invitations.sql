-- Short-lived admission records scoped to the caller's retry key.
CREATE TABLE private_call_invitations (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  caller_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  receiver_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES worker_listings(id) ON DELETE CASCADE,
  attempt_key_hash TEXT NOT NULL CHECK(length(attempt_key_hash)=64),
  consent_revision INTEGER NOT NULL CHECK(consent_revision>0),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0),
  ring_deadline_ms INTEGER NOT NULL CHECK(ring_deadline_ms>created_at_ms),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>=ring_deadline_ms),
  UNIQUE(caller_account_id,attempt_key_hash),
  CHECK(caller_account_id<>receiver_account_id)
);
CREATE INDEX idx_private_call_invitation_expiry ON private_call_invitations(expires_at_ms,id);
CREATE INDEX idx_private_call_invitation_receiver ON private_call_invitations(receiver_account_id);
CREATE INDEX idx_private_call_invitation_listing ON private_call_invitations(listing_id);
