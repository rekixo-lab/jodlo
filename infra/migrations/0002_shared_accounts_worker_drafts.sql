-- ADR-0006: one JODLO account can be a customer and optionally a worker.
-- No phone, email, GPS, provider subject, real names or public verification data.
-- Account IDs are server-owned opaque IDs resolved by a trusted identity adapter.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 8 AND 128),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Presence of a worker profile is the opt-in. Customer access is implicit
-- for an active account; no duplicate account or mutable 'worker' role flag.
-- Deliberately DRAFT ONLY; publishing and identity checks are future features.
CREATE TABLE worker_profiles (
  account_id TEXT PRIMARY KEY NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status = 'draft'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
