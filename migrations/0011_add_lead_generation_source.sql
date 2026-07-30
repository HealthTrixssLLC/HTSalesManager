-- Add 'lead_generation' as a valid lead source for candidates approved via the Lead Gen Review Queue
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'lead_generation' BEFORE 'other';
