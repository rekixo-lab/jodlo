-- M-003/M-005: locally rehearsed PRIVATE Agora safety state.
-- 2026-11-03 founder permission authorizes engineering/preparation only.
-- NO real presence, rate thresholds, retention approval or live API.
-- No caller/worker phone, GPS, call records, raw tokens, provider IDs or message text.
-- Every table starts EMPTY; no row, missing preference or missing policy grants a call.

-- An explicit worker-controlled availability preference is NOT online presence.
-- Missing row is unavailable; consent in worker_agora_call_preferences remains
-- separately required and default OFF. Owner-session CAS writer is internal only.
CREATE TABLE worker_agora_availability_preferences (
  account_id TEXT NOT NULL PRIMARY KEY
    REFERENCES worker_profiles(account_id) ON DELETE CASCADE,
  accepting_calls INTEGER NOT NULL DEFAULT 0
    CHECK(accepting_calls IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647)
);

-- Directional relationship safety: each block is initiated by its own actor.
-- Either direction must deny future contact. No reason, timestamp, notes or
-- inferred bilateral consent; no public projection or third-party lookup.
CREATE TABLE agora_account_blocks (
  blocker_account_id TEXT NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_account_id TEXT NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_account_id, blocked_account_id),
  CHECK (blocker_account_id <> blocked_account_id)
);
CREATE INDEX idx_agora_blocks_target ON agora_account_blocks(blocked_account_id);

-- Aggregate-only schema slot for a FUTURE approved anti-abuse policy.
-- NO inserts or reads for admission are authorized until the founder approves
-- window/threshold, retention+purge, reset semantics and privacy/disclosure.
-- A missing row must NEVER imply "pass". Caller ID is pseudonymous personal
-- data; no call ID, IP, device ID, recipient, phone or per-attempt event log.
CREATE TABLE agora_abuse_window_counters (
  actor_account_id TEXT NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope='invite'),
  window_start_ms INTEGER NOT NULL CHECK(window_start_ms >= 0),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > window_start_ms),
  attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 0 AND 2147483647),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  PRIMARY KEY (actor_account_id, scope)
);
CREATE INDEX idx_agora_abuse_expiry ON agora_abuse_window_counters(expires_at_ms);
