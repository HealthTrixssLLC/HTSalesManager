---
name: External PATCH API rules
description: Constraints and stubs in the Phase E controlled PATCH endpoints
---
- Mutable-field allowlists + immutable list are the source of truth in `server/external-patch-config.ts`; array columns (opportunity categories/operationalAreas) are excluded because Drizzle can't set text[] reliably (updateOpportunity uses raw SQL for those).
- Relationship fields must be tenant-safe: PATCHed `accountId` must belong to the record's org; `ownerId` must have a `user_organizations` membership in that org. Code review rejects work that skips these checks.
- **Why:** cross-tenant links are a security violation flagged by completion review; keep parity with internal create/update routes (incl. opportunity date invariants validated against the merged record).
- Phase F stub: an API key is treated as read-only if its name/description contains "[read-only]". Replace with a real permissions column in Phase F.
