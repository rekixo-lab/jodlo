-- Existing services have no profile. Owner edits always return to review.
CREATE TABLE worker_service_details (
  listing_id TEXT PRIMARY KEY NOT NULL REFERENCES worker_listings(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  display_name TEXT CHECK(length(display_name) BETWEEN 2 AND 60),
  description TEXT CHECK(length(description) BETWEEN 10 AND 400),
  experience_years INTEGER CHECK(experience_years BETWEEN 0 AND 80),
  visit_rate_inr INTEGER CHECK(visit_rate_inr BETWEEN 1 AND 10000000),
  review_status TEXT NOT NULL CHECK(review_status IN ('pending','approved','rejected','cleared')),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  CHECK((review_status = 'cleared' AND display_name IS NULL AND description IS NULL) OR
        (review_status <> 'cleared' AND display_name IS NOT NULL AND description IS NOT NULL))
);
CREATE INDEX idx_worker_service_details_pending ON worker_service_details(listing_id)
WHERE review_status='pending';

-- Do not revive a former approval if a listing changes Category and returns.
CREATE TRIGGER worker_service_details_reject_on_category_change
AFTER UPDATE OF category_id ON worker_listings
FOR EACH ROW WHEN OLD.category_id <> NEW.category_id
BEGIN
  UPDATE worker_service_details
  SET review_status='rejected', revision=revision+1
  WHERE listing_id=NEW.id AND review_status IN ('pending','approved');
END;
