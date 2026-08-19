# External API — Tag & Write Integration Guide

A consumer-agnostic guide to the Health Trixss CRM External API (`/api/v1/external`), covering authentication, reads, controlled writes, tagging, concurrency control, idempotency, and error handling. All examples use `curl`; any HTTP client works the same way.

Base URL used in examples: `https://crm.example.com/api/v1/external`. The machine-readable contract is [`docs/openapi.yaml`](./openapi.yaml).

---

## 1. Authentication

Every request must carry an API key in the `x-api-key` header. Keys are generated in Admin Console → API Keys and shown only once at creation.

```bash
curl -H "x-api-key: $KEY" https://crm.example.com/api/v1/external/accounts
```

Missing, malformed, revoked, or expired keys return `401`.

## 2. Key types: system vs organization-scoped

- **Organization-scoped keys** see only their organization's data. All tag routes, and the contacts, leads, and activities endpoints, require an org-scoped key.
- **System keys** (not bound to an organization) may read accounts and opportunities across all organizations, and may PATCH records in any org. Org-restricted routes return `403` with `error: "Organization-bound API key required"` and `code: INSUFFICIENT_SCOPE`.

## 3. Permission scopes

Each key carries permission scopes; routes enforce them:

| Scope | Grants |
|---|---|
| `crm.read` | All CRM GET endpoints (accounts, opportunities, contacts, leads, tags, logs) |
| `crm.write` | POST /leads, POST /accounts, POST /contacts, POST /opportunities, POST /leads/:id/convert, PATCH accounts/contacts/leads/opportunities, tag management & CRM tag assignment, opportunity-contact links, CRM comments |
| `activities.read` | GET activities and activity tags |
| `activities.write` | POST/PATCH activities, activity tag assignment/removal |
| `documents.read` / `documents.write` | Document reference reads / writes |

A missing scope returns `403` with `requiredPermission` and `code: INSUFFICIENT_SCOPE`. Legacy keys with no explicit scopes have all scopes; an explicitly empty scope list grants nothing.

## 4. Organization isolation

Org-scoped keys can never read or modify another organization's records. Cross-org records are indistinguishable from missing ones: both return `404` (no existence leak). Cross-org related references (e.g. `accountId`, `ownerId`, tag IDs) are rejected with `404` as well.

## 5. Record IDs

Canonical prefixes: Account `ACCT-*`, Contact `CONT-*`, Lead `LEAD-*`, Opportunity `OPP-*`, Activity `ACT-*`, Document `DOC-*`. Tag IDs are UUIDs.

## 6. Response envelope & pagination

Reads return `{ "data": ... }`; lists add `{ "pagination": { total, limit, offset, hasMore } }`. `limit` defaults to 100 (max 1000), `offset` defaults to 0. `total` reflects all applied filters.

```bash
curl -H "x-api-key: $KEY" "https://crm.example.com/api/v1/external/opportunities?limit=50&offset=50"
```

## 7. Incremental sync

Every list endpoint supports `updatedSince` (strict ISO 8601 timestamp with time component, e.g. `2026-08-01T00:00:00Z`). Only records with `updatedAt` strictly after the instant are returned. Invalid timestamps return `400`.

## 8. List filtering

Entity-specific filters (see the OpenAPI spec for the full set): `search`/`name`, `email`, `accountId`, `stage`, `status`, `rating`, `source`, `ownerId`, `includeInForecast`, activity `type`/`status`/`priority`/`relatedType`/`relatedId`/`dueBefore`/`dueAfter`. Invalid enum or date values return `400` listing the allowed values.

## 9. Expansion

Detail endpoints accept `expand` (comma-separated): `opportunities`, `contacts`, `account`, `resources`, `tags` depending on entity. Example:

```bash
curl -H "x-api-key: $KEY" "https://crm.example.com/api/v1/external/accounts/ACCT-2025-00001?expand=opportunities,tags"
```

## 10. Monetary values

`amount`, `actualRevenue`, `estRevenue` are decimal strings in currency units with 2-decimal precision (e.g. `"150000.00"`) — **not** integer cents.

## 11. Tag model

Tags are organization-scoped labels: `{ id, name, color }`. Names are normalized (trimmed, internal whitespace collapsed) and unique per org, case-insensitively. Tags are **optional metadata**: no create or PATCH operation ever requires tag fields, and ordinary record writes never create, assign, or remove tags.

## 12. Listing & searching tags

```bash
curl -H "x-api-key: $KEY" "https://crm.example.com/api/v1/external/tags?search=priority&limit=50"
```

