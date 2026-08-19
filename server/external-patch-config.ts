// Phase E — Controlled PATCH API configuration
// Per-entity mutable-field allowlists and validation schemas for
// PATCH /api/v1/external/{accounts,contacts,leads,opportunities,activities}/:id
//
// Security model:
// - Only fields listed in MUTABLE_FIELDS may be changed via the external PATCH API.
// - IMMUTABLE_FIELDS always return 400 when present in a request body.
// - Any other unknown field returns 400 listing the rejected keys.
// - No arbitrary database updates are possible.

import { z } from "zod";

/**
 * Fields that can NEVER be modified through the external PATCH API,
 * regardless of entity: canonical ID, org ownership, creation timestamp,
 * and system audit / import-provenance fields.
 */
export const IMMUTABLE_FIELDS = [
  "id",
  "organizationId",
  "createdAt",
  "updatedAt",
  "sourceSystem",
  "sourceRecordId",
  "importStatus",
  "importNotes",
  "legacyId",
] as const;

/** Per-entity allowlists of mutable fields (documented source of truth). */
export const MUTABLE_FIELDS: Record<string, readonly string[]> = {
  account: [
    "name", "accountNumber", "type", "category", "ownerId", "industry",
    "website", "phone", "billingAddress", "shippingAddress", "externalId",
  ],
  contact: [
    "accountId", "firstName", "lastName", "email", "phone", "mobile",
    "title", "department", "mailingStreet", "mailingCity", "mailingState",
    "mailingPostalCode", "mailingCountry", "description", "ownerId", "externalId",
  ],
  lead: [
    "firstName", "lastName", "title", "company", "email", "phone", "topic",
    "status", "source", "rating", "ownerId", "externalId",
  ],
  opportunity: [
    // NOTE: categories/operationalAreas (text[] columns) are intentionally
    // excluded — array updates require the raw-SQL path in updateOpportunity.
    "accountId", "name", "stage", "amount", "closeDate", "ownerId",
    "probability", "status", "actualCloseDate", "actualRevenue",
    "estCloseDate", "estRevenue", "rating", "includeInForecast",
    "implementationStartDate", "implementationEndDate", "billingEndDate",
    "description", "externalId",
  ],
  activity: [
    "type", "subject", "status", "priority", "dueAt", "completedAt",
    "notes", "ownerId", "externalId",
  ],
};

// ---- Value validation (types only — key filtering happens in the route) ----

const isoDate = z.string().datetime({ offset: true }).transform(s => new Date(s)).nullable();
const decimalStr = z.union([z.number(), z.string()])
  .transform(v => String(v))
  .refine(v => /^-?\d+(\.\d+)?$/.test(v), "Must be a decimal number")
  .nullable();
const optStr = (max: number) => z.string().trim().max(max).nullable().optional();

export const PATCH_SCHEMAS: Record<string, z.ZodObject<any>> = {
  account: z.object({
    name: z.string().trim().min(1).max(300).optional(),
    accountNumber: optStr(100),
    type: z.enum(["customer", "prospect", "partner", "vendor", "other"]).nullable().optional(),
    category: optStr(200),
    ownerId: optStr(50),
    industry: optStr(200),
    website: optStr(500),
    phone: optStr(50),
    billingAddress: optStr(1000),
    shippingAddress: optStr(1000),
    externalId: optStr(200),
  }),
  contact: z.object({
    accountId: optStr(100),
    firstName: z.string().trim().min(1).max(200).optional(),
    lastName: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: optStr(50),
    mobile: optStr(50),
    title: optStr(200),
    department: optStr(200),
    mailingStreet: optStr(300),
    mailingCity: optStr(200),
    mailingState: optStr(100),
    mailingPostalCode: optStr(40),
    mailingCountry: optStr(100),
    description: optStr(5000),
    ownerId: optStr(50),
    externalId: optStr(200),
  }),
  lead: z.object({
    firstName: z.string().trim().min(1).max(200).optional(),
    lastName: z.string().trim().min(1).max(200).optional(),
    title: optStr(200),
    company: optStr(300),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: optStr(50),
    topic: optStr(2000),
    status: z.enum(["new", "contacted", "qualified", "unqualified", "converted"]).optional(),
    source: z.enum(["website", "referral", "phone", "email", "event", "partner", "lead_generation", "other"]).nullable().optional(),
    rating: z.enum(["hot", "warm", "cold"]).nullable().optional(),
    ownerId: optStr(50),
    externalId: optStr(200),
  }),
  opportunity: z.object({
    accountId: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(300).optional(),
    stage: z.enum(["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]).optional(),
    amount: decimalStr.optional(),
    closeDate: z.string().datetime({ offset: true }).transform(s => new Date(s)).optional(),
    ownerId: optStr(50),
    probability: z.number().int().min(0).max(100).nullable().optional(),
    status: optStr(100),
    actualCloseDate: isoDate.optional(),
    actualRevenue: decimalStr.optional(),
    estCloseDate: isoDate.optional(),
    estRevenue: decimalStr.optional(),
    rating: optStr(50),
    includeInForecast: z.boolean().optional(),
    implementationStartDate: isoDate.optional(),
    implementationEndDate: isoDate.optional(),
    billingEndDate: isoDate.optional(),
    description: optStr(10000),
    externalId: optStr(200),
  }),
  activity: z.object({
    type: z.enum(["call", "email", "meeting", "task", "note"]).optional(),
    subject: z.string().trim().min(1).max(500).optional(),
    status: z.enum(["pending", "completed", "cancelled"]).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    dueAt: isoDate.optional(),
    completedAt: isoDate.optional(),
    notes: optStr(10000),
    ownerId: optStr(50),
    externalId: optStr(200),
  }),
};

/**
 * Split a PATCH body's keys into immutable violations, unknown fields,
 * and the allowed subset for a given entity.
 */
export function classifyPatchFields(entity: string, body: Record<string, any>) {
  const allowlist = MUTABLE_FIELDS[entity];
  const keys = Object.keys(body);
  const immutable = keys.filter(k => (IMMUTABLE_FIELDS as readonly string[]).includes(k));
  const unknown = keys.filter(k => !allowlist.includes(k) && !immutable.includes(k));
  return { immutable, unknown };
}
