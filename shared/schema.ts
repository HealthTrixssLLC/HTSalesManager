// Health Trixss CRM - Complete Database Schema
// Based on CPDO requirements for lightweight self-hosted CRM

import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, decimal, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ========== ENUMS ==========

// Lead Generation Module Enums
export const lgRunStatusEnum = pgEnum("lg_run_status", ["draft", "active", "stopped", "reviewing", "complete", "archived", "error"]);
export const lgCandidateStatusEnum = pgEnum("lg_candidate_status", ["pending_review", "approved", "rejected", "deferred"]);
export const lgTierEnum = pgEnum("lg_tier", ["tier_1", "tier_2", "tier_3"]);
export const lgDuplicateClassEnum = pgEnum("lg_duplicate_class", ["unique", "possible_duplicate", "confirmed_duplicate"]);
export const lgVerificationStatusEnum = pgEnum("lg_verification_status", ["unverified", "partial", "verified"]);
export const lgDecisionTypeEnum = pgEnum("lg_decision_type", ["approve", "reject", "defer", "edit"]);
export const lgEvidenceSourceTypeEnum = pgEnum("lg_evidence_source_type", ["linkedin", "website", "crm", "manual", "import", "other"]);
export const lgChannelEnum = pgEnum("lg_channel", ["email", "linkedin", "call", "event", "other"]);
export const researchDocumentTypeEnum = pgEnum("research_document_type", ["company_overview", "strategic_approach", "contact_brief", "communication_draft", "manual_note"]);
export const researchDocumentEntityTypeEnum = pgEnum("research_document_entity_type", ["candidate_account", "candidate_contact", "candidate_lead", "lead", "account", "contact", "opportunity"]);

