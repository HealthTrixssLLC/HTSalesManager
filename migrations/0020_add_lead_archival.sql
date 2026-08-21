-- 0020: Preserve Lead history while removing archived records from active workflows.
-- Existing rows remain active (archived_at IS NULL). No records are deleted.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_from_status lead_status;

CREATE INDEX IF NOT EXISTS leads_org_archived_idx
  ON leads (organization_id, archived_at);