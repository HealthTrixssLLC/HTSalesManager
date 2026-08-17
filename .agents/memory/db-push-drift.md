---
name: Schema migrations & server test workflow
description: Durable rules for applying schema changes and running server integration tests
---


## Schema changes
`npm run db:push` cannot be relied on non-interactively (pre-existing drift triggers an unanswerable prompt; `--force` doesn't skip it).
**Why:** drizzle-kit treats already-applied constraints as new and prompts interactively.
**How to apply:** add new indexes/constraints to `shared/schema.ts` AND apply them directly via SQL so schema and DB stay in sync.

## Server integration tests
Server suites hit the live dev server, which does not watch server code.
**Why:** tests silently exercise stale code after server edits, producing misleading failures/passes.
**How to apply:** restart the dev workflow before running server integration suites; run them individually — running several concurrently against one dev server causes spurious 30s timeouts.
## Full server suite quirks (Phase G)
- The full suite makes >10 logins/min across files; the auth limiter (10/min/IP) 429s them. Set env var `DISABLE_RATE_LIMITING=true` (development) — the external API per-key limiter is separate and stays active, so 429 tests still work.
- Test files must not run in parallel (`fileParallelism: false` in tests/vitest.server.config.ts): they share one server/DB, and API-key auth bcrypt-scans all active keys per request, so parallel files compound latency into 30s timeouts.
- Task-branch DBs can lag migrations (missing tables/columns/unique indexes). Apply the missing `migrations/*.sql` with psql before blaming test code; the leads org+lower(email) unique index is required for the duplicate-lead race test.
- `tests/opportunity-activity-creation.test.ts` is a plain tsx script (own workflow), excluded from the vitest config on purpose.

## DB drift check before trusting test failures
500s in the server suite (e.g. "relation does not exist") usually mean the dev DB is missing a migration, not a code bug. Verify `opportunity_contacts`, `documents`, `api_keys.permissions`, and the partial unique index `leads_org_email_unique_idx` (created by `scripts/migrate-lead-email-unique.ts`, not a numbered migration) exist before debugging. POST /leads concurrent-dedup relies on that index.
