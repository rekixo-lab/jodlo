-- A receiver can hold one short-lived dispatch slot across all listings.
CREATE TABLE private_call_dispatch_slots (
  receiver_account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invitation_id TEXT NOT NULL UNIQUE REFERENCES private_call_invitations(id) ON DELETE CASCADE,
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>0)
);
