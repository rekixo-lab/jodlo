-- Google sub is the only external identifier; no email, phone, profile or location.
-- The Google ID token is verified by the Worker BEFORE any row is created.
CREATE TABLE google_identities (
  google_sub TEXT PRIMARY KEY NOT NULL CHECK (length(google_sub) BETWEEN 1 AND 255),
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_google_identities_account ON google_identities(account_id);

-- Opaque, randomly generated bearer tokens are stored ONLY as SHA-256 digests.
-- A compromised database alone does not expose active bearer credentials.
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL CHECK (expires_at > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_auth_sessions_account ON auth_sessions(account_id);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);
