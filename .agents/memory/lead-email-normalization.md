---
name: Lead email normalization
description: Business rule and implementation for how blank/whitespace lead emails are handled across all write paths and the DB index.
---

## Rule
A blank, empty, or whitespace-only lead email means "no email" and must be stored as NULL. NULL emails do not participate in uniqueness — multiple leads without a meaningful email are allowed in the same org.

## Implementation
- `server/lib/normalize-email.ts` exports `normalizeEmail(email)`:  trims whitespace, returns null for empty/null/undefined.
- Applied in: `db.ts` `createLead`, `updateLead` (when email key present), `patchLead` (when email key present), `lead-gen-routes.ts` direct insert.
- External API POST: Zod `.trim().email()` already handles blank rejection (400) and padded-email trimming; `normalizeEmail` applied before dedup check and to createLead call for defense-in-depth.
- External PATCH: Zod `.trim().email().nullable()` handles validation; `patchLead` normalizes anyway.

## DB index
```sql
CREATE UNIQUE INDEX leads_org_email_unique_idx
  ON leads (organization_id, lower(BTRIM(email)))
  WHERE NULLIF(BTRIM(email), '') IS NOT NULL;
```
Defined in `shared/schema.ts` (`orgEmailUnique`) and recreated by `scripts/migrate-lead-email-unique.ts`.

**Why:** `'' IS NOT NULL` is TRUE, so storing blank strings as emails broke uniqueness. BTRIM+NULLIF correctly excludes blank/whitespace strings from uniqueness enforcement.

## How to apply
- Before any deployment, run `npx tsx scripts/migrate-lead-email-unique.ts` to normalize blanks → NULL and create/recreate the index.
- The migration is idempotent; re-runs are safe.
