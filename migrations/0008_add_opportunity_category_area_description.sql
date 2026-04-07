ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "categories" text[];
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "operational_areas" text[];
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "description" text;
