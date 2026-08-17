# External API — Implementation Guide

Developer-facing guide to the Health Trixss CRM External API (`/api/v1/external`).
The canonical machine-readable contract is [`docs/openapi.yaml`](./openapi.yaml)
(OpenAPI 3.1). Every endpoint documented here is verifiable against
`server/external-api-routes.ts`.

**Base URL:** `https://<your-crm-domain>/api/v1/external`

---

## 1. Authentication

Every request must include an API key in the `x-api-key` header:

```bash
curl -H "x-api-key: htcrm_your_key_here" \
  "https://<your-crm-domain>/api/v1/external/accounts"
```

- Keys are created in **Admin Console → API Keys** and are displayed **only once**
  at creation. Store them securely (secret manager / environment variable).
- Key format: `htcrm_` prefix + URL-safe random value (~49 chars total).
- Keys are stored server-side as bcrypt hashes; a lost key cannot be recovered.
- Keys can be **revoked** (deactivated) and can carry an **expiration date**.
  Requests with a revoked or expired key return `401`.

401 responses you may see:

| `error` | Cause |
|---|---|
| `API key required` | Header missing |
| `Invalid API key format` | Key doesn't start with `htcrm_` |
| `Invalid API key` | Key not found |
| `API key revoked` | Key deactivated |
| `API key expired` | Past its expiration date |

All authentication attempts (success and failure) are recorded in the audit log.

## 2. Permission scopes

Each key carries a list of permission scopes, enforced per route:

| Scope | Grants |
|---|---|
| `crm.read` | All GET endpoints: accounts, opportunities, contacts, leads, logs |
| `crm.write` | `POST /leads`, `PATCH` on accounts/contacts/leads/opportunities, `POST`/`DELETE` opportunity-contact links |
| `activities.read` | `GET /activities`, `GET /activities/:id` |
| `activities.write` | `POST /activities`, `PATCH /activities/:id` |
| `documents.read` | `GET /documents`, `GET /documents/:id` |
| `documents.write` | `POST /documents`, `POST /documents/:id/links`, `DELETE /documents/:id/links/:entityType/:entityId` |

- A missing scope returns `403` with `requiredPermission` naming the scope.
- **Legacy keys** created before scopes existed (`permissions = NULL`) are
  treated as having **all** scopes.
- A key with an **explicit empty scope list** can do **nothing** — empty is
  never promoted to full access.

## 3. Tenant scoping

Two kinds of keys:

- **System keys** (no organization binding): may read **accounts** and
  **opportunities** across all organizations.
- **Organization-scoped keys**: all reads and writes are confined to the key's
  organization.

Endpoints that **require** an org-scoped key (system keys get `403
Organization-bound API key required`): contact reads (`GET /contacts`,
`GET /contacts/:id`), lead reads and creation (`GET /leads`, `GET /leads/:id`,
`POST /leads`), activity reads and creation (`GET /activities`,
`GET /activities/:id`, `POST /activities`), and document routes. The PATCH routes (including
`PATCH /contacts/:id` and `PATCH /leads/:id`) accept system keys — but an
org-scoped key can still only modify records in its own organization.

Cross-org records are indistinguishable from missing records: you always get
`404`, never a permission hint. Writes (PATCH, contact links, activities) also
validate that any referenced record (`accountId`, `ownerId`, `relatedId`,
`contactId`) belongs to the same organization as the target record — a
cross-org reference returns `404`.

## 4. Record IDs

Human-readable IDs with canonical entity prefixes:

| Entity | Prefix | Pattern | Example |
|---|---|---|---|
| Account | `ACCT-` | `ACCT-{YYYY}-{seq:5}` | `ACCT-2025-00001` |
| Contact | `CONT-` | `CONT-{YY}{MM}-{seq:5}` | `CONT-2511-00001` |
| Lead | `LEAD-` | `LEAD-{seq:6}` | `LEAD-000042` |
| Opportunity | `OPP-` | `OPP-{YYYY}-{seq:6}` | `OPP-2025-000001` |
| Activity | `ACT-` | `ACT-{YY}{MM}-{seq:5}` | `ACT-2608-00099` |
| Document | `DOC-` | `DOC-{seq:6}` | `DOC-000001` |

