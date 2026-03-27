ALTER TABLE "candidate_accounts" ADD COLUMN IF NOT EXISTS "citations" jsonb DEFAULT '[]'::jsonb;
