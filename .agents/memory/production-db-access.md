---
name: Production DB access
description: Which database is really production for the deployed app and how to query it
---

- The deployed app reads only `DATABASE_URL` (server/db.ts, drizzle.config.ts). `NEON_DATABASE_URL` is a stale copy (41 accounts, ACT-1000–ACT-1041) used only by old audit scripts — it is NOT production.
- The workspace `DATABASE_URL` (host `helium`, db `heliumdb`) is the **development** Replit-managed Postgres. The production deployment binds its own `DATABASE_URL` that is not visible in workspace env vars.
- To query real production data, use the database skill's `executeSql({ ..., environment: "production" })` read replica. Confirmed via fingerprints: ACT-2103 (Cavulus) and ACT-2098 (Care Oregon) exist only there; HT org account count = 56 (matches live API).
- The Health Trixss org in production is named "Primary Organization" (id 3e369484-0c88-401d-86e3-9c3361ee465e) — name searches for `%trixss%`/`%health%` return nothing; fall back to the active API key's organization_id.

**Why:** two audits went against the wrong DB by trusting env-var names.
**How to apply:** any production data/ID/migration work must go through the production replica (read) or the publish flow (schema), never NEON_DATABASE_URL or workspace DATABASE_URL.