`search` is a case-insensitive substring match. Requires `crm.read` + org-scoped key.

## 13. Creating tags

```bash
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"priority"}' https://crm.example.com/api/v1/external/tags
```

`201` with the tag; a duplicate (case-insensitive) name returns `409` with `code: TAG_ALREADY_EXISTS` and `existingTagId`, which the consumer can use directly.

## 14. Assigning tags to records

All five entity types support `POST /{entity}/{id}/tags` with **either** `tagId` **or** `name` (exactly one):

```bash
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"priority"}' https://crm.example.com/api/v1/external/opportunities/OPP-2025-000001/tags
```

Returns the record's current tag list. Assignment is idempotent (re-assigning is a no-op). **Tags are never auto-created**: an unknown `name` returns `404` — create the tag first (§13).

## 15. Reading a record's tags

```bash
curl -H "x-api-key: $KEY" https://crm.example.com/api/v1/external/leads/LEAD-000042/tags
```

Or use `expand=tags` on the detail endpoint to fetch record + tags in one call.

## 16. Removing tags

```bash
curl -X DELETE -H "x-api-key: $KEY" \
  https://crm.example.com/api/v1/external/accounts/ACCT-2025-00001/tags/$TAG_ID
```

`204`, idempotent (removing a non-existent assignment is still `204`). Unknown/cross-org tag or record → `404`.

## 17. Filtering lists by tag

Every list endpoint accepts `tag=<name>` or `tagId=<id>` (mutually exclusive — both at once is `400`). Unknown names/IDs return `404`. Pagination `total` reflects the tag filter.

```bash
curl -H "x-api-key: $KEY" "https://crm.example.com/api/v1/external/contacts?tag=priority"
```

## 18. Controlled PATCH — field rules

`PATCH /{entity}/{id}` performs strict partial updates:

- Only allowlisted mutable fields are accepted (see the OpenAPI `*Patch` schemas).
- Immutable fields (`id`, `organizationId`, `createdAt`, `updatedAt`, `sourceSystem`, `sourceRecordId`, `importStatus`, `importNotes`) → `400` with `rejectedFields`.
- Unknown fields → `400` with `rejectedFields` and `allowedFields`.
- Empty body → `400`. All PATCH validation errors carry `code: VALIDATION_ERROR`.
- Related references are org-checked: cross-org `accountId` or non-member `ownerId` → `404`.
- Opportunity date invariants are validated against the *merged* record: `implementationStartDate ≤ implementationEndDate`, and `billingEndDate` not before `implementationEndDate`.

```bash
curl -X PATCH -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"stage":"negotiation","probability":80}' \
  https://crm.example.com/api/v1/external/opportunities/OPP-2025-000001
```

## 19. Optimistic concurrency — ETag / If-Match workflow

Every detail GET and successful PATCH returns a strong `ETag` header, mirrored as `_version` in the payload. To avoid overwriting concurrent changes, use the conditional PATCH procedure:

```bash
# 1. GET the record and extract the ETag
ETAG=$(curl -s -D - -o /tmp/rec.json -H "x-api-key: $KEY" \
  https://crm.example.com/api/v1/external/contacts/CONT-2511-00001 \
  | awk 'BEGIN{IGNORECASE=1} /^etag:/ {print $2}' | tr -d '\r')

# 2. PATCH with If-Match
curl -X PATCH -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -H "If-Match: $ETAG" -d '{"title":"SVP of Operations"}' \
  https://crm.example.com/api/v1/external/contacts/CONT-2511-00001

# 3. Verify: 200 → success (response carries the new ETag);
#    412 → record changed; re-GET (or use body.currentVersion), re-merge, retry.
```

Rules (RFC 9110, strong comparison): quoted tags only; weak validators (`W/"..."`), bare unquoted tokens, and malformed lists always fail with `412 STALE_RECORD`; `If-Match: *` matches any current version; omitting `If-Match` makes the PATCH unconditional (last-write-wins). Version checks are atomic — under two concurrent conditional PATCHes with the same version, exactly one wins. Internal CRM edits also advance the version, so stale external tokens are always detected.

## 20. Creating activities

```bash
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"type":"call","subject":"Discovery call","status":"completed","relatedType":"Lead","relatedId":"LEAD-000042"}' \
  https://crm.example.com/api/v1/external/activities
```

Requires `activities.write` + org-scoped key. `relatedType`/`relatedId` must be provided together and reference an in-org record (`404` otherwise); the activity then appears on that record's timeline. `status` defaults to `completed`, `priority` to `medium`.

## 21. Activity idempotency (`externalId`)

