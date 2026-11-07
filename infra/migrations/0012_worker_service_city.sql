-- Optional public service city chosen by the owner. Existing Services opt out.
ALTER TABLE worker_listings ADD COLUMN service_city TEXT
  CHECK(service_city IS NULL OR service_city IN ('bilaspur', 'raipur'));

CREATE INDEX idx_worker_listings_public_city
ON worker_listings(service_city,created_at,id)
WHERE status='published' AND moderation_status='allowed' AND service_city IS NOT NULL;
