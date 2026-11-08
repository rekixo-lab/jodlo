-- Private, per-block references for managing outgoing blocks without exposing account IDs.
ALTER TABLE agora_account_blocks ADD COLUMN management_id TEXT;
UPDATE agora_account_blocks SET management_id=lower(hex(randomblob(16)));
CREATE UNIQUE INDEX idx_agora_block_management ON agora_account_blocks(blocker_account_id, management_id);

CREATE TRIGGER trg_agora_block_management
AFTER INSERT ON agora_account_blocks FOR EACH ROW
WHEN NEW.management_id IS NULL
BEGIN
  UPDATE agora_account_blocks SET management_id=lower(hex(randomblob(16))) WHERE rowid=NEW.rowid;
END;
