-- JODLO first local-only migration: public taxonomy, no identities or PII.
-- Forward-only migration; rehearse restore from a local SQLite backup before release.
CREATE TABLE categories (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  slug TEXT NOT NULL UNIQUE CHECK (
    length(slug) BETWEEN 2 AND 64
    AND slug GLOB '[a-z]*'
    AND slug NOT GLOB '*[^a-z0-9-]*'
  ),
  name_en TEXT NOT NULL CHECK (length(trim(name_en)) BETWEEN 1 AND 120),
  name_hi TEXT CHECK (name_hi IS NULL OR length(trim(name_hi)) BETWEEN 1 AND 120),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Only approved published entries can appear in catalog reads.
CREATE INDEX idx_categories_active_sort ON categories (sort_order, id)
  WHERE is_active = 1;