export const userStatusEnum = pgEnum("user_status", ["active", "inactive", "suspended"]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "contacted", "qualified", "unqualified", "converted"]);
export const leadSourceEnum = pgEnum("lead_source", ["website", "referral", "phone", "email", "event", "partner", "other"]);
export const opportunityStageEnum = pgEnum("opportunity_stage", ["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]);
export const activityTypeEnum = pgEnum("activity_type", ["call", "email", "meeting", "task", "note"]);
export const activityStatusEnum = pgEnum("activity_status", ["pending", "completed", "cancelled"]);
export const activityPriorityEnum = pgEnum("activity_priority", ["low", "medium", "high"]);
export const accountTypeEnum = pgEnum("account_type", ["customer", "prospect", "partner", "vendor", "other"]);
export const backupStatusEnum = pgEnum("backup_status", ["pending", "in_progress", "completed", "failed"]);

// ========== CORE AUTH & RBAC TABLES ==========

export const users = pgTable("users", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  password: text("password").notNull(),
  status: userStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const roles = pgTable("roles", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // Admin, SalesManager, SalesRep, ReadOnly
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  resource: text("resource").notNull(), // e.g., "Account", "Lead", "Opportunity"
  action: text("action").notNull(), // e.g., "read", "create", "update", "delete", "convert"
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  userId: varchar("user_id", { length: 50 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: varchar("role_id", { length: 50 }).notNull().references(() => roles.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("user_roles_user_id_idx").on(table.userId),
  roleIdIdx: index("user_roles_role_id_idx").on(table.roleId),
}));

export const rolePermissions = pgTable("role_permissions", {
  roleId: varchar("role_id", { length: 50 }).notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: varchar("permission_id", { length: 50 }).notNull().references(() => permissions.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
}, (table) => ({
  roleIdIdx: index("role_permissions_role_id_idx").on(table.roleId),
  permissionIdIdx: index("role_permissions_permission_id_idx").on(table.permissionId),
}));

// ========== CRM ENTITY TABLES ==========

export const accounts = pgTable("accounts", {
  id: varchar("id", { length: 100 }).primaryKey(), // Custom ID pattern: ACCT-2025-00001
  organizationId: varchar("organization_id", { length: 50 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  accountNumber: text("account_number"), // External account number (e.g., from Dynamics)
  type: accountTypeEnum("type"),
  category: text("category"), // Business category (e.g., Provider, Payer, Vendor)
  ownerId: varchar("owner_id", { length: 50 }).references(() => users.id),
  industry: text("industry"),
  website: text("website"),
  phone: text("phone"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  externalId: text("external_id"), // External system ID (e.g., Dynamics GUID)
  sourceSystem: text("source_system"), // Origin system (e.g., "Dynamics 365")
  sourceRecordId: text("source_record_id"), // Original record ID in source system
  importStatus: text("import_status"), // Import status (e.g., "Success", "Warning", "Error")
  importNotes: text("import_notes"), // Notes from import process
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("accounts_org_id_idx").on(table.organizationId),
  ownerIdIdx: index("accounts_owner_id_idx").on(table.ownerId),
  nameIdx: index("accounts_name_idx").on(table.name),
  accountNumberIdx: index("accounts_account_number_idx").on(table.accountNumber),
  externalIdIdx: index("accounts_external_id_idx").on(table.externalId),
}));

export const contacts = pgTable("contacts", {
  id: varchar("id", { length: 100 }).primaryKey(), // Custom ID pattern: CONT-2501-00001
  organizationId: varchar("organization_id", { length: 50 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: varchar("account_id", { length: 100 }).references(() => accounts.id, { onDelete: "set null" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  title: text("title"),
  department: text("department"),
  mailingStreet: text("mailing_street"),
  mailingCity: text("mailing_city"),
  mailingState: text("mailing_state"),
  mailingPostalCode: text("mailing_postal_code"),
  mailingCountry: text("mailing_country"),
  description: text("description"),
  ownerId: varchar("owner_id", { length: 50 }).references(() => users.id),
  externalId: text("external_id"), // External system ID (e.g., Dynamics GUID)
  sourceSystem: text("source_system"), // Origin system (e.g., "Dynamics 365")
  sourceRecordId: text("source_record_id"), // Original record ID in source system
  importStatus: text("import_status"), // Import status
  importNotes: text("import_notes"), // Import notes
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("contacts_org_id_idx").on(table.organizationId),
  accountIdIdx: index("contacts_account_id_idx").on(table.accountId),
  ownerIdIdx: index("contacts_owner_id_idx").on(table.ownerId),
  emailIdx: index("contacts_email_idx").on(table.email),
  externalIdIdx: index("contacts_external_id_idx").on(table.externalId),
}));

export const leads = pgTable("leads", {
  id: varchar("id", { length: 100 }).primaryKey(), // Custom ID pattern: LEAD-000001
  organizationId: varchar("organization_id", { length: 50 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  title: text("title"),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  topic: text("topic"), // Lead subject/description
  status: leadStatusEnum("status").notNull().default("new"),
  source: leadSourceEnum("source"),
  rating: text("rating"), // Lead temperature: hot, warm, cold
  ownerId: varchar("owner_id", { length: 50 }).references(() => users.id),
  convertedAccountId: varchar("converted_account_id", { length: 100 }).references(() => accounts.id),
  convertedContactId: varchar("converted_contact_id", { length: 100 }).references(() => contacts.id),
  convertedOpportunityId: varchar("converted_opportunity_id", { length: 100 }).references(() => opportunities.id),
  convertedAt: timestamp("converted_at"),
  // Import governance fields for Dynamics 365 migration
  externalId: text("external_id"), // Original Dynamics 365 GUID
  sourceSystem: text("source_system"), // E.g., "Dynamics 365"
  sourceRecordId: text("source_record_id"), // External system record ID
  importStatus: text("import_status"), // Import tracking status
  importNotes: text("import_notes"), // Notes from import process
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("leads_org_id_idx").on(table.organizationId),
  ownerIdIdx: index("leads_owner_id_idx").on(table.ownerId),
  statusIdx: index("leads_status_idx").on(table.status),
  emailIdx: index("leads_email_idx").on(table.email),
  externalIdIdx: index("leads_external_id_idx").on(table.externalId),
  orgEmailUnique: uniqueIndex("leads_org_email_unique_idx")
    .on(table.organizationId, sql`lower(${table.email})`)
    .where(sql`${table.email} IS NOT NULL`),
}));

export const opportunities = pgTable("opportunities", {
  id: varchar("id", { length: 100 }).primaryKey(), // Custom ID pattern: OPP-2025-000001
  organizationId: varchar("organization_id", { length: 50 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: varchar("account_id", { length: 100 }).notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  stage: opportunityStageEnum("stage").notNull().default("prospecting"),
  amount: decimal("amount", { precision: 15, scale: 2 }),
  closeDate: timestamp("close_date").notNull(),
  ownerId: varchar("owner_id", { length: 50 }).references(() => users.id),
  probability: integer("probability").default(0), // 0-100
  status: text("status"), // Dynamics status field (Won, Lost, Open, etc.)
  actualCloseDate: timestamp("actual_close_date"), // Actual close date from Dynamics
  actualRevenue: decimal("actual_revenue", { precision: 15, scale: 2 }), // Actual revenue from Dynamics
  estCloseDate: timestamp("est_close_date"), // Estimated close date from Dynamics
  estRevenue: decimal("est_revenue", { precision: 15, scale: 2 }), // Estimated revenue from Dynamics
  rating: text("rating"), // Dynamics rating field (Hot, Warm, Cold)
  externalId: text("external_id"), // External system ID (e.g., Dynamics GUID)
  sourceSystem: text("source_system"), // Origin system (e.g., "Dynamics 365")
  sourceRecordId: text("source_record_id"), // Original record ID in source system
  importStatus: text("import_status"), // Import status
  importNotes: text("import_notes"), // Import notes
  includeInForecast: boolean("include_in_forecast").notNull().default(true), // Exclude internal/test opportunities from sales metrics
  implementationStartDate: timestamp("implementation_start_date"),
  implementationEndDate: timestamp("implementation_end_date"),
  billingEndDate: timestamp("billing_end_date"),
  categories: text("categories").array(),
  operationalAreas: text("operational_areas").array(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("opportunities_org_id_idx").on(table.organizationId),
  accountIdIdx: index("opportunities_account_id_idx").on(table.accountId),
  ownerIdIdx: index("opportunities_owner_id_idx").on(table.ownerId),
  stageIdx: index("opportunities_stage_idx").on(table.stage),
  statusIdx: index("opportunities_status_idx").on(table.status),
  closeDateIdx: index("opportunities_close_date_idx").on(table.closeDate),
  externalIdIdx: index("opportunities_external_id_idx").on(table.externalId),
  includeInForecastIdx: index("opportunities_include_in_forecast_idx").on(table.includeInForecast),
}));

export const activities = pgTable("activities", {
  id: varchar("id", { length: 100 }).primaryKey(), // Custom ID pattern: ACV-2501-00001
  organizationId: varchar("organization_id", { length: 50 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: activityTypeEnum("type").notNull(),
  subject: text("subject").notNull(),
  status: activityStatusEnum("status").notNull().default("pending"),
  priority: activityPriorityEnum("priority").notNull().default("medium"),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  ownerId: varchar("owner_id", { length: 50 }).references(() => users.id),
  relatedType: text("related_type"), // "Account", "Contact", "Lead", "Opportunity" - DEPRECATED, use activity_associations
  relatedId: varchar("related_id", { length: 100 }), // ID of related record - DEPRECATED, use activity_associations
  notes: text("notes"),
  externalId: text("external_id"), // External system ID (e.g., Dynamics GUID)
  sourceSystem: text("source_system"), // Origin system (e.g., "Dynamics 365")
  sourceRecordId: text("source_record_id"), // Original record ID in source system
  importStatus: text("import_status"), // Import status
  importNotes: text("import_notes"), // Import notes
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("activities_org_id_idx").on(table.organizationId),
  ownerIdIdx: index("activities_owner_id_idx").on(table.ownerId),
  relatedIdx: index("activities_related_idx").on(table.relatedType, table.relatedId),
  dueAtIdx: index("activities_due_at_idx").on(table.dueAt),
  externalIdIdx: index("activities_external_id_idx").on(table.externalId),
  statusIdx: index("activities_status_idx").on(table.status),
}));

export const activityAssociations = pgTable("activity_associations", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  activityId: varchar("activity_id", { length: 100 }).notNull().references(() => activities.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), // "Account", "Contact", "Lead", "Opportunity"
  entityId: varchar("entity_id", { length: 100 }).notNull(), // ID of the related entity
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  activityIdIdx: index("activity_associations_activity_id_idx").on(table.activityId),
  entityIdx: index("activity_associations_entity_idx").on(table.entityType, table.entityId),
  uniqueAssociation: uniqueIndex("activity_associations_unique_idx").on(table.activityId, table.entityType, table.entityId),
}));

// ========== AUDIT & SYSTEM TABLES ==========

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  actorId: varchar("actor_id", { length: 50 }).references(() => users.id),
  action: text("action").notNull(), // "create", "update", "delete", "convert", etc.
  resource: text("resource").notNull(), // "Account", "Lead", etc.
  resourceId: text("resource_id"),
  before: jsonb("before"), // Before state (for updates/deletes)
  after: jsonb("after"), // After state (for creates/updates)
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  resourceIdx: index("audit_logs_resource_idx").on(table.resource, table.resourceId),
  actorIdIdx: index("audit_logs_actor_id_idx").on(table.actorId),
  createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
}));

export const idPatterns = pgTable("id_patterns", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  entity: text("entity").notNull(), // "Account", "Contact", "Lead", etc.
  pattern: text("pattern").notNull(), // e.g., "ACCT-{YYYY}-{SEQ:5}"
  counter: integer("counter").notNull().default(0),
  startValue: integer("start_value").default(1),
  lastIssued: text("last_issued"),
  organizationId: varchar("organization_id", { length: 50 }).references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  entityOrgUnique: uniqueIndex("id_patterns_entity_org_idx").on(table.entity, table.organizationId),
  orgIdx: index("id_patterns_org_idx").on(table.organizationId),
}));

export const accountCategories = pgTable("account_categories", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  organizationId: varchar("organization_id", { length: 50 }).references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameOrgUnique: uniqueIndex("account_categories_name_org_idx").on(table.name, table.organizationId),
  orgIdx: index("account_categories_org_idx").on(table.organizationId),
}));

export const backupJobs = pgTable("backup_jobs", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  status: backupStatusEnum("status").notNull().default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  path: text("path"),
  sizeBytes: integer("size_bytes"),
  checksum: text("checksum"),
  initiatedBy: varchar("initiated_by", { length: 50 }).references(() => users.id),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ========== COMMENTS SYSTEM ==========

export const comments = pgTable("comments", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  entity: text("entity").notNull(), // "Account", "Contact", "Lead", "Opportunity"
  entityId: varchar("entity_id", { length: 100 }).notNull(), // ID of the record
  parentId: varchar("parent_id", { length: 50 }).references((): any => comments.id, { onDelete: "cascade" }),
  depth: integer("depth").notNull().default(0), // 0 = top-level, max 2
  body: text("body").notNull(), // Markdown content
  bodyHtml: text("body_html"), // Sanitized HTML (optional)
  mentions: jsonb("mentions").default([]), // Array of {userId, display}
  isPinned: boolean("is_pinned").notNull().default(false),
  isResolved: boolean("is_resolved").notNull().default(false),
  createdBy: varchar("created_by", { length: 50 }).notNull().references(() => users.id),
  editedBy: varchar("edited_by", { length: 50 }).references(() => users.id),
  editHistory: jsonb("edit_history").default([]), // Array of {at, by, from, to}
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("comments_entity_idx").on(table.entity, table.entityId, table.createdAt),
  parentIdx: index("comments_parent_idx").on(table.parentId),
  createdByIdx: index("comments_created_by_idx").on(table.createdBy),
}));

export const commentReactions = pgTable("comment_reactions", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id", { length: 50 }).notNull().references(() => comments.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 50 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(), // "👍", "❤️", "🎉", "👀", "🚀"
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  commentIdx: index("comment_reactions_comment_idx").on(table.commentId),
  uniqueReaction: index("comment_reactions_unique_idx").on(table.commentId, table.userId, table.emoji),
}));

export const commentAttachments = pgTable("comment_attachments", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id", { length: 50 }).notNull().references(() => comments.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(), // bytes
  url: text("url").notNull(), // Storage path or URL
  thumbnailUrl: text("thumbnail_url"), // For images/PDFs
  uploadedBy: varchar("uploaded_by", { length: 50 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  commentIdx: index("comment_attachments_comment_idx").on(table.commentId),
}));

export const commentSubscriptions = pgTable("comment_subscriptions", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id", { length: 50 }).notNull().references(() => comments.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 50 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueSubscription: index("comment_subscriptions_unique_idx").on(table.commentId, table.userId),
}));

