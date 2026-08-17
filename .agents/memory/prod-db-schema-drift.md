---
name: Production DB schema drift
description: NEON_DATABASE_URL (production) schema and id_patterns diverge sharply from dev code/docs
---
- `NEON_DATABASE_URL` is the production Neon DB; `DATABASE_URL` is local dev. Query prod with a read-only pg script (`scripts/canonical-id-audit*.ts` are reusable SELECT-only examples).
- Production schema is generations behind dev: no `organizations`/`organization_id` columns, no `crm_documents`, `research_documents`, `opportunity_resources`, `saved_filters`, or lead-gen tables. Never assume dev schema shapes apply to prod queries or migrations.
- Production `id_patterns` rows override code defaults in `generateId()` — prod issues `ACT-{SEQ:4}` Accounts and `ACV-*` Activities, contradicting the documented `ACCT-*`/`ACT-*` contract. See CANONICAL_ID_AUDIT.md for full findings and remediation plan.

**Why:** Task-204 audit assumptions (ACT/ACCT collision, existence of ACT-2103) proved false against actual prod data; checking the live pattern rows first avoids wasted analysis.
**How to apply:** before any ID/schema work touching production, SELECT `id_patterns` and information_schema from NEON_DATABASE_URL first.
- Some polymorphic entity-type columns are Postgres enums: compare with `col::text IN (...)` or non-enum variants raise "invalid input value for enum".
