# Health Trixss CRM External API Documentation

## Overview

The Health Trixss CRM External API provides secure access to your CRM data, enabling custom forecasting applications, business intelligence tools, and third-party integrations to read and write CRM records.

**Base URL:** `https://htsalesmanager.healthtrixss.com/api/v1/external`

**API Version:** 1.0

**Response Format:** JSON

**Authentication:** API Key (header-based)

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Authentication](#authentication)
3. [API Key Scoping](#api-key-scoping)
4. [Available Endpoints](#available-endpoints)
5. [Query Parameters](#query-parameters)
6. [Response Format](#response-format)
7. [Request Examples](#request-examples)
8. [Error Handling](#error-handling)
9. [Rate Limiting](#rate-limiting)
10. [Best Practices](#best-practices)
11. [Integration Patterns](#integration-patterns)

---

## Getting Started

### Prerequisites

- Access to Health Trixss CRM Admin Console
- Admin or Sales Manager role permissions
- API key generation privileges

### Quick Start

1. **Generate an API Key:**
   - Log in to the CRM
   - Navigate to Admin Console → API Keys tab
   - Click "Generate New API Key"
   - Provide a name and optional description
   - Optionally bind the key to a specific organization (required for leads, contacts, and activities)
   - Copy the generated key immediately (shown only once)

2. **Test Your Connection:**
   ```bash
   curl -H "x-api-key: YOUR_API_KEY" \
        https://htsalesmanager.healthtrixss.com/api/v1/external/accounts
   ```

3. **Start Building:**
   - All responses are wrapped in a `data` field (single records) or `data` array + `pagination` object (lists)
   - Use `limit` / `offset` for pagination and `updatedSince` for incremental syncs

---

## Authentication

All API requests must include an API key in the `x-api-key` header.

### Header Format

```
x-api-key: your-api-key-here
```

### Security Features

- **One-time Display:** API keys are shown only once upon generation
- **Secure Storage:** Keys are hashed using bcrypt (12 rounds) before storage
- **Expiration:** Keys can have optional expiration dates
- **Revocation:** Keys can be instantly revoked via the Admin Console
- **Activity Tracking:** Last used timestamp is tracked for each key
- **IP Allowlisting:** Optional IP restrictions can be configured

### Authentication Errors

| Status Code | Error | Description |
|-------------|-------|-------------|
| `401` | API key required | No x-api-key header provided |
| `401` | Invalid API key format | Key format is invalid |
| `401` | Invalid API key | Key is invalid or revoked |
| `401` | API key expired | Key has passed its expiration date |

---

## API Key Scoping

API keys are either **system-level** or **organization-scoped**.

| Key Type | Accounts | Opportunities | Contacts | Leads | Activities | Logs |
|----------|----------|---------------|----------|-------|------------|------|
| System key | ✅ All orgs | ✅ All orgs | ❌ 403 | ❌ 403 | ❌ 403 | ✅ Own key |
| Org-scoped key | ✅ Own org | ✅ Own org | ✅ Own org | ✅ Own org | ✅ Own org | ✅ Own key |

Contacts, leads, and activities **require an organization-scoped key**. Requesting them with a system key returns `403 Organization-bound API key required`.

---

## Available Endpoints

### Endpoint Summary

```
GET  /api/v1/external/accounts              # List accounts
GET  /api/v1/external/accounts/:id          # Get account details
GET  /api/v1/external/opportunities         # List opportunities
GET  /api/v1/external/opportunities/:id     # Get opportunity details
GET  /api/v1/external/contacts              # List contacts (org-scoped key required)
GET  /api/v1/external/contacts/:id          # Get contact details (org-scoped key required)
POST /api/v1/external/leads                 # Create a lead (org-scoped key required)
GET  /api/v1/external/leads                 # List leads (org-scoped key required)
GET  /api/v1/external/leads/:id             # Get lead details (org-scoped key required)
POST /api/v1/external/activities            # Create an activity (org-scoped key required)
GET  /api/v1/external/logs                  # List API access logs for this key
```

---

### 1. List Accounts

**Endpoint:** `GET /api/v1/external/accounts`

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Records per page (max 1000) |
| `offset` | number | 0 | Records to skip |
| `updatedSince` | ISO 8601 | — | Only accounts updated after this timestamp |
| `expand` | string | — | `opportunities` — adds forecast-flagged opportunities to each account |

**Response:**
```json
{
  "data": [
    {
      "id": "ACT-00001",
      "name": "Acme Healthcare",
      "accountNumber": "AN-00001",
      "type": "Customer",
      "category": "Hospital",
      "ownerId": 1,
      "industry": "Healthcare",
      "externalId": null,
      "createdAt": "2025-01-15T10:00:00.000Z",
      "updatedAt": "2025-02-01T14:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

When `expand=opportunities` is included, each account gains an `opportunities` array containing only forecast-flagged opportunities:
```json
"opportunities": [
  {
    "id": "OPP-00001",
    "name": "Enterprise License",
    "stage": "Proposal Sent",
    "amount": 15000000,
    "closeDate": "2025-03-15",
    "probability": 75,
    "implementationStartDate": "2025-04-01",
    "implementationEndDate": "2025-06-30",
    "billingEndDate": "2026-06-30"
  }
]
```

---

### 2. Get Account Details

**Endpoint:** `GET /api/v1/external/accounts/:id`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `expand` | string | Comma-separated: `opportunities`, `contacts` |

**Response:**
```json
{
  "data": {
    "id": "ACT-00001",
    "name": "Acme Healthcare",
    "accountNumber": "AN-00001",
    "type": "Customer",
    "category": "Hospital",
    "ownerId": 1,
    "industry": "Healthcare",
    "website": "https://acmehealthcare.com",
    "phone": "+1-555-0100",
    "externalId": null,
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-02-01T14:30:00.000Z"
  }
}
```

When `expand=opportunities,contacts`:
- `opportunities` array: same shape as above, includes `rating` field additionally
- `contacts` array:
```json
"contacts": [
  {
    "id": "CON-00001",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane@acme.com",
    "phone": "+1-555-0101",
    "mobile": null,
    "title": "VP of Operations"
  }
]
```

---

### 3. List Opportunities

**Endpoint:** `GET /api/v1/external/opportunities`

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Records per page (max 1000) |
| `offset` | number | 0 | Records to skip |
| `updatedSince` | ISO 8601 | — | Only opportunities updated after this timestamp |
| `includeInForecast` | string | `true` | `true` · `false` · `all` |
| `expand` | string | — | Comma-separated: `account`, `resources` |

**Response:**
```json
{
  "data": [
    {
      "id": "OPP-00001",
      "accountId": "ACT-00001",
      "name": "Enterprise Software License",
      "stage": "Proposal Sent",
      "amount": 15000000,
      "closeDate": "2025-03-15",
      "ownerId": 1,
      "probability": 75,
      "status": "open",
      "actualCloseDate": null,
      "actualRevenue": null,
      "estCloseDate": "2025-03-15",
      "estRevenue": 15000000,
      "rating": "warm",
      "includeInForecast": true,
      "implementationStartDate": "2025-04-01",
      "implementationEndDate": "2025-06-30",
      "billingEndDate": "2026-06-30",
      "externalId": null,
      "createdAt": "2025-01-10T09:00:00.000Z",
      "updatedAt": "2025-02-05T11:20:00.000Z"
    }
  ],
  "pagination": {
    "total": 85,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}
```

> **Note on monetary values:** `amount`, `actualRevenue`, and `estRevenue` are stored in cents. Divide by 100 for dollar values.

When `expand=account`:
```json
"account": {
  "id": "ACT-00001",
  "name": "Acme Healthcare",
  "accountNumber": "AN-00001",
  "type": "Customer",
  "category": "Hospital"
}
```

When `expand=resources`:
```json
"resources": [
  {
    "userId": 3,
    "role": "Implementation Lead",
    "allocationPercentage": 80,
    "startDate": "2025-04-01",
    "endDate": "2025-06-30"
  }
]
```

---

### 4. Get Opportunity Details

**Endpoint:** `GET /api/v1/external/opportunities/:id`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `expand` | string | Comma-separated: `account`, `resources` |

**Response:** Same shape as a single item in the list response, wrapped in `{ "data": { ... } }`.

When `expand=account`, the embedded account additionally includes `industry`:
```json
"account": {
  "id": "ACT-00001",
  "name": "Acme Healthcare",
  "accountNumber": "AN-00001",
  "type": "Customer",
  "category": "Hospital",
  "industry": "Healthcare"
}
```

---

### 5. List Contacts

> **Requires an organization-scoped API key.** System keys receive `403`.

**Endpoint:** `GET /api/v1/external/contacts`

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Records per page (max 1000) |
| `offset` | number | 0 | Records to skip |
| `updatedSince` | ISO 8601 | — | Only contacts updated after this timestamp |
| `expand` | string | — | `account` — adds `{ id, name }` to each contact |

**Response:**
```json
{
  "data": [
    {
      "id": "CON-00001",
      "firstName": "Jane",
      "lastName": "Smith",
      "title": "VP of Operations",
      "email": "jane@acme.com",
      "phone": "+1-555-0101",
      "mobile": null,
      "accountId": "ACT-00001",
      "ownerId": 1,
      "externalId": null,
      "createdAt": "2025-01-20T08:00:00.000Z",
      "updatedAt": "2025-02-10T09:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 42,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### 6. Get Contact Details

> **Requires an organization-scoped API key.** System keys receive `403`.

**Endpoint:** `GET /api/v1/external/contacts/:id`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `expand` | string | `account` — adds `{ id, name }` |

**Response:** Single contact wrapped in `{ "data": { ... } }`.

---

### 7. Create Lead

> **Requires an organization-scoped API key.** System keys receive `403`.

**Endpoint:** `POST /api/v1/external/leads`

**Content-Type:** `application/json`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `firstName` | string | ✅ | Max 200 characters |
| `lastName` | string | ✅ | Max 200 characters |
| `email` | string (email) | — | Max 320 characters; used for duplicate detection |
| `phone` | string | — | Max 50 characters |
| `company` | string | — | Max 300 characters |
| `title` | string | — | Max 200 characters |
| `topic` | string | — | Max 2000 characters |
| `notes` | string | — | Max 2000 characters; merged with `topic` if `topic` is omitted |
| `source` | enum | — | `website` · `referral` · `phone` · `email` · `event` · `partner` · `lead_generation` · `other` |
| `rating` | enum | — | `hot` · `warm` · `cold` |

**Duplicate Handling:** If a lead with the same email already exists in the organization, no new record is created. The existing lead is returned with `"duplicate": true`.

**Success Response (201 Created):**
```json
{
  "duplicate": false,
  "data": {
    "id": "LED-00042",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "phone": "+1-555-0199",
    "company": "Acme Corp",
    "title": "Director",
    "topic": "Interested in product demo",
    "status": "new",
    "source": "website",
    "rating": "warm",
    "organizationId": "ORG-00001",
    "organizationName": "Health Trixss",
    "createdAt": "2025-08-12T10:00:00.000Z",
    "updatedAt": "2025-08-12T10:00:00.000Z"
  }
}
```

**Duplicate Response (200 OK):**
```json
{
  "duplicate": true,
  "message": "A lead with this email already exists in the organization. No new lead was created.",
  "data": { ... }
}
```

**Validation Error (400):**
```json
{
  "error": "Validation failed",
  "message": "The lead payload is invalid",
  "details": [
    { "field": "email", "message": "Invalid email address" }
  ]
}
```

---

### 8. List Leads

> **Requires an organization-scoped API key.** System keys receive `403`.

**Endpoint:** `GET /api/v1/external/leads`

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Records per page (max 1000) |
| `offset` | number | 0 | Records to skip |
| `updatedSince` | ISO 8601 | — | Only leads updated after this timestamp |

**Response:**
```json
{
  "data": [
    {
      "id": "LED-00042",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "phone": "+1-555-0199",
      "company": "Acme Corp",
      "title": "Director",
      "topic": "Interested in product demo",
      "status": "new",
      "source": "website",
      "rating": "warm",
      "organizationId": "ORG-00001",
      "organizationName": "Health Trixss",
      "createdAt": "2025-08-12T10:00:00.000Z",
      "updatedAt": "2025-08-12T10:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 17,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### 9. Get Lead Details

> **Requires an organization-scoped API key.** System keys receive `403`.

**Endpoint:** `GET /api/v1/external/leads/:id`

**Response:** Single lead wrapped in `{ "data": { ... } }`.

---

### 10. Create Activity

> **Requires an organization-scoped API key.** System keys receive `403`.

**Endpoint:** `POST /api/v1/external/activities`

**Content-Type:** `application/json`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | ✅ | `call` · `email` · `meeting` · `task` · `note` |
| `subject` | string | ✅ | Max 500 characters |
| `status` | enum | — | `pending` · `completed` · `cancelled` (default: `completed`) |
| `notes` | string | — | Max 10000 characters |
| `dueAt` | ISO 8601 datetime | — | Due date/time |
| `completedAt` | ISO 8601 datetime | — | Completion date/time |
| `priority` | enum | — | `low` · `medium` · `high` (default: `medium`) |
| `relatedType` | enum | — | `Contact` · `Lead` · `Account` · `Opportunity` |
| `relatedId` | string | — | ID of the related record |

> `relatedType` and `relatedId` must **both** be provided together or both omitted. The referenced record must belong to the same organization as the API key.

**Success Response (201 Created):**
```json
{
  "data": {
    "id": "ACT-00099",
    "type": "call",
    "subject": "Discovery call",
    "status": "completed",
    "priority": "medium",
    "notes": "Discussed product fit",
    "dueAt": null,
    "completedAt": "2025-08-12T14:00:00.000Z",
    "relatedType": "Lead",
    "relatedId": "LED-00042",
    "organizationId": "ORG-00001",
    "createdAt": "2025-08-12T14:05:00.000Z",
    "updatedAt": "2025-08-12T14:05:00.000Z"
  }
}
```

---

### 11. List API Access Logs

Retrieve your own API access log history for monitoring and debugging.

**Endpoint:** `GET /api/v1/external/logs`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | ISO 8601 | Only logs after this timestamp |
| `endDate` | ISO 8601 | Only logs before this timestamp |
| `status` | number | Filter by HTTP status code (e.g., `200`, `401`, `429`) |
| `action` | enum | `auth_success` · `auth_failure` · `request_success` · `request_failure` |
| `limit` | number | Records per page (default 100, max 1000) |
| `offset` | number | Records to skip (default 0) |

**Response:**
```json
{
  "data": [
    {
      "timestamp": "2025-08-12T10:05:00.000Z",
      "action": "external_api_request_success",
      "endpoint": "/accounts",
      "method": "GET",
      "statusCode": 200,
      "latencyMs": 42,
      "responseSizeBytes": 1840,
      "aborted": false,
      "errorType": null,
      "errorCode": null,
      "errorMessage": null,
      "resourceType": null,
      "resourceId": null,
      "queryParams": { "limit": "50", "offset": "0" },
      "ipAddress": "203.0.113.5",
      "userAgent": "MyApp/1.0"
    }
  ],
  "pagination": {
    "total": 512,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

> Logs are scoped to the calling API key. You will only see logs generated by your own key.

---

## Query Parameters

### Pagination

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `limit` | 100 | 1000 | Records per page |
| `offset` | 0 | — | Starting position (0-based) |

```
GET /api/v1/external/accounts?limit=25&offset=50
```

### Incremental Sync

Use `updatedSince` to fetch only records modified after a given timestamp.

**Format:** ISO 8601 (`2025-08-01T00:00:00.000Z`)

```
GET /api/v1/external/opportunities?updatedSince=2025-08-01T00:00:00.000Z
```

### Expand

Use `expand` to include related entities in the response. Pass multiple values as a comma-separated string.

```
GET /api/v1/external/opportunities?expand=account,resources
GET /api/v1/external/accounts/ACT-00001?expand=opportunities,contacts
```

---

## Response Format

### List Endpoints

```json
{
  "data": [ ... ],
  "pagination": {
    "total": 150,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

### Detail Endpoints

```json
{
  "data": { ... }
}
```

### Lead Creation (unique shape)

```json
{
  "duplicate": false,
  "data": { ... }
}
```

---

## Object Reference

### Account Object (list)

```typescript
{
  id: string;              // "ACT-XXXXX"
  name: string;
  accountNumber: string | null;
  type: string | null;     // e.g., "Customer", "Prospect"
  category: string | null; // e.g., "Hospital", "Clinic"
  ownerId: number | null;
  industry: string | null;
  externalId: string | null;
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}
```

### Account Object (detail, adds)

```typescript
{
  website: string | null;
  phone: string | null;
}
```

### Opportunity Object

```typescript
{
  id: string;                         // "OPP-XXXXX"
  accountId: string;
  name: string;
  stage: string;                      // e.g., "Prospecting", "Closed Won"
  amount: number | null;              // In cents
  closeDate: string | null;           // "YYYY-MM-DD"
  ownerId: number | null;
  probability: number | null;         // 0–100
  status: string | null;              // e.g., "open", "closed_won", "closed_lost"
  actualCloseDate: string | null;     // "YYYY-MM-DD"
  actualRevenue: number | null;       // In cents
  estCloseDate: string | null;        // "YYYY-MM-DD"
  estRevenue: number | null;          // In cents
  rating: string | null;              // "hot" | "warm" | "cold"
  includeInForecast: boolean;
  implementationStartDate: string | null;  // "YYYY-MM-DD"
  implementationEndDate: string | null;    // "YYYY-MM-DD"
  billingEndDate: string | null;           // "YYYY-MM-DD"
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Contact Object

```typescript
{
  id: string;              // "CON-XXXXX"
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  accountId: string | null;
  ownerId: number | null;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Lead Object

```typescript
{
  id: string;              // "LED-XXXXX"
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  topic: string | null;
  status: string;          // "new" | "contacted" | "qualified" | "converted" | "lost"
  source: string | null;
  rating: string | null;   // "hot" | "warm" | "cold"
  organizationId: string | null;
  organizationName: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Activity Object

```typescript
{
  id: string;              // "ACT-XXXXX"
  type: string;            // "call" | "email" | "meeting" | "task" | "note"
  subject: string;
  status: string;          // "pending" | "completed" | "cancelled"
  priority: string;        // "low" | "medium" | "high"
  notes: string | null;
  dueAt: string | null;    // ISO 8601
  completedAt: string | null;  // ISO 8601
  relatedType: string | null;
  relatedId: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## Error Handling

### Error Response Format

```json
{
  "error": "Error code/name",
  "message": "Detailed error description"
}
```

Validation errors additionally include a `details` array:

```json
{
  "error": "Validation failed",
  "message": "The lead payload is invalid",
  "details": [
    { "field": "email", "message": "Invalid email address" }
  ]
}
```

### HTTP Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Success |
| `201` | Created |
| `400` | Bad request (invalid parameters or payload) |
| `401` | Authentication failed or missing |
| `403` | Forbidden (system key used where org-scoped key is required) |
| `404` | Resource not found or not accessible by this key |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

---

## Rate Limiting

### Default Limits

- **Default:** 100 requests per minute per API key
- **Configurable:** Admins can set custom limits per API key in the Admin Console

### Rate Limit Headers

Every response includes:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1707123600
```

When rate-limited (HTTP 429), a `Retry-After` header is included:

```
Retry-After: 60
```

---

## Best Practices

### Security

- Never commit API keys to version control
- Store keys in environment variables or a secrets manager
- Use organization-scoped keys for tenant-isolated access
- Rotate keys periodically; revoke compromised keys immediately via Admin Console

### Performance

- Use `updatedSince` for incremental syncs instead of full refreshes
- Use `expand` only when you need the related data
- Implement exponential backoff for 429 responses
- Page through results with `limit` / `offset` rather than fetching everything at once

### Monetary Values

All monetary fields (`amount`, `actualRevenue`, `estRevenue`) are stored and returned in **cents**. Divide by 100 to get dollar values:

```javascript
const dollarsAmount = opportunity.amount / 100;
```

### Duplicate-Safe Lead Ingestion

The `POST /leads` endpoint is idempotent on `email` within an org — submitting the same email twice returns the existing lead with `"duplicate": true` instead of creating a duplicate. Always check this flag before assuming a new record was created.

---

## Request Examples

### Example 1: Fetch All Forecast Opportunities

```javascript
const baseUrl = 'https://htsalesmanager.healthtrixss.com/api/v1/external';
const headers = { 'x-api-key': process.env.CRM_API_KEY };

async function getAllForecastOpportunities() {
  let all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(
      `${baseUrl}/opportunities?limit=${limit}&offset=${offset}&includeInForecast=true`,
      { headers }
    );
    const { data, pagination } = await res.json();
    all = all.concat(data);
    if (!pagination.hasMore) break;
    offset += limit;
  }

  return all;
}
```

### Example 2: Incremental Sync

```javascript
const lastSync = localStorage.getItem('lastSyncTime') || '2020-01-01T00:00:00.000Z';

const res = await fetch(
  `${baseUrl}/opportunities?updatedSince=${encodeURIComponent(lastSync)}`,
  { headers }
);
const { data } = await res.json();

// Update local store with changed records
data.forEach(opp => updateLocalRecord(opp));
localStorage.setItem('lastSyncTime', new Date().toISOString());
```

### Example 3: Account with Opportunities and Contacts

```javascript
const res = await fetch(
  `${baseUrl}/accounts/ACT-00001?expand=opportunities,contacts`,
  { headers }
);
const { data: account } = await res.json();

console.log(`${account.name} has ${account.opportunities.length} open opportunities`);
account.contacts.forEach(c => console.log(`  Contact: ${c.firstName} ${c.lastName}`));
```

### Example 4: Submit a Lead from a Web Form

```javascript
const res = await fetch(`${baseUrl}/leads`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    company: 'Acme Corp',
    source: 'website',
    topic: 'Interested in product demo',
  }),
});

const result = await res.json();
if (result.duplicate) {
  console.log('Lead already exists:', result.data.id);
} else {
  console.log('New lead created:', result.data.id);
}
```

### Example 5: Log an Activity Against a Lead

```javascript
const res = await fetch(`${baseUrl}/activities`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'call',
    subject: 'Initial discovery call',
    status: 'completed',
    completedAt: new Date().toISOString(),
    notes: 'Discussed product fit and pricing',
    relatedType: 'Lead',
    relatedId: 'LED-00042',
  }),
});

const { data: activity } = await res.json();
console.log('Activity logged:', activity.id);
```

### Example 6: Error Handling with Retry

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const err = await res.json();
      if (res.status >= 400 && res.status < 500) throw new Error(err.message); // Don't retry client errors
      if (attempt === maxRetries - 1) throw new Error(err.message);
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); // Exponential backoff
      continue;
    }

    return res.json();
  }
}
```

---

## Integration Patterns

### Pattern 1: Full Initial Sync + Incremental Updates

**Use case:** Custom forecasting dashboard

```javascript
class CRMSync {
  constructor(apiKey) {
    this.baseUrl = 'https://htsalesmanager.healthtrixss.com/api/v1/external';
    this.headers = { 'x-api-key': apiKey };
  }

  async initialSync() {
    const opps = await this.fetchAll('/opportunities?includeInForecast=true');
    await db.opportunities.bulkUpsert(opps);
    await db.meta.set('lastSyncTime', new Date().toISOString());
  }

  async incrementalSync() {
    const since = await db.meta.get('lastSyncTime');
    const { data } = await fetch(
      `${this.baseUrl}/opportunities?updatedSince=${since}`,
      { headers: this.headers }
    ).then(r => r.json());

    await db.opportunities.bulkUpsert(data);
    await db.meta.set('lastSyncTime', new Date().toISOString());
  }

  async fetchAll(path) {
    let all = [], offset = 0;
    while (true) {
      const { data, pagination } = await fetch(
        `${this.baseUrl}${path}&limit=100&offset=${offset}`,
        { headers: this.headers }
      ).then(r => r.json());
      all = all.concat(data);
      if (!pagination.hasMore) break;
      offset += 100;
    }
    return all;
  }
}
```

### Pattern 2: Weighted Forecast by Stage

```javascript
async function calculateForecast() {
  const { data } = await fetch(
    `${baseUrl}/opportunities?includeInForecast=true&expand=account`,
    { headers }
  ).then(r => r.json());

  return data.reduce((acc, opp) => {
    const dollarAmount = (opp.amount ?? 0) / 100;
    const weighted = dollarAmount * (opp.probability ?? 0) / 100;

    acc[opp.stage] = acc[opp.stage] || { count: 0, total: 0, weighted: 0 };
    acc[opp.stage].count++;
    acc[opp.stage].total += dollarAmount;
    acc[opp.stage].weighted += weighted;
    return acc;
  }, {});
}
```

### Pattern 3: Lead Capture Integration

**Use case:** Website form → CRM lead

```javascript
// On form submit
async function submitLead(formData) {
  const res = await fetch(`${baseUrl}/leads`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName'),
      email: formData.get('email'),
      company: formData.get('company'),
      source: 'website',
      topic: formData.get('message'),
    }),
  });

  if (!res.ok) {
    const { message } = await res.json();
    throw new Error(message);
  }

  const result = await res.json();
  return result; // Check result.duplicate to know if it was a new lead
}
```

---

## Support & Additional Resources

### Audit Logging

All external API requests are automatically logged. Access your key's logs programmatically via `GET /api/v1/external/logs` or view them in Admin Console → API Access Logs.

Each log entry records: endpoint, method, HTTP status, latency, response size, query parameters, IP address, and user agent.

### Admin Console Features

- **Generate API Keys:** Create new keys, optionally scoped to an organization
- **View Activity:** Last used timestamp per key
- **Revoke Access:** Instantly disable any key
- **Set Expiration:** Automatic key expiration
- **Configure Rate Limits:** Per-key rate limit overrides
- **View Access Logs:** Searchable log of all API requests

---

## Changelog

### Version 1.1 (August 2026)
- **New endpoints:** Contacts list/detail, Leads create/list/detail, Activities create, API access logs
- **Response envelope:** All list and detail responses are now wrapped in `{ "data": ... }` (was `{ "accounts": ... }` / `{ "opportunities": ... }`)
- **Pagination defaults updated:** Default limit raised to 100 (was 50), max raised to 1000 (was 100)
- **Opportunity fields added:** `implementationStartDate`, `implementationEndDate`, `billingEndDate`, `status`, `actualCloseDate`, `actualRevenue`, `estCloseDate`, `estRevenue`, `rating`, `externalId`
- **Opportunity fields renamed:** `expectedCloseDate` → `closeDate`
- **Opportunity expand:** Added `resources` expand option
- **Account fields added:** `accountNumber`, `type`, `externalId`
- **Organization-scoped API keys:** System vs. org-scoped key distinction documented
- **Base URL updated:** `https://htsalesmanager.healthtrixss.com`

### Version 1.0 (November 2025)
- Initial release: accounts and opportunities list/detail endpoints
- API key authentication with bcrypt hashing
- Rate limiting, pagination, incremental sync, expand

---

**Document Version:** 1.1  
**Last Updated:** August 12, 2026  
**API Version:** 1.1
