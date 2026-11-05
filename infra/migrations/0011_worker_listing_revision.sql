-- 0011 (local-only): deterministic revision for owner-selected Service edits.
-- No new personally-identifying, profile, GPS, phone, rate, media or public data.
-- Preserve old Public/Owner DTOs and all original GET/POST/PUT/DELETE routes.
-- Revision starts at 0 for existing records; it is PRIVATE to opt-in v2 GET.
-- Every UPDATE of a safety/publication/category field (including old v1
-- endpoints and moderator actions) increments the version, defeating ABA.
-- Trigger is AFTER UPDATE OF the three named fields; updating revision alone
-- does NOT recursively re-enter the trigger, even if recursive_triggers=ON.
ALTER TABLE worker_listings
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
    CHECK(revision BETWEEN 0 AND 2147483647);

CREATE TRIGGER worker_listing_bump_revision
AFTER UPDATE OF category_id,status,moderation_status ON worker_listings
FOR EACH ROW
WHEN OLD.category_id IS NOT NEW.category_id
  OR OLD.status IS NOT NEW.status
  OR OLD.moderation_status IS NOT NEW.moderation_status
BEGIN
  UPDATE worker_listings SET revision=revision+1 WHERE id=NEW.id;
END;
