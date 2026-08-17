# Health Trixss CRM — External API Documentation

REST API for secure external access to CRM data (forecasting tools, BI, and
third-party integrations).

> **Canonical contract:** [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.1)
> is the authoritative machine-readable specification. For a full developer
> walkthrough, see [`docs/API_IMPLEMENTATION_GUIDE.md`](docs/API_IMPLEMENTATION_GUIDE.md).
> For lead-submission specifics, see [`docs/EXTERNAL_LEAD_API_GUIDE.md`](docs/EXTERNAL_LEAD_API_GUIDE.md).

**Base URL:** `https://<your-crm-domain>/api/v1/external`

## Authentication

Send your API key in the `x-api-key` header on every request:

```bash
curl -H "x-api-key: htcrm_your_key_here" \
  "https://<your-crm-domain>/api/v1/external/accounts"
```

- Create keys in **Admin Console → API Keys**; the key is shown **once**.
- Keys may be organization-scoped (see only that org's data) or system-wide
  (read accounts/opportunities across orgs). Contacts, leads, and activity
  creation **require** an organization-scoped key.
- Keys carry permission scopes: `crm.read` (accounts/opportunities/contacts/
  leads GETs and `/logs`), `crm.write` (lead creation, PATCHes,
  opportunity-contact links), `activities.read` (activity reads),
  `activities.write` (activity creation and update). Missing scopes → `403`
  with `requiredPermission`.
- Keys can be revoked or given an expiration date; such keys get `401`.

## Record ID formats

| Entity | Example |
|---|---|
| Account | `ACCT-2025-00001` |
| Contact | `CONT-2511-00001` |
| Lead | `LEAD-000042` |
| Opportunity | `OPP-2025-000001` |
| Activity | `ACT-2608-00099` |

`ownerId` and other user references are UUID strings.

## Endpoints

All routes below exist in `server/external-api-routes.ts`; nothing else does.

### Accounts

- `GET /accounts` — list. Query: `search` / `name` (case-insensitive substring
  match on account name), `updatedSince` (ISO 8601), `limit` (≤1000, default
  100), `offset`, `expand=opportunities` (embeds forecast-flagged
  opportunities).
- `GET /accounts/:id` — detail (adds `website`, `phone`).
  `expand=opportunities,contacts`.
- `PATCH /accounts/:id` — partial update of mutable fields (name,
  accountNumber, type, category, ownerId, industry, website, phone,
  billingAddress, shippingAddress, externalId).

```json
{
  "data": [
    {
      "id": "ACCT-2025-00001",
      "name": "Acme Healthcare",
      "accountNumber": "AN-00001",
      "type": "customer",
      "category": "Hospital",
      "ownerId": "7f6c4a3e-2b1d-4c8a-9e50-1a2b3c4d5e6f",
      "industry": "Healthcare",
      "externalId": null,
      "createdAt": "2025-01-15T10:00:00.000Z",
      "updatedAt": "2025-02-01T14:30:00.000Z"
    }
  ],
  "pagination": { "total": 150, "limit": 100, "offset": 0, "hasMore": true }
}
```

Account `type` values: `customer`, `prospect`, `partner`, `vendor`, `other`.

### Opportunities

- `GET /opportunities` — list. Query: `search` (substring on name),
  `accountId` (exact), `status` (exact), `stage` (enum, invalid → 400),
  `ownerId` (exact), `rating` (exact), `updatedSince`,
  `includeInForecast=true|false|all` (default `true`), `limit`, `offset`,
  `expand=account,resources`.
- `GET /opportunities/:id` — detail. `expand=account,resources,contacts`
  (account expand additionally includes `industry`; `contacts` is
  detail-only).
- `PATCH /opportunities/:id` — partial update. Date invariants enforced:
  `implementationStartDate ≤ implementationEndDate`,
  `billingEndDate ≥ implementationEndDate`. `accountId`/`ownerId` must
  reference same-org records (else 404).
- `POST /opportunities/:id/contacts` — link a contact:
  `{ "contactId": "CONT-2511-00001", "role": "champion", "isPrimary": true }`.
  Roles: `economic_buyer`, `champion`, `technical_contact`,
  `contract_contact`, `executive_sponsor`, `decision_maker`, `influencer`,
  `other`. Duplicate link → `409`.
- `DELETE /opportunities/:id/contacts/:contactId` — unlink (`204`).

Opportunity fields of note:

- `stage`: `prospecting`, `qualification`, `proposal`, `negotiation`,
  `closed_won`, `closed_lost` (lowercase).
- **Monetary fields** (`amount`, `actualRevenue`, `estRevenue`): decimal
  strings in currency units, e.g. `"150000.00"` — **not** integer cents.
- `probability`: integer 0–100. `includeInForecast`: boolean.
- Dates (`closeDate`, `estCloseDate`, `actualCloseDate`,
  `implementationStartDate`, `implementationEndDate`, `billingEndDate`):
  ISO 8601 timestamps or null.

### Contacts (reads require an organization-scoped key)

- `GET /contacts` — list. Query: `search` (substring on "first last" name),
  `email` (case-insensitive exact), `accountId` (exact), `updatedSince`,
  `limit`, `offset`, `expand=account` (embeds `{ id, name }` or null).
- `GET /contacts/:id` — detail.
- `PATCH /contacts/:id` — partial update (accountId, name/title/department,
  email, phone, mobile, mailing address fields, description, ownerId,
  externalId). Accepts system keys.

System keys receive `403 Organization-bound API key required` on contact
reads; `PATCH /contacts/:id` accepts system keys.

### Leads (reads and creation require an organization-scoped key)

- `POST /leads` — create. Required: `firstName`, `lastName`. Optional:
  `email`, `phone`, `company`, `title`, `topic`, `notes`, `source`
  (`website|referral|phone|email|event|partner|lead_generation|other`),
  `rating` (`hot|warm|cold`). Unknown fields → `400`. Duplicate email
  (case-insensitive, same org) → HTTP `200` with `duplicate: true` and the
  existing lead; new leads return `201` with `duplicate: false`.
- `GET /leads` — list. Query: `search` (substring on name or company),
  `email` (case-insensitive exact), `status`
  (`new|contacted|qualified|unqualified|converted`), `rating`
  (`hot|warm|cold`, case-insensitive), `source` (lead source enum),
  `updatedSince`, `limit`, `offset`. Invalid enum values → 400.
- `GET /leads/:id` — detail.
- `PATCH /leads/:id` — partial update. Accepts system keys (unlike lead reads
  and creation).

### Activities (org-scoped key required)

- `GET /activities` (`activities.read`) — list. Query: `relatedType`
  (`Contact|Lead|Account|Opportunity`), `relatedId` (exact), `type`
  (`call|email|meeting|task|note`), `status` (`pending|completed|cancelled`),
  `priority` (`low|medium|high`), `dueBefore` / `dueAfter` (ISO 8601, strict
  comparison against `dueAt`; activities without a `dueAt` are excluded),
  `updatedSince`, `limit`, `offset`. Invalid enum or date values → 400.
- `GET /activities/:id` (`activities.read`) — detail; org-scoped lookup, so a
  missing record and another org's record both return `404`.
- `POST /activities` (org-scoped key + `activities.write`) — create.
  Required: `type` (`call|email|meeting|task|note`), `subject`. Optional:
  `status` (`pending|completed|cancelled`, default `completed`), `priority`
  (`low|medium|high`), `notes`, `dueAt`, `completedAt`, and
  `relatedType` (`Contact|Lead|Account|Opportunity`) + `relatedId`
  (must be provided together; record must be in your org).
- `PATCH /activities/:id` — partial update.

### Documents (organization-scoped key required)

Document *references* — a title plus a stable canonical URL pointing to an
external system (SharePoint, Google Drive, ...). No file content is stored.

- `POST /documents` (`documents.write`) — create. Required: `title`,
  `canonicalUrl`. Optional: `documentType`, `sourceSystem`, `version`,
  `status` (default `active`), `mimeType`, `externalId`. `canonicalUrl` must
  be a stable http(s) URL without embedded credentials or signed/temporary
  query or fragment parameters (rejected with `400`).
- `GET /documents` (`documents.read`) — list. Query: `entityType` +
  `entityId` (filter to documents linked to that record;
  `entityType` ∈ `account|opportunity|contact|lead`), `updatedSince`,
  `limit`, `offset`.
- `GET /documents/:id` (`documents.read`) — detail, includes `links`
  (`entityType`, `entityId`, `createdAt`).
- `POST /documents/:id/links` (`documents.write`) — link to an entity in the
  same organization (`{entityType, entityId}`). `201` on creation, `200` +
  `created: false` if the link already exists, `404` if the entity is not
  found in the document's organization.
- `DELETE /documents/:id/links/:entityType/:entityId` (`documents.write`) —
  unlink (`204`; `404` if no such link).

### Access logs

- `GET /logs` — your key's own request logs (newest first). Query:
  `startDate`, `endDate`, `status`, `action`
  (`auth_success|auth_failure|request_success|request_failure`), `limit`,
  `offset`.

## Pagination

All list endpoints return:

```json
"pagination": { "total": 150, "limit": 100, "offset": 0, "hasMore": true }
```

Page by advancing `offset` until `hasMore` is `false`. Use `updatedSince`
for incremental sync.

## Errors

Envelope: `{ "error": "...", "message": "..." }` plus context fields —
`details` (validation), `rejectedFields`/`allowedFields` (PATCH),
`requiredPermission` (403).

| Status | Meaning |
|---|---|
| 400 | Validation failure / bad timestamp / invalid PATCH body |
| 401 | Missing, invalid, revoked, or expired key |
| 403 | Missing permission scope, or org-scoped key required |
| 404 | Not found (includes cross-org records) |
| 409 | Duplicate opportunity-contact link |
| 429 | Rate limit exceeded |
| 500 | Server error |

PATCH rejects immutable fields (`id`, `organizationId`, `createdAt`,
`updatedAt`, `sourceSystem`, `sourceRecordId`, `importStatus`, `importNotes`)
and unknown fields with `400` listing `rejectedFields`.

## Rate limiting

Per-key, default **100 requests/minute** (configurable per key). Responses
include standard `RateLimit-Limit`, `RateLimit-Remaining`, and
`RateLimit-Reset` (seconds) headers — legacy `X-RateLimit-*` headers are not
sent. `429` responses include `Retry-After` (seconds).

## Audit logging

Every request (including failed authentication) is recorded with endpoint,
method, status, latency, response size, IP, and user agent. Admins can view
logs in the Admin Console; API consumers can self-serve their own key's logs
via `GET /logs`.

## Changelog

| Version | Changes |
|---|---|
| 1.4 | Activity read endpoints (`GET /activities`, `GET /activities/:id`) with the `activities.read` scope and nine server-side filters. |
| 1.3 | Document reference endpoints (`/documents`, entity linking) with `documents.read`/`documents.write` scopes. |
| 1.2 | Server-side list filters for accounts, opportunities, contacts, and leads; permission scopes enforced on every route; PATCH endpoints for all five entities; opportunity-contact link/unlink + `expand=contacts`; `POST /activities`; authoritative OpenAPI 3.1 spec at `docs/openapi.yaml`; documentation corrected (decimal-string money, `RateLimit-*` headers, canonical ID prefixes). |
| 1.1 | Contacts and leads endpoints (org-scoped), `GET /logs`, per-key rate limiting. |
| 1.0 | Initial release: accounts and opportunities reads with pagination, `updatedSince`, `includeInForecast`, expand. |
