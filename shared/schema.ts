// Health Trixss CRM - Complete Database Schema
// Based on CPDO requirements for lightweight self-hosted CRM

import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, decimal, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ========== ENUMS ==========

export const userStatusEnum = pgEnum("user_status", ["active", "inactive", "suspended"]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "contacted", "qualified", "unqualified", "converted"]);
export const leadSourceEnum = pgEnum("lead_source", ["website", "referral", "phone", "email", "event", "partner", "other"]);
export const opportunityStageEnum = pgEnum("opportunity_stage", ["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]);
export const activityTypeEnum = pgEnum("activity_type", ["call", "email", "meeting", "task", "note"]);
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
  name: text("name").notNull(),
  accountNumber: text("account_number"), // External account number (e.g., from Dynamics)
  type: accountTypeEnum("type"),
  category: text("category"), // Business category (e.g., Provider, Payer, Vendor)
  ownerId: varchar("owner_id", { length: 50 }).notNull().references(() => users.id),
  industry: text("industry"),
  website: text("website"),
  phone: text("phone"),
  primaryContactName: text("primary_contact_name"), // Name of primary contact
  primaryContactEmail: text("primary_contact_email"), // Email of primary contact
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
  ownerIdIdx: index("accounts_owner_id_idx").on(table.ownerId),
  nameIdx: index("accounts_name_idx").on(table.name),
  accountNumberIdx: index("accounts_account_number_idx").on(table.accountNumber),
  externalIdIdx: index("accounts_external_id_idx").on(table.externalId),
}));

export const contacts = pgTable("contacts", {
  id: varchar("id", { length: 100 }).primaryKey(), // Custom ID pattern: CONT-2501-00001
  accountId: varchar("account_id", { length: 100 }).references(() => accounts.id, { onDelete: "set null" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  ownerId: varchar("owner_id", { length: 50 }).notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  accountIdIdx: index("contacts_account_id_idx").on(table.accountId),
  ownerIdIdx: index("contacts_owner_id_idx").on(table.ownerId),
  emailIdx: index("contacts_email_idx").on(table.email),
}));

export const leads = pgTable("leads", {
  id: varchar("id", { length: 100 }).primaryKey(), // Custom ID pattern: LEAD-000001
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  status: leadStatusEnum("status").notNull().default("new"),
  source: leadSourceEnum("source"),
  ownerId: varchar("owner_id", { length: 50 }).notNull().references(() => users.id),
  convertedAccountId: varchar("converted_account_id", { length: 100 }).references(() => accounts.id),
  convertedContactId: varchar("converted_contact_id", { length: 100 }).references(() => contacts.id),
  convertedOpportunityId: varchar("converted_opportunity_id", { length: 100 }).references(() => opportunities.id),
  convertedAt: timestamp("converted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  ownerIdIdx: index("leads_owner_id_idx").on(table.ownerId),
  statusIdx: index("leads_status_idx").on(table.status),
  emailIdx: index("leads_email_idx").on(table.email),
}));

export const opportunities = pgTable("opportunities", {
  id: varchar("id", { length: 100 }).primaryKey(), // Custom ID pattern: OPP-2025-000001
  accountId: varchar("account_id", { length: 100 }).notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  stage: opportunityStageEnum("stage").notNull().default("prospecting"),
  amount: decimal("amount", { precision: 15, scale: 2 }),
  closeDate: timestamp("close_date"),
  ownerId: varchar("owner_id", { length: 50 }).notNull().references(() => users.id),
  probability: integer("probability").default(0), // 0-100
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  accountIdIdx: index("opportunities_account_id_idx").on(table.accountId),
  ownerIdIdx: index("opportunities_owner_id_idx").on(table.ownerId),
  stageIdx: index("opportunities_stage_idx").on(table.stage),
  closeDateIdx: index("opportunities_close_date_idx").on(table.closeDate),
}));

export const activities = pgTable("activities", {
  id: varchar("id", { length: 100 }).primaryKey(), // Custom ID pattern: ACT-2501-00001
  type: activityTypeEnum("type").notNull(),
  subject: text("subject").notNull(),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  ownerId: varchar("owner_id", { length: 50 }).notNull().references(() => users.id),
  relatedType: text("related_type"), // "Account", "Contact", "Lead", "Opportunity"
  relatedId: varchar("related_id", { length: 100 }), // ID of related record
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  ownerIdIdx: index("activities_owner_id_idx").on(table.ownerId),
  relatedIdx: index("activities_related_idx").on(table.relatedType, table.relatedId),
  dueAtIdx: index("activities_due_at_idx").on(table.dueAt),
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
  entity: text("entity").notNull().unique(), // "Account", "Contact", "Lead", etc.
  pattern: text("pattern").notNull(), // e.g., "ACCT-{YYYY}-{SEQ:5}"
  counter: integer("counter").notNull().default(0),
  startValue: integer("start_value").default(1),
  lastIssued: text("last_issued"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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

export const opportunitiesRelations = relations(opportunities, ({ one }) => ({
  account: one(accounts, { fields: [opportunities.accountId], references: [accounts.id] }),
  owner: one(users, { fields: [opportunities.ownerId], references: [users.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  owner: one(users, { fields: [activities.ownerId], references: [users.id] }),
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
export const insertAccountSchema = createInsertSchema(accounts).omit({ createdAt: true, updatedAt: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

// Contacts
export const insertContactSchema = createInsertSchema(contacts).omit({ createdAt: true, updatedAt: true });
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
});
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

// Opportunities
export const insertOpportunitySchema = createInsertSchema(opportunities).omit({ createdAt: true, updatedAt: true });
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type Opportunity = typeof opportunities.$inferSelect;

// Activities
export const insertActivitySchema = createInsertSchema(activities).omit({ createdAt: true, updatedAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activities.$inferSelect;

// AuditLogs
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// IdPatterns
export const insertIdPatternSchema = createInsertSchema(idPatterns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIdPattern = z.infer<typeof insertIdPatternSchema>;
export type IdPattern = typeof idPatterns.$inferSelect;

// BackupJobs
export const insertBackupJobSchema = createInsertSchema(backupJobs).omit({ id: true, createdAt: true });
export type InsertBackupJob = z.infer<typeof insertBackupJobSchema>;
export type BackupJob = typeof backupJobs.$inferSelect;

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
