
-- M-005: auto-public service item, distinct from PRIVATE draft worker profile.
-- No area, phone, address, GPS, photos, descriptions, prices or trust labels.
CREATE TABLE worker_listings (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
 worker_account_id TEXT NOT NULL REFERENCES worker_profiles(account_id) ON DELETE CASCADE,
 category_id TEXT NOT NULL REFERENCES categories(id),
 status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','unpublished')),
 moderation_status TEXT NOT NULL DEFAULT 'allowed' CHECK(moderation_status IN ('allowed','hidden')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(worker_account_id,category_id)
);
CREATE INDEX idx_worker_listings_public ON worker_listings(category_id,created_at,id)
 WHERE status='published' AND moderation_status='allowed';
