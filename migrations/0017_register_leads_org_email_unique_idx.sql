-- Idempotent: no-op if the index already exists (production).
-- Registers the partial unique index in the migration journal so Drizzle
-- does not attempt to create it as a net-new object on future publishes.
-- Matches the exact production definition introspected from pg_indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "leads_org_email_unique_idx"
  ON "leads" USING btree ("organization_id", lower(BTRIM("email")))
  WHERE NULLIF(BTRIM("email"), ''::text) IS NOT NULL;
