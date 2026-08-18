# MCP Tag Implementation Guide — CRM External API Tagging

Codex-ready reference for adding tag support to the `healthtrixss-crm-mcp` server.
All endpoints live under the CRM External API base URL:

```
https://<crm-domain>/api/v1/external
```

## Authentication

Every request carries an API key in the `x-api-key` header.

```
x-api-key: htcrm_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**All tag routes require an organization-scoped key.** System keys (keys not
bound to an organization) receive:

```json
HTTP 403
{ "error": "Organization-bound API key required", "message": "Tag access requires an API key bound to an organization" }
```

## Permission scopes

| Route | Scope |
|---|---|
| `GET /tags` | `crm.read` |
| `POST /tags` | `crm.write` |
| `GET /{accounts,contacts,leads,opportunities}/{id}/tags` | `crm.read` |
| `POST /{accounts,contacts,leads,opportunities}/{id}/tags` | `crm.write` |
| `DELETE /{accounts,contacts,leads,opportunities}/{id}/tags/{tagId}` | `crm.write` |
| `GET /activities/{id}/tags` | `activities.read` |
| `POST /activities/{id}/tags` | `activities.write` |
| `DELETE /activities/{id}/tags/{tagId}` | `activities.write` |

Missing scope → `403` with `requiredPermission` in the body. Legacy keys with
no explicit scopes have all scopes; an explicitly empty scope list grants nothing.

## Tag object schema

Every tag returned anywhere in the external API has this exact shape:

```json
{ "id": "4f6c4a3e-2b1d-4c8a-9e50-1a2b3c4d5e6f", "name": "priority", "color": "#3b82f6" }
```

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | Stable identifier |
| `name` | string | 1–100 chars, unique per org (case-insensitive), whitespace-normalized |
| `color` | string | Hex badge color; defaults to `#3b82f6` (colors are not settable externally) |

## Entity mapping

| URL segment | Entity | Record ID prefix |
|---|---|---|
| `accounts` | Account | `ACCT-*` |
| `contacts` | Contact | `CONT-*` |
| `leads` | Lead | `LEAD-*` |
| `opportunities` | Opportunity | `OPP-*` |
| `activities` | Activity | `ACT-*` |

## Endpoints

### 1. List tags — `GET /tags`

Query params: `search` (case-insensitive name contains), `limit` (default 100,
max 1000), `offset` (default 0).

```bash
curl -H "x-api-key: $KEY" "https://crm.example.com/api/v1/external/tags?search=prio&limit=50"
```

```json
{
  "data": [ { "id": "…", "name": "priority", "color": "#3b82f6" } ],
  "pagination": { "total": 1, "limit": 50, "offset": 0, "hasMore": false }
}
```

### 2. Create tag — `POST /tags`

Body: `{ "name": "<1–100 chars>" }` (no other fields accepted). Name is
normalized (trimmed, internal whitespace collapsed) before uniqueness check.

```bash
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"priority"}' https://crm.example.com/api/v1/external/tags
```

- `201` → `{ "data": { "id", "name", "color" } }`
- `409` duplicate (case-insensitive) → body includes `existingTagId` so callers can reuse it:

```json
{ "error": "Tag already exists", "message": "A tag named \"priority\" already exists in this organization", "existingTagId": "…" }
```

There is **no external PATCH/DELETE on tags themselves** (create-only).

### 3. List a record's tags — `GET /{entity}/{id}/tags`

```bash
curl -H "x-api-key: $KEY" https://crm.example.com/api/v1/external/accounts/ACCT-2025-00001/tags
```

`200` → `{ "data": [TagObject, …] }`. Missing or cross-org record → `404`.

### 4. Assign a tag — `POST /{entity}/{id}/tags`

Body: **exactly one** of `{ "tagId": "…" }` or `{ "name": "…" }`.

```bash
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"priority"}' https://crm.example.com/api/v1/external/opportunities/OPP-2025-00001/tags
```

- `200` → `{ "data": [TagObject, …] }` — the record's **current full tag list** after assignment.
- Name that doesn't exist in the org → `404` (**never auto-creates**).
- Cross-org tag or record → `404`.
- Both/neither of `tagId`/`name`, or unknown extra fields → `400`.
- **Idempotent**: re-assigning an already-assigned tag returns `200` with the unchanged list.

### 5. Remove a tag — `DELETE /{entity}/{id}/tags/{tagId}`

```bash
curl -X DELETE -H "x-api-key: $KEY" \
  https://crm.example.com/api/v1/external/leads/LEAD-2025-00001/tags/$TAG_ID
```

- `204` (empty body) — **also 204 when the assignment didn't exist** (idempotent).
- `404` when the record or the tag itself is missing/cross-org.

