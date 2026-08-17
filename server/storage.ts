// Storage interface for CRM data access
// Using PostgreSQL with Drizzle ORM

import type {
  User, InsertUser,
  Account, InsertAccount,
  Contact, InsertContact,
  Lead, InsertLead,
  Opportunity, InsertOpportunity,
  Activity, InsertActivity,
  Role, InsertRole,
  Permission, InsertPermission,
  AuditLog, InsertAuditLog,
  IdPattern, InsertIdPattern,
  AccountCategory, InsertAccountCategory,
  BackupJob, InsertBackupJob,
  OpportunityResource, InsertOpportunityResource,
  OpportunityContact, InsertOpportunityContact,
  LlmConfiguration, InsertLlmConfiguration,
  Tag, InsertTag,
  EntityTag,
  CrmDocument, InsertCrmDocument, CrmDocumentEntityType,
  Document, InsertDocument, DocumentLink, DocumentLinkEntityType,
  Organization, InsertOrganization,
  UserOrganization, InsertUserOrganization,
  ApiKey, InsertApiKey,
} from "@shared/schema";

// ========== EXTERNAL API LIST FILTERS ==========
// Server-side filters for the external list endpoints (Phase B).
// All fields are optional; storage builds conditional WHERE clauses.

export interface IStorage {
  // ========== AUTH & USER MANAGEMENT ==========
  getUserByEmail(email: string): Promise<(User & { password: string }) | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User>;
  getAllUsers(): Promise<User[]>;
  
  // ========== ROLES & PERMISSIONS ==========
  getAllRoles(): Promise<Role[]>;
  getAllPermissions(): Promise<Permission[]>;
  getRolePermissions(roleId: string): Promise<Permission[]>;
  getUserRoles(userId: string): Promise<Role[]>;
  assignRoleToUser(userId: string, roleId: string): Promise<void>;
  removeRoleFromUser(userId: string, roleId: string): Promise<void>;
  updateUserRole(userId: string, newRoleId: string): Promise<void>;
  assignPermissionToRole(roleId: string, permissionId: string): Promise<void>;
  
