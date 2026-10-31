-- ADR-0014 / M-005: explicit, worker-owned permission to receive Agora IP voice.
-- Not inferred from draft profile/listing publication. Missing row means OFF.
-- No telephone numbers, calls, history, location, push tokens, consent text,
-- provider account IDs, recorded audio, timestamps or personal area information.
-- A tiny private switch plus optimistic revision is all the founder approved.
CREATE TABLE worker_agora_call_preferences (
  account_id TEXT PRIMARY KEY NOT NULL
    REFERENCES worker_profiles(account_id) ON DELETE CASCADE,
  calls_enabled INTEGER NOT NULL DEFAULT 0 CHECK(calls_enabled IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647)
);