// ========== API KEYS FOR EXTERNAL INTEGRATIONS ==========

export const apiKeys = pgTable("api_keys", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  hashedKey: text("hashed_key").notNull().unique(), // Bcrypt hash of the API key
  name: text("name").notNull(), // Human-readable name for the key
  description: text("description"), // Purpose/usage description
  isActive: boolean("is_active").notNull().default(true),
  rateLimitPerMin: integer("rate_limit_per_min").default(100), // Requests per minute limit
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"), // Optional expiration date
  organizationId: varchar("organization_id", { length: 50 }).references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: varchar("created_by", { length: 50 }).notNull().references(() => users.id),
  revokedBy: varchar("revoked_by", { length: 50 }).references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  hashedKeyIdx: index("api_keys_hashed_key_idx").on(table.hashedKey),
  isActiveIdx: index("api_keys_is_active_idx").on(table.isActive),
  orgIdx: index("api_keys_org_idx").on(table.organizationId),
}));

// ========== TAGS SYSTEM ==========

export const tags = pgTable("tags", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#3b82f6"), // Hex color for tag badge
  createdBy: varchar("created_by", { length: 50 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("tags_name_idx").on(table.name),
}));

export const entityTags = pgTable("entity_tags", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  entity: text("entity").notNull(), // "Account", "Contact", "Lead", "Opportunity", "Activity"
  entityId: varchar("entity_id", { length: 100 }).notNull(), // ID of the record
  tagId: varchar("tag_id", { length: 50 }).notNull().references(() => tags.id, { onDelete: "cascade" }),
  createdBy: varchar("created_by", { length: 50 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("entity_tags_entity_idx").on(table.entity, table.entityId),
  tagIdx: index("entity_tags_tag_idx").on(table.tagId),
  uniqueTag: uniqueIndex("entity_tags_unique_idx").on(table.entity, table.entityId, table.tagId),
}));

