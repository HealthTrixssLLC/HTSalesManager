// Database connection and storage implementation
// PostgreSQL with Drizzle ORM

import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { eq, sql, and, gte } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { IStorage } from "./storage";
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

// Configure neon for WebSocket support
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export class PostgresStorage implements IStorage {
  // ========== AUTH & USER MANAGEMENT ==========
  
  async getUserByEmail(email: string): Promise<(User & { password: string }) | undefined> {
    const result = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    return result[0] as any;
  }
  
  async getUserById(id: string): Promise<User | undefined> {
    const result = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (result.length === 0) return undefined;
    const { password, ...user } = result[0];
    return user as User;
  }
  
  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(schema.users).values(insertUser).returning();
    const { password, ...user } = result[0];
    return user as User;
  }
  
  async getAllUsers(): Promise<User[]> {
    const result = await db.select().from(schema.users);
    return result.map(({ password, ...user }) => user as User);
  }
  
  // ========== ROLES & PERMISSIONS ==========
  
  async getAllRoles(): Promise<Role[]> {
    return await db.select().from(schema.roles);
  }
  
  async getAllPermissions(): Promise<Permission[]> {
    return await db.select().from(schema.permissions);
  }
  
  async getRolePermissions(roleId: string): Promise<Permission[]> {
    const result = await db
      .select({ permission: schema.permissions })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(eq(schema.rolePermissions.roleId, roleId));
    return result.map(r => r.permission);
  }
  
  async getUserRoles(userId: string): Promise<Role[]> {
    const result = await db
      .select({ role: schema.roles })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, userId));
    return result.map(r => r.role);
  }
  
  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    await db.insert(schema.userRoles).values({ userId, roleId });
  }
  
  async assignPermissionToRole(roleId: string, permissionId: string): Promise<void> {
    await db.insert(schema.rolePermissions).values({ roleId, permissionId });
  }
  
  // ========== ACCOUNTS ==========
  
  async getAllAccounts(): Promise<Account[]> {
    return await db.select().from(schema.accounts);
  }
  
  async getAccountById(id: string): Promise<Account | undefined> {
    const result = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).limit(1);
    return result[0];
  }
  
  async createAccount(account: InsertAccount): Promise<Account> {
    // Generate ID if not provided
    if (!account.id || account.id === "") {
      account.id = await this.generateId("Account");
    }
    const result = await db.insert(schema.accounts).values(account).returning();
    return result[0];
  }
  
  async updateAccount(id: string, account: Partial<InsertAccount>): Promise<Account> {
    const result = await db.update(schema.accounts)
      .set({ ...account, updatedAt: new Date() })
      .where(eq(schema.accounts.id, id))
      .returning();
    return result[0];
  }
  
  async deleteAccount(id: string): Promise<void> {
    await db.delete(schema.accounts).where(eq(schema.accounts.id, id));
  }
  
  // ========== CONTACTS ==========
  
  async getAllContacts(): Promise<Contact[]> {
    return await db.select().from(schema.contacts);
  }
  
  async getContactById(id: string): Promise<Contact | undefined> {
    const result = await db.select().from(schema.contacts).where(eq(schema.contacts.id, id)).limit(1);
    return result[0];
  }
  
  async createContact(contact: InsertContact): Promise<Contact> {
    if (!contact.id || contact.id === "") {
      contact.id = await this.generateId("Contact");
    }
    const result = await db.insert(schema.contacts).values(contact).returning();
    return result[0];
  }
  
  async updateContact(id: string, contact: Partial<InsertContact>): Promise<Contact> {
    const result = await db.update(schema.contacts)
      .set({ ...contact, updatedAt: new Date() })
      .where(eq(schema.contacts.id, id))
      .returning();
    return result[0];
  }
  
  async deleteContact(id: string): Promise<void> {
    await db.delete(schema.contacts).where(eq(schema.contacts.id, id));
  }
  
  // ========== LEADS ==========
  
  async getAllLeads(): Promise<Lead[]> {
    return await db.select().from(schema.leads);
  }
  
  async getLeadById(id: string): Promise<Lead | undefined> {
    const result = await db.select().from(schema.leads).where(eq(schema.leads.id, id)).limit(1);
    return result[0];
  }
  
  async createLead(lead: InsertLead): Promise<Lead> {
    if (!lead.id || lead.id === "") {
      lead.id = await this.generateId("Lead");
    }
    const result = await db.insert(schema.leads).values(lead).returning();
    return result[0];
  }
  
  async updateLead(id: string, lead: Partial<InsertLead>): Promise<Lead> {
    const result = await db.update(schema.leads)
      .set({ ...lead, updatedAt: new Date() })
      .where(eq(schema.leads.id, id))
      .returning();
    return result[0];
  }
  
  async deleteLead(id: string): Promise<void> {
    await db.delete(schema.leads).where(eq(schema.leads.id, id));
  }
  
  // ========== OPPORTUNITIES ==========
  
  async getAllOpportunities(): Promise<Opportunity[]> {
    return await db.select().from(schema.opportunities);
  }
  
  async getOpportunityById(id: string): Promise<Opportunity | undefined> {
    const result = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, id)).limit(1);
    return result[0];
  }
  
  async createOpportunity(opportunity: InsertOpportunity): Promise<Opportunity> {
    if (!opportunity.id || opportunity.id === "") {
      opportunity.id = await this.generateId("Opportunity");
    }
    const result = await db.insert(schema.opportunities).values(opportunity).returning();
    return result[0];
  }
  
  async updateOpportunity(id: string, opportunity: Partial<InsertOpportunity>): Promise<Opportunity> {
    const result = await db.update(schema.opportunities)
      .set({ ...opportunity, updatedAt: new Date() })
      .where(eq(schema.opportunities.id, id))
      .returning();
    return result[0];
  }
  
  async deleteOpportunity(id: string): Promise<void> {
    await db.delete(schema.opportunities).where(eq(schema.opportunities.id, id));
  }
  
  // ========== ACTIVITIES ==========
  
  async getAllActivities(): Promise<Activity[]> {
    return await db.select().from(schema.activities);
  }
  
  async getActivityById(id: string): Promise<Activity | undefined> {
    const result = await db.select().from(schema.activities).where(eq(schema.activities.id, id)).limit(1);
    return result[0];
  }
  
  async createActivity(activity: InsertActivity): Promise<Activity> {
    if (!activity.id || activity.id === "") {
      activity.id = await this.generateId("Activity");
    }
    const result = await db.insert(schema.activities).values(activity).returning();
    return result[0];
  }
  
  async updateActivity(id: string, activity: Partial<InsertActivity>): Promise<Activity> {
    const result = await db.update(schema.activities)
      .set({ ...activity, updatedAt: new Date() })
      .where(eq(schema.activities.id, id))
      .returning();
    return result[0];
  }
  
  async deleteActivity(id: string): Promise<void> {
    await db.delete(schema.activities).where(eq(schema.activities.id, id));
  }
  
  // ========== AUDIT LOGS ==========
  
  async getAllAuditLogs(): Promise<AuditLog[]> {
    return await db.select().from(schema.auditLogs).orderBy(sql`${schema.auditLogs.createdAt} DESC`);
  }
  
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const result = await db.insert(schema.auditLogs).values(log).returning();
    return result[0];
  }
  
  // ========== ID PATTERNS ==========
  
  async getAllIdPatterns(): Promise<IdPattern[]> {
    return await db.select().from(schema.idPatterns);
  }
  
  async getIdPattern(entity: string): Promise<IdPattern | undefined> {
    const result = await db.select().from(schema.idPatterns).where(eq(schema.idPatterns.entity, entity)).limit(1);
    return result[0];
  }
  
  async updateIdPattern(id: string, pattern: Partial<IdPattern>): Promise<IdPattern> {
    const result = await db.update(schema.idPatterns)
      .set({ ...pattern, updatedAt: new Date() })
      .where(eq(schema.idPatterns.id, id))
      .returning();
    return result[0];
  }
  
  async generateId(entity: string): Promise<string> {
    // Get the ID pattern for this entity
    let pattern = await this.getIdPattern(entity);
    
    // If no pattern exists, create a default one
    if (!pattern) {
      const defaultPatterns: Record<string, string> = {
        "Account": "ACCT-{YYYY}-{SEQ:5}",
        "Contact": "CONT-{YY}{MM}-{SEQ:5}",
        "Lead": "LEAD-{SEQ:6}",
        "Opportunity": "OPP-{YYYY}-{SEQ:6}",
        "Activity": "ACT-{YY}{MM}-{SEQ:5}",
      };
      
      const defaultPattern = defaultPatterns[entity] || `${entity.toUpperCase()}-{SEQ:6}`;
      
      const result = await db.insert(schema.idPatterns).values({
        entity,
        pattern: defaultPattern,
        counter: 0,
        startValue: 1,
      }).returning();
      pattern = result[0];
    }
    
    // Atomically increment counter and get new value
    const result = await db.update(schema.idPatterns)
      .set({ 
        counter: sql`${schema.idPatterns.counter} + 1`,
        updatedAt: new Date()
      })
      .where(eq(schema.idPatterns.id, pattern.id))
      .returning();
    
    const updatedPattern = result[0];
    const counter = updatedPattern.counter;
    
    // Parse pattern and generate ID
    const now = new Date();
    let generatedId = updatedPattern.pattern
      .replace("{PREFIX}", entity.substring(0, 4).toUpperCase())
      .replace("{YYYY}", now.getFullYear().toString())
      .replace("{YY}", now.getFullYear().toString().slice(2))
      .replace("{MM}", (now.getMonth() + 1).toString().padStart(2, "0"))
      .replace(/{SEQ:(\d+)}/g, (_, len) => counter.toString().padStart(parseInt(len), "0"));
    
    // Update last issued
    await db.update(schema.idPatterns)
      .set({ lastIssued: generatedId })
      .where(eq(schema.idPatterns.id, pattern.id));
    
    return generatedId;
  }
  
  // ========== BACKUP JOBS ==========
  
  async getAllBackupJobs(): Promise<BackupJob[]> {
    return await db.select().from(schema.backupJobs).orderBy(sql`${schema.backupJobs.createdAt} DESC`);
  }
  
  async createBackupJob(job: InsertBackupJob): Promise<BackupJob> {
    const result = await db.insert(schema.backupJobs).values(job).returning();
    return result[0];
  }
  
  async updateBackupJob(id: string, job: Partial<BackupJob>): Promise<BackupJob> {
    const result = await db.update(schema.backupJobs)
      .set(job)
      .where(eq(schema.backupJobs.id, id))
      .returning();
    return result[0];
  }
  
  // ========== DASHBOARD & STATS ==========
  
  async getDashboardStats(): Promise<{
    totalAccounts: number;
    totalContacts: number;
    totalLeads: number;
    totalOpportunities: number;
    pipelineByStage: { stage: string; count: number; value: number }[];
    newLeadsThisMonth: number;
    winRate: number;
    activitiesByUser: { userName: string; count: number }[];
  }> {
    // Get counts
    const accounts = await db.select({ count: sql<number>`count(*)` }).from(schema.accounts);
    const contacts = await db.select({ count: sql<number>`count(*)` }).from(schema.contacts);
    const leads = await db.select({ count: sql<number>`count(*)` }).from(schema.leads);
    const opportunities = await db.select({ count: sql<number>`count(*)` }).from(schema.opportunities);
    
    // Get pipeline by stage
    const pipeline = await db
      .select({
        stage: schema.opportunities.stage,
        count: sql<number>`count(*)`,
        value: sql<number>`sum(cast(${schema.opportunities.amount} as numeric))`,
      })
      .from(schema.opportunities)
      .groupBy(schema.opportunities.stage);
    
    // Get new leads this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const newLeads = await db.select({ count: sql<number>`count(*)` })
      .from(schema.leads)
      .where(gte(schema.leads.createdAt, startOfMonth));
    
    // Calculate win rate
    const closedWon = await db.select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(eq(schema.opportunities.stage, "closed_won"));
    
    const closedLost = await db.select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(eq(schema.opportunities.stage, "closed_lost"));
    
    const totalClosed = (closedWon[0]?.count || 0) + (closedLost[0]?.count || 0);
    const winRate = totalClosed > 0 ? Math.round(((closedWon[0]?.count || 0) / totalClosed) * 100) : 0;
    
    // Get activities by user
    const activitiesByUser = await db
      .select({
        userName: schema.users.name,
        count: sql<number>`count(*)`,
      })
      .from(schema.activities)
      .innerJoin(schema.users, eq(schema.activities.ownerId, schema.users.id))
      .groupBy(schema.users.name);
    
    return {
      totalAccounts: accounts[0]?.count || 0,
      totalContacts: contacts[0]?.count || 0,
      totalLeads: leads[0]?.count || 0,
      totalOpportunities: opportunities[0]?.count || 0,
      pipelineByStage: pipeline.map(p => ({
        stage: p.stage,
        count: p.count,
        value: p.value || 0,
      })),
      newLeadsThisMonth: newLeads[0]?.count || 0,
      winRate,
      activitiesByUser: activitiesByUser.map(a => ({
        userName: a.userName,
        count: a.count,
      })),
    };
  }
}

export const storage = new PostgresStorage();
