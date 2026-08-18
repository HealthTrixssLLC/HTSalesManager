---
name: Legacy startup schema DDL
description: How to handle the project's existing startup-time schema repair code alongside Replit-managed Publish migrations
---

## Rule
For this Replit-managed PostgreSQL project, the Publish schema diff is the authoritative production migration mechanism. Do not add new schema DDL to runStartupColumnMigration() or a deployment/startup hook.

**Why:** Replit Publish introspects development and production schemas, validates its generated diff, and applies it during Publish. Startup DDL duplicates that source of truth and can race or conflict with the same migration; Replit's database migration guidance explicitly prohibits it.

**How to apply:** Define production schema changes in shared/schema.ts and let the normal development schema-sync and Publish flows carry them forward. Treat the existing runStartupColumnMigration() as legacy repair code: do not extend it, and plan any removal separately after confirming legacy production schemas no longer depend on it.

## Tag migration note
The organization-scoped tag change is represented by the Publish diff (global unique constraint removal, nullable creator columns, organization_id, FK, and indexes) and also by legacy startup DDL. Future tag migration work must use the Publish schema source only; retain legacy tags with NULL organization_id and preserve entity-tag assignments.