// ========== OPPORTUNITY RESOURCES (Workforce/Resource Planning) ==========

export const opportunityResources = pgTable("opportunity_resources", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  opportunityId: varchar("opportunity_id", { length: 100 }).notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 50 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role"),
  allocation: integer("allocation").default(100),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  opportunityIdIdx: index("opportunity_resources_opportunity_id_idx").on(table.opportunityId),
  userIdIdx: index("opportunity_resources_user_id_idx").on(table.userId),
  uniqueAssignment: uniqueIndex("opportunity_resources_unique_idx").on(table.opportunityId, table.userId),
}));

// ========== SAVED FILTER PRESETS ==========

export const savedFilters = pgTable("saved_filters", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 50 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  pageName: varchar("page_name", { length: 50 }).notNull(), // e.g. "opportunities", "accounts"
  name: text("name").notNull(),
  filters: jsonb("filters").notNull(), // Stored filter state as JSON
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userPageIdx: index("saved_filters_user_page_idx").on(table.userId, table.pageName),
}));

// ========== RESEARCH DOCUMENTS ==========

export const researchDocuments = pgTable("research_documents", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  entityType: researchDocumentEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  documentType: researchDocumentTypeEnum("document_type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceAgentPhase: text("source_agent_phase"),
  runId: varchar("run_id", { length: 50 }),
  createdBy: varchar("created_by", { length: 50 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("research_documents_entity_idx").on(table.entityType, table.entityId),
  runIdIdx: index("research_documents_run_id_idx").on(table.runId),
  documentTypeIdx: index("research_documents_doc_type_idx").on(table.documentType),
}));

// ========== LLM CONFIGURATION TABLE ==========

export const llmConfigurations = pgTable("llm_configurations", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().default("openai"), // "openai", "anthropic", "custom", "azure"
  baseUrl: text("base_url"),
  encryptedApiKey: text("encrypted_api_key"),
  apiKeyHint: text("api_key_hint"), // Last 4 chars of key for display masking
  modelName: text("model_name").notNull().default("gpt-4o"),
  apiVersion: text("api_version"), // Azure OpenAI: e.g. "2024-12-01-preview"
  temperature: decimal("temperature", { precision: 3, scale: 2 }).notNull().default("0.7"),
  maxTokens: integer("max_tokens").notNull().default(4096),
  requestTimeout: integer("request_timeout").notNull().default(60), // seconds
  enabledAgents: jsonb("enabled_agents").default(["market_research", "company_discovery", "lead_discovery", "strategy", "communication_drafting"]),
  agentModelOverrides: jsonb("agent_model_overrides").default({}), // { agentName: modelName }
  organizationId: varchar("organization_id", { length: 50 }).references(() => organizations.id, { onDelete: "cascade" }),
  updatedBy: varchar("updated_by", { length: 50 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("llm_configurations_org_idx").on(table.organizationId),
}));

export const insertLlmConfigurationSchema = createInsertSchema(llmConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLlmConfiguration = z.infer<typeof insertLlmConfigurationSchema>;
export type LlmConfiguration = typeof llmConfigurations.$inferSelect;

// ========== LEAD GENERATION MODULE TABLES ==========

export const icpProfiles = pgTable("icp_profiles", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  organizationId: varchar("organization_id", { length: 50 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: varchar("created_by", { length: 50 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("icp_profiles_name_idx").on(table.name),
  orgIdIdx: index("icp_profiles_org_id_idx").on(table.organizationId),
}));

export const icpProfileVersions = pgTable("icp_profile_versions", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  icpProfileId: varchar("icp_profile_id", { length: 50 }).notNull().references(() => icpProfiles.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull().default(1),
  targetIndustries: text("target_industries").array(),
  targetCompanySizes: text("target_company_sizes").array(),
  targetGeographies: text("target_geographies").array(),
  targetTitles: text("target_titles").array(),
  scoringRubric: jsonb("scoring_rubric").default({}),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by", { length: 50 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  icpProfileIdIdx: index("icp_profile_versions_profile_id_idx").on(table.icpProfileId),
}));

export const offers = pgTable("offers", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  icpProfileId: varchar("icp_profile_id", { length: 50 }).notNull().references(() => icpProfiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  valueProposition: text("value_proposition"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by", { length: 50 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  icpProfileIdIdx: index("offers_icp_profile_id_idx").on(table.icpProfileId),
}));

export const taskPlaybooks = pgTable("task_playbooks", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  icpProfileId: varchar("icp_profile_id", { length: 50 }).references(() => icpProfiles.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  organizationId: varchar("organization_id", { length: 50 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: varchar("created_by", { length: 50 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("task_playbooks_name_idx").on(table.name),
  orgIdIdx: index("task_playbooks_org_id_idx").on(table.organizationId),
}));

export const taskPlaybookSteps = pgTable("task_playbook_steps", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  playbookId: varchar("playbook_id", { length: 50 }).notNull().references(() => taskPlaybooks.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  channel: lgChannelEnum("channel").notNull().default("email"),
  dayOffset: integer("day_offset").notNull().default(0),
  activityType: activityTypeEnum("activity_type").notNull().default("task"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  playbookIdIdx: index("task_playbook_steps_playbook_id_idx").on(table.playbookId),
}));

export const leadGenerationRuns = pgTable("lead_generation_runs", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  organizationId: varchar("organization_id", { length: 50 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  icpProfileId: varchar("icp_profile_id", { length: 50 }).references(() => icpProfiles.id),
  icpVersionId: varchar("icp_version_id", { length: 50 }).references(() => icpProfileVersions.id),
  playbookId: varchar("playbook_id", { length: 50 }).references(() => taskPlaybooks.id, { onDelete: "set null" }),
  status: lgRunStatusEnum("status").notNull().default("draft"),
  ownerId: varchar("owner_id", { length: 50 }).references(() => users.id),
  targetCount: integer("target_count"),
  seedCompanies: text("seed_companies").array(),
  candidateCount: integer("candidate_count").notNull().default(0),
  reviewedCount: integer("reviewed_count").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  deferredCount: integer("deferred_count").notNull().default(0),
  currentPhase: text("current_phase"),
  phaseLog: jsonb("phase_log").default([]),
  errorPhase: text("error_phase"),
  errorReason: text("error_reason"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdBy: varchar("created_by", { length: 50 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("lg_runs_status_idx").on(table.status),
  ownerIdIdx: index("lg_runs_owner_id_idx").on(table.ownerId),
  orgIdIdx: index("lg_runs_org_id_idx").on(table.organizationId),
}));

export const agentStepLogs = pgTable("agent_step_logs", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id", { length: 50 }).notNull().references(() => leadGenerationRuns.id, { onDelete: "cascade" }),
  phase: text("phase").notNull(),
  stepName: text("step_name").notNull(),
  promptSent: text("prompt_sent"),
  responseReceived: text("response_received"),
  modelUsed: text("model_used"),
  providerUsed: text("provider_used"),
  durationMs: integer("duration_ms"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  runIdIdx: index("agent_step_logs_run_id_idx").on(table.runId),
  phaseIdx: index("agent_step_logs_phase_idx").on(table.phase),
  createdAtIdx: index("agent_step_logs_created_at_idx").on(table.createdAt),
}));

export const insertAgentStepLogSchema = createInsertSchema(agentStepLogs).omit({ id: true, createdAt: true });
export type InsertAgentStepLog = z.infer<typeof insertAgentStepLogSchema>;
export type AgentStepLog = typeof agentStepLogs.$inferSelect;

export const candidateAccounts = pgTable("candidate_accounts", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id", { length: 50 }).notNull().references(() => leadGenerationRuns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  domain: text("domain"),
  website: text("website"),
  industry: text("industry"),
  companySize: text("company_size"),
  geography: text("geography"),
  description: text("description"),
  icpFitRationale: text("icp_fit_rationale"),
  companyOverview: text("company_overview"),
  strategicApproach: text("strategic_approach"),
  sourceAgentPhase: text("source_agent_phase"),
  linkedinUrl: text("linkedin_url"),
  existingAccountId: varchar("existing_account_id", { length: 100 }).references(() => accounts.id),
  citations: jsonb("citations").default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  runIdIdx: index("candidate_accounts_run_id_idx").on(table.runId),
}));

export const candidateContacts = pgTable("candidate_contacts", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  candidateAccountId: varchar("candidate_account_id", { length: 50 }).references(() => candidateAccounts.id, { onDelete: "cascade" }),
  runId: varchar("run_id", { length: 50 }).notNull().references(() => leadGenerationRuns.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  linkedinUrl: text("linkedin_url"),
  roleFitRationale: text("role_fit_rationale"),
  outreachPriority: text("outreach_priority"),
  sourceAgentPhase: text("source_agent_phase"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateAccountIdIdx: index("candidate_contacts_account_id_idx").on(table.candidateAccountId),
  runIdIdx: index("candidate_contacts_run_id_idx").on(table.runId),
}));

export const candidateLeads = pgTable("candidate_leads", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id", { length: 50 }).notNull().references(() => leadGenerationRuns.id, { onDelete: "cascade" }),
  candidateAccountId: varchar("candidate_account_id", { length: 50 }).references(() => candidateAccounts.id, { onDelete: "cascade" }),
  candidateContactId: varchar("candidate_contact_id", { length: 50 }).references(() => candidateContacts.id),
  status: lgCandidateStatusEnum("status").notNull().default("pending_review"),
  tier: lgTierEnum("tier"),
  duplicateClass: lgDuplicateClassEnum("duplicate_class").notNull().default("unique"),
  verificationStatus: lgVerificationStatusEnum("verification_status").notNull().default("unverified"),
  assignedPlaybookId: varchar("assigned_playbook_id", { length: 50 }).references(() => taskPlaybooks.id),
  communicationPlan: jsonb("communication_plan"),
  reviewNote: text("review_note"),
  reviewedBy: varchar("reviewed_by", { length: 50 }).references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdBy: varchar("created_by", { length: 50 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  runIdIdx: index("candidate_leads_run_id_idx").on(table.runId),
  statusIdx: index("candidate_leads_status_idx").on(table.status),
  tierIdx: index("candidate_leads_tier_idx").on(table.tier),
}));

export const candidateScores = pgTable("candidate_scores", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  candidateLeadId: varchar("candidate_lead_id", { length: 50 }).notNull().references(() => candidateLeads.id, { onDelete: "cascade" }),
  totalScore: integer("total_score").notNull().default(0),
  maxScore: integer("max_score").notNull().default(100),
  industryScore: integer("industry_score"),
  sizeScore: integer("size_score"),
  geoScore: integer("geo_score"),
  titleScore: integer("title_score"),
  rationale: text("rationale"),
  details: jsonb("details").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateLeadIdIdx: index("candidate_scores_lead_id_idx").on(table.candidateLeadId),
}));

export const evidenceSources = pgTable("evidence_sources", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  candidateLeadId: varchar("candidate_lead_id", { length: 50 }).references(() => candidateLeads.id, { onDelete: "cascade" }),
  candidateAccountId: varchar("candidate_account_id", { length: 50 }).references(() => candidateAccounts.id, { onDelete: "cascade" }),
  sourceType: lgEvidenceSourceTypeEnum("source_type").notNull().default("manual"),
  url: text("url"),
  title: text("title"),
  content: text("content"),
  collectedAt: timestamp("collected_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateLeadIdIdx: index("evidence_sources_lead_id_idx").on(table.candidateLeadId),
}));

export const reviewDecisions = pgTable("review_decisions", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  candidateLeadId: varchar("candidate_lead_id", { length: 50 }).notNull().references(() => candidateLeads.id, { onDelete: "cascade" }),
  decisionType: lgDecisionTypeEnum("decision_type").notNull(),
  decidedBy: varchar("decided_by", { length: 50 }).references(() => users.id),
  note: text("note"),
  editsBefore: jsonb("edits_before"),
  editsAfter: jsonb("edits_after"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateLeadIdIdx: index("review_decisions_lead_id_idx").on(table.candidateLeadId),
}));

export const lgCrmLeads = pgTable("lg_crm_leads", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  candidateLeadId: varchar("candidate_lead_id", { length: 50 }).notNull().references(() => candidateLeads.id),
  crmLeadId: varchar("crm_lead_id", { length: 100 }).notNull().references(() => leads.id),
  runId: varchar("run_id", { length: 50 }).references(() => leadGenerationRuns.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateLeadIdIdx: index("lg_crm_leads_candidate_id_idx").on(table.candidateLeadId),
  crmLeadIdIdx: index("lg_crm_leads_crm_lead_id_idx").on(table.crmLeadId),
}));

export const lgCrmTasks = pgTable("lg_crm_tasks", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  candidateLeadId: varchar("candidate_lead_id", { length: 50 }).notNull().references(() => candidateLeads.id),
  activityId: varchar("activity_id", { length: 100 }).notNull().references(() => activities.id),
  playbookStepId: varchar("playbook_step_id", { length: 50 }).references(() => taskPlaybookSteps.id),
  runId: varchar("run_id", { length: 50 }).references(() => leadGenerationRuns.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateLeadIdIdx: index("lg_crm_tasks_candidate_id_idx").on(table.candidateLeadId),
}));

