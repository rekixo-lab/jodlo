-- Report-based holds are independent of other moderation decisions.
ALTER TABLE worker_listings ADD COLUMN report_hold INTEGER NOT NULL DEFAULT 0
  CHECK(report_hold IN (0,1));

CREATE TABLE service_report_cases (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  listing_id TEXT NOT NULL REFERENCES worker_listings(id) ON DELETE CASCADE,
  reporter_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  listing_revision INTEGER NOT NULL,
  profile_revision INTEGER NOT NULL,
  photo_revision INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('misleading','unsafe','privacy','spam')),
  status TEXT NOT NULL CHECK(status IN ('pending','dismissed','upheld','appealed','restored','appeal_denied')),
  appeal_reason TEXT CHECK(appeal_reason IN ('corrected','mistaken')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_service_cases_queue ON service_report_cases(status,id);
CREATE INDEX idx_service_cases_listing ON service_report_cases(listing_id,status);
CREATE INDEX idx_service_cases_reporter ON service_report_cases(reporter_account_id,status);
CREATE UNIQUE INDEX idx_service_cases_one_report_per_revision
  ON service_report_cases(reporter_account_id,listing_id,listing_revision,profile_revision,photo_revision)
  WHERE reporter_account_id IS NOT NULL;

-- A successful appeal removes the report hold only when no other upheld case
-- remains. It never clears the listing's separate moderation_status.
CREATE TRIGGER service_report_update_listing_hold
AFTER UPDATE OF status ON service_report_cases
FOR EACH ROW WHEN OLD.status <> NEW.status
BEGIN
  UPDATE worker_listings
  SET report_hold=CASE WHEN EXISTS(
        SELECT 1 FROM service_report_cases
        WHERE listing_id=NEW.listing_id AND status IN ('upheld','appealed','appeal_denied')
      ) THEN 1 ELSE 0 END,
      revision=revision+1
  WHERE id=NEW.listing_id AND report_hold<>CASE WHEN EXISTS(
        SELECT 1 FROM service_report_cases
        WHERE listing_id=NEW.listing_id AND status IN ('upheld','appealed','appeal_denied')
      ) THEN 1 ELSE 0 END;
END;
