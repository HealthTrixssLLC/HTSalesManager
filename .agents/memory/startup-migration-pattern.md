---
name: Startup migration is the production migration path
description: How schema migrations actually reach production in this project — not drizzle migrate, not the SQL files
---

## Rule
Every production schema change must be added to `runStartupColumnMigration()` in `server/seed.ts` as idempotent SQL (`IF NOT EXISTS`, `IF EXISTS`, `DROP NOT NULL` on nullable column is no-op, etc.). The numbered SQL files under `migrations/` and the Drizzle journal (`migrations/meta/_journal.json`) are **not used at runtime**.

## Why
- `npm run start` = `NODE_ENV=production node dist/index.js` — no drizzle migrate call.
- Drizzle kit is configured for `push` (direct schema sync in dev), not `migrate`.
- The Drizzle journal only runs up to idx 10 (0017_register_leads_org_email_unique_idx) even though migrations/ has files through 0018. New SQL files added to migrations/ do nothing in production unless also added to the startup migration.
- Root cause of the org-scoped-tags deployment failure: schema.ts gained `tags.organization_id` but runStartupColumnMigration() never added the column, so any ORM query against tags in production would throw "column organization_id does not exist" → 500.

## How to apply
1. Write idempotent SQL for the change (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, DROP NOT NULL).
2. Add it as a numbered comment block in `runStartupColumnMigration()` in `server/seed.ts`.
3. Also update `migrations/0NNN_*.sql` for dev reference (applied via `npm run db:push` interactively).
4. Verify idempotency by running the SQL against a DB that already has the change applied — every statement must be a silent no-op (NOTICE is fine, ERROR is not).
5. Run `npx tsc --noEmit` and the relevant test suite before shipping.