export const lgAuditEvents = pgTable("lg_audit_events", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  actorId: varchar("actor_id", { length: 50 }).references(() => users.id),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  runId: varchar("run_id", { length: 50 }).references(() => leadGenerationRuns.id),
  details: jsonb("details").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  runIdIdx: index("lg_audit_events_run_id_idx").on(table.runId),
  actorIdIdx: index("lg_audit_events_actor_id_idx").on(table.actorId),
  createdAtIdx: index("lg_audit_events_created_at_idx").on(table.createdAt),
}));

export const aiConfigs = pgTable("ai_configs", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  apiKeyEnvVar: text("api_key_env_var"),
  baseUrl: text("base_url"),
  temperature: decimal("temperature", { precision: 3, scale: 2 }).default("0.7"),
  maxTokens: integer("max_tokens").default(4096),
  agentPhase: text("agent_phase"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata").default({}),
  createdBy: varchar("created_by", { length: 50 }).references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  providerIdx: index("ai_configs_provider_idx").on(table.provider),
  isDefaultIdx: index("ai_configs_is_default_idx").on(table.isDefault),
  agentPhaseIdx: index("ai_configs_agent_phase_idx").on(table.agentPhase),
}));

// ========== RELATIONS ==========

export const usersRelations = relations(users, ({ many }) => ({
  userRoles: many(userRoles),
  ownedAccounts: many(accounts),
  ownedContacts: many(contacts),
  ownedLeads: many(leads),
  ownedOpportunities: many(opportunities),
  ownedActivities: many(activities),
  auditLogs: many(auditLogs),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  owner: one(users, { fields: [accounts.ownerId], references: [users.id] }),
  contacts: many(contacts),
  opportunities: many(opportunities),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  account: one(accounts, { fields: [contacts.accountId], references: [accounts.id] }),
  owner: one(users, { fields: [contacts.ownerId], references: [users.id] }),
}));

