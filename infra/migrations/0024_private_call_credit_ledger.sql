-- Offline-only minute entitlement accounting. No Play/UPI verification,
-- checkout API, price, refund or live usage source is connected by this schema.
-- Credit seconds are not currency, balances are private, no arbitrary writes by clients.
CREATE TABLE call_credit_balances (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  available_seconds INTEGER NOT NULL DEFAULT 0
    CHECK(available_seconds BETWEEN 0 AND 2147483647),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 2147483647)
);

-- Store ONLY a trusted source-event SHA-256 digest, never purchase tokens,
-- prices, device identifiers, provider credentials or receipt bodies.
-- The globally unique digest is also a duplicate/cross-account claim fence.
CREATE TABLE call_credit_events (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_key_hash TEXT NOT NULL UNIQUE
    CHECK(length(source_key_hash)=64 AND source_key_hash NOT GLOB '*[^0-9a-f]*'),
  kind TEXT NOT NULL CHECK(kind IN ('purchase_grant','verified_usage')),
  seconds INTEGER NOT NULL CHECK(seconds BETWEEN 1 AND 30000),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>0)
);
CREATE INDEX idx_call_credit_events_owner ON call_credit_events(account_id,created_at_ms,id);

CREATE TRIGGER apply_call_credit_event AFTER INSERT ON call_credit_events
BEGIN
  INSERT OR IGNORE INTO call_credit_balances(account_id) VALUES (NEW.account_id);
  UPDATE call_credit_balances
     SET available_seconds=available_seconds+
         CASE WHEN NEW.kind='purchase_grant' THEN NEW.seconds ELSE -NEW.seconds END,
         revision=revision+1
   WHERE account_id=NEW.account_id;
END;