## Filtering entity lists by tag

All five list endpoints (`/accounts`, `/contacts`, `/leads`, `/opportunities`,
`/activities`) accept:

| Param | Behavior |
|---|---|
| `tag=<name>` | Exact name, case-insensitive; unknown name → `404`; requires org-scoped key |
| `tagId=<id>` | Unknown/cross-org ID → `404`; requires org-scoped key |

`tag` and `tagId` are mutually exclusive (`400` when both are provided). The
pagination `total` reflects the **filtered** count. Combines freely with the
endpoints' other filters (`search`, `updatedSince`, `status`, …).

```bash
curl -H "x-api-key: $KEY" "https://crm.example.com/api/v1/external/accounts?tag=priority&limit=100"
```

Note for `/opportunities`: the default `includeInForecast=true` filter still
applies; pass `includeInForecast=all` to tag-filter across all opportunities.

## Expanding tags on record reads

All five detail endpoints (`GET /{entity}/{id}`) accept `expand=tags` — as the
sole value or inside a comma-separated list (e.g. `expand=account,tags`). The
response's `data` object then includes:

```json
"tags": [ { "id": "…", "name": "priority", "color": "#3b82f6" } ]
```

Without `expand=tags`, no `tags` key is present.

```bash
curl -H "x-api-key: $KEY" "https://crm.example.com/api/v1/external/contacts/CONT-2025-00001?expand=account,tags"
```

## Pagination

Standard envelope on `GET /tags` and all list endpoints:

```json
"pagination": { "total": 12, "limit": 100, "offset": 0, "hasMore": false }
```

`limit` default 100, max 1000; `offset` default 0.

## Error catalog

| Status | When | Body shape |
|---|---|---|
| `400` | Invalid body (empty/too-long name, both/neither `tagId`+`name`, unknown fields, malformed JSON); `tag`+`tagId` filters combined | `{ error, message, details? }` |
| `401` | Missing/invalid/revoked API key | `{ error, message }` |
| `403` | Missing permission scope | `{ error, message, requiredPermission }` |
| `403` | System (non-org) key on any tag route, or `tag=<name>` filter | `{ error: "Organization-bound API key required", message }` |
| `404` | Record, tag, or tag name not found — **or belongs to another org** (indistinguishable by design) | `{ error, message }` |
| `409` | Duplicate tag name on create | `{ error, message, existingTagId }` |
| `429` | Per-key rate limit (default 100 req/min); `Retry-After` header present | `{ error, message }` |
| `500` | Server error | `{ error, message }` |

## Idempotency & org-scoping guarantees

- Assign is idempotent (re-assign → `200`, no duplicate); remove is idempotent (`204` even if absent).
- Tags are strictly org-scoped: names are unique per org, and other orgs' tags/records always look like `404`. There is no way to enumerate or reference another org's tags.
- Every tag mutation is captured in the CRM audit log automatically (request-level middleware).

## Recommended MCP tool mappings

### `crm_list_tags`
- **Input**: `{ search?: string, limit?: number, offset?: number }`
- **Call**: `GET /tags`
- **Output**: `{ tags: TagObject[], total: number, hasMore: boolean }`
- Errors: 401/403 → auth error; 429 → retry with backoff.

### `crm_create_tag` (optional, if write access is desired)
- **Input**: `{ name: string }` (1–100 chars)
- **Call**: `POST /tags`
- **Output**: `TagObject`. On 409, surface `existingTagId` and treat as success-with-existing.

### `crm_get_entity_tags`
- **Input**: `{ entity: "accounts"|"contacts"|"leads"|"opportunities"|"activities", id: string }`
- **Call**: `GET /{entity}/{id}/tags`
- **Output**: `{ tags: TagObject[] }`
- Errors: 404 → "record not found (or not in your organization)".

### `crm_add_tag`
- **Input**: `{ entity, id, tagId?: string, name?: string }` — exactly one of `tagId`/`name`
- **Call**: `POST /{entity}/{id}/tags`
- **Output**: `{ tags: TagObject[] }` (current list)
- Errors: 404 with a `name` input → "tag does not exist; create it first with crm_create_tag"; 400 → input validation.

### `crm_remove_tag`
- **Input**: `{ entity, id, tagId: string }`
- **Call**: `DELETE /{entity}/{id}/tags/{tagId}`
- **Output**: `{ removed: true }` on 204.
- Errors: 404 → record or tag not found.

### Filter/expand integration for existing list/get tools
- Add optional `tag` / `tagId` inputs to existing `crm_list_*` tools and pass them through as query params.
- Add optional `includeTags: boolean` to existing `crm_get_*` tools; when true append `expand=tags` (comma-merge with any existing expand value).
