# External API Enhancement Roadmap — Final Implementation Report

**Date:** 2026-08-17
**Scope:** Phases A–H of the External API enhancement roadmap, validated as a whole (Phase I gate).
**Baseline commit:** `75796fc` ("Git commit prior to merge") → **HEAD** `dba3f7d` (Phase H) + gate fixes.

---

## IMPLEMENTED

Every roadmap phase is confirmed present in code:

| Phase | Deliverable | Evidence |
|---|---|---|
| A | Activity Read API: `GET /activities` (org-scoped list, `activities.read` scope, filters `relatedType`, `relatedId`, `type`, `status`, `priority`, `dueBefore`/`dueAfter` on `dueAt`, `updatedSince`, `limit`, `offset`) and `GET /activities/:id` (org-scoped detail; cross-org and missing records both 404) | `server/external-api-routes.ts` activity read section, `server/db.ts` (`getActivities`, org-scoped `getActivityById`); `tests/external-activity-api.test.ts` |
| B | Server-side list filters (accounts `search`/`name`; opportunities `search`, `accountId`, `status`, `stage`, `ownerId`, `rating`; contacts `search`, `email`, `accountId`; leads `search`, `email`, `status`, `rating`, `source`), strict ISO 8601 validation, enum validation | `server/external-api-routes.ts` (`qs`, `parseDateParam`, `parseEnumParam`), `server/storage.ts` filters; `tests/external-list-filters.test.ts` |
| C | Opportunity-contact relationship model: join table, roles, single primary, link/unlink endpoints, `expand=contacts` on opportunity detail | `migrations/0013_opportunity_contacts.sql`, `POST /opportunities/:id/contacts`, `DELETE /opportunities/:id/contacts/:contactId`; `tests/opportunity-contacts-api.test.ts` |
| D | Document reference model (`documents` + `document_links`), DOC-* IDs, five endpoints, `documents.read`/`documents.write` scopes, credential-safe `canonicalUrl` guard | `migrations/0015_add_documents.sql`, `server/external-api-routes.ts` document section; `tests/external-documents-api.test.ts` |
| E | Controlled PATCH API: per-entity allowlists, immutable-field rejection, tenant-safe `accountId`/`ownerId` validation, opportunity date invariants | `server/external-patch-config.ts`, PATCH loop in `server/external-api-routes.ts`; `tests/external-patch-api.test.ts` |
| F | API key permission scopes: `permissions` column (NULL legacy = full access, `[]` = zero scopes), `requirePermission` middleware, guards on every external route, Admin Console read-only toggle | `migrations/0014_add_api_key_permissions.sql`, `server/api-key-auth.ts`, `client/src/pages/admin-console.tsx`; `tests/api-key-permissions.test.ts` |
| G | Comprehensive test matrix: field shapes, expands, pagination, cross-tenant isolation, rate-limit 429, `GET /logs` scoping | `tests/external-api-matrix.test.ts`, serialized `tests/vitest.server.config.ts` |
| H | Authoritative docs: OpenAPI 3.1 spec, implementation guide, corrected legacy guides, canonical ID prefixes | `docs/openapi.yaml`, `docs/API_IMPLEMENTATION_GUIDE.md`, `API_DOCUMENTATION.md`, `INTEGRATION_GUIDE.md` |

## MIGRATIONS

Migration files added by the roadmap, in apply order (all verified applied to the development database; each is idempotent — `IF NOT EXISTS` / guarded `DO` blocks):

1. **`migrations/0013_opportunity_contacts.sql`** — creates `opportunity_contacts` join table (opportunity_id, contact_id, role enum, is_primary) with unique (opportunity, contact) pair, partial unique index enforcing one primary per opportunity, and lookup indexes.
2. **`migrations/0014_add_api_key_permissions.sql`** — adds `api_keys.permissions text[]` (NULL = legacy full access; empty array = zero scopes).
3. **`migrations/0015_add_documents.sql`** — creates `documents` (org-scoped external references with canonical_url) and `document_links` (unique document/entityType/entityId pair) with org and lookup indexes.

Additionally, `scripts/migrate-lead-email-unique.ts` (Phase-era data migration) deduplicates lead emails per org and creates the partial unique index `leads_org_email_unique_idx ON leads (organization_id, lower(email)) WHERE email IS NOT NULL`, which the concurrent-lead-dedup race handling in `POST /leads` depends on.

