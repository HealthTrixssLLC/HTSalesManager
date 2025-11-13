# Health Trixss CRM External API Documentation

## Overview

The Health Trixss CRM External API provides secure, read-only access to your CRM data, enabling custom forecasting applications, business intelligence tools, and third-party integrations to access account and opportunity information.

**Base URL:** `https://your-crm-domain.com/api/v1/external`

**API Version:** 1.0

**Response Format:** JSON

**Authentication:** API Key (header-based)

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Authentication](#authentication)
3. [Available Endpoints](#available-endpoints)
4. [Query Parameters](#query-parameters)
5. [Request Examples](#request-examples)
6. [Response Formats](#response-formats)
7. [Error Handling](#error-handling)
8. [Rate Limiting](#rate-limiting)
9. [Best Practices](#best-practices)
10. [Integration Patterns](#integration-patterns)

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
   - Copy the generated key immediately (it's shown only once)

2. **Test Your Connection:**
   ```bash
   curl -H "x-api-key: YOUR_API_KEY" \
        https://your-crm-domain.com/api/v1/external/accounts
   ```

3. **Start Building:**
   - Use the API key in all requests via the `x-api-key` header
   - Begin fetching accounts and opportunities
   - Implement error handling and rate limiting

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
| `401` | Invalid API key format | The provided API key format is invalid |
| `401` | Invalid API key | API key is invalid or has been revoked |
| `401` | API key expired | The provided API key has expired |

**Example Error Response:**
```json
{
  "error": "Invalid API key",
  "message": "The provided API key is invalid or has been revoked"
}
```

---

## Available Endpoints

### 1. List Accounts

Retrieve a paginated list of all accounts in your CRM.

**Endpoint:** `GET /api/v1/external/accounts`

**Query Parameters:**
- `limit` (number, optional): Number of records to return (default: 50, max: 100)
- `offset` (number, optional): Number of records to skip for pagination (default: 0)
- `updatedSince` (ISO 8601 string, optional): Only return accounts modified after this timestamp
- `expand` (string, optional): Include related data. Value: `opportunities`

**Response:**
```json
{
  "accounts": [
    {
      "id": "ACT-00001",
      "name": "Acme Healthcare",
      "category": "Hospital",
      "website": "https://acmehealthcare.com",
      "phone": "+1-555-0100",
      "email": "info@acmehealthcare.com",
      "address": "123 Main St",
      "city": "Boston",
      "state": "MA",
      "zipCode": "02101",
      "country": "USA",
      "industry": "Healthcare",
      "employees": 500,
      "annualRevenue": 50000000,
      "description": "Leading healthcare provider",
      "ownerId": 1,
      "createdAt": "2025-01-15T10:00:00.000Z",
      "updatedAt": "2025-02-01T14:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

### 2. Get Account Details

Retrieve detailed information about a specific account.

**Endpoint:** `GET /api/v1/external/accounts/:id`

**Path Parameters:**
- `id` (string, required): Account ID (e.g., ACT-00001)

**Query Parameters:**
- `expand` (string, optional): Include related data. Values: `opportunities`, `contacts`, `leads`, `activities` (comma-separated)

**Response:**
```json
{
  "id": "ACT-00001",
  "name": "Acme Healthcare",
  "category": "Hospital",
  "website": "https://acmehealthcare.com",
  "phone": "+1-555-0100",
  "email": "info@acmehealthcare.com",
  "address": "123 Main St",
  "city": "Boston",
  "state": "MA",
  "zipCode": "02101",
  "country": "USA",
  "industry": "Healthcare",
  "employees": 500,
  "annualRevenue": 50000000,
  "description": "Leading healthcare provider",
  "ownerId": 1,
  "createdAt": "2025-01-15T10:00:00.000Z",
  "updatedAt": "2025-02-01T14:30:00.000Z"
}
```

### 3. List Opportunities

Retrieve a paginated list of opportunities, with optional filtering by forecast inclusion.

**Endpoint:** `GET /api/v1/external/opportunities`

**Query Parameters:**
- `limit` (number, optional): Number of records to return (default: 50, max: 100)
- `offset` (number, optional): Number of records to skip for pagination (default: 0)
- `includeInForecast` (string, optional): Filter opportunities by forecast inclusion
  - `true` (default): Only opportunities marked for forecast inclusion
  - `false`: Only opportunities excluded from forecast
  - `all`: All opportunities regardless of forecast flag
- `updatedSince` (ISO 8601 string, optional): Only return opportunities modified after this timestamp
- `expand` (string, optional): Include related data. Value: `account`

**Response:**
```json
{
  "opportunities": [
    {
      "id": "OPP-00001",
      "name": "Enterprise Software License",
      "accountId": "ACT-00001",
      "stage": "Proposal Sent",
      "amount": 150000,
      "probability": 75,
      "expectedCloseDate": "2025-03-15",
      "description": "Annual enterprise license renewal",
      "leadSource": "Referral",
      "nextStep": "Schedule final review meeting",
      "includeInForecast": true,
      "ownerId": 1,
      "createdAt": "2025-01-10T09:00:00.000Z",
      "updatedAt": "2025-02-05T11:20:00.000Z"
    }
  ],
  "pagination": {
    "total": 85,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

### 4. Get Opportunity Details

Retrieve detailed information about a specific opportunity.

**Endpoint:** `GET /api/v1/external/opportunities/:id`

**Path Parameters:**
- `id` (string, required): Opportunity ID (e.g., OPP-00001)

**Query Parameters:**
- `expand` (string, optional): Include related data. Value: `account`

**Response:**
```json
{
  "id": "OPP-00001",
  "name": "Enterprise Software License",
  "accountId": "ACT-00001",
  "stage": "Proposal Sent",
  "amount": 150000,
  "probability": 75,
  "expectedCloseDate": "2025-03-15",
  "description": "Annual enterprise license renewal",
  "leadSource": "Referral",
  "nextStep": "Schedule final review meeting",
  "includeInForecast": true,
  "ownerId": 1,
  "createdAt": "2025-01-10T09:00:00.000Z",
  "updatedAt": "2025-02-05T11:20:00.000Z"
}
```

---

## Query Parameters

### Pagination

Use `limit` and `offset` parameters to paginate through large datasets:

- **limit**: Number of records per page (max: 100)
- **offset**: Starting position (0-based)

**Example:**
```
GET /api/v1/external/accounts?limit=25&offset=50
```
This retrieves records 51-75.

### Incremental Sync

Use `updatedSince` to fetch only records modified after a specific timestamp:

**Format:** ISO 8601 timestamp (e.g., `2025-02-01T00:00:00.000Z`)

**Example:**
```
GET /api/v1/external/opportunities?updatedSince=2025-02-01T00:00:00.000Z
```

### Expanding Related Data

Use `expand` to include related entities in the response:

**For Accounts:**
- `opportunities`: Include all opportunities for the account
- `contacts`: Include all contacts
- `leads`: Include all leads
- `activities`: Include all activities

**For Opportunities:**
- `account`: Include the parent account details

**Example:**
```
GET /api/v1/external/accounts/ACT-00001?expand=opportunities,contacts
```

### Filtering

**Opportunities Only:**
- `includeInForecast`: Filter by forecast inclusion flag
  - `true`: Only forecasted opportunities
  - `false`: Only non-forecasted opportunities
  - `all`: All opportunities

---

## Request Examples

### Example 1: Basic Account List

```javascript
const axios = require('axios');

const config = {
  headers: {
    'x-api-key': 'your-api-key-here'
  }
};

axios.get('https://your-crm.com/api/v1/external/accounts', config)
  .then(response => {
    console.log(`Found ${response.data.pagination.total} accounts`);
    response.data.accounts.forEach(account => {
      console.log(`${account.id}: ${account.name}`);
    });
  })
  .catch(error => {
    console.error('Error:', error.response.data);
  });
```

### Example 2: Paginated Opportunities

```javascript
async function getAllOpportunities() {
  const apiKey = 'your-api-key-here';
  const baseUrl = 'https://your-crm.com/api/v1/external';
  let allOpportunities = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await fetch(
      `${baseUrl}/opportunities?limit=${limit}&offset=${offset}`,
      {
        headers: { 'x-api-key': apiKey }
      }
    );

    const data = await response.json();
    allOpportunities = allOpportunities.concat(data.opportunities);

    if (!data.pagination.hasMore) break;
    offset += limit;
  }

  return allOpportunities;
}
```

### Example 3: Incremental Sync

```javascript
const lastSyncTime = '2025-02-01T00:00:00.000Z';

fetch(`https://your-crm.com/api/v1/external/opportunities?updatedSince=${lastSyncTime}`, {
  headers: {
    'x-api-key': 'your-api-key-here'
  }
})
.then(res => res.json())
.then(data => {
  console.log(`${data.opportunities.length} opportunities updated since last sync`);
  // Update your local database with changed records
});
```

### Example 4: Account with Expanded Opportunities

```javascript
fetch('https://your-crm.com/api/v1/external/accounts/ACT-00001?expand=opportunities', {
  headers: {
    'x-api-key': 'your-api-key-here'
  }
})
.then(res => res.json())
.then(account => {
  console.log(`Account: ${account.name}`);
  console.log(`Opportunities: ${account.opportunities.length}`);
  
  account.opportunities.forEach(opp => {
    console.log(`  - ${opp.name}: $${opp.amount}`);
  });
});
```

### Example 5: Error Handling

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = response.headers.get('Retry-After') || 60;
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`${error.error}: ${error.message}`);
      }
      
      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

// Usage
const options = {
  headers: { 'x-api-key': 'your-api-key-here' }
};

try {
  const data = await fetchWithRetry(
    'https://your-crm.com/api/v1/external/accounts',
    options
  );
  console.log('Success:', data);
} catch (error) {
  console.error('Failed after retries:', error.message);
}
```

---

## Response Formats

### Success Response Structure

All successful responses follow this structure:

**List Endpoints:**
```json
{
  "accounts": [...],  // or "opportunities"
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

**Detail Endpoints:**
```json
{
  "id": "ACT-00001",
  "name": "...",
  // ... other fields
}
```

### Account Object

```typescript
{
  id: string;                    // Format: ACT-XXXXX
  name: string;
  category: string;              // e.g., "Hospital", "Clinic"
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  industry: string | null;
  employees: number | null;
  annualRevenue: number | null;  // In cents
  description: string | null;
  ownerId: number;               // User ID of account owner
  createdAt: string;             // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
}
```

### Opportunity Object

```typescript
{
  id: string;                    // Format: OPP-XXXXX
  name: string;
  accountId: string;             // Foreign key to Account
  stage: string;                 // e.g., "Prospecting", "Closed Won"
  amount: number;                // In cents
  probability: number;           // 0-100
  expectedCloseDate: string;     // YYYY-MM-DD format
  description: string | null;
  leadSource: string | null;
  nextStep: string | null;
  includeInForecast: boolean;    // Forecast inclusion flag
  ownerId: number;               // User ID of opportunity owner
  createdAt: string;             // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
}
```

---

## Error Handling

### Error Response Format

All errors return a consistent JSON structure:

```json
{
  "error": "Error code/name",
  "message": "Detailed error description"
}
```

### HTTP Status Codes

| Status Code | Error Type | Description |
|-------------|------------|-------------|
| `200` | Success | Request completed successfully |
| `401` | Unauthorized | Authentication failed or missing |
| `404` | Not Found | Resource does not exist |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Server Error | Internal server error occurred |

### Specific Error Messages

**Authentication Errors (401):**
- `API key required`
- `Invalid API key format`
- `Invalid API key`
- `API key expired`

**Resource Not Found (404):**
- `Account not found` - No account found with ID: ACT-XXXXX
- `Opportunity not found` - No opportunity found with ID: OPP-XXXXX

**Rate Limiting (429):**
- `Too many requests` - Rate limit exceeded

**Server Errors (500):**
- `Failed to fetch accounts` - Error listing accounts
- `Failed to fetch account` - Error fetching account details
- `Failed to fetch opportunities` - Error listing opportunities
- `Failed to fetch opportunity` - Error fetching opportunity details

---

## Rate Limiting

### Default Limits

- **Default:** 100 requests per minute per API key
- **Configurable:** Admins can set custom limits per API key

### Rate Limit Headers

Every response includes rate limit information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1707123600
```

- `X-RateLimit-Limit`: Maximum requests allowed per minute
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Unix timestamp when the limit resets

### Handling Rate Limits

When rate limited (HTTP 429), the response includes a `Retry-After` header:

```
Retry-After: 60
```

**Best Practice:**
```javascript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
  // Retry the request
}
```

---

## Best Practices

### 1. Security

- **Protect Your API Key:** Never commit API keys to version control
- **Use Environment Variables:** Store keys in `.env` files or secure key vaults
- **Rotate Keys Regularly:** Generate new keys periodically
- **Use HTTPS:** Always use encrypted connections
- **Monitor Usage:** Review API key activity regularly in Admin Console

### 2. Performance

- **Batch Requests:** Use pagination to fetch data in manageable chunks
- **Cache Responses:** Cache data locally to reduce API calls
- **Use Incremental Sync:** Leverage `updatedSince` for efficient updates
- **Expand Wisely:** Only expand related data when needed
- **Respect Rate Limits:** Implement exponential backoff

### 3. Data Synchronization

- **Store Last Sync Time:** Track the last successful sync timestamp
- **Handle Deletes:** The API doesn't expose deleted records; implement soft delete logic
- **Validate Data:** Always validate API responses before using data
- **Error Recovery:** Implement retry logic for transient failures

### 4. Error Handling

```javascript
function handleApiError(error) {
  if (error.response) {
    switch (error.response.status) {
      case 401:
        // Invalid API key - check credentials
        console.error('Authentication failed');
        break;
      case 404:
        // Resource not found - may have been deleted
        console.warn('Resource not found');
        break;
      case 429:
        // Rate limited - implement backoff
        console.warn('Rate limit exceeded');
        break;
      case 500:
        // Server error - retry with exponential backoff
        console.error('Server error');
        break;
    }
  }
}
```

---

## Integration Patterns

### Pattern 1: Full Initial Sync + Incremental Updates

**Use Case:** Custom forecasting dashboard

```javascript
class CRMSync {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.lastSyncTime = null;
  }

  async initialSync() {
    // Fetch all opportunities on first run
    const opportunities = await this.fetchAllOpportunities();
    await this.saveToDatabase(opportunities);
    this.lastSyncTime = new Date().toISOString();
  }

  async incrementalSync() {
    // Fetch only changed opportunities
    const url = `${this.baseUrl}/opportunities?updatedSince=${this.lastSyncTime}`;
    const response = await fetch(url, {
      headers: { 'x-api-key': this.apiKey }
    });
    const data = await response.json();
    
    await this.updateDatabase(data.opportunities);
    this.lastSyncTime = new Date().toISOString();
  }

  async fetchAllOpportunities() {
    let allOpps = [];
    let offset = 0;
    
    while (true) {
      const response = await fetch(
        `${this.baseUrl}/opportunities?limit=100&offset=${offset}`,
        { headers: { 'x-api-key': this.apiKey } }
      );
      const data = await response.json();
      allOpps = allOpps.concat(data.opportunities);
      
      if (!data.pagination.hasMore) break;
      offset += 100;
    }
    
    return allOpps;
  }
}
```

### Pattern 2: Real-time Forecast Calculations

**Use Case:** Sales pipeline analytics

```javascript
async function calculateForecast() {
  const response = await fetch(
    'https://your-crm.com/api/v1/external/opportunities?includeInForecast=true',
    {
      headers: { 'x-api-key': process.env.CRM_API_KEY }
    }
  );
  
  const data = await response.json();
  
  const forecast = data.opportunities.reduce((acc, opp) => {
    const weightedValue = (opp.amount / 100) * (opp.probability / 100);
    
    if (!acc[opp.stage]) {
      acc[opp.stage] = { count: 0, total: 0, weighted: 0 };
    }
    
    acc[opp.stage].count++;
    acc[opp.stage].total += opp.amount / 100;
    acc[opp.stage].weighted += weightedValue;
    
    return acc;
  }, {});
  
  return forecast;
}
```

### Pattern 3: Account-Centric Analysis

**Use Case:** Customer health scoring

```javascript
async function analyzeAccountHealth(accountId) {
  const response = await fetch(
    `https://your-crm.com/api/v1/external/accounts/${accountId}?expand=opportunities`,
    {
      headers: { 'x-api-key': process.env.CRM_API_KEY }
    }
  );
  
  const account = await response.json();
  
  const metrics = {
    totalOpportunities: account.opportunities.length,
    totalValue: account.opportunities.reduce((sum, opp) => sum + opp.amount, 0) / 100,
    avgDealSize: 0,
    winRate: 0,
    openOpportunities: account.opportunities.filter(o => 
      !['Closed Won', 'Closed Lost'].includes(o.stage)
    ).length
  };
  
  metrics.avgDealSize = metrics.totalValue / metrics.totalOpportunities;
  
  const closedWon = account.opportunities.filter(o => o.stage === 'Closed Won').length;
  const closedTotal = account.opportunities.filter(o => 
    ['Closed Won', 'Closed Lost'].includes(o.stage)
  ).length;
  metrics.winRate = closedTotal > 0 ? (closedWon / closedTotal) * 100 : 0;
  
  return metrics;
}
```

---

## Support & Additional Resources

### Audit Logging

All external API requests are automatically logged in the CRM's audit system with:
- Endpoint accessed
- HTTP method
- Response status code
- Request latency
- API key metadata

### Admin Console Features

- **Generate API Keys:** Create new keys with custom names and descriptions
- **View Activity:** Check last used timestamp for each key
- **Revoke Access:** Instantly disable keys
- **Set Expiration:** Configure automatic key expiration
- **Configure Rate Limits:** Adjust request limits per key

### Getting Help

For additional support:
- Review the in-app Help → API Documentation tab
- Contact your CRM administrator
- Check audit logs for debugging failed requests

---

## Changelog

### Version 1.0 (Current)
- Initial release
- Four core endpoints (accounts list/detail, opportunities list/detail)
- API key authentication with bcrypt hashing
- Rate limiting (100 req/min default)
- Pagination support (max 100 per page)
- Incremental sync via `updatedSince` parameter
- Related data expansion via `expand` parameter
- Forecast filtering for opportunities
- Comprehensive audit logging

---

## Quick Reference

### Endpoints Summary

```
GET /api/v1/external/accounts              # List all accounts
GET /api/v1/external/accounts/:id          # Get account details
GET /api/v1/external/opportunities         # List opportunities
GET /api/v1/external/opportunities/:id     # Get opportunity details
```

### Common Parameters

```
?limit=50                                   # Pagination limit
?offset=0                                   # Pagination offset
?updatedSince=2025-02-01T00:00:00.000Z     # Incremental sync
?expand=opportunities                       # Include related data
?includeInForecast=true                    # Filter by forecast flag
```

### Authentication Header

```
x-api-key: your-api-key-here
```

---

**Document Version:** 1.0  
**Last Updated:** November 13, 2025  
**API Version:** 1.0
