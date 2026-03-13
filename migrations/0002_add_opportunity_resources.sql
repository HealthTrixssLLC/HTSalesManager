-- Migration: Add opportunity_resources table for workforce/resource planning
-- This table tracks user-to-opportunity resource assignments

CREATE TABLE IF NOT EXISTS "opportunity_resources" (
  "id" varchar(50) PRIMARY KEY DEFAULT gen_random_uuid(),
  "opportunity_id" varchar(100) NOT NULL REFERENCES "opportunities"("id") ON DELETE CASCADE,
  "user_id" varchar(50) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text,
  "allocation" integer DEFAULT 100,
  "start_date" timestamp,
  "end_date" timestamp,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "opportunity_resources_opportunity_id_idx" ON "opportunity_resources" ("opportunity_id");
CREATE INDEX IF NOT EXISTS "opportunity_resources_user_id_idx" ON "opportunity_resources" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_resources_unique_idx" ON "opportunity_resources" ("opportunity_id", "user_id");
