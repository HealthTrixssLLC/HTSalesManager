-- Phase F: API key read/write permission scopes
-- Adds a permissions column defaulting to all capabilities so existing keys keep full access.
ALTER TABLE "api_keys"
  ADD COLUMN IF NOT EXISTS "permissions" text[]
  DEFAULT ARRAY['crm.read','crm.write','activities.read','activities.write','documents.read','documents.write']::text[];
