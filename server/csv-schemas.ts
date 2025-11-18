// CSV Import/Export Zod Schemas
// Strongly-typed schemas for CSV row parsing to eliminate TypeScript errors

import { z } from "zod";

// Helper to transform empty strings to undefined/null
const optionalString = z
  .string()
  .optional()
  .transform((val) => {
    if (!val || val.trim() === "") return undefined;
    return val.trim();
  });

const nullableString = z
  .string()
  .optional()
  .transform((val) => {
    if (!val || val.trim() === "") return null;
    return val.trim();
  });

// ========== ACCOUNT CSV SCHEMA ==========

export const accountCsvRowSchema = z.object({
  id: optionalString,
  name: z.string().transform((val) => val.trim()),
  accountNumber: optionalString,
  type: optionalString,
  category: optionalString,
  industry: optionalString,
  website: optionalString,
  phone: optionalString,
  primaryContactName: optionalString,
  primaryContactEmail: optionalString,
  billingAddress: optionalString,
  shippingAddress: optionalString,
  externalId: optionalString,
  sourceSystem: optionalString,
  sourceRecordId: optionalString,
  importStatus: optionalString,
  importNotes: optionalString,
});

export type AccountCsvRow = z.infer<typeof accountCsvRowSchema>;

// ========== CONTACT CSV SCHEMA ==========

export const contactCsvRowSchema = z.object({
  id: optionalString,
  firstName: z.string().transform((val) => val.trim()),
  lastName: z.string().transform((val) => val.trim()),
  email: nullableString,
  phone: nullableString,
  mobile: nullableString,
  title: nullableString,
  department: nullableString,
  accountId: nullableString,
  mailingStreet: nullableString,
  mailingCity: nullableString,
  mailingState: nullableString,
  mailingPostalCode: nullableString,
  mailingCountry: nullableString,
  description: nullableString,
  externalId: nullableString,
  sourceSystem: nullableString,
  sourceRecordId: nullableString,
  importStatus: nullableString,
  importNotes: nullableString,
});

export type ContactCsvRow = z.infer<typeof contactCsvRowSchema>;

// ========== LEAD CSV SCHEMA ==========

export const leadCsvRowSchema = z.object({
  id: optionalString,
  firstName: z.string().transform((val) => val.trim()),
  lastName: z.string().transform((val) => val.trim()),
  company: nullableString,
  email: nullableString,
  phone: nullableString,
  topic: nullableString,
  status: optionalString,
  source: optionalString,
  rating: nullableString,
  externalId: nullableString,
  sourceSystem: nullableString,
  sourceRecordId: nullableString,
  importStatus: nullableString,
  importNotes: nullableString,
});

export type LeadCsvRow = z.infer<typeof leadCsvRowSchema>;

// ========== OPPORTUNITY CSV SCHEMA ==========

export const opportunityCsvRowSchema = z.object({
  id: optionalString,
  name: z.string().transform((val) => val.trim()),
  accountId: z.string().transform((val) => val.trim()),
  status: nullableString,
  stage: optionalString,
  amount: optionalString,
  probability: optionalString,
  closeDate: optionalString,
  actualCloseDate: optionalString,
  actualRevenue: optionalString,
  estCloseDate: optionalString,
  estRevenue: optionalString,
  rating: nullableString,
  externalId: nullableString,
  sourceSystem: nullableString,
  sourceRecordId: nullableString,
  importStatus: nullableString,
  importNotes: nullableString,
});

export type OpportunityCsvRow = z.infer<typeof opportunityCsvRowSchema>;

// ========== ACTIVITY CSV SCHEMA ==========

export const activityCsvRowSchema = z.object({
  id: optionalString,
  type: z.string().transform((val) => val.trim()),
  subject: z.string().transform((val) => val.trim()),
  status: optionalString,
  priority: optionalString,
  dueAt: optionalString,
  completedAt: optionalString,
  relatedType: nullableString,
  relatedId: nullableString,
  notes: nullableString,
  externalId: nullableString,
  sourceSystem: nullableString,
  sourceRecordId: nullableString,
  importStatus: nullableString,
  importNotes: nullableString,
});

export type ActivityCsvRow = z.infer<typeof activityCsvRowSchema>;