export const leadsRelations = relations(leads, ({ one }) => ({
  owner: one(users, { fields: [leads.ownerId], references: [users.id] }),
  convertedAccount: one(accounts, { fields: [leads.convertedAccountId], references: [accounts.id] }),
  convertedContact: one(contacts, { fields: [leads.convertedContactId], references: [contacts.id] }),
  convertedOpportunity: one(opportunities, { fields: [leads.convertedOpportunityId], references: [opportunities.id] }),
}));

export const opportunitiesRelations = relations(opportunities, ({ one, many }) => ({
  account: one(accounts, { fields: [opportunities.accountId], references: [accounts.id] }),
  owner: one(users, { fields: [opportunities.ownerId], references: [users.id] }),
  resources: many(opportunityResources),
}));

export const opportunityResourcesRelations = relations(opportunityResources, ({ one }) => ({
  opportunity: one(opportunities, { fields: [opportunityResources.opportunityId], references: [opportunities.id] }),
  user: one(users, { fields: [opportunityResources.userId], references: [users.id] }),
}));

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  owner: one(users, { fields: [activities.ownerId], references: [users.id] }),
  associations: many(activityAssociations),
}));

export const activityAssociationsRelations = relations(activityAssociations, ({ one }) => ({
  activity: one(activities, { fields: [activityAssociations.activityId], references: [activities.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));

// ========== ZOD SCHEMAS & TYPES ==========

// Users
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
});

export const selectUserSchema = createSelectSchema(users).omit({ password: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = Omit<typeof users.$inferSelect, 'password'>;

// Roles
export const insertRoleSchema = createInsertSchema(roles).omit({ id: true, createdAt: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

// Permissions
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true, createdAt: true });
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;

// Accounts
export const insertAccountSchema = createInsertSchema(accounts).omit({ createdAt: true, updatedAt: true }).extend({
  name: z.string().min(1, "Account name is required"),
  accountNumber: z.string().optional(),
  category: z.string().optional(),
  organizationId: z.string().optional(),
});
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

// Contacts
export const insertContactSchema = createInsertSchema(contacts).omit({ createdAt: true, updatedAt: true }).extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  organizationId: z.string().optional(),
});
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

// Leads
export const insertLeadSchema = createInsertSchema(leads).omit({ 
  createdAt: true, 
  updatedAt: true,
  convertedAccountId: true,
  convertedContactId: true,
  convertedOpportunityId: true,
  convertedAt: true,
}).extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  organizationId: z.string().optional(),
});
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

// Opportunities - handle date string conversion for closeDate, actualCloseDate, estCloseDate
const datePreprocessor = (val: unknown) => {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date) return val;
  if (typeof val === "string") {
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

export const insertOpportunitySchema = createInsertSchema(opportunities)
  .omit({ createdAt: true, updatedAt: true })
  .extend({
    name: z.string().min(1, "Opportunity name is required"),
    accountId: z.string().min(1, "Account is required"),
    closeDate: z.preprocess(
      datePreprocessor,
      z.date({ required_error: "Close date is required" })
    ),
    actualCloseDate: z.preprocess(datePreprocessor, z.date().nullable()),
    estCloseDate: z.preprocess(datePreprocessor, z.date().nullable()),
    implementationStartDate: z.preprocess(datePreprocessor, z.date().nullable()),
    implementationEndDate: z.preprocess(datePreprocessor, z.date().nullable()),
    billingEndDate: z.preprocess(datePreprocessor, z.date().nullable()),
    organizationId: z.string().optional(),
  });
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type Opportunity = typeof opportunities.$inferSelect;

// Activities
export const insertActivitySchema = createInsertSchema(activities).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  subject: z.string().min(1, "Subject is required"),
  dueAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  ownerId: z.string().nullish(),
  notes: z.string().nullish(),
  organizationId: z.string().optional(),
});
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activities.$inferSelect;

