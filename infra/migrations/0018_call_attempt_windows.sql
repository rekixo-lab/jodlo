-- Expiring aggregate windows. No per-attempt records or provider data.
CREATE TABLE call_attempt_windows (
  counter_key TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  window_start_ms INTEGER NOT NULL CHECK(window_start_ms>0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>window_start_ms),
  attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 1 AND 30)
);
CREATE INDEX idx_call_attempt_windows_expiry ON call_attempt_windows(expires_at_ms,counter_key);
CREATE INDEX idx_call_attempt_windows_owner ON call_attempt_windows(account_id);
CREATE INDEX idx_call_attempt_windows_peer ON call_attempt_windows(peer_account_id);
