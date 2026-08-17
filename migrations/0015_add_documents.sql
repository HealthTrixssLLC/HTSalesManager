-- Document reference model: external documents (SharePoint, OneDrive, GitHub, ...)
-- linked to CRM entities. No binaries, no temporary signed URLs.

CREATE TABLE IF NOT EXISTS "documents" (
  "id" varchar(100) PRIMARY KEY,
  "organization_id" varchar(50) NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "document_type" text,
  "source_system" text,
  "canonical_url" text NOT NULL,
  "version" text,
  "status" text NOT NULL DEFAULT 'active',
  "mime_type" text,
  "external_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "documents_org_id_idx" ON "documents" ("organization_id");
CREATE INDEX IF NOT EXISTS "documents_external_id_idx" ON "documents" ("external_id");
CREATE INDEX IF NOT EXISTS "documents_updated_at_idx" ON "documents" ("updated_at");

CREATE TABLE IF NOT EXISTS "document_links" (
  "id" varchar(50) PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" varchar(100) NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" varchar(100) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "document_links_document_id_idx" ON "document_links" ("document_id");
CREATE INDEX IF NOT EXISTS "document_links_entity_idx" ON "document_links" ("entity_type", "entity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "document_links_unique_idx" ON "document_links" ("document_id", "entity_type", "entity_id");

-- Register DOC-* in the global id_patterns seed (idempotent)
INSERT INTO "id_patterns" ("entity", "pattern", "counter", "start_value", "organization_id")
SELECT 'Document', 'DOC-{SEQ:6}', 0, 1, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "id_patterns" WHERE "entity" = 'Document' AND "organization_id" IS NULL
);
