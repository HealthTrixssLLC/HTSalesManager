# Health Trixss CRM External API - Integration Guide

Complete guide for integrating with the Health Trixss CRM External API for custom forecasting applications and automated workflows.

---

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Authentication](#authentication)
4. [Multi-Tenancy & Organization Scoping](#multi-tenancy--organization-scoping)
5. [API Endpoints](#api-endpoints)
6. [Debugging & Monitoring](#debugging--monitoring)
7. [Error Handling](#error-handling)
8. [Rate Limiting](#rate-limiting)
9. [Best Practices](#best-practices)
10. [Code Examples](#code-examples)
11. [Troubleshooting](#troubleshooting)

---

## Overview

The Health Trixss CRM External API provides secure, RESTful access to accounts, opportunities, and audit logs for building custom forecasting applications and automated workflows.

### Key Features

- **Secure Authentication**: Crypto-based API keys with bcrypt hashing
- **Rate Limiting**: Configurable per-key limits (default 100 req/min)
- **Comprehensive Logging**: All API requests logged for debugging and compliance
- **Incremental Sync**: `updatedSince` parameter for efficient data synchronization
- **Relationship Expansion**: Include related entities in responses
- **Programmatic Debugging**: Access audit logs via API for automated monitoring
- **Multi-Tenant Isolation**: API keys can be scoped to a specific organization

### Base URL

```
https://your-domain.repl.co/api/v1/external
```

---

## Getting Started

### Step 1: Generate an API Key

1. Log into Health Trixss CRM as an **Admin** user
2. Navigate to **Admin Console** (top navigation)
3. Click the **"API Keys"** tab
4. Click **"Generate API Key"** button
5. Fill in the form:
   - **Name**: Descriptive name (e.g., "Forecasting App Production")
   - **Description**: Purpose and usage notes
   - **Expires At** (optional): Expiration date for security
   - **Rate Limit** (optional): Custom requests per minute (default: 100)
6. Click **"Generate"**
7. **IMPORTANT**: Copy the API key immediately - it's shown only once!

### Step 2: Store API Key Securely

```bash
# Environment variable (recommended)
export HEALTH_TRIXSS_API_KEY="your-api-key-here"

# .env file (add to .gitignore!)
HEALTH_TRIXSS_API_KEY=your-api-key-here
```

**Security Note**: Never commit API keys to version control or expose them in client-side code.

### Step 3: Test Your Connection

```bash
curl -H "X-API-Key: $HEALTH_TRIXSS_API_KEY" \
  https://your-domain.repl.co/api/v1/external/accounts?limit=1
```

Expected response:
```json
{
  "data": [
    {
      "id": "ACCT-2025-00001",
      "name": "Example Corp",
      "accountNumber": "ACCT-2025-00001",
      ...
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 1,
    "offset": 0,
    "hasMore": true
  }
}
```

---

## Authentication

### API Key Format

Generated keys follow the format `htcrm_<value>` where `<value>` is a URL-safe base64-encoded random 32-byte value. The total key length is approximately 49 characters.

Example: `htcrm_kB4rN8mPqT2vW5nL0jYeF3cZ9sU1xH6dA7oVgMpRkB4`

### API Key Header

All requests must include your API key in the `X-API-Key` header:

```http
X-API-Key: your-api-key-here
```

### Authentication Errors

| Status | Error | Cause |
|--------|-------|-------|
| 401 | `API key required` | No `X-API-Key` header provided |
| 401 | `Invalid API key format` | Key doesn't start with `htcrm_` or contains invalid characters |
| 401 | `Invalid API key` | Key not found in database or has been revoked |
| 401 | `API key expired` | Key has passed its expiration date |

**Error response shape** (all auth errors):
```json
{
  "error": "API key required",
  "message": "Please provide your API key in the x-api-key header"
}
```

---

## Multi-Tenancy & Organization Scoping

Health Trixss CRM is a multi-tenant system. API keys may be scoped to a specific organization.

- **Org-scoped key**: All endpoints automatically filter results to that organization's data only. Records belonging to other organizations are invisible to the key.
- **System-level key** (no org assigned): Has access to data across all organizations. Use with care — suitable only for global administrative integrations.

The active organization scope is determined by the API key itself; no additional headers are required. When you generate an API key as an Admin, the key inherits the organization context of the user who created it.

---

## API Endpoints

### 1. List All Accounts

Retrieve all accounts with optional filtering and pagination.

**Endpoint**: `GET /api/v1/external/accounts`

**Query Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `updatedSince` | ISO 8601 | - | Only return accounts updated after this timestamp |
| `limit` | integer | 100 | Number of results (max: 1000) |
| `offset` | integer | 0 | Number of results to skip |
| `expand` | string | - | Comma-separated list: `opportunities` |

**Example Request**:
```bash
curl -H "X-API-Key: $HEALTH_TRIXSS_API_KEY" \
  "https://your-domain.repl.co/api/v1/external/accounts?limit=10&expand=opportunities"
```

**Example Response**:
```json
{
  "data": [
    {
      "id": "ACCT-2025-00001",
      "name": "Example Corp",
      "accountNumber": "ACCT-2025-00001",
      "type": "Customer",
      "category": "Healthcare",
      "ownerId": "user-uuid-here",
      "industry": "Medical Devices",
      "externalId": "SF-12345",
      "createdAt": "2025-01-15T10:30:00Z",
      "updatedAt": "2025-01-20T14:22:00Z",
      "opportunities": [
        {
          "id": "OPP-2025-00001",
          "name": "Q1 2025 Contract Renewal",
          "stage": "Proposal",
          "amount": 50000,
          "closeDate": "2025-03-31",
          "probability": 75
        }
      ]
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

**Notes**:
- The `expand=opportunities` option only includes opportunities where `includeInForecast` is `true`.
- Fields `website`, `phone`, and `region` are not included in list responses. Use the single-account endpoint for full detail.

---

### 2. Get Single Account

Retrieve detailed information about a specific account.

**Endpoint**: `GET /api/v1/external/accounts/:id`

**URL Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Account ID (e.g., `ACCT-2025-00001`) |

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `expand` | string | Comma-separated list: `opportunities`, `contacts` |

**Example Request**:
```bash
curl -H "X-API-Key: $HEALTH_TRIXSS_API_KEY" \
  "https://your-domain.repl.co/api/v1/external/accounts/ACCT-2025-00001?expand=opportunities,contacts"
```

**Example Response**:
```json
{
  "data": {
    "id": "ACCT-2025-00001",
    "name": "Example Corp",
    "accountNumber": "ACCT-2025-00001",
    "type": "Customer",
    "category": "Healthcare",
    "ownerId": "user-uuid-here",
    "industry": "Medical Devices",
    "website": "https://example.com",
    "phone": "+1-555-0100",
    "externalId": "SF-12345",
    "createdAt": "2025-01-15T10:30:00Z",
    "updatedAt": "2025-01-20T14:22:00Z",
    "opportunities": [
      {
        "id": "OPP-2025-00001",
        "name": "Q1 2025 Contract Renewal",
        "stage": "Proposal",
        "amount": 50000,
        "closeDate": "2025-03-31",
        "probability": 75,
        "rating": "Hot"
      }
    ],
    "contacts": [
      {
        "id": "CON-2025-00001",
        "firstName": "Jane",
        "lastName": "Smith",
        "email": "jane.smith@example.com",
        "phone": "+1-555-0101",
        "mobile": "+1-555-0102",
        "title": "VP of Operations"
      }
    ]
  }
}
```

**Notes**:
- `expand=opportunities` only includes opportunities where `includeInForecast` is `true`.
- `expand=contacts` returns all contacts linked to this account.

**Error Response** (404):
```json
{
  "error": "Account not found",
  "message": "No account found with ID: ACCT-2025-99999"
}
```

---

### 3. List All Opportunities

Retrieve all opportunities with optional filtering and pagination.

**Endpoint**: `GET /api/v1/external/opportunities`

**Query Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `updatedSince` | ISO 8601 | - | Only return opportunities updated after this timestamp |
| `includeInForecast` | string | `true` | Filter by forecast inclusion: `true`, `false`, or `all` |
| `limit` | integer | 100 | Number of results (max: 1000) |
| `offset` | integer | 0 | Number of results to skip |
| `expand` | string | - | Comma-separated list: `account` |

**`includeInForecast` values**:
| Value | Behavior |
|-------|----------|
| `true` (default) | Only return opportunities flagged for forecasting |
| `false` | Only return opportunities excluded from forecasting |
| `all` | Return every opportunity regardless of forecast flag |

**Example Request** (Forecast-only, default):
```bash
curl -H "X-API-Key: $HEALTH_TRIXSS_API_KEY" \
  "https://your-domain.repl.co/api/v1/external/opportunities?limit=100"
```

**Example Request** (Forecast-only with related account, default):
```bash
curl -H "X-API-Key: $HEALTH_TRIXSS_API_KEY" \
  "https://your-domain.repl.co/api/v1/external/opportunities?expand=account&limit=100"
```

**Example Request** (All opportunities):
```bash
curl -H "X-API-Key: $HEALTH_TRIXSS_API_KEY" \
  "https://your-domain.repl.co/api/v1/external/opportunities?includeInForecast=all&limit=100"
```

**Example Response** (with `expand=account`):
```json
{
  "data": [
    {
      "id": "OPP-2025-00001",
      "accountId": "ACCT-2025-00001",
      "name": "Q1 2025 Contract Renewal",
      "stage": "Proposal",
      "amount": 50000,
      "closeDate": "2025-03-31",
      "ownerId": "user-uuid-here",
      "probability": 75,
      "status": "open",
      "actualCloseDate": null,
      "actualRevenue": null,
      "estCloseDate": "2025-03-15",
      "estRevenue": 50000,
      "rating": "Hot",
      "includeInForecast": true,
      "externalId": "SF-OPP-54321",
      "createdAt": "2025-01-10T09:00:00Z",
      "updatedAt": "2025-01-18T16:45:00Z",
      "account": {
        "id": "ACCT-2025-00001",
        "name": "Example Corp",
        "accountNumber": "ACCT-2025-00001",
        "type": "Customer",
        "category": "Healthcare"
      }
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### 4. Get Single Opportunity

Retrieve detailed information about a specific opportunity.

**Endpoint**: `GET /api/v1/external/opportunities/:id`

**URL Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Opportunity ID (e.g., `OPP-2025-00001`) |

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `expand` | string | Comma-separated list: `account` |

**Example Request**:
```bash
curl -H "X-API-Key: $HEALTH_TRIXSS_API_KEY" \
  "https://your-domain.repl.co/api/v1/external/opportunities/OPP-2025-00001?expand=account"
```

**Example Response**:
```json
{
  "data": {
    "id": "OPP-2025-00001",
    "accountId": "ACCT-2025-00001",
    "name": "Q1 2025 Contract Renewal",
    "stage": "Proposal",
    "amount": 50000,
    "closeDate": "2025-03-31",
    "ownerId": "user-uuid-here",
    "probability": 75,
    "status": "open",
    "actualCloseDate": null,
    "actualRevenue": null,
    "estCloseDate": "2025-03-15",
    "estRevenue": 50000,
    "rating": "Hot",
    "includeInForecast": true,
    "externalId": "SF-OPP-54321",
    "createdAt": "2025-01-10T09:00:00Z",
    "updatedAt": "2025-01-18T16:45:00Z",
    "account": {
      "id": "ACCT-2025-00001",
      "name": "Example Corp",
      "accountNumber": "ACCT-2025-00001",
      "type": "Customer",
      "category": "Healthcare",
      "industry": "Medical Devices"
    }
  }
}
```

**Error Response** (404):
```json
{
  "error": "Opportunity not found",
  "message": "No opportunity found with ID: OPP-2025-99999"
}
```

---

### 5. Access Audit Logs (Programmatic Debugging)

Retrieve audit logs for your API key's requests - essential for automated debugging and monitoring.

**Endpoint**: `GET /api/v1/external/logs`

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | ISO 8601 | Filter logs after this timestamp |
| `endDate` | ISO 8601 | Filter logs before this timestamp |
| `status` | integer | HTTP status code (200, 401, 404, 429, 500, etc.) |
| `action` | string | Action type: `auth_success`, `auth_failure`, `request_success`, `request_failure` |
| `limit` | integer | Number of results (default: 100, max: 1000) |
| `offset` | integer | Number of results to skip |

**Security Note**: Each API key can only access its own logs (automatic filtering by API key ID).

**Example Request** (Find Recent Errors):
```bash
curl -H "X-API-Key: $HEALTH_TRIXSS_API_KEY" \
  "https://your-domain.repl.co/api/v1/external/logs?action=request_failure&limit=10"
```

**Example Response**:
```json
{
  "data": [
    {
      "timestamp": "2025-01-20T14:35:22Z",
      "action": "external_api_request_failure",
      "endpoint": "/accounts/ACCT-2025-99999",
      "method": "GET",
      "statusCode": 404,
      "latencyMs": 12,
      "responseSizeBytes": 156,
      "aborted": false,
      "errorType": "client_error",
      "errorCode": null,
      "errorMessage": "Account not found",
      "resourceType": "account",
      "resourceId": "ACCT-2025-99999",
      "queryParams": null,
      "ipAddress": "203.0.113.45",
      "userAgent": "ForecastingApp/1.0"
    }
  ],
  "pagination": {
    "total": 3,
    "limit": 10,
    "offset": 0,
    "hasMore": false
  }
}
```

---

## Debugging & Monitoring

### Automated Monitoring Script

Use the `/logs` endpoint to build automated monitoring and alerting:

```javascript
// monitor.js - Check for API errors every 5 minutes
const API_KEY = process.env.HEALTH_TRIXSS_API_KEY;
const BASE_URL = 'https://your-domain.repl.co/api/v1/external';

async function checkForErrors() {
  // Get logs from last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  const response = await fetch(
    `${BASE_URL}/logs?action=request_failure&startDate=${fiveMinutesAgo}`,
    {
      headers: { 'X-API-Key': API_KEY }
    }
  );
  
  const { data, pagination } = await response.json();
  
  if (pagination.total > 0) {
    console.error(`Found ${pagination.total} API errors in last 5 minutes:`);
    
    data.forEach(log => {
      console.error(`  - ${log.statusCode} ${log.method} ${log.endpoint}`);
      console.error(`    Error: ${log.errorMessage}`);
      console.error(`    Time: ${log.timestamp}`);
    });
    
    // Send alert to your monitoring system
    await sendAlert({
      severity: 'warning',
      message: `${pagination.total} API errors detected`,
      logs: data
    });
  }
}

// Run every 5 minutes
setInterval(checkForErrors, 5 * 60 * 1000);
```

### Web-Based Log Viewer

Admins can view and export logs via the Admin Console:

1. Log into Health Trixss CRM as Admin
2. Navigate to **Admin Console**
3. Click **"API Access Logs"** tab
4. Apply filters:
   - Date range
   - API key
   - Status code
   - Action type
5. Click rows to expand detailed metadata
6. Click **"Export CSV"** for offline analysis

---

## Error Handling

### Standard Error Response

All errors return a JSON object with two fields:

```json
{
  "error": "Brief error description",
  "message": "Detailed error message"
}
```

There is no `code` field or resource-specific ID field in error responses.

### Common HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 200 | Success | Request succeeded |
| 401 | Unauthorized | Invalid/missing API key, expired key |
| 404 | Not Found | Resource doesn't exist (check ID) |
| 429 | Rate Limited | Too many requests (see rate limiting) |
| 500 | Server Error | Internal server error (contact support) |

### Retry Strategy

Implement exponential backoff for failed requests:

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      // Success
      if (response.ok) return response;
      
      // Rate limited - wait and retry using Retry-After header (seconds)
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || String(2 ** i));
        const waitMs = retryAfter * 1000;
        console.log(`Rate limited. Retrying in ${retryAfter}s...`);
        await sleep(waitMs);
        continue;
      }
      
      // Client error (4xx) - don't retry
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error: ${response.status}`);
      }
      
      // Server error (5xx) - retry with backoff
      if (response.status >= 500) {
        const backoff = 2 ** i * 1000; // 1s, 2s, 4s
        console.log(`Server error. Retrying in ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(2 ** i * 1000);
    }
  }
  throw new Error('Max retries exceeded');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Rate Limiting

### Default Limits

- **100 requests per minute** per API key (default)
- Configurable per key in Admin Console

### Rate Limit Headers

Response headers indicate current rate limit status:

```http
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 45
```

- `RateLimit-Limit` — maximum requests allowed in the current window
- `RateLimit-Remaining` — requests remaining in the current window
- `RateLimit-Reset` — **seconds until the rate limit window resets** (not a Unix timestamp)

### 429 Response

When rate limited, the response includes both a `Retry-After` header (seconds to wait) and a JSON body:

```http
Retry-After: 45
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 45
```

```json
{
  "error": "Too many requests",
  "message": "You have exceeded the rate limit for this API key. Please try again later."
}
```

**Important**: Use the `Retry-After` header (seconds to wait) or `RateLimit-Reset` (seconds until window resets) to determine when to retry. Both values are in seconds, not Unix timestamps.

### Best Practices

1. **Respect Rate Limits**: Check `RateLimit-Remaining` header before each request
2. **Use Incremental Sync**: Use `updatedSince` instead of fetching all data
3. **Batch Requests**: Increase `limit` parameter to reduce total requests
4. **Cache Data**: Store frequently accessed data locally
5. **Implement Backoff**: Use exponential backoff on 429 responses

---

## Best Practices

### 1. Incremental Synchronization

Avoid fetching all data on every sync - use `updatedSince`:

```javascript
// Initial sync - fetch all accounts
const allAccounts = await fetchAllAccounts();
localStorage.setItem('lastSync', new Date().toISOString());

// Subsequent syncs - only fetch changes
const lastSync = localStorage.getItem('lastSync');
const changedAccounts = await fetch(
  `${BASE_URL}/accounts?updatedSince=${lastSync}`,
  { headers: { 'X-API-Key': API_KEY } }
);
localStorage.setItem('lastSync', new Date().toISOString());
```

### 2. Pagination Handling

Fetch all pages efficiently:

```javascript
async function fetchAllAccounts() {
  const allAccounts = [];
  let offset = 0;
  const limit = 1000; // Max page size
  
  while (true) {
    const response = await fetch(
      `${BASE_URL}/accounts?limit=${limit}&offset=${offset}`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    const { data, pagination } = await response.json();
    
    allAccounts.push(...data);
    
    if (!pagination.hasMore) break;
    offset += limit;
  }
  
  return allAccounts;
}
```

### 3. Relationship Expansion

Use `expand` parameter to reduce API calls:

```javascript
// BAD: Two API calls per opportunity
for (const opp of opportunities) {
  const account = await fetch(`${BASE_URL}/accounts/${opp.accountId}`);
}

// GOOD: One API call with expanded relationships
const opportunities = await fetch(
  `${BASE_URL}/opportunities?expand=account`,
  { headers: { 'X-API-Key': API_KEY } }
);
```

### 4. Error Logging

Log all errors for debugging:

```javascript
try {
  const response = await fetch(url, options);
  const data = await response.json();
  
  // Log to monitoring service
  logger.info('API request succeeded', {
    endpoint: url,
    statusCode: response.status,
    duration: Date.now() - startTime
  });
  
  return data;
} catch (error) {
  logger.error('API request failed', {
    endpoint: url,
    error: error.message,
    stack: error.stack
  });
  throw error;
}
```

---

## Code Examples

### Node.js / TypeScript

```typescript
import fetch from 'node-fetch';

const API_KEY = process.env.HEALTH_TRIXSS_API_KEY!;
const BASE_URL = 'https://your-domain.repl.co/api/v1/external';

interface Account {
  id: string;
  name: string;
  accountNumber: string;
  // ... other fields
}

interface Opportunity {
  id: string;
  name: string;
  accountId: string;
  stage: string;
  amount: number | null;
  probability: number;
  status: string;
  estRevenue: number | null;
  actualRevenue: number | null;
  includeInForecast: boolean;
  // ... other fields
}

async function getForecastData(): Promise<Opportunity[]> {
  const response = await fetch(
    `${BASE_URL}/opportunities?expand=account&limit=1000`,
    {
      headers: {
        'X-API-Key': API_KEY
      }
    }
  );
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  const { data } = await response.json();
  return data;
}

// Calculate weighted pipeline
async function calculateWeightedPipeline(): Promise<number> {
  const opportunities = await getForecastData();
  
  return opportunities.reduce((total, opp) => {
    return total + ((opp.estRevenue ?? 0) * opp.probability / 100);
  }, 0);
}

calculateWeightedPipeline()
  .then(pipeline => console.log(`Weighted Pipeline: $${pipeline.toFixed(2)}`))
  .catch(error => console.error('Error:', error));
```

### Python

```python
import os
import requests
from datetime import datetime, timedelta
from typing import List, Dict

API_KEY = os.environ['HEALTH_TRIXSS_API_KEY']
BASE_URL = 'https://your-domain.repl.co/api/v1/external'

def get_headers():
    return {'X-API-Key': API_KEY}

def get_forecast_opportunities() -> List[Dict]:
    """Fetch all opportunities included in forecast"""
    response = requests.get(
        f'{BASE_URL}/opportunities',
        headers=get_headers(),
        params={
            'expand': 'account',
            'limit': 1000
        }
    )
    response.raise_for_status()
    return response.json()['data']

def calculate_weighted_pipeline() -> float:
    """Calculate weighted pipeline value"""
    opportunities = get_forecast_opportunities()
    
    weighted_total = sum(
        (opp.get('estRevenue') or 0) * opp['probability'] / 100
        for opp in opportunities
    )
    
    return weighted_total

def get_recent_errors() -> List[Dict]:
    """Check for API errors in last hour"""
    one_hour_ago = (datetime.now() - timedelta(hours=1)).isoformat()
    
    response = requests.get(
        f'{BASE_URL}/logs',
        headers=get_headers(),
        params={
            'action': 'request_failure',
            'startDate': one_hour_ago,
            'limit': 100
        }
    )
    response.raise_for_status()
    return response.json()['data']

if __name__ == '__main__':
    # Calculate forecast
    pipeline = calculate_weighted_pipeline()
    print(f'Weighted Pipeline: ${pipeline:,.2f}')
    
    # Check for errors
    errors = get_recent_errors()
    if errors:
        print(f'\nFound {len(errors)} API errors in last hour')
        for error in errors[:5]:  # Show first 5
            print(f"  - {error['statusCode']} {error['method']} {error['endpoint']}")
```

### cURL

```bash
#!/bin/bash

# Configuration
API_KEY="${HEALTH_TRIXSS_API_KEY}"
BASE_URL="https://your-domain.repl.co/api/v1/external"

# Fetch all forecast opportunities (default: includeInForecast=true)
curl -s -H "X-API-Key: $API_KEY" \
  "${BASE_URL}/opportunities?limit=1000" \
  | jq '{
    total: .pagination.total,
    weighted_pipeline: ([.data[] | (.estRevenue // 0) * .probability / 100] | add)
  }'

# Check for recent errors
ONE_HOUR_AGO=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)
curl -s -H "X-API-Key: $API_KEY" \
  "${BASE_URL}/logs?action=request_failure&startDate=${ONE_HOUR_AGO}" \
  | jq '{
    error_count: .pagination.total,
    recent_errors: .data[0:5] | map({
      time: .timestamp,
      endpoint: .endpoint,
      status: .statusCode,
      error: .errorMessage
    })
  }'
```

---

## Troubleshooting

### Problem: 401 Unauthorized

**Check**:
1. API key is correct and copied completely
2. Key hasn't expired (check Admin Console)
3. Key hasn't been revoked
4. Header name is exact: `X-API-Key` (case-sensitive)

**Solution**:
```bash
# Verify your API key format (should start with htcrm_ and be ~49 chars)
echo -n $HEALTH_TRIXSS_API_KEY | wc -c  # Should be ~49 characters

# Test with verbose output
curl -v -H "X-API-Key: $HEALTH_TRIXSS_API_KEY" \
  "${BASE_URL}/accounts?limit=1"
```

### Problem: 429 Rate Limited

**Check**:
1. Current rate limit in Admin Console
2. Number of requests in last minute
3. Multiple applications using same key

**Solution**:
```javascript
// Implement request queuing
class RateLimiter {
  constructor(requestsPerMinute = 100) {
    this.queue = [];
    this.limit = requestsPerMinute;
    this.window = 60000; // 1 minute
  }
  
  async execute(fn) {
    const now = Date.now();
    this.queue = this.queue.filter(t => now - t < this.window);
    
    if (this.queue.length >= this.limit) {
      const oldestRequest = this.queue[0];
      const waitTime = this.window - (now - oldestRequest);
      await sleep(waitTime);
      return this.execute(fn);
    }
    
    this.queue.push(now);
    return fn();
  }
}

const limiter = new RateLimiter(100);
await limiter.execute(() => fetch(url, options));
```

### Problem: 404 Not Found

**Check**:
1. Resource ID is correct (check for typos)
2. Resource hasn't been deleted
3. Using correct ID format (e.g., `ACCT-2025-00001` not just `00001`)
4. If using an org-scoped API key, the resource must belong to that organization

**Solution**:
```javascript
// Verify resource exists first
const accounts = await fetch(`${BASE_URL}/accounts?limit=1000`);
const accountIds = accounts.data.map(a => a.id);

if (!accountIds.includes(targetId)) {
  console.error(`Account ${targetId} not found. Available IDs:`, accountIds);
}
```

### Problem: Slow Response Times

**Check**:
1. Using `expand` parameter unnecessarily
2. Large `limit` values
3. Network latency
4. Not using `updatedSince` for incremental sync

**Solution**:
```javascript
// Measure request timing
const start = Date.now();
const response = await fetch(url, options);
const duration = Date.now() - start;

console.log(`Request took ${duration}ms`);

if (duration > 1000) {
  console.warn('Slow request detected:');
  console.warn(`  - URL: ${url}`);
  console.warn(`  - Consider reducing limit or removing expand`);
}
```

### Problem: Stale Data

**Check**:
1. Using incremental sync correctly
2. Caching strategy
3. Time zone differences with `updatedSince`

**Solution**:
```javascript
// Always use ISO 8601 UTC timestamps
const lastSync = new Date().toISOString(); // "2025-01-20T14:30:00.000Z"

// NOT: new Date().toString()
// NOT: "2025-01-20 14:30:00"
```

---

## Support & Resources

### Getting Help

1. **Check Logs**: Use Admin Console → API Access Logs or programmatic `/logs` endpoint
2. **Review Documentation**: This guide + API endpoint comments in codebase
3. **Contact Support**: Include API key name (not the key itself) and error logs

### Useful Admin Console Features

- **API Keys Tab**: Generate, revoke, monitor API key usage
- **API Access Logs Tab**: View/export detailed request logs with filters
- **Database Diagnostics**: Check entity counts before large imports

### Rate Limit Increase Requests

To request a higher rate limit:
1. Navigate to Admin Console → API Keys
2. Edit your API key
3. Update "Rate Limit Per Minute" field
4. Or contact admin to adjust limits

---

## Appendix: Complete Endpoint Summary

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/external/accounts` | List all accounts | API Key |
| GET | `/api/v1/external/accounts/:id` | Get single account | API Key |
| GET | `/api/v1/external/opportunities` | List all opportunities | API Key |
| GET | `/api/v1/external/opportunities/:id` | Get single opportunity | API Key |
| GET | `/api/v1/external/logs` | Access audit logs (debugging) | API Key |

**All endpoints return JSON and support pagination.**

---

**Last Updated**: May 2026  
**API Version**: 1.0  
**Document Version**: 1.1