**Gate finding (fixed during validation):** the development database was missing `opportunity_contacts` and `leads_org_email_unique_idx` (drift from a rebase/merge). Both were applied during this gate; the full suite then passed. Deployment must ensure both are applied (see DEPLOYMENT ORDER).

## BACKWARD COMPATIBILITY

- The API remains versioned under `/api/v1/external`; **no existing route was removed or renamed** and no response field was removed or retyped.
- Existing keys: keys created before the scopes column have `permissions = NULL` and are treated as having **all** scopes — existing callers are unaffected. An explicit empty scope list grants nothing (never promoted to full access).
- New capabilities are additive: new endpoints (PATCH, contact links, activities write, documents), new optional query filters, new expand targets, new response fields on opportunities (`implementationStartDate`, `implementationEndDate`, `billingEndDate`).
- Stable contracts unchanged: pagination envelope, error envelope, `updatedSince` semantics, ID prefixes, `x-api-key` auth, `RateLimit-*` headers.
- **No breaking changes identified.**

## SECURITY

- **No secrets committed** — scan of tracked files for `htcrm_` keys, AWS keys, private keys, and `.env` files found only documented placeholders (`.env.example`, doc examples such as `htcrm_xxxxxxxx…`, and intentionally invalid test keys). No real credentials.
- **Cross-tenant isolation** — verified by `tests/external-api-matrix.test.ts` (isolation matrix), `tests/opportunity-contacts-api.test.ts` (cross-org link → 404, no info leak), `tests/external-documents-api.test.ts`, and `tests/external-patch-api.test.ts` (cross-org PATCH/reference → 404). All passing.
- **Read-only key enforcement** — `tests/api-key-permissions.test.ts` verifies keys lacking `crm.write` / `activities.write` / `documents.write` receive 403 with `requiredPermission` on every mutation route; empty scope lists can do nothing.
- **Immutable-field protection** — PATCH rejects `id`, `organizationId`, `createdAt`, `updatedAt`, `sourceSystem`, `sourceRecordId`, `importStatus`, `importNotes`, and unknown fields with 400 + `rejectedFields` (`tests/external-patch-api.test.ts`).
- **canonicalUrl guard** — document URLs embedding credentials or signed/temporary parameters (`X-Amz-Signature`, `sig`, `token`, `auth`, `key`, …) are rejected with 400 (`tests/external-documents-api.test.ts`).
- Every external route carries an explicit `requirePermission(...)` guard; auth attempts and all requests (including 429s) are audit-logged.

## TEST RESULTS

`DISABLE_RATE_LIMITING=true npx vitest run --config tests/vitest.server.config.ts` (final run, after gate fixes):

```
 Test Files  10 passed (10)
      Tests  184 passed (184)
   Duration  220.93s
```

Suites: api-key-permissions, external-api-matrix, external-documents-api, external-lead-api, external-list-filters, external-patch-api, lead-gen-approval, opportunity-activity-creation, opportunity-contacts-api, password-reset / permissions.

Typecheck (`npx tsc --noEmit`): **167 pre-existing errors, identical to the pre-roadmap baseline commit** (verified by running tsc on a worktree at `75796fc`). The roadmap introduced **one** new error (Neon drizzle pool type at `server/db.ts:63`), fixed during this gate by constructing the Neon branch's pool with `@neondatabase/serverless`'s `Pool`. Zero *new* errors remain. There is no `npm run lint` script; `npm run check` (tsc) is the project's static check.

OpenAPI validation (`npx @redocly/cli lint docs/openapi.yaml`): **valid** — 0 errors, 10 warnings (all `no-invalid-media-type-examples` on illustrative error-response examples).

## API CHANGES

Registered routes in `server/external-api-routes.ts`, **before** (baseline `75796fc`) vs **after**:

**Before (11 routes, read-mostly):**
```
GET  /accounts            GET  /accounts/:id
GET  /opportunities       GET  /opportunities/:id
GET  /contacts            GET  /contacts/:id
GET  /leads               GET  /leads/:id       POST /leads
POST /activities          GET  /logs
```