User IDs (`ownerId`, resource `userId`) are UUID **strings**, not numbers.

## 5. Endpoints

| Method | Path | Scope | Org key? | Purpose |
|---|---|---|---|---|
| GET | `/accounts` | crm.read | optional | List accounts |
| GET | `/accounts/:id` | crm.read | optional | Account detail |
| PATCH | `/accounts/:id` | crm.write | optional* | Partial update |
| GET | `/opportunities` | crm.read | optional | List opportunities |
| GET | `/opportunities/:id` | crm.read | optional | Opportunity detail |
| PATCH | `/opportunities/:id` | crm.write | optional* | Partial update |
| POST | `/opportunities/:id/contacts` | crm.write | optional* | Link a contact |
| DELETE | `/opportunities/:id/contacts/:contactId` | crm.write | optional* | Unlink a contact |
| GET | `/contacts` | crm.read | **required** | List contacts |
| GET | `/contacts/:id` | crm.read | **required** | Contact detail |
| PATCH | `/contacts/:id` | crm.write | optional* | Partial update |
| POST | `/leads` | crm.write | **required** | Create lead (dedup by email) |
| GET | `/leads` | crm.read | **required** | List leads |
| GET | `/leads/:id` | crm.read | **required** | Lead detail |
| PATCH | `/leads/:id` | crm.write | optional* | Partial update |
| GET | `/activities` | activities.read | **required** | List activities |
| GET | `/activities/:id` | activities.read | **required** | Activity detail |
| POST | `/activities` | activities.write | **required** | Create activity |
| PATCH | `/activities/:id` | activities.write | optional* | Partial update |
| POST | `/documents` | documents.write | **required** | Create document reference |
| GET | `/documents` | documents.read | **required** | List document references |
| GET | `/documents/:id` | documents.read | **required** | Document detail (with links) |
| POST | `/documents/:id/links` | documents.write | **required** | Link document to an entity |
| DELETE | `/documents/:id/links/:entityType/:entityId` | documents.write | **required** | Remove a document link |
| GET | `/logs` | crm.read | optional | This key's access logs |

\* "optional" for writes means a system key is accepted, but org-scoped keys
can only touch records in their own organization (`404` otherwise).

**Documents** are *references* (title + canonical URL to an external system),
not file uploads. `canonicalUrl` must be a stable http(s) URL: URLs embedding
credentials, or with signed/temporary query or fragment parameters (e.g.
`X-Amz-Signature`, `sig`, anything containing `token`, `auth`, `key`, ...),
are rejected with `400`. `GET /documents` supports `entityType` +
`entityId` filters (both from `account|opportunity|contact|lead`);
`GET /documents/:id` includes the document's entity `links`. Linking
(`POST /documents/:id/links` with `{entityType, entityId}`) requires the
target entity to exist in the same organization (`404` otherwise); re-linking
an existing pair returns `200` with `created: false` (first creation returns
`201`). Unlinking returns `204`, or `404` if the link does not exist.

## 6. Query parameters & filter semantics

Common to list endpoints:

| Param | Type | Semantics |
|---|---|---|
| `updatedSince` | ISO 8601 | Records with `updatedAt` **strictly after** the timestamp. Invalid values → `400`. Use for incremental sync. |
| `limit` | int | Page size; default 100, clamped to 1–1000. Non-numeric falls back to 100. |
| `offset` | int | Records skipped; default 0; negative values coerced to 0. |
| `expand` | csv | Related entities to embed (see §8). Unknown values are silently ignored. |

Per-entity list filters (applied server-side, before pagination):

