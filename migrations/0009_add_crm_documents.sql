DO $$ BEGIN
  CREATE TYPE "crm_document_entity_type" AS ENUM('lead', 'account', 'contact', 'opportunity');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "crm_documents" (
  "id" varchar(50) PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_type" "crm_document_entity_type" NOT NULL,
  "entity_id" varchar(100) NOT NULL,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "content_type" text NOT NULL,
  "size" integer NOT NULL,
  "uploaded_by" varchar(50) NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "crm_documents_entity_idx" ON "crm_documents" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "crm_documents_uploaded_by_idx" ON "crm_documents" ("uploaded_by");
