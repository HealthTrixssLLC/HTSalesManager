# External API — Integration Readiness Matrix

Classification of the 28 required External API capabilities for third-party integration readiness.

**Criteria** — a capability is **READY** only when it is all four of:
1. **Implemented** in `server/external-api-routes.ts` (and supporting modules)
2. **Tested** by an automated suite under `tests/`
3. **Documented** in `docs/openapi.yaml` and the [integration guide](./EXTERNAL_API_TAG_AND_WRITE_INTEGRATION_GUIDE.md)
4. **Security validated** (org isolation, scope enforcement, or equivalent covered by tests)

Statuses: **READY** / **PARTIALLY READY** / **BLOCKED**.

| # | Capability | Status | Evidence / Reason |
|---|---|---|---|
| 1 | API-key authentication (`x-api-key`, 401 handling) | READY | All suites exercise 401 paths; documented in spec `securitySchemes` |
| 2 | Permission scopes (`crm.*`, `activities.*`, `documents.*`) with 403 + `requiredPermission` | READY | Scope-denial tests in every suite; `INSUFFICIENT_SCOPE` code |
| 3 | System vs org-scoped key model (org-bound-required routes) | READY | 403 org-bound tests (tags, contacts, leads, activities) |
| 4 | Organization isolation on reads (404 without existence leak) | READY | Cross-org 404 tests in activity, tag, and PATCH suites |
| 5 | Organization isolation on writes (cross-org related refs rejected) | READY | Cross-tenant `accountId`/`ownerId`/tag tests in PATCH & tag suites |
| 6 | Account list/detail reads with filters & expand | READY | `external-list-filters` suite; spec documents params |
| 7 | Opportunity list/detail reads with filters & expand | READY | Same as above, incl. `includeInForecast` semantics |
| 8 | Contact list/detail reads with filters & expand | READY | `external-list-filters` suite |
| 9 | Lead list/detail reads with filters | READY | `external-list-filters` suite |
| 10 | Activity list/detail reads with full filter set (type/status/priority/related/due/updatedSince) | READY | `external-activity-api` suite (29 tests) |
| 11 | Pagination envelope (`total`/`limit`/`offset`/`hasMore`, filtered totals) | READY | Pagination tests across list suites |
| 12 | Incremental sync via strict `updatedSince` validation | READY | Invalid-date 400 tests; strict ISO 8601 parser |
| 13 | Lead creation with case-insensitive email duplicate detection | READY | Lead API tests; `duplicate: true` contract documented |
| 14 | Activity creation with related-record linking & timeline association | READY | `opportunity-activity-creation` + activity suites |
| 15 | Activity creation idempotency (`externalId`, atomic claim, 200 replay / 409 conflict) | READY | `external-activity-idempotency` suite (17 tests incl. concurrency races) |
| 16 | Controlled PATCH: mutable-field allowlists + immutable/unknown rejection (all 5 entities) | READY | `external-patch-api` suite; allowlists in `external-patch-config.ts` |
| 17 | PATCH merged-record invariants (opportunity date rules) | READY | Merged-state validation tests |
| 18 | Optimistic concurrency: ETag/`_version` on detail GETs | READY | ETag exposure tests; documented headers |
| 19 | Conditional PATCH via `If-Match` (strong RFC 9110 comparison, 412 `STALE_RECORD`, atomic race behavior) | READY | 14 ETag tests incl. concurrent one-winner and malformed-header cases |
| 20 | Version invalidation from internal edits (CRM UI, merges, conversions, backfills) | READY | Internal-edit invalidation tests in PATCH suite |
| 21 | Tag management (list/search/create, org-unique normalized names, 409 duplicate) | READY | `external-api-tags` suite (47+ tests) |
| 22 | Tag assignment/removal on all 5 entities (idempotent, no auto-create) | READY | Per-entity assignment tests; no-auto-create regression tests |
| 23 | Tag list filtering (`tag`/`tagId`) and `expand=tags` | READY | Filter + expand tests per entity |
| 24 | Tags remain optional for all record operations (creates/PATCHes never require or mutate tags) | READY | Dedicated "tags stay optional" regression block in `external-api-tags` |
| 25 | Machine-readable error codes (`code` field: VALIDATION_ERROR … RATE_LIMITED) | PARTIALLY READY | Implemented + tested + documented on tag, PATCH, lead-creation, and activity-creation errors plus permission failures and rate limiting; **legacy read-endpoint validation errors (invalid enum/date query params) and document-endpoint errors still omit `code`** — tracked as a follow-up task |
| 26 | Rate limiting (per-key limits, `RateLimit-*` headers, 429 + `Retry-After` + `RATE_LIMITED`) | READY | 429 tests with per-key limiter active; documented retry policy |
| 27 | Document references (create/list/get, entity links, credential-bearing URL rejection) | READY | Document API tests; URL-safety validation documented in the spec and integration guide (§25); errors lack `code` (rolled into #25's partial) |
| 28 | API access logs (`GET /logs`, per-key self-scoping, filterable) | READY | Log endpoint tests; per-key isolation enforced server-side |
| 29 | Create account/contact/opportunity (`POST`, org key, optional externalId idempotency) | READY | `tests/external-create-api.test.ts` |
| 30 | Lead conversion (`POST /leads/:id/convert`, transactional, canonical IDs on writes) | READY | `tests/external-convert-api.test.ts` |
| 31 | Comments list/create on account, contact, lead, opportunity, activity | READY | `tests/external-comments-api.test.ts` |
| 32 | Read-only legacy ID on detail GET + CRM search; no write aliasing | READY | `tests/external-legacy-id.test.ts` |

## Summary

- **READY: 31 / 32** (item 25 remains PARTIALLY READY)
- **PARTIALLY READY: 1 / 28** — #25 (error-code coverage on legacy read-endpoint validation errors and document endpoints); additive-only, no breaking impact; clients must already treat `code` as optional per the integration guide.
- **BLOCKED: 0 / 28**

The External API is integration-ready for third-party consumers. The single partial item does not affect any write path or safety mechanism.
