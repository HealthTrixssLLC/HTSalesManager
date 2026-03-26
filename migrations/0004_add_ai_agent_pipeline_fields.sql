-- Extend lg_run_status enum to include error state for failed pipeline runs
ALTER TYPE "lg_run_status" ADD VALUE IF NOT EXISTS 'error';

-- Add AI agent pipeline fields to lead_generation_runs
ALTER TABLE "lead_generation_runs"
  ADD COLUMN IF NOT EXISTS "current_phase" text,
  ADD COLUMN IF NOT EXISTS "phase_log" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "error_phase" text,
  ADD COLUMN IF NOT EXISTS "error_reason" text;

-- Add ICP/agent enrichment fields to candidate_accounts
ALTER TABLE "candidate_accounts"
  ADD COLUMN IF NOT EXISTS "domain" text,
  ADD COLUMN IF NOT EXISTS "icp_fit_rationale" text,
  ADD COLUMN IF NOT EXISTS "company_overview" text,
  ADD COLUMN IF NOT EXISTS "strategic_approach" text,
  ADD COLUMN IF NOT EXISTS "source_agent_phase" text;

-- Add role/outreach fields to candidate_contacts
ALTER TABLE "candidate_contacts"
  ADD COLUMN IF NOT EXISTS "role_fit_rationale" text,
  ADD COLUMN IF NOT EXISTS "outreach_priority" text,
  ADD COLUMN IF NOT EXISTS "source_agent_phase" text;

-- Add communication plan to candidate_leads
ALTER TABLE "candidate_leads"
  ADD COLUMN IF NOT EXISTS "communication_plan" jsonb;

-- Create agent_step_logs table for LLM audit trail
CREATE TABLE IF NOT EXISTS "agent_step_logs" (
  "id" varchar(50) PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" varchar(50) NOT NULL REFERENCES "lead_generation_runs"("id") ON DELETE CASCADE,
  "phase" text NOT NULL,
  "step_name" text NOT NULL,
  "prompt_sent" text,
  "response_received" text,
  "model_used" text,
  "provider_used" text,
  "duration_ms" integer,
  "success" boolean NOT NULL DEFAULT true,
  "error_message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_step_logs_run_id_idx" ON "agent_step_logs" ("run_id");
CREATE INDEX IF NOT EXISTS "agent_step_logs_phase_idx" ON "agent_step_logs" ("phase");
CREATE INDEX IF NOT EXISTS "agent_step_logs_created_at_idx" ON "agent_step_logs" ("created_at");

-- Create ai_configs table for supplementary search provider configuration
-- API keys are referenced via api_key_env_var (env var name) only — no plaintext key storage.
-- LLM provider secrets are managed via the admin console llm_configurations table (encrypted at rest).
CREATE TABLE IF NOT EXISTS "ai_configs" (
  "id" varchar(50) PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "api_key_env_var" text,
  "base_url" text,
  "temperature" numeric(3,2) DEFAULT 0.7,
  "max_tokens" integer DEFAULT 4096,
  "agent_phase" text,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_by" varchar(50) REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
-- Migrate existing rows: drop api_key column if it was created in a prior version
ALTER TABLE "ai_configs" DROP COLUMN IF EXISTS "api_key";

CREATE INDEX IF NOT EXISTS "ai_configs_provider_idx" ON "ai_configs" ("provider");
CREATE INDEX IF NOT EXISTS "ai_configs_is_default_idx" ON "ai_configs" ("is_default");
CREATE INDEX IF NOT EXISTS "ai_configs_agent_phase_idx" ON "ai_configs" ("agent_phase");
