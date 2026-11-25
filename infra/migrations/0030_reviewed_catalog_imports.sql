-- Empty, forward-only JODLO catalog import journal. No catalog is seeded here.
-- Publication requires a separately reviewed, content-bound operator manifest.
CREATE TABLE catalog_import_batches (
  batch_id TEXT PRIMARY KEY NOT NULL CHECK(length(batch_id) BETWEEN 8 AND 64),
  scope_sha256 TEXT NOT NULL CHECK(length(scope_sha256)=64 AND scope_sha256 NOT GLOB '*[^a-f0-9]*'),
  approval_sha256 TEXT NOT NULL CHECK(length(approval_sha256)=64 AND approval_sha256 NOT GLOB '*[^a-f0-9]*'),
  owner_evidence_url TEXT NOT NULL CHECK(length(owner_evidence_url) BETWEEN 1 AND 300),
  state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','published','reversed')),
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at TEXT,
  reversed_at TEXT
);
CREATE TABLE catalog_import_entries (
  batch_id TEXT NOT NULL REFERENCES catalog_import_batches(batch_id) ON DELETE RESTRICT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('group','family','category','service')),
  entity_id TEXT NOT NULL CHECK(length(entity_id) BETWEEN 1 AND 64),
  record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64 AND record_sha256 NOT GLOB '*[^a-f0-9]*'),
  is_owned INTEGER NOT NULL CHECK(is_owned IN (0,1)),
  PRIMARY KEY(batch_id,entity_kind,entity_id)
);
CREATE UNIQUE INDEX catalog_import_single_owner ON catalog_import_entries(entity_kind,entity_id)
  WHERE is_owned=1;
CREATE INDEX catalog_import_dependents ON catalog_import_entries(entity_kind,entity_id,batch_id)
  WHERE is_owned=0;

-- Reviewed service-name choices within the canonical Category hierarchy.
-- These are taxonomy labels, NEVER a claim that an actual Worker is available.
CREATE TABLE catalog_services (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 10 AND 64 AND id GLOB 'jodlo_s_*' AND id NOT GLOB '*[^a-z0-9_]*'),
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name_en TEXT NOT NULL CHECK(length(trim(name_en)) BETWEEN 1 AND 120),
  name_hi TEXT NOT NULL CHECK(length(trim(name_hi)) BETWEEN 1 AND 120),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1))
);
CREATE INDEX catalog_services_public_category ON catalog_services(category_id,id) WHERE is_active=1;
