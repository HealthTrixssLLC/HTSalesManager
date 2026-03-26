-- Migration: Add Azure OpenAI provider support to llm_configurations
-- Adds api_version column (nullable text) to store Azure API version strings
-- e.g. "2024-12-01-preview"

ALTER TABLE "llm_configurations" ADD COLUMN IF NOT EXISTS "api_version" text;
