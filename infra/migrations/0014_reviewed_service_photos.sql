-- One small, normalized JPEG per Service. No external URL, original file,
-- embedded metadata, or object outside account/listing erasure cascades.
CREATE TABLE worker_service_photos (
  listing_id TEXT PRIMARY KEY NOT NULL REFERENCES worker_listings(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  jpeg_base64 TEXT CHECK(length(jpeg_base64) BETWEEN 1 AND 57344),
  review_status TEXT NOT NULL CHECK(review_status IN ('pending','approved','rejected','cleared')),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  CHECK((review_status='cleared')=(jpeg_base64 IS NULL))
);
CREATE INDEX idx_worker_service_photos_pending ON worker_service_photos(listing_id)
WHERE review_status='pending';

CREATE TRIGGER worker_service_photos_reject_on_category_change
AFTER UPDATE OF category_id ON worker_listings
FOR EACH ROW WHEN OLD.category_id <> NEW.category_id
BEGIN
  UPDATE worker_service_photos SET review_status='rejected',revision=revision+1
  WHERE listing_id=NEW.id AND review_status IN ('pending','approved');
END;