| Endpoint | Param | Semantics |
|---|---|---|
| `GET /accounts` | `search`, `name` | Case-insensitive substring match on account name (both behave identically) |
| `GET /opportunities` | `search` | Case-insensitive substring match on opportunity name |
| | `accountId` | Exact match on parent account ID |
| | `status` | Case-insensitive exact match on the free-text status field |
| | `stage` | Enum: `prospecting|qualification|proposal|negotiation|closed_won|closed_lost`; invalid → 400 |
| | `ownerId` | Exact match on owning user's ID |
| | `rating` | Case-insensitive exact match on the free-text rating |
| | `includeInForecast` | `true` (default) only forecast-flagged; `false` only excluded; `all` everything; invalid → 400 |
| `GET /contacts` | `search` | Case-insensitive substring match on "first last" name |
| | `email` | Case-insensitive exact email match |
| | `accountId` | Exact match on parent account ID |
| `GET /leads` | `search` | Case-insensitive substring match on "first last" name or company |
| | `email` | Case-insensitive exact email match |
| | `status` | Enum: `new|contacted|qualified|unqualified|converted`; invalid → 400 |
| | `rating` | Enum: `hot|warm|cold` (case-insensitive); invalid → 400 |
| | `source` | Enum: `website|referral|phone|email|event|partner|lead_generation|other`; invalid → 400 |
| `GET /activities` | `relatedType` | Exact match on the related record type (`Contact|Lead|Account|Opportunity`) |
| | `relatedId` | Exact match on the related record ID |
| | `type` | Enum: `call|email|meeting|task|note`; invalid → 400 |
| | `status` | Enum: `pending|completed|cancelled`; invalid → 400 |
| | `priority` | Enum: `low|medium|high`; invalid → 400 |
| | `dueBefore` | ISO 8601; activities with `dueAt` **strictly before** this instant (no `dueAt` → excluded); invalid → 400 |
| | `dueAfter` | ISO 8601; activities with `dueAt` **strictly after** this instant (no `dueAt` → excluded); invalid → 400 |

Invalid enum values return `400` with a message listing the allowed values.

`GET /logs` supports `startDate`, `endDate` (ISO 8601, inclusive), `status`
(HTTP status code), and `action`
(`auth_success|auth_failure|request_success|request_failure`).

Filtering is applied **before** pagination, so `pagination.total` reflects the
filtered count.

## 7. Pagination

Every list response includes:

```json
"pagination": { "total": 150, "limit": 100, "offset": 0, "hasMore": true }
```

Iterate by incrementing `offset` by `limit` until `hasMore` is `false`.
Offset pagination is not stable under concurrent writes — for sync jobs prefer
`updatedSince` checkpointing over deep offsets.

## 8. Expand behavior

| Endpoint | `expand` values | Embedded shape |
|---|---|---|
| `GET /accounts` | `opportunities` | Forecast-flagged opportunities only (lean shape: id, name, stage, amount, closeDate, probability, implementation/billing dates) |
| `GET /accounts/:id` | `opportunities`, `contacts` | Opportunities as above **plus `rating`**; contacts (id, name, email, phone, mobile, title) |
| `GET /opportunities` | `account`, `resources` | Account (id, name, accountNumber, type, category); resources (userId, role, allocationPercentage, startDate, endDate) |
| `GET /opportunities/:id` | `account`, `resources`, `contacts` | Account additionally includes `industry`; contacts include role/isPrimary from the association |
| `GET /contacts`, `GET /contacts/:id` | `account` | `{ id, name }` or `null` |

`expand=contacts` on opportunities works only on the **detail** endpoint, not
the list.

## 9. Errors

Error envelope: `{ "error": "<short name>", "message": "<detail>" }`, plus
context-specific fields:

- Validation failures: `details: [{ field, message }]`
- PATCH immutable/unknown fields: `rejectedFields` (+ `allowedFields` for unknowns)
- Missing scope: `requiredPermission`

