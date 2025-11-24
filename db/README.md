# Database Migrations & Fixes

## Pre-Migration Fixes

### Overview
The `pre-migration-fixes.sql` script runs automatically before Drizzle schema push in Docker deployments. This ensures that data constraints can be applied successfully even when migrating from older schema versions.

### Current Fixes

#### Fix 1: NULL close_date values
**Problem:** Opportunities table may have NULL `close_date` values from older schema versions, but the current schema requires `close_date NOT NULL`.

**Solution:** Updates all NULL `close_date` values to December 31st of the current year before applying the NOT NULL constraint.

**SQL:**
```sql
UPDATE opportunities 
SET close_date = (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year' - INTERVAL '1 day')::timestamp
WHERE close_date IS NULL;
```

### How It Works (Docker)

1. **Container Starts** → Docker entrypoint begins
2. **Wait for PostgreSQL** → Health check ensures DB is ready
3. **Run pre-migration-fixes.sql** → Backfill NULL values
4. **Run npm run db:push** → Apply schema changes (now succeeds!)
5. **Start Application** → CRM starts normally

### Manual Execution (Replit/Local)

If you encounter migration errors in Replit or local development:

```bash
# Connect to your database and run the fix manually
psql $DATABASE_URL -f db/pre-migration-fixes.sql

# Then push the schema
npm run db:push
```

### Adding New Fixes

To add a new pre-migration fix:

1. Edit `db/pre-migration-fixes.sql`
2. Add your SQL inside a `DO $$ BEGIN ... END $$;` block
3. Check if table/column exists before running fix
4. Rebuild Docker image for changes to take effect

Example pattern:
```sql
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'my_table') THEN
    -- Your fix here
    UPDATE my_table SET my_column = 'default' WHERE my_column IS NULL;
    RAISE NOTICE 'Fixed my_table rows';
  END IF;
END $$;
```

### Troubleshooting

**Error: `column "close_date" contains null values`**
- ✅ Fixed by pre-migration-fixes.sql

**Error: `column "external_id" does not exist`**
- ✅ Fixed after close_date migration succeeds  

**Docker migration still failing?**
- Check `docker logs healthtrixss-crm-app` for pre-migration output
- Verify SQL file is copied: `docker exec healthtrixss-crm-app ls -la /app/db/`
- Manually run fix: `docker exec -it healthtrixss-crm-app node -e "..."` (see Dockerfile)

### Schema Push Reference

**Replit (Neon):** Uses serverless driver
```bash
npm run db:push
```

**Docker (Standard PostgreSQL):** Uses standard pg driver
```bash
npm run db:push  # Runs automatically on container start
```

Both environments use the same schema (`shared/schema.ts`) and migrations are fully portable via encrypted backups.