**Added by the roadmap (13 new routes):**
```
GET    /activities
GET    /activities/:id
PATCH  /accounts/:id
PATCH  /contacts/:id
PATCH  /leads/:id
PATCH  /opportunities/:id
PATCH  /activities/:id
POST   /opportunities/:id/contacts
DELETE /opportunities/:id/contacts/:contactId
POST   /documents
GET    /documents
GET    /documents/:id
POST   /documents/:id/links
DELETE /documents/:id/links/:entityType/:entityId
```

Total: **24 registered routes**, all guarded by `requirePermission(...)` (baseline had no scope guards). All 24 routes are documented in `docs/openapi.yaml`; path-by-path comparison found **no mismatch in either direction**.

## NOT IMPLEMENTED

- Nothing. Phase A (Activity Read API) — the last outstanding phase — is now implemented: `GET /activities` and `GET /activities/:id` guarded by `activities.read`, org-scoped-key required, with the full filter set (`relatedType`, `relatedId`, `type`, `status`, `priority`, `dueBefore`, `dueAfter`, `updatedSince`, `limit`, `offset`), documented in `docs/openapi.yaml`, and covered by `tests/external-activity-api.test.ts`. All phases A–H of the approval document are implemented.

## FILES CHANGED

34 files changed across Phases A–H (`git diff --name-only 75796fc..HEAD`), plus the gate fix:

- **Server:** `server/api-key-auth.ts`, `server/db.ts` (also gate-fixed: Neon pool type), `server/external-api-routes.ts`, `server/external-patch-config.ts` (new), `server/routes.ts`, `server/seed.ts`, `server/storage.ts`
- **Schema/migrations:** `shared/schema.ts`, `migrations/0013_opportunity_contacts.sql`, `migrations/0014_add_api_key_permissions.sql`, `migrations/0015_add_documents.sql`
- **Client:** `client/src/pages/accounts-page.tsx`, `client/src/pages/admin-console.tsx`, `client/src/pages/help-page.tsx`
- **Docs:** `docs/openapi.yaml` (new), `docs/API_IMPLEMENTATION_GUIDE.md` (new), `docs/EXTERNAL_LEAD_API_GUIDE.md`, `API_DOCUMENTATION.md`, `INTEGRATION_GUIDE.md`, `DYNAMICS_IMPORT_GUIDE.md`, `docs/IMPLEMENTATION_REPORT.md` (this file)
- **Tests:** `tests/api-key-permissions.test.ts`, `tests/external-api-matrix.test.ts`, `tests/external-documents-api.test.ts`, `tests/external-list-filters.test.ts`, `tests/external-patch-api.test.ts`, `tests/opportunity-contacts-api.test.ts`, `tests/run-documents-api-tests.sh`, `tests/run-opportunity-contacts-tests.sh`, `tests/vitest.server.config.ts`
- **Config/other:** `package.json`, `.replit`, `.agents/memory/*`

## DEPLOYMENT ORDER

All schema changes are additive, so a zero-downtime deploy is straightforward:

1. **Apply migrations first, in order:** `0013_opportunity_contacts.sql` → `0014_add_api_key_permissions.sql` → `0015_add_documents.sql`. Each is idempotent; old code runs unaffected against the new schema.
2. **Run the lead-email data migration:** `npx tsx scripts/migrate-lead-email-unique.ts` (dedupes existing lead emails per org, then creates `leads_org_email_unique_idx`). Must complete before new code serves traffic, because the new `POST /leads` race handling relies on this index. (The server's idempotent startup migration also covers `api_keys.permissions` for pre-Phase-F deployments.)
3. **Deploy code** (server + client bundle together — they ship as one artifact).
4. **Post-deploy checks:** hit `GET /api/v1/external/accounts` with an existing key (legacy NULL-permissions keys must still work); confirm a scoped read-only key gets 403 on a PATCH; confirm `GET /documents` for an org-scoped key.

No downtime window is required; do not deploy code before step 1–2 complete.

## MCP IMPACT

**The MCP server was not modified.** No MCP-related source file appears in the Phase A–H changeset (`git diff 75796fc..HEAD`), and no file under `server/` importing `@modelcontextprotocol/sdk` was touched. MCP was explicitly out of scope per the approval document, and that boundary was respected.
