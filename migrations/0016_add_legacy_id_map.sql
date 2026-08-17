-- Migration: recognize legacy_id_map as a permanent application-managed table.
-- This table was created and populated by the canonical-ID migration script
-- (scripts/run-canonical-id-migration.ts --live) and contains 766 mapping rows
-- that MUST NOT be dropped, truncated, or modified by Replit Publishing or any
-- subsequent Drizzle migration.
--
-- Using CREATE TABLE IF NOT EXISTS so that:
--   • On development databases where the table is absent: it is created.
--   • On production where the table already exists: this is a no-op.
--
-- The PRIMARY KEY and UNIQUE constraint names match those already present in
-- production (legacy_id_map_pkey, legacy_id_map_entity_canonical_id_key).

CREATE TABLE IF NOT EXISTS "legacy_id_map" (
  "entity"       text        NOT NULL,
  "legacy_id"    text        NOT NULL,
  "canonical_id" text        NOT NULL,
  "migrated_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "legacy_id_map_pkey" PRIMARY KEY ("entity", "legacy_id"),
  CONSTRAINT "legacy_id_map_entity_canonical_id_key" UNIQUE ("entity", "canonical_id")
);