// Activity Associations
export const insertActivityAssociationSchema = createInsertSchema(activityAssociations).omit({ id: true, createdAt: true });
export type InsertActivityAssociation = z.infer<typeof insertActivityAssociationSchema>;
export type ActivityAssociation = typeof activityAssociations.$inferSelect;

// AuditLogs
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// IdPatterns
export const insertIdPatternSchema = createInsertSchema(idPatterns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIdPattern = z.infer<typeof insertIdPatternSchema>;
export type IdPattern = typeof idPatterns.$inferSelect;

// AccountCategories
export const insertAccountCategorySchema = createInsertSchema(accountCategories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccountCategory = z.infer<typeof insertAccountCategorySchema>;
export type AccountCategory = typeof accountCategories.$inferSelect;

// BackupJobs
export const insertBackupJobSchema = createInsertSchema(backupJobs).omit({ id: true, createdAt: true });
export type InsertBackupJob = z.infer<typeof insertBackupJobSchema>;
export type BackupJob = typeof backupJobs.$inferSelect;

// API Keys - handle date string conversion for expiresAt
export const insertApiKeySchema = createInsertSchema(apiKeys)
  .omit({ id: true, createdAt: true })
  .extend({
    expiresAt: z.preprocess(
      (val) => {
        if (val === null || val === undefined || val === "") return null;
        if (val instanceof Date) return val;
        if (typeof val === "string") return new Date(val);
        return val;
      },
      z.date().nullable().optional()
    ).optional(),
  });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;

export const insertTagSchema = createInsertSchema(tags).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTag = z.infer<typeof insertTagSchema>;
export type Tag = typeof tags.$inferSelect;

// EntityTags
export const insertEntityTagSchema = createInsertSchema(entityTags).omit({ id: true, createdAt: true });
export type InsertEntityTag = z.infer<typeof insertEntityTagSchema>;
export type EntityTag = typeof entityTags.$inferSelect;

// OpportunityResources
export const insertOpportunityResourceSchema = createInsertSchema(opportunityResources).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  startDate: z.preprocess(datePreprocessor, z.date().nullable()).optional(),
  endDate: z.preprocess(datePreprocessor, z.date().nullable()).optional(),
});
export type InsertOpportunityResource = z.infer<typeof insertOpportunityResourceSchema>;
export type OpportunityResource = typeof opportunityResources.$inferSelect;

// SavedFilters
export const insertSavedFilterSchema = createInsertSchema(savedFilters).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSavedFilter = z.infer<typeof insertSavedFilterSchema>;
export type SavedFilter = typeof savedFilters.$inferSelect;

// ========== API RESPONSE TYPES ==========

export type AccountWithRelations = Account & {
  owner: User;
  contacts?: Contact[];
  opportunities?: Opportunity[];
};

export type ContactWithRelations = Contact & {
  account?: Account | null;
  owner: User;
};

export type LeadWithRelations = Lead & {
  owner: User;
};

export type OpportunityWithRelations = Opportunity & {
  account: Account;
  owner: User;
};

export type ActivityWithRelations = Activity & {
  owner: User;
};

export type UserWithRoles = User & {
  roles: (Role & { permissions: Permission[] })[];
};

// Comments
export const insertCommentSchema = createInsertSchema(comments).omit({ 
  id: true,
  createdAt: true, 
  updatedAt: true,
  bodyHtml: true,
  editHistory: true,
}).extend({
  body: z.string().min(1, "Comment body is required"),
  entity: z.enum(["Account", "Contact", "Lead", "Opportunity"]),
  entityId: z.string().min(1, "Entity ID is required"),
  depth: z.number().max(2, "Maximum comment depth is 2"),
});
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof comments.$inferSelect;

// Comment Reactions
export const insertCommentReactionSchema = createInsertSchema(commentReactions).omit({ 
  id: true,
  createdAt: true,
}).extend({
  emoji: z.enum(["👍", "❤️", "🎉", "👀", "🚀"]),
});
export type InsertCommentReaction = z.infer<typeof insertCommentReactionSchema>;
export type CommentReaction = typeof commentReactions.$inferSelect;

// Comment Attachments
export const insertCommentAttachmentSchema = createInsertSchema(commentAttachments).omit({ 
  id: true,
  createdAt: true,
}).extend({
  size: z.number().max(25 * 1024 * 1024, "File size must be less than 25MB"),
});
export type InsertCommentAttachment = z.infer<typeof insertCommentAttachmentSchema>;
export type CommentAttachment = typeof commentAttachments.$inferSelect;

// Comment Subscriptions
export const insertCommentSubscriptionSchema = createInsertSchema(commentSubscriptions).omit({ 
  id: true,
  createdAt: true,
});
export type InsertCommentSubscription = z.infer<typeof insertCommentSubscriptionSchema>;
export type CommentSubscription = typeof commentSubscriptions.$inferSelect;

// Comment with full details (for API responses)
export type CommentWithDetails = Comment & {
  createdByUser: User;
  editedByUser?: User | null;
  attachments: CommentAttachment[];
  reactions: Record<string, number>;
  replyCount?: number;
  userReaction?: string | null;
};

// ========== LEAD GENERATION MODULE SCHEMAS & TYPES ==========

