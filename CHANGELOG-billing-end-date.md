# Change Integration Guide — Billing End Date Field on Opportunities

**Date:** 2026-05-11
**Version impact:** Additive / non-breaking

---

## What changed

A new optional date field, `billingEndDate`, has been added to the **Opportunities** entity. It captures the date when billing ends on a Statement of Work (SOW), complementing the existing `implementationEndDate` which now represents when billing *starts*.

---

## Database

| Table | Column added | Type | Nullable |
|---|---|---|---|
| `opportunities` | `billing_end_date` | `TIMESTAMP` | Yes |

The column is purely additive — existing rows are unaffected and default to `NULL`.

---

## API changes

### Internal CRM API

Both create and update endpoints now accept and persist `billingEndDate`.

**`POST /api/opportunities`**

New optional body field:

```json
{
  "billingEndDate": "2026-12-31T00:00:00.000Z"   // ISO 8601, nullable
}
```

Validation rule: if both `implementationEndDate` and `billingEndDate` are provided, `billingEndDate` must not be *before* `implementationEndDate`. Violation returns `HTTP 400`:

```json
{ "error": "Billing end date must not be before implementation end date (billing start)" }
```

**`PATCH /api/opportunities/:id`**

Same field and same validation rule applies on update.

---

### External API (API-key authenticated)

Both opportunity endpoints now include `billingEndDate` in the response payload.

**`GET /api/v1/external/opportunities`** — list response item:

```json
{
  "id": "OPP-2025-000001",
  "implementationStartDate": "2026-01-01T00:00:00.000Z",
  "implementationEndDate":   "2026-03-31T00:00:00.000Z",
  "billingEndDate":          "2026-12-31T00:00:00.000Z",
  ...
}
```

**`GET /api/v1/external/opportunities/:id`** — single record response, same field added.

**`GET /api/v1/external/accounts` (with `expand=opportunities`)** — opportunity objects embedded under an account now also include `billingEndDate`.

**`GET /api/v1/external/accounts/:id` (with `expand=opportunities`)** — same as above.

---

## Backup / restore

Backup archives at version **2.1.0+** now include `billingEndDate` for each opportunity record. The field is correctly deserialised from ISO strings back to `Date` objects during restore.

Restoring older backups (v1.x, v2.0.0) that do not contain `billingEndDate` will simply leave the field `NULL` on all restored opportunity rows — no data loss, no errors.

---

## UI changes

### Create Opportunity dialog (`/opportunities`)

- A new **Billing End Date** date picker has been added after the renamed "Implementation End (Billing Start)" picker.

### Edit Opportunity dialog + Detail view (`/opportunities/:id`)

- The same **Billing End Date** picker is present in the edit form.
- The read-only detail view displays the field as **"Billing End Date"** in the Opportunity Information section.
- "Impl. End Date" has been relabelled to **"Impl. End Date (Billing Start)"** for clarity.

---

## TypeScript / schema types

`InsertOpportunity` and `Opportunity` types (from `shared/schema.ts`) now include:

```typescript
billingEndDate?: Date | null;
```

Downstream TypeScript consumers that spread or destructure `Opportunity` objects do not need changes — the field is optional and nullable.

---

## Action required for downstream systems

| System type | Action |
|---|---|
| Systems reading the External API | Update your opportunity response models to handle the new `billingEndDate` field (ISO 8601 string or `null`). |
| Systems writing via the Internal API | Optionally pass `billingEndDate` in create/update payloads. No change required if you do not use the field. |
| ETL / data warehouse pipelines | Add a `billing_end_date` nullable date/timestamp column to your local opportunities table and map the new field. |
| Backup consumers | No action needed — backup files remain backward-compatible. |
