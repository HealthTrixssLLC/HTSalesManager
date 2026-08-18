-- 0018: Org-scoped tags for External API tagging support
--
-- 1. tags.organization_id (nullable FK -> organizations): NULL = legacy/global
--    internal-use tag; set = tag belongs to that organization.
-- 2. Replace the global UNIQUE(name) constraint with a case-insensitive
--    UNIQUE(lower(name), COALESCE(organization_id, '')) index so different
--    orgs may reuse a tag name, but a name is unique within one org (and
--    within the legacy global namespace).
-- 3. created_by becomes nullable on tags and entity_tags: external API
--    requests are key-scoped, not user-scoped (matches createActivity's
--    ownerId: null pattern).

ALTER TABLE tags ADD COLUMN IF NOT EXISTS organization_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_unique;
ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS tags_name_org_unique_idx
  ON tags (lower(name), COALESCE(organization_id, ''));

CREATE INDEX IF NOT EXISTS tags_org_idx ON tags (organization_id);

ALTER TABLE tags ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE entity_tags ALTER COLUMN created_by DROP NOT NULL;