Add an optional `externalId` (unique per organization) to make creation retry-safe:

```bash
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"type":"call","subject":"Discovery call","externalId":"sync-2026-08-18-001"}' \
  https://crm.example.com/api/v1/external/activities
```

- First request → `201` with the new activity.
- Replay with the same `externalId` and same `type` + `subject` → `200` with the **original** record; nothing new is created. The claim is atomic, so concurrent retries can never create duplicates.
- Same `externalId` but different `type` or `subject` → `409` with `code: IDEMPOTENCY_CONFLICT` and `existingActivityId` — a signal of token reuse, not a retry situation.

Recommended pattern for sync pipelines: derive `externalId` deterministically from the source event ID.

## 22. Creating leads (with duplicate detection)

```bash
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"firstName":"John","lastName":"Doe","email":"john@example.com","source":"website"}' \
  https://crm.example.com/api/v1/external/leads
```

`201` on creation. If a lead with the same email (case-insensitive) already exists in the org, nothing is created and the existing lead is returned with `200` and `duplicate: true`.

## 23. Error catalog

Every error is JSON with a legacy `error` string, usually a `message`, and (on write endpoints, permission failures, and rate limiting) a stable machine-readable `code`:

| HTTP | `code` | Meaning | Extra fields |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad payload/parameter, immutable/unknown/empty PATCH body | `details`, `rejectedFields`, `allowedFields` |
| 401 | — | Missing/invalid API key | |
| 403 | `INSUFFICIENT_SCOPE` | Missing permission scope or org binding | `requiredPermission` |
| 404 | `NOT_FOUND` | Missing or cross-org record/tag/related reference | |
| 409 | `TAG_ALREADY_EXISTS` | Duplicate tag name in org | `existingTagId` |
| 409 | `IDEMPOTENCY_CONFLICT` | `externalId` reused with different type/subject | `existingActivityId` |
| 412 | `STALE_RECORD` | `If-Match` precondition failed | `currentVersion` |
| 429 | `RATE_LIMITED` | Per-key rate limit exceeded | `Retry-After` header |
| 500 | — | Server error | |

Branch on `code` when present; treat it as optional on older read-endpoint errors and fall back to HTTP status.

## 24. Rate limiting & retry behavior

Default limit is 100 requests/minute per key (configurable per key). Standard `RateLimit-*` headers are on all responses; `429` responses include `Retry-After` (seconds) and `code: RATE_LIMITED`.

Recommended client policy: on `429`, wait `Retry-After` seconds (or exponential backoff) and retry; on `412`, re-GET and re-merge before retrying; on `409 IDEMPOTENCY_CONFLICT`, do **not** retry — investigate the token collision; on `5xx`, retry idempotent requests (all GETs; POST /activities only when using `externalId`).

## 25. Document references

`POST /documents`, `GET /documents`, `GET /documents/{id}`, and `POST /documents/{id}/links` (scopes `documents.write` / `documents.read`, org-scoped key required) manage external document *references* — metadata plus a canonical URL, not file uploads:

```bash
# Create a document reference
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Signed MSA","canonicalUrl":"https://files.example.com/msa.pdf","documentType":"contract"}' \
  https://crm.example.com/api/v1/external/documents

# Link it to a CRM record
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"entityType":"Opportunity","entityId":"OPP-2025-000001"}' \
  https://crm.example.com/api/v1/external/documents/$DOC_ID/links
```

Links must reference an in-org record (`404` for cross-org or missing records). **URL safety:** `canonicalUrl` must be a stable, non-credential URL — embedded credentials (`user:pass@host`) and query/fragment parameters that look like tokens, signatures, or keys (`token`, `signature`, `api_key`, `session`, …) are rejected with `400`. Never place secrets or signed temporary URLs in a document reference. Note: document-endpoint errors currently return the legacy shape without a `code` field.

## 26. Post-write verification

After any write, verify from the response and/or a follow-up read:

1. **PATCH** — the `200` body is the full updated row; confirm the changed fields and store the new `ETag`/`_version`.
2. **Activity create** — `201` vs `200` distinguishes "created" from "idempotent replay"; the body carries the canonical `id` and `externalId`.
3. **Tag operations** — assignment responses return the record's current tag list; `GET /{entity}/{id}/tags` (or `expand=tags`) confirms state.
4. **Audit trail** — `GET /logs` returns the key's own API access logs (status codes, latency, endpoints) for reconciliation and debugging.

```bash
curl -H "x-api-key: $KEY" "https://crm.example.com/api/v1/external/logs?status=412&limit=20"
```