  // ========== ACCOUNTS ==========
  getAllAccounts(orgId?: string, filters?: AccountListFilters): Promise<Account[]>;
  getAccountById(id: string): Promise<Account | undefined>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: string, account: Partial<InsertAccount>): Promise<Account>;
  deleteAccount(id: string): Promise<void>;
  
  // ========== CONTACTS ==========
  getAllContacts(orgId?: string, filters?: ContactListFilters): Promise<Contact[]>;
  getContactById(id: string): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: string, contact: Partial<InsertContact>): Promise<Contact>;
  deleteContact(id: string): Promise<void>;
  
  // ========== LEADS ==========
  getAllLeads(orgId?: string | string[], filters?: LeadListFilters): Promise<Lead[]>;
  getLeadById(id: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: string, lead: Partial<InsertLead>): Promise<Lead>;
  deleteLead(id: string): Promise<void>;
  
  // ========== OPPORTUNITIES ==========
  getAllOpportunities(orgId?: string, filters?: OpportunityListFilters): Promise<Opportunity[]>;
  getOpportunityById(id: string): Promise<Opportunity | undefined>;
  createOpportunity(opportunity: InsertOpportunity): Promise<Opportunity>;
  updateOpportunity(id: string, opportunity: Partial<InsertOpportunity>): Promise<Opportunity>;
  deleteOpportunity(id: string): Promise<void>;
  
  // ========== ACTIVITIES ==========
  getAllActivities(orgId?: string): Promise<Activity[]>;
  getActivityById(id: string): Promise<Activity | undefined>;
  createActivity(activity: InsertActivity): Promise<Activity>;
  updateActivity(id: string, activity: Partial<InsertActivity>): Promise<Activity>;
  deleteActivity(id: string): Promise<void>;
  
  // ========== EXTERNAL API PATCH (org-scoped partial updates) ==========
  patchAccount(id: string, orgId: string | undefined, fields: Record<string, any>): Promise<Account | undefined>;
  patchContact(id: string, orgId: string | undefined, fields: Record<string, any>): Promise<Contact | undefined>;
  patchLead(id: string, orgId: string | undefined, fields: Record<string, any>): Promise<Lead | undefined>;
  patchOpportunity(id: string, orgId: string | undefined, fields: Record<string, any>): Promise<Opportunity | undefined>;
  patchActivity(id: string, orgId: string | undefined, fields: Record<string, any>): Promise<Activity | undefined>;

  // ========== AUDIT LOGS ==========
  getAllAuditLogs(): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  
  // ========== ID PATTERNS ==========
  getAllIdPatterns(orgId?: string): Promise<IdPattern[]>;
  getIdPattern(entity: string, orgId?: string): Promise<IdPattern | undefined>;
  updateIdPattern(id: string, pattern: Partial<IdPattern>): Promise<IdPattern>;
  generateId(entity: string, orgId?: string): Promise<string>;
  
  // ========== ACCOUNT CATEGORIES ==========
  getAllAccountCategories(orgId?: string): Promise<AccountCategory[]>;
  getAccountCategory(id: string): Promise<AccountCategory | undefined>;
  createAccountCategory(category: InsertAccountCategory): Promise<AccountCategory>;
  updateAccountCategory(id: string, category: Partial<AccountCategory>): Promise<AccountCategory>;
  deleteAccountCategory(id: string): Promise<void>;
  
  // ========== BACKUP JOBS ==========
  getAllBackupJobs(): Promise<BackupJob[]>;
  createBackupJob(job: InsertBackupJob): Promise<BackupJob>;
  updateBackupJob(id: string, job: Partial<BackupJob>): Promise<BackupJob>;
  
  // ========== API KEYS ==========
  getAllApiKeys(orgId?: string): Promise<ApiKey[]>;
  getApiKeyById(id: string): Promise<ApiKey | undefined>;
  getApiKeyByHashedKey(hashedKey: string): Promise<ApiKey | undefined>;
  createApiKey(apiKey: InsertApiKey): Promise<ApiKey>;
  updateApiKeyLastUsed(id: string): Promise<void>;
  revokeApiKey(id: string, userId: string): Promise<ApiKey>;
  
  // ========== TAGS ==========
  getAllTags(): Promise<Tag[]>;
  getTagById(id: string): Promise<Tag | undefined>;
  createTag(tag: InsertTag): Promise<Tag>;
  updateTag(id: string, tag: Partial<InsertTag>): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  
  // ========== ENTITY TAGS ==========
  getEntityTagsBulk(entity: string, entityIds: string[]): Promise<Array<{ entityId: string; id: string; name: string; color: string }>>;
  getActivityTagsBulk(activityIds: string[], orgId?: string): Promise<Array<{ entityId: string; id: string; name: string; color: string }>>;
  getEntityTags(entity: string, entityId: string): Promise<Tag[]>;
  addEntityTags(entity: string, entityId: string, tagIds: string[], userId: string): Promise<void>;
  removeEntityTag(entity: string, entityId: string, tagId: string): Promise<void>;
  
  // ========== OPPORTUNITY RESOURCES ==========
  getOpportunityResources(opportunityId: string): Promise<OpportunityResource[]>;
  addOpportunityResource(resource: InsertOpportunityResource): Promise<OpportunityResource>;
  removeOpportunityResource(id: string): Promise<void>;
  getAllOpportunityResources(): Promise<OpportunityResource[]>;
  
  // ========== OPPORTUNITY CONTACTS ==========
  getOpportunityContacts(opportunityId: string): Promise<Array<OpportunityContact & { contact: Contact }>>;
  linkContactToOpportunity(link: InsertOpportunityContact): Promise<OpportunityContact>;
  unlinkContactFromOpportunity(opportunityId: string, contactId: string): Promise<boolean>;
  
  // ========== LLM CONFIGURATION ==========
  getLlmConfiguration(orgId?: string): Promise<LlmConfiguration | undefined>;
  upsertLlmConfiguration(config: Partial<InsertLlmConfiguration> & { updatedBy?: string }, orgId?: string): Promise<LlmConfiguration>;
  
  // ========== CRM DOCUMENT ATTACHMENTS ==========

  // ========== DOCUMENT REFERENCES (external documents) ==========
  createDocumentReference(doc: InsertDocument): Promise<Document>;
  getDocumentReferenceById(id: string, orgId?: string): Promise<Document | undefined>;
  listDocumentReferences(options: {
    orgId?: string;
    entityType?: DocumentLinkEntityType;
    entityId?: string;
    updatedSince?: Date;
    limit: number;
    offset: number;
  }): Promise<{ data: Document[]; total: number }>;
  getDocumentLinks(documentId: string): Promise<DocumentLink[]>;
  createDocumentLink(documentId: string, entityType: DocumentLinkEntityType, entityId: string): Promise<{ link: DocumentLink; created: boolean }>;
  deleteDocumentLink(documentId: string, entityType: DocumentLinkEntityType, entityId: string): Promise<boolean>;
  getEntityOrganizationId(entityType: DocumentLinkEntityType, entityId: string): Promise<string | undefined>;

  getDocuments(entityType: CrmDocumentEntityType, entityId: string): Promise<CrmDocument[]>;
  getDocumentById(id: string): Promise<CrmDocument | undefined>;
  createDocument(data: InsertCrmDocument): Promise<CrmDocument>;
  deleteDocument(id: string): Promise<void>;

  // ========== USER MERGE ==========
  mergeUsers(primaryId: string, secondaryIds: string[]): Promise<void>;

  // ========== ORGANIZATIONS ==========
  getAllOrganizations(): Promise<Organization[]>;
  getOrganizationById(id: string): Promise<Organization | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: string, org: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: string): Promise<void>;
  getOrganizationMembers(organizationId: string): Promise<(UserOrganization & { user: User; roleName: string })[]>;
  getUserOrganizations(userId: string): Promise<(UserOrganization & { organization: Organization; roleName: string })[]>;
  addOrganizationMember(entry: InsertUserOrganization): Promise<UserOrganization>;
  updateOrganizationMember(userId: string, organizationId: string, roleId: string): Promise<UserOrganization>;
  removeOrganizationMember(userId: string, organizationId: string): Promise<void>;
  setDefaultOrganization(userId: string, organizationId: string): Promise<void>;
  getDefaultOrganization(userId: string): Promise<Organization | undefined>;
  getOrgMembership(userId: string, organizationId: string): Promise<(UserOrganization & { roleName: string }) | undefined>;
  bulkAssignData(targetOrgId: string, sourceOrgId: string | "all"): Promise<{ accounts: number; contacts: number; leads: number; opportunities: number; activities: number; total: number }>;

  // ========== ADMIN OPERATIONS ==========
  resetDatabase(): Promise<void>;
  
  // ========== DASHBOARD & STATS ==========
  getDashboardStats(year: number, orgId?: string): Promise<{
    totalAccounts: number;
    totalContacts: number;
    totalLeads: number;
    totalOpportunities: number;
    pipelineByStage: { stage: string; count: number; value: number }[];
    newLeadsThisMonth: number;
    winRate: number;
    totalClosedDeals: number;
    opportunitiesByCloseDate: { period: string; count: number; value: number; opportunities: { id: string; name: string; amount: number; closeDate: string | null }[] }[];
  }>;
  getSalesWaterfallData(year: number, orgId?: string): Promise<{
    name: string;
    amount: number;
    stage: string;
    closeDate: string | null;
  }[]>;
}

export interface AccountListFilters {
  search?: string;       // Case-insensitive substring match on account name
  name?: string;         // Case-insensitive substring match on account name
  updatedSince?: Date;   // updated_at strictly after this timestamp
}

export interface LeadListFilters {
  search?: string;       // Case-insensitive substring match on "first last" name or company
  email?: string;        // Case-insensitive exact email match
  status?: string;       // lead_status enum value
  rating?: string;       // Case-insensitive exact match (hot/warm/cold)
  source?: string;       // lead_source enum value
  updatedSince?: Date;
}

export interface OpportunityListFilters {
  search?: string;             // Case-insensitive substring match on opportunity name
  accountId?: string;          // Exact account ID match
  status?: string;             // Case-insensitive exact match on status text
  stage?: string;              // opportunity_stage enum value
  ownerId?: string;            // Exact owner ID match
  rating?: string;             // Case-insensitive exact match
  includeInForecast?: boolean; // Exact boolean match (omit for "all")
  updatedSince?: Date;
}

export interface ContactListFilters {
  search?: string;       // Case-insensitive substring match on "first last" name
  email?: string;        // Case-insensitive exact email match
  accountId?: string;    // Exact account ID match
  updatedSince?: Date;
}
