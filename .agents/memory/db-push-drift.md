---
name: db:push interactive drift & server test workflow
description: Quirks when applying schema changes and running server integration tests
---
## db:push prompt
`npm run db:push` (drizzle-kit push) stops at an interactive prompt about adding `organizations_slug_unique` — pre-existing drift between schema.ts and the DB, unrelated to new changes. `--force` does not skip it.
**Why:** the constraint exists in schema.ts but drizzle sees it as new, and the prompt cannot be answered non-interactively.
**How to apply:** for new indexes/constraints, add them to `shared/schema.ts` AND create them directly with `psql "$DATABASE_URL"` so schema and DB stay in sync without running the interactive push.

## Drift symptom: uniqueness tests fail
Indexes/constraints declared in schema.ts may be missing from the dev DB (drift). If a uniqueness-dependent test fails, check `pg_indexes` before debugging app code; existing duplicate rows (often test residue) must be cleaned before a unique index can be created.

## Server integration tests
- Located in `tests/*.test.ts`; must run with `npx vitest run <file> --config tests/vitest.server.config.ts` (root vitest.config.ts only includes `client/src/__tests__`).
- They hit the live dev server on localhost:5000. The dev workflow runs `tsx server/index.ts` WITHOUT watch — restart the "Start application" workflow after editing server code or tests will exercise stale code.

**Deployment schema mechanism:** the drizzle migrations journal is not the active mechanism; production schema changes apply via the idempotent startup migration run at server boot. New tables/columns must be added there too, or deployments won't get them.

## Full server suite quirks (Phase G)
- The full suite makes >10 logins/min across files; the auth limiter (10/min/IP) 429s them. Set env var `DISABLE_RATE_LIMITING=true` (development) — the external API per-key limiter is separate and stays active, so 429 tests still work.
- Test files must not run in parallel (`fileParallelism: false` in tests/vitest.server.config.ts): they share one server/DB, and API-key auth bcrypt-scans all active keys per request, so parallel files compound latency into 30s timeouts.
- Task-branch DBs can lag migrations (missing tables/columns/unique indexes). Apply the missing `migrations/*.sql` with psql before blaming test code; the leads org+lower(email) unique index is required for the duplicate-lead race test.
- `tests/opportunity-activity-creation.test.ts` is a plain tsx script (own workflow), excluded from the vitest config on purpose.