// ICP Profiles
export const insertIcpProfileSchema = createInsertSchema(icpProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIcpProfile = z.infer<typeof insertIcpProfileSchema>;
export type IcpProfile = typeof icpProfiles.$inferSelect;

// ICP Profile Versions
export const insertIcpProfileVersionSchema = createInsertSchema(icpProfileVersions).omit({ id: true, createdAt: true });
export type InsertIcpProfileVersion = z.infer<typeof insertIcpProfileVersionSchema>;
export type IcpProfileVersion = typeof icpProfileVersions.$inferSelect;

// Offers
export const insertOfferSchema = createInsertSchema(offers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOffer = z.infer<typeof insertOfferSchema>;
export type Offer = typeof offers.$inferSelect;

// Task Playbooks
export const insertTaskPlaybookSchema = createInsertSchema(taskPlaybooks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaskPlaybook = z.infer<typeof insertTaskPlaybookSchema>;
export type TaskPlaybook = typeof taskPlaybooks.$inferSelect;

// Task Playbook Steps
export const insertTaskPlaybookStepSchema = createInsertSchema(taskPlaybookSteps).omit({ id: true, createdAt: true });
export type InsertTaskPlaybookStep = z.infer<typeof insertTaskPlaybookStepSchema>;
export type TaskPlaybookStep = typeof taskPlaybookSteps.$inferSelect;

// Lead Generation Runs
export const insertLeadGenerationRunSchema = createInsertSchema(leadGenerationRuns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeadGenerationRun = z.infer<typeof insertLeadGenerationRunSchema>;
export type LeadGenerationRun = typeof leadGenerationRuns.$inferSelect;

// Candidate Accounts
export const insertCandidateAccountSchema = createInsertSchema(candidateAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCandidateAccount = z.infer<typeof insertCandidateAccountSchema>;
export type CandidateAccount = typeof candidateAccounts.$inferSelect;

// Candidate Contacts
export const insertCandidateContactSchema = createInsertSchema(candidateContacts).omit({ id: true, createdAt: true });
export type InsertCandidateContact = z.infer<typeof insertCandidateContactSchema>;
export type CandidateContact = typeof candidateContacts.$inferSelect;

// Candidate Leads
export const insertCandidateLeadSchema = createInsertSchema(candidateLeads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCandidateLead = z.infer<typeof insertCandidateLeadSchema>;
export type CandidateLead = typeof candidateLeads.$inferSelect;

// Candidate Scores
export const insertCandidateScoreSchema = createInsertSchema(candidateScores).omit({ id: true, createdAt: true });
export type InsertCandidateScore = z.infer<typeof insertCandidateScoreSchema>;
export type CandidateScore = typeof candidateScores.$inferSelect;

// Evidence Sources
export const insertEvidenceSourceSchema = createInsertSchema(evidenceSources).omit({ id: true, createdAt: true });
export type InsertEvidenceSource = z.infer<typeof insertEvidenceSourceSchema>;
export type EvidenceSource = typeof evidenceSources.$inferSelect;

// Review Decisions
export const insertReviewDecisionSchema = createInsertSchema(reviewDecisions).omit({ id: true, createdAt: true });
export type InsertReviewDecision = z.infer<typeof insertReviewDecisionSchema>;
export type ReviewDecision = typeof reviewDecisions.$inferSelect;

// LG CRM Leads (linking table)
export const insertLgCrmLeadSchema = createInsertSchema(lgCrmLeads).omit({ id: true, createdAt: true });
export type InsertLgCrmLead = z.infer<typeof insertLgCrmLeadSchema>;
export type LgCrmLead = typeof lgCrmLeads.$inferSelect;

// LG CRM Tasks (linking table)
export const insertLgCrmTaskSchema = createInsertSchema(lgCrmTasks).omit({ id: true, createdAt: true });
export type InsertLgCrmTask = z.infer<typeof insertLgCrmTaskSchema>;
export type LgCrmTask = typeof lgCrmTasks.$inferSelect;

// LG Audit Events
export const insertLgAuditEventSchema = createInsertSchema(lgAuditEvents).omit({ id: true, createdAt: true });
export type InsertLgAuditEvent = z.infer<typeof insertLgAuditEventSchema>;
export type LgAuditEvent = typeof lgAuditEvents.$inferSelect;

// Research Documents
export const insertResearchDocumentSchema = createInsertSchema(researchDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertResearchDocument = z.infer<typeof insertResearchDocumentSchema>;
export type ResearchDocument = typeof researchDocuments.$inferSelect;

// AI Configs
export const insertAiConfigSchema = createInsertSchema(aiConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiConfig = z.infer<typeof insertAiConfigSchema>;
export type AiConfig = typeof aiConfigs.$inferSelect;

// ========== ORGANIZATIONS (Multi-Tenant) ==========

export const organizations = pgTable("organizations", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  logoUrl: text("logo_url"),
  settings: jsonb("settings").notNull().default({}), // { annualSalesTargets: { "2025": 1000000 } }
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  slugIdx: index("organizations_slug_idx").on(table.slug),
}));

export const userOrganizations = pgTable("user_organizations", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 50 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id", { length: 50 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  roleId: varchar("role_id", { length: 50 }).notNull().references(() => roles.id, { onDelete: "restrict" }),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("user_organizations_user_id_idx").on(table.userId),
  orgIdIdx: index("user_organizations_org_id_idx").on(table.organizationId),
  uniqueMembership: uniqueIndex("user_organizations_unique_idx").on(table.userId, table.organizationId),
}));

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;

export const insertUserOrganizationSchema = createInsertSchema(userOrganizations).omit({ id: true, createdAt: true });
export type InsertUserOrganization = z.infer<typeof insertUserOrganizationSchema>;
export type UserOrganization = typeof userOrganizations.$inferSelect;

// ========== CRM DOCUMENT ATTACHMENTS ==========

export const crmDocumentEntityTypeEnum = pgEnum("crm_document_entity_type", ["lead", "account", "contact", "opportunity"]);

export const crmDocuments = pgTable("crm_documents", {
  id: varchar("id", { length: 50 }).primaryKey().default(sql`gen_random_uuid()`),
  entityType: crmDocumentEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path"),
  fileData: text("file_data"),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  uploadedBy: varchar("uploaded_by", { length: 50 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("crm_documents_entity_idx").on(table.entityType, table.entityId),
  uploadedByIdx: index("crm_documents_uploaded_by_idx").on(table.uploadedBy),
}));

export const insertCrmDocumentSchema = createInsertSchema(crmDocuments).omit({ id: true, createdAt: true });
export type InsertCrmDocument = z.infer<typeof insertCrmDocumentSchema>;
export type CrmDocument = typeof crmDocuments.$inferSelect;
export type CrmDocumentEntityType = "lead" | "account" | "contact" | "opportunity";
