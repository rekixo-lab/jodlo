-- One private summary per participant. Account deletion removes their rows.
CREATE TABLE call_history (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id)=36),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  outcome TEXT NOT NULL CHECK (outcome IN ('ended','declined','busy','cancelled','missed','failed')),
  ended_at INTEGER NOT NULL CHECK (ended_at>0),
  connected_seconds INTEGER NOT NULL CHECK (connected_seconds>=0),
  CHECK (outcome='ended' OR connected_seconds=0)
);
CREATE INDEX idx_call_history_owner ON call_history(account_id,ended_at DESC,id DESC);
CREATE INDEX idx_call_history_expiry ON call_history(ended_at,id);
