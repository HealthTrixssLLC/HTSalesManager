# Health Trixss CRM — External Lead API Integration Guide

This guide explains how an external system (a website contact form, an email-parsing service, or any other application) can create leads in the Health Trixss CRM through its secure external API. Hand this document to the developer or Replit agent building the integration — it contains everything they need.

---

## 1. Overview

- **Base URL**: `https://<your-crm-domain>/api/v1/external`
- **Authentication**: API key sent in the `x-api-key` header on every request
- **Format**: JSON request and response bodies (`Content-Type: application/json`)
- **Organization scoping**: Every API key is bound to exactly **one organization**. All leads created with a key are automatically assigned to that key's organization — the caller never chooses (or can override) the organization. The response always returns the assigned `organizationId` and `organizationName` so you can confirm where the lead landed.
- **Multiple sources → multiple keys**: If your website and your email system should feed **different** organizations, create one API key per organization and give each system its own key. If they feed the same organization, they can share a key (or use separate keys for cleaner audit logs — recommended).

## 2. Getting an API Key

1. Log in to the CRM as an **Admin**.
2. Open **Admin Console → API Keys**.
3. Click **Create API Key**, give it a descriptive name (e.g. `Website Contact Form` or `Email Lead Intake`), and **select the organization** the key belongs to. This is required — keys without an organization cannot create leads.
4. Copy the key immediately — it is shown **only once**. Keys look like: `htcrm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
5. Store the key as a secret (environment variable) in the integrating system. Never hard-code it or expose it in browser-side JavaScript.

> **Important for website forms**: The API key must stay on your server. Have your website form POST to your own backend, and let your backend call the CRM API. Do not call the CRM directly from client-side code.

## 3. Endpoints

### 3.1 Create a Lead

```
POST /api/v1/external/leads
```

**Headers**

| Header | Value |
|---|---|
| `x-api-key` | Your API key (required) |
| `Content-Type` | `application/json` |

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `firstName` | string | ✅ | 1–200 chars |
| `lastName` | string | ✅ | 1–200 chars |
| `email` | string | — | Valid email; used for duplicate detection |
| `phone` | string | — | Max 50 chars |
| `company` | string | — | Max 300 chars |
| `title` | string | — | Job title, max 200 chars |
| `topic` | string | — | Subject / message / notes, max 2000 chars |
| `source` | string | — | One of: `website`, `referral`, `phone`, `email`, `event`, `partner`, `other` |
| `rating` | string | — | One of: `hot`, `warm`, `cold` |

Unknown fields are rejected (400). You **cannot** send `organizationId` — it is derived from the API key.

**Success response — new lead created (`201 Created`)**

```json
{
  "duplicate": false,
  "data": {
    "id": "LEAD-000123",
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane.doe@example.com",
    "phone": "+1 555 0100",
    "company": "Acme Health",
    "title": "Director of Operations",
    "topic": "Requested a product demo",
    "status": "new",
    "source": "website",
    "rating": null,
    "organizationId": "2f5e350e-5cb9-45a8-aef7-8ca8194c5081",
    "organizationName": "Lucentria Inc",
    "createdAt": "2026-07-22T15:58:26.819Z",
    "updatedAt": "2026-07-22T15:58:26.819Z"
  }
}
```

**Duplicate response (`200 OK`)** — if a lead with the same email (case-insensitive) already exists in the organization, **no new lead is created** and the existing lead is returned:

```json
{
  "duplicate": true,
  "message": "A lead with this email already exists in the organization. No new lead was created.",
  "data": { "id": "LEAD-000123", "...": "existing lead fields" }
}
```

Check the `duplicate` flag (and/or status code 201 vs 200) to know whether a new lead was created.

### 3.2 Read Back a Lead

```
GET /api/v1/external/leads/:id
```

Returns `{ "data": { ...lead } }` for a lead in your key's organization, or `404` if it doesn't exist (or belongs to another organization).

### 3.3 List Leads

```
GET /api/v1/external/leads?updatedSince=2026-07-01T00:00:00Z&limit=100&offset=0
```

| Query param | Notes |
|---|---|
| `updatedSince` | ISO 8601 timestamp; only leads updated after this time |
| `limit` | Default 100, max 1000 |
| `offset` | Default 0 |

Response: `{ "data": [ ...leads ], "pagination": { "total", "limit", "offset", "hasMore" } }`. Only leads in your key's organization are returned.

## 4. Error Reference

| Status | Meaning | Body |
|---|---|---|
| `400` | Validation failed | `{ "error": "Validation failed", "message": "...", "details": [{ "field": "firstName", "message": "First name is required" }] }` |
| `401` | Missing/invalid/expired API key | `{ "error": "Invalid API key", "message": "..." }` |
| `403` | Key is not bound to an organization | `{ "error": "Organization-bound API key required", "message": "..." }` |
| `404` | Lead not found (or belongs to another org) | `{ "error": "Lead not found", "message": "..." }` |
| `429` | Rate limit exceeded | `{ "error": "Too many requests", "message": "..." }` |
| `500` | Server error | `{ "error": "Failed to create lead", "message": "..." }` |

## 5. Rate Limits

Each API key has its own rate limit (default **100 requests/minute**, configurable per key in the Admin Console). Standard `RateLimit-*` response headers are included. On `429`, wait and retry with backoff.

## 6. Audit Logging

Every request (success and failure) is recorded in the CRM's API access logs, visible in **Admin Console → API Access Logs**. You can also query your own key's logs programmatically via `GET /api/v1/external/logs`.

## 7. Code Examples

### 7.1 curl

```bash
curl -X POST "https://<your-crm-domain>/api/v1/external/leads" \
  -H "x-api-key: $CRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane.doe@example.com",
    "company": "Acme Health",
    "topic": "Requested a product demo",
    "source": "website"
  }'
