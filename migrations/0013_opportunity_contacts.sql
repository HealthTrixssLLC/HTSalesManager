-- Opportunity-Contact many-to-many relationship with roles and primary flag
DO $$ BEGIN
  CREATE TYPE opportunity_contact_role AS ENUM (
    'economic_buyer', 'champion', 'technical_contact', 'contract_contact',
    'executive_sponsor', 'decision_maker', 'influencer', 'other'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS opportunity_contacts (
  id             varchar(50)  PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id varchar(100) NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  contact_id     varchar(100) NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role           opportunity_contact_role NOT NULL,
  is_primary     boolean      NOT NULL DEFAULT false,
  created_at     timestamp    NOT NULL DEFAULT now(),
  updated_at     timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_contacts_opportunity_id_idx ON opportunity_contacts(opportunity_id);
CREATE INDEX IF NOT EXISTS opportunity_contacts_contact_id_idx ON opportunity_contacts(contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_contacts_unique_idx ON opportunity_contacts(opportunity_id, contact_id);
-- Only one primary contact per opportunity
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_contacts_primary_unique_idx ON opportunity_contacts(opportunity_id) WHERE is_primary = true;
