---
name: db:push interactive drift & server test workflow
description: Quirks when applying schema changes and running server integration tests
---
## db:push prompt
`npm run db:push` (drizzle-kit push) stops at an interactive prompt about adding `organizations_slug_unique` — pre-existing drift between schema.ts and the DB, unrelated to new changes. `--force` does not skip it.
**Why:** the constraint exists in schema.ts but drizzle sees it as new, and the prompt cannot be answered non-interactively.
**How to apply:** for new indexes/constraints, add them to `shared/schema.ts` AND create them directly with `psql "$DATABASE_URL"` so schema and DB stay in sync without running the interactive push.

## Server integration tests
- Located in `tests/*.test.ts`; must run with `npx vitest run <file> --config tests/vitest.server.config.ts` (root vitest.config.ts only includes `client/src/__tests__`).
- They hit the live dev server on localhost:5000. The dev workflow runs `tsx server/index.ts` WITHOUT watch — restart the "Start application" workflow after editing server code or tests will exercise stale code.
