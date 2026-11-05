-- Forward-only JODLO-only hierarchy preparation. NO seed, approval or production write.
-- Every hierarchy level and Category assignment requires explicit independent
-- operator-controlled activation following qualified human review.
CREATE TABLE catalog_groups (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  name_en TEXT NOT NULL CHECK (length(trim(name_en)) BETWEEN 1 AND 120),
  name_hi TEXT CHECK (name_hi IS NULL OR length(trim(name_hi)) BETWEEN 1 AND 120),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
  is_approved INTEGER NOT NULL DEFAULT 0 CHECK(is_approved IN (0,1))
);
CREATE TABLE catalog_families (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  group_id TEXT NOT NULL REFERENCES catalog_groups(id) ON DELETE RESTRICT,
  name_en TEXT NOT NULL CHECK (length(trim(name_en)) BETWEEN 1 AND 120),
  name_hi TEXT CHECK (name_hi IS NULL OR length(trim(name_hi)) BETWEEN 1 AND 120),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
  is_approved INTEGER NOT NULL DEFAULT 0 CHECK(is_approved IN (0,1))
);
CREATE INDEX idx_hierarchy_families_group ON catalog_families(group_id,id);
CREATE TABLE catalog_family_categories (
  family_id TEXT NOT NULL REFERENCES catalog_families(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  is_approved INTEGER NOT NULL DEFAULT 0 CHECK(is_approved IN (0,1)),
  PRIMARY KEY (family_id, category_id)
);
CREATE INDEX idx_hierarchy_membership_category ON catalog_family_categories(category_id, family_id);