| Status | Meaning |
|---|---|
| 400 | Validation failure, bad timestamp, empty/invalid PATCH body |
| 401 | Missing/invalid/revoked/expired key |
| 403 | Missing scope, or org-scoped key required |
| 404 | Not found (including cross-org records and cross-org references) |
| 409 | Duplicate opportunity-contact link |
| 429 | Rate limit exceeded |
| 500 | Server error |

## 10. Rate limits

- Per-key limit, default **100 requests/minute** (configurable per key).
- Standard draft headers on responses: `RateLimit-Limit`,
  `RateLimit-Remaining`, `RateLimit-Reset` (seconds until reset).
  Legacy `X-RateLimit-*` headers are **not** sent.
- `429` includes `Retry-After` (seconds). Back off and retry with jitter.

## 11. Monetary units

`amount`, `actualRevenue`, `estRevenue` are stored as `decimal(15,2)` and
serialized as **decimal strings in currency units** (e.g. `"50000.00"` =
fifty thousand dollars). They are **not** integer cents. Parse with a decimal
library, not floating point, if you do arithmetic. PATCH accepts a number or
numeric string; the response returns the canonical string form.

## 12. Mutable vs immutable fields (PATCH)

PATCH is strict: the body must be a non-empty JSON object containing only
allowlisted mutable fields.

**Immutable everywhere** (400 with `rejectedFields`): `id`, `organizationId`,
`createdAt`, `updatedAt`, `sourceSystem`, `sourceRecordId`, `importStatus`,
`importNotes`.

**Mutable fields per entity** (see `server/external-patch-config.ts` /
`docs/openapi.yaml` schemas `*Patch`):

- **Account**: name, accountNumber, type, category, ownerId, industry, website, phone, billingAddress, shippingAddress, externalId
- **Contact**: accountId, firstName, lastName, email, phone, mobile, title, department, mailing* address fields, description, ownerId, externalId
- **Lead**: firstName, lastName, title, company, email, phone, topic, status, source, rating, ownerId, externalId
- **Opportunity**: accountId, name, stage, amount, closeDate, ownerId, probability, status, actualCloseDate, actualRevenue, estCloseDate, estRevenue, rating, includeInForecast, implementationStartDate, implementationEndDate, billingEndDate, description, externalId (categories and operationalAreas are NOT externally mutable)
- **Activity**: type, subject, status, priority, dueAt, completedAt, notes, ownerId, externalId

Unknown fields return 400 with `rejectedFields` and `allowedFields`.

## 13. Relationship rules

- **Opportunity → Account** (`accountId`): must reference an account in the
  same organization; validated on PATCH (404 on violation).
- **`ownerId`** (accounts, contacts, leads, opportunities): must reference a
  user with a membership in the record's organization; 404 on violation.
- **Opportunity ↔ Contact links**: created via
  `POST /opportunities/:id/contacts` with a `role`
  (`economic_buyer|champion|technical_contact|contract_contact|executive_sponsor|decision_maker|influencer|other`)
  and optional `isPrimary`. One primary contact per opportunity; duplicate
  links → 409. `DELETE .../contacts/:contactId` removes only the link (204).
- **Opportunity date invariants** (validated against the merged record on
  PATCH): `implementationStartDate ≤ implementationEndDate` and
  `billingEndDate ≥ implementationEndDate`.
- **Activities**: `relatedType` (`Contact|Lead|Account|Opportunity`) and
  `relatedId` must be provided together; the referenced record must belong to
  the key's organization. Creation also writes an activity-association row so
  the activity shows on the record's timeline.
- **Lead email normalization**: Surrounding whitespace is trimmed from every
  email value before storage. A blank or whitespace-only email is treated as
  "no email" and stored as `NULL`; such leads do not participate in uniqueness
  — multiple leads without a meaningful email are permitted in the same
  organization. This normalization applies to all write paths (create, update,
  PATCH, import, lead-gen approval).
