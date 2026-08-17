---
name: External API migration drift
description: The local dev database (DATABASE_URL) was missing 3 migrations and 1 unique index after merges; how to detect and fix.
---

## Rule
After any merge that touches `migrations/`, verify all migration SQL files have been applied to `DATABASE_URL` (the local PostgreSQL instance used by the dev server and integration tests). `NEON_DATABASE_URL` is a separate Neon branch and is NOT the dev database.

## What drifted (Phase A–H gate)
- `migrations/0013_opportunity_contacts.sql` — not applied → `opportunity_contacts` table missing → opportunity-contacts tests failed
- `migrations/0014_add_api_key_permissions.sql` — not applied → `api_keys.permissions` column missing → permission tests failed
- `migrations/0015_add_documents.sql` — not applied → `documents`/`document_links` tables missing → documents tests failed
- `leads_org_email_unique_idx` — missing → concurrent-lead-dedup relied on DB constraint that didn't exist

## How to detect
```bash
psql "$DATABASE_URL" -c "\dt" | grep -E "opportunity_contacts|documents|document_links"
psql "$DATABASE_URL" -c "\di" | grep leads_org_email
```

## How to fix
Apply each migration SQL file directly. For the unique index:
```sql
-- Clean duplicates first if any exist:
DELETE FROM leads WHERE id NOT IN (SELECT MIN(id) FROM leads GROUP BY organization_id, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS leads_org_email_unique_idx ON leads(organization_id, lower(email)) WHERE email IS NOT NULL;
```

## Why
`npm run db:push` is interactive and blocks on pre-existing slug constraints; migrations are applied via direct psql. Merges don't auto-apply SQL to the local DB.

## How to apply
Before running integration tests after a merge, always run each new migration SQL against `$DATABASE_URL` directly with `psql`.
