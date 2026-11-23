-- Forward-only Cloudflare D1 query index for the owner-private Play hold
-- preview. The underlying table and the revocation/credit triggers remain
-- unchanged; this adds NO payment, grant, refund or public write capability.
-- Only an existing outbox row associated with the active account can ever
-- appear in the optional read-only Account -> Purchase Status screen.
CREATE INDEX idx_play_consume_outbox_owner_void_hold
ON play_consume_outbox(account_id,updated_at_ms DESC,source_key_hash DESC)
WHERE status='void_hold';
