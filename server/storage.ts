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
} from "@shared/schema";

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
  getAllAccounts(): Promise<Account[]>;
  getAccountById(id: string): Promise<Account | undefined>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: string, account: Partial<InsertAccount>): Promise<Account>;
  deleteAccount(id: string): Promise<void>;
  
  // ========== CONTACTS ==========
  getAllContacts(): Promise<Contact[]>;
  getContactById(id: string): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: string, contact: Partial<InsertContact>): Promise<Contact>;
  deleteContact(id: string): Promise<void>;
  
  // ========== LEADS ==========
  getAllLeads(): Promise<Lead[]>;
  getLeadById(id: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: string, lead: Partial<InsertLead>): Promise<Lead>;
  deleteLead(id: string): Promise<void>;
  
  // ========== OPPORTUNITIES ==========
  getAllOpportunities(): Promise<Opportunity[]>;
  getOpportunityById(id: string): Promise<Opportunity | undefined>;
  createOpportunity(opportunity: InsertOpportunity): Promise<Opportunity>;
  updateOpportunity(id: string, opportunity: Partial<InsertOpportunity>): Promise<Opportunity>;
  deleteOpportunity(id: string): Promise<void>;
  
  // ========== ACTIVITIES ==========
  getAllActivities(): Promise<Activity[]>;
  getActivityById(id: string): Promise<Activity | undefined>;
  createActivity(activity: InsertActivity): Promise<Activity>;
  updateActivity(id: string, activity: Partial<InsertActivity>): Promise<Activity>;
  deleteActivity(id: string): Promise<void>;
  
  // ========== AUDIT LOGS ==========
  getAllAuditLogs(): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  
  // ========== ID PATTERNS ==========
  getAllIdPatterns(): Promise<IdPattern[]>;
  getIdPattern(entity: string): Promise<IdPattern | undefined>;
  updateIdPattern(id: string, pattern: Partial<IdPattern>): Promise<IdPattern>;
  generateId(entity: string): Promise<string>;
  
  // ========== ACCOUNT CATEGORIES ==========
  getAllAccountCategories(): Promise<AccountCategory[]>;
  getAccountCategory(id: string): Promise<AccountCategory | undefined>;
  createAccountCategory(category: InsertAccountCategory): Promise<AccountCategory>;
  updateAccountCategory(id: string, category: Partial<AccountCategory>): Promise<AccountCategory>;
  deleteAccountCategory(id: string): Promise<void>;
  
  // ========== BACKUP JOBS ==========
  getAllBackupJobs(): Promise<BackupJob[]>;
  createBackupJob(job: InsertBackupJob): Promise<BackupJob>;
  updateBackupJob(id: string, job: Partial<BackupJob>): Promise<BackupJob>;
  
  // ========== TAGS ==========
  getAllTags(): Promise<Tag[]>;
  getTagById(id: string): Promise<Tag | undefined>;
  createTag(tag: InsertTag): Promise<Tag>;
  updateTag(id: string, tag: Partial<InsertTag>): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  
  // ========== ENTITY TAGS ==========
  getEntityTags(entity: string, entityId: string): Promise<Tag[]>;
  addEntityTags(entity: string, entityId: string, tagIds: string[], userId: string): Promise<void>;
  removeEntityTag(entity: string, entityId: string, tagId: string): Promise<void>;
  
  // ========== ADMIN OPERATIONS ==========
  resetDatabase(): Promise<void>;
  
  // ========== DASHBOARD & STATS ==========
  getDashboardStats(): Promise<{
    totalAccounts: number;
    totalContacts: number;
    totalLeads: number;
    totalOpportunities: number;
    pipelineByStage: { stage: string; count: number; value: number }[];
    newLeadsThisMonth: number;
    winRate: number;
    opportunitiesByCloseDate: { period: string; count: number; value: number; opportunities: { id: string; name: string; amount: number; closeDate: string | null }[] }[];
  }>;
}
