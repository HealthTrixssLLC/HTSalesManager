-- Pre-migration fixes for Docker deployment
-- Run this before drizzle-kit push to ensure schema constraints can be applied

-- Fix 1: Update NULL close_date values to a default date
-- This allows the NOT NULL constraint to be applied successfully
DO $$
BEGIN
  -- Only run if opportunities table exists
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'opportunities') THEN
    -- Check if close_date column exists and has NULL values
    IF EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'opportunities' AND column_name = 'close_date'
    ) THEN
      -- Update NULL close_date to end of current year
      UPDATE opportunities 
      SET close_date = (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year' - INTERVAL '1 day')::timestamp
      WHERE close_date IS NULL;
      
      RAISE NOTICE 'Fixed % opportunities with NULL close_date', (SELECT COUNT(*) FROM opportunities WHERE close_date IS NULL);
    END IF;
  END IF;
END $$;