- **Lead dedup**: `POST /leads` with a meaningful email that matches an existing
  lead (case-insensitive and whitespace-trimmed, same org) creates nothing and
  returns HTTP 200 with `duplicate: true` and the existing record. Empty or
  whitespace-only emails do not trigger deduplication.
- **Document ↔ entity links**: a document can link to any number of
  `account|opportunity|contact|lead` records in its own organization; the
  (document, entityType, entityId) pair is unique — repeat links are
  idempotent (`200`, `created: false`).

## 14. Backward compatibility

- The API is versioned in the path (`/api/v1/`). Breaking changes will ship
  under a new version prefix.
- Non-breaking changes (new optional fields, new endpoints, new enum values,
  new expand targets) may be added to v1 at any time — clients must tolerate
  unknown response fields.
- `updatedSince`, pagination envelope, error envelope, and ID prefixes are
  stable contracts.
- Unknown `expand` values are ignored rather than rejected; unknown query
  parameters are ignored.
- Request **bodies** are strict (unknown fields rejected) — this is intentional
  to surface client bugs early and will not be relaxed.

## 15. Examples

Incremental account sync:

```bash
curl -H "x-api-key: $API_KEY" \
  "https://<crm>/api/v1/external/accounts?updatedSince=2026-08-01T00:00:00Z&limit=500&expand=opportunities"
```

Create a lead:

```bash
curl -X POST -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"firstName":"John","lastName":"Doe","email":"john.doe@example.com","company":"Acme Corp","source":"website"}' \
  "https://<crm>/api/v1/external/leads"
```

Move an opportunity stage:

```bash
curl -X PATCH -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"stage":"negotiation","probability":80}' \
  "https://<crm>/api/v1/external/opportunities/OPP-2025-000001"
```

Link a champion contact:

```bash
curl -X POST -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"contactId":"CONT-2511-00001","role":"champion","isPrimary":true}' \
  "https://<crm>/api/v1/external/opportunities/OPP-2025-000001/contacts"
```

Log a completed call against a lead:

```bash
curl -X POST -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"type":"call","subject":"Discovery call","status":"completed","relatedType":"Lead","relatedId":"LEAD-000042"}' \
  "https://<crm>/api/v1/external/activities"
```

## 16. Changelog

| Version | Changes |
|---|---|
| 1.4 | Activity read endpoints (`GET /activities`, `GET /activities/:id`) with the `activities.read` scope, org-scoped key requirement, and server-side filters (`relatedType`, `relatedId`, `type`, `status`, `priority`, `dueBefore`, `dueAfter`, `updatedSince`, `limit`, `offset`). |
| 1.3 | Document reference endpoints (`POST/GET /documents`, `GET /documents/:id`, `POST /documents/:id/links`, `DELETE /documents/:id/links/:entityType/:entityId`) with `documents.read`/`documents.write` scopes, org-bound key requirement, credential-safe `canonicalUrl` validation, and entity linking to accounts/opportunities/contacts/leads. |
| 1.2 | Server-side list filters on accounts (`search`/`name`), opportunities (`search`, `accountId`, `status`, `stage`, `ownerId`, `rating`), contacts (`search`, `email`, `accountId`), and leads (`search`, `email`, `status`, `rating`, `source`); permission scopes (`crm.read`, `crm.write`, `activities.write`) enforced on every route; PATCH endpoints for accounts, contacts, leads, opportunities, activities with per-entity allowlists, immutable-field rejection, and opportunity date invariants; opportunity-contact link/unlink endpoints and `expand=contacts` on opportunity detail; `POST /activities`; authoritative OpenAPI 3.1 spec (`docs/openapi.yaml`). |
| 1.1 | Contacts read endpoints (org-scoped); leads create/read with email dedup; `GET /logs` self-service access logs; per-key rate limiting with standard `RateLimit-*` headers. |
| 1.0 | Initial release: accounts and opportunities read endpoints with pagination, `updatedSince`, `includeInForecast`, and expand support; `x-api-key` authentication; audit logging. |
