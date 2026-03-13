-- Add implementation dates to opportunities
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS implementation_start_date timestamp;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS implementation_end_date timestamp;

-- Create opportunity_resources table
CREATE TABLE IF NOT EXISTS opportunity_resources (
  id varchar(50) PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id varchar(100) NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id varchar(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(100) NOT NULL,
  created_at timestamp DEFAULT now()
);
