-- Migration: Add llm_configurations table for AI/LLM provider configuration
-- Stores per-instance LLM provider settings, encrypted API credentials,
-- generation parameters, and per-agent enable/override flags.

CREATE TABLE IF NOT EXISTS "llm_configurations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL DEFAULT 'openai',
  "base_url" text,
  "encrypted_api_key" text,
  "api_key_hint" text,
  "model_name" text NOT NULL DEFAULT 'gpt-4o',
  "temperature" numeric NOT NULL DEFAULT 0.7,
  "max_tokens" integer NOT NULL DEFAULT 4096,
  "request_timeout" integer NOT NULL DEFAULT 60,
  "enabled_agents" jsonb DEFAULT '["market_research","company_discovery","lead_discovery","strategy","communication_drafting"]'::jsonb,
  "agent_model_overrides" jsonb DEFAULT '{}'::jsonb,
  "updated_by" varchar(50) REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