```

### 7.2 JavaScript / Node (fetch)

```js
async function createCrmLead(lead) {
  const res = await fetch(`${process.env.CRM_BASE_URL}/api/v1/external/leads`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.CRM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(lead),
  });

  const body = await res.json();

  if (res.status === 201) {
    console.log(`Lead created: ${body.data.id} in ${body.data.organizationName}`);
    return { created: true, lead: body.data };
  }
  if (res.status === 200 && body.duplicate) {
    console.log(`Lead already existed: ${body.data.id}`);
    return { created: false, lead: body.data };
  }
  if (res.status === 400) {
    throw new Error(`Validation failed: ${JSON.stringify(body.details)}`);
  }
  if (res.status === 429) {
    throw new Error("Rate limited — retry later");
  }
  throw new Error(`CRM error ${res.status}: ${body.message || body.error}`);
}
```

### 7.3 Website Contact Form (server-side handler)

The form posts to **your** backend; your backend forwards to the CRM.

HTML form:

```html
<form method="POST" action="/api/contact">
  <input name="firstName" placeholder="First name" required />
  <input name="lastName" placeholder="Last name" required />
  <input name="email" type="email" placeholder="Work email" required />
  <input name="company" placeholder="Organization" />
  <textarea name="message" placeholder="How can we help?"></textarea>
  <button type="submit">Contact Us</button>
</form>
```

Express handler:

```js
import express from "express";
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/api/contact", async (req, res) => {
  try {
    const result = await createCrmLead({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      company: req.body.company || undefined,
      topic: req.body.message || undefined,
      source: "website",
    });
    res.json({ ok: true, leadId: result.lead.id, alreadyExisted: !result.created });
  } catch (err) {
    console.error("CRM lead submission failed:", err);
    // Don't lose the inquiry — queue it, email it, or store it for retry
    res.status(502).json({ ok: false, error: "Could not submit your request. Please try again." });
  }
});
```

### 7.4 Email-Parsing Integration

When your email system receives an inquiry, parse the sender and body, then push a lead:

```js
async function handleInboundEmail(email) {
  // email = { fromName: "Jane Doe", fromAddress: "jane.doe@example.com", subject, textBody }
  const [firstName, ...rest] = (email.fromName || "Unknown Sender").trim().split(/\s+/);
  const lastName = rest.join(" ") || "(from email)";

  const result = await createCrmLead({
    firstName,
    lastName,
    email: email.fromAddress,
    topic: `${email.subject}\n\n${(email.textBody || "").slice(0, 1800)}`,
    source: "email",
  });

  return result; // duplicate emails are handled by the CRM automatically
}
```

Use a **separate API key** for the email integration (e.g. `Email Lead Intake`) so audit logs distinguish the two sources — and bind it to a different organization if email leads should land elsewhere.

## 8. Integration Checklist

- [ ] API key created in Admin Console, bound to the correct organization
- [ ] Key stored as a secret (`CRM_API_KEY`), never exposed client-side
- [ ] `source` set appropriately (`website` or `email`) on every submission
- [ ] `duplicate` flag handled (201 = created, 200 = already existed)
- [ ] 400 validation errors surfaced during development
- [ ] 429 retry/backoff and failure fallback (queue or notify) implemented
- [ ] Confirmed `organizationId`/`organizationName` in responses match the intended org
