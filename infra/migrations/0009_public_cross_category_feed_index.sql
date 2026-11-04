-- Read-path index for the bounded anonymous cross-category public feed.
-- Keeps the same server-owned published+allowed eligibility as Category pages.
-- No rows inserted, statuses changed, or historical Catalog activated.
CREATE INDEX IF NOT EXISTS idx_worker_listings_public_all
ON worker_listings(created_at,id)
WHERE status='published' AND moderation_status='allowed';
