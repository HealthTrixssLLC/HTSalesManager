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
  
  // ========== BACKUP JOBS ==========
  getAllBackupJobs(): Promise<BackupJob[]>;
  createBackupJob(job: InsertBackupJob): Promise<BackupJob>;
  updateBackupJob(id: string, job: Partial<BackupJob>): Promise<BackupJob>;
  
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
    activitiesByUser: { userName: string; count: number }[];
  }>;
}
