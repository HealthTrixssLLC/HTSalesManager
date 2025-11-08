// Database connection and storage implementation
// PostgreSQL with Drizzle ORM
// Auto-detects Neon serverless vs standard PostgreSQL

import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { eq, sql, and, gte, lte, ne, asc, desc, inArray, notInArray, or, isNotNull, isNull } from "drizzle-orm";
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
  AccountCategory, InsertAccountCategory,
  BackupJob, InsertBackupJob,
} from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Auto-detect database type and use appropriate driver
// Use Neon serverless for Replit/Neon, standard pg for Docker/local PostgreSQL
const isNeonDatabase = process.env.DATABASE_URL.includes('neon.tech') || 
                       process.env.DATABASE_URL.includes('pooler') ||
                       process.env.DATABASE_URL.includes('neon.ai');

// Initialize database connection based on environment
let db: any;

if (isNeonDatabase) {
  // Use Neon serverless driver (WebSocket-based) for Replit
  console.log('Using Neon serverless database driver');
  neonConfig.webSocketConstructor = ws;
  const pool = new NeonPool({ connectionString: process.env.DATABASE_URL });
  db = neonDrizzle(pool, { schema });
} else {
  // Use standard pg driver for Docker/local PostgreSQL
  console.log('Using standard PostgreSQL driver');
  const pool = new PgPool({ connectionString: process.env.DATABASE_URL });
  db = pgDrizzle(pool, { schema });
}

export { db };

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
  
  async updateUser(id: string, updateData: Partial<InsertUser>): Promise<User> {
    const result = await db.update(schema.users)
      .set(updateData)
      .where(eq(schema.users.id, id))
      .returning();
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
  
  async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    await db.delete(schema.userRoles)
      .where(and(
        eq(schema.userRoles.userId, userId),
        eq(schema.userRoles.roleId, roleId)
      ));
  }
  
  async updateUserRole(userId: string, newRoleId: string): Promise<void> {
    // Remove all existing roles and assign the new one
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.insert(schema.userRoles).values({ userId, roleId: newRoleId });
  }
  
  async assignPermissionToRole(roleId: string, permissionId: string): Promise<void> {
    await db.insert(schema.rolePermissions).values({ roleId, permissionId });
  }
  
  // ========== ACCOUNTS ==========
  
  async getAllAccounts(): Promise<Account[]> {
    try {
      // Use raw SQL for tag aggregation to avoid N+1 queries
      const result: any = await db.execute(sql`
        SELECT 
          a.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', t.id,
                'name', t.name,
                'color', t.color,
                'createdBy', t.created_by,
                'createdAt', t.created_at,
                'updatedAt', t.updated_at
              )
            ) FILTER (WHERE t.id IS NOT NULL),
            '[]'::json
          ) as tags
        FROM accounts a
        LEFT JOIN entity_tags et ON et.entity_id = a.id AND et.entity = 'Account'
        LEFT JOIN tags t ON t.id = et.tag_id
        GROUP BY a.id
        ORDER BY a.created_at DESC
      `);
      
      // Normalize result: Neon driver returns array, standard pg driver returns {rows, rowCount, ...}
      const rows = Array.isArray(result) ? result : result?.rows ?? [];
      return rows;
    } catch (error) {
      console.error('[DB-ACCOUNTS] Error in getAllAccounts:', error);
      console.error('[DB-ACCOUNTS] Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('[DB-ACCOUNTS] Error stack:', error instanceof Error ? error.stack : 'No stack');
      throw error;
    }
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
    try {
      // Use raw SQL for tag aggregation to avoid N+1 queries
      const result: any = await db.execute(sql`
        SELECT 
          c.id,
          c.account_id as "accountId",
          c.first_name as "firstName",
          c.last_name as "lastName",
          c.email,
          c.phone,
          c.title,
          c.owner_id as "ownerId",
          c.created_at as "createdAt",
          c.updated_at as "updatedAt",
          COALESCE(
            json_agg(
              json_build_object(
                'id', t.id,
                'name', t.name,
                'color', t.color,
                'createdBy', t.created_by,
                'createdAt', t.created_at,
                'updatedAt', t.updated_at
              )
            ) FILTER (WHERE t.id IS NOT NULL),
            '[]'::json
          ) as tags
        FROM contacts c
        LEFT JOIN entity_tags et ON et.entity_id = c.id AND et.entity = 'Contact'
        LEFT JOIN tags t ON t.id = et.tag_id
        GROUP BY c.id, c.account_id, c.first_name, c.last_name, c.email, c.phone, c.title, c.owner_id, c.created_at, c.updated_at
        ORDER BY c.created_at DESC
      `);
      
      // Normalize result: Neon driver returns array, standard pg driver returns {rows, rowCount, ...}
      const rows = Array.isArray(result) ? result : result?.rows ?? [];
      return rows;
    } catch (error) {
      console.error('[DB-CONTACTS] Error in getAllContacts:', error);
      console.error('[DB-CONTACTS] Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('[DB-CONTACTS] Error stack:', error instanceof Error ? error.stack : 'No stack');
      throw error;
    }
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
    try {
      // Use raw SQL for tag aggregation to avoid N+1 queries
      const result: any = await db.execute(sql`
        SELECT 
          l.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', t.id,
                'name', t.name,
                'color', t.color,
                'createdBy', t.created_by,
                'createdAt', t.created_at,
                'updatedAt', t.updated_at
              )
            ) FILTER (WHERE t.id IS NOT NULL),
            '[]'::json
          ) as tags
        FROM leads l
        LEFT JOIN entity_tags et ON et.entity_id = l.id AND et.entity = 'Lead'
        LEFT JOIN tags t ON t.id = et.tag_id
        GROUP BY l.id
        ORDER BY l.created_at DESC
      `);
      
      // Normalize result: Neon driver returns array, standard pg driver returns {rows, rowCount, ...}
      const rows = Array.isArray(result) ? result : result?.rows ?? [];
      return rows;
    } catch (error) {
      console.error('[DB-LEADS] Error in getAllLeads:', error);
      console.error('[DB-LEADS] Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('[DB-LEADS] Error stack:', error instanceof Error ? error.stack : 'No stack');
      throw error;
    }
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
    try {
      // Use raw SQL for tag aggregation to avoid N+1 queries
      // Explicitly alias all columns to ensure proper snake_case to camelCase conversion
      const result: any = await db.execute(sql`
        SELECT 
          o.id,
          o.name,
          o.account_id as "accountId",
          o.stage,
          o.amount,
          o.probability,
          o.close_date as "closeDate",
          o.status,
          o.actual_close_date as "actualCloseDate",
          o.actual_revenue as "actualRevenue",
          o.est_close_date as "estCloseDate",
          o.est_revenue as "estRevenue",
          o.rating,
          o.external_id as "externalId",
          o.source_system as "sourceSystem",
          o.source_record_id as "sourceRecordId",
          o.import_status as "importStatus",
          o.import_notes as "importNotes",
          o.owner_id as "ownerId",
          o.include_in_forecast as "includeInForecast",
          o.created_at as "createdAt",
          o.updated_at as "updatedAt",
          COALESCE(
            json_agg(
              json_build_object(
                'id', t.id,
                'name', t.name,
                'color', t.color,
                'createdBy', t.created_by,
                'createdAt', t.created_at,
                'updatedAt', t.updated_at
              )
            ) FILTER (WHERE t.id IS NOT NULL),
            '[]'::json
          ) as tags
        FROM opportunities o
        LEFT JOIN entity_tags et ON et.entity_id = o.id AND et.entity = 'Opportunity'
        LEFT JOIN tags t ON t.id = et.tag_id
        GROUP BY o.id
        ORDER BY o.created_at DESC
      `);
      
      // Normalize result: Neon driver returns array, standard pg driver returns {rows, rowCount, ...}
      const rows = Array.isArray(result) ? result : result?.rows ?? [];
      return rows;
    } catch (error) {
      console.error('[DB-OPPORTUNITIES] Error in getAllOpportunities:', error);
      console.error('[DB-OPPORTUNITIES] Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('[DB-OPPORTUNITIES] Error stack:', error instanceof Error ? error.stack : 'No stack');
      throw error;
    }
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
  
  async initializeIdPatterns(): Promise<void> {
    // Pre-populate default ID patterns for all core entities
    const defaultPatterns = [
      { entity: "Account", pattern: "ACCT-{YYYY}-{SEQ:5}" },
      { entity: "Contact", pattern: "CONT-{YY}{MM}-{SEQ:5}" },
      { entity: "Lead", pattern: "LEAD-{SEQ:6}" },
      { entity: "Opportunity", pattern: "OPP-{YYYY}-{SEQ:6}" },
      { entity: "Activity", pattern: "ACT-{YY}{MM}-{SEQ:5}" },
    ];

    for (const { entity, pattern } of defaultPatterns) {
      const existing = await this.getIdPattern(entity);
      if (!existing) {
        await db.insert(schema.idPatterns).values({
          entity,
          pattern,
          counter: 0,
          startValue: 1,
        });
      }
    }
  }
  
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
    const startValue = updatedPattern.startValue || 1;
    
    // Calculate actual sequence number: startValue + (counter - 1)
    // This allows users to set custom starting values like 1000
    const sequenceNumber = startValue + (counter - 1);
    
    // Parse pattern and generate ID
    const now = new Date();
    let generatedId = updatedPattern.pattern
      .replace("{PREFIX}", entity.substring(0, 4).toUpperCase())
      .replace("{YYYY}", now.getFullYear().toString())
      .replace("{YY}", now.getFullYear().toString().slice(2))
      .replace("{MM}", (now.getMonth() + 1).toString().padStart(2, "0"))
      .replace(/{SEQ:(\d+)}/g, (_, len) => sequenceNumber.toString().padStart(parseInt(len), "0"));
    
    // Update last issued
    await db.update(schema.idPatterns)
      .set({ lastIssued: generatedId })
      .where(eq(schema.idPatterns.id, pattern.id));
    
    return generatedId;
  }
  
  // ========== ACCOUNT CATEGORIES ==========
  
  async getAllAccountCategories(): Promise<AccountCategory[]> {
    return await db.select().from(schema.accountCategories).orderBy(asc(schema.accountCategories.name));
  }
  
  async getAccountCategory(id: string): Promise<AccountCategory | undefined> {
    const result = await db.select().from(schema.accountCategories).where(eq(schema.accountCategories.id, id)).limit(1);
    return result[0];
  }
  
  async createAccountCategory(category: InsertAccountCategory): Promise<AccountCategory> {
    const result = await db.insert(schema.accountCategories).values(category).returning();
    return result[0];
  }
  
  async updateAccountCategory(id: string, category: Partial<AccountCategory>): Promise<AccountCategory> {
    const result = await db.update(schema.accountCategories)
      .set({ ...category, updatedAt: new Date() })
      .where(eq(schema.accountCategories.id, id))
      .returning();
    return result[0];
  }
  
  async deleteAccountCategory(id: string): Promise<void> {
    await db.delete(schema.accountCategories).where(eq(schema.accountCategories.id, id));
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
    opportunitiesByCloseDate: { period: string; count: number; value: number; opportunities: { id: string; name: string; amount: number; closeDate: string | null }[] }[];
  }> {
    // Get counts
    const accounts = await db.select({ count: sql<number>`count(*)` }).from(schema.accounts);
    const contacts = await db.select({ count: sql<number>`count(*)` }).from(schema.contacts);
    const leads = await db.select({ count: sql<number>`count(*)` }).from(schema.leads);
    const opportunities = await db.select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(eq(schema.opportunities.includeInForecast, true));
    
    // Get pipeline by stage (only opportunities included in forecast)
    const pipeline = await db
      .select({
        stage: schema.opportunities.stage,
        count: sql<number>`count(*)`,
        value: sql<number>`sum(cast(${schema.opportunities.amount} as numeric))`,
      })
      .from(schema.opportunities)
      .where(eq(schema.opportunities.includeInForecast, true))
      .groupBy(schema.opportunities.stage);
    
    // Get new leads this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const newLeads = await db.select({ count: sql<number>`count(*)` })
      .from(schema.leads)
      .where(gte(schema.leads.createdAt, startOfMonth));
    
    // Calculate win rate (only opportunities included in forecast)
    const closedWon = await db.select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(and(
        eq(schema.opportunities.stage, "closed_won"),
        eq(schema.opportunities.includeInForecast, true)
      ));
    
    const closedLost = await db.select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(and(
        eq(schema.opportunities.stage, "closed_lost"),
        eq(schema.opportunities.includeInForecast, true)
      ));
    
    const totalClosed = (closedWon[0]?.count || 0) + (closedLost[0]?.count || 0);
    const winRate = totalClosed > 0 ? Math.round(((closedWon[0]?.count || 0) / totalClosed) * 100) : 0;
    
    // Get upcoming opportunities grouped by close date (month)
    // Only include open opportunities (not closed_won or closed_lost)
    const now = new Date();
    const sixMonthsLater = new Date(now);
    sixMonthsLater.setMonth(now.getMonth() + 6);
    
    const upcomingOpps = await db
      .select({
        id: schema.opportunities.id,
        name: schema.opportunities.name,
        amount: schema.opportunities.amount,
        closeDate: schema.opportunities.closeDate,
        stage: schema.opportunities.stage,
      })
      .from(schema.opportunities)
      .where(
        and(
          eq(schema.opportunities.includeInForecast, true),
          notInArray(schema.opportunities.stage, ["closed_won", "closed_lost"]),
          or(
            and(
              isNotNull(schema.opportunities.closeDate),
              gte(schema.opportunities.closeDate, now),
              lte(schema.opportunities.closeDate, sixMonthsLater)
            ),
            isNull(schema.opportunities.closeDate) // Include opportunities without close date
          )
        )
      )
      .orderBy(schema.opportunities.closeDate);
    
    // Group by month/quarter
    const oppsByPeriod = new Map<string, { count: number; value: number; opportunities: any[] }>();
    
    upcomingOpps.forEach(opp => {
      let period: string;
      if (opp.closeDate) {
        const date = new Date(opp.closeDate);
        period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else {
        period = "No Date";
      }
      
      if (!oppsByPeriod.has(period)) {
        oppsByPeriod.set(period, { count: 0, value: 0, opportunities: [] });
      }
      
      const periodData = oppsByPeriod.get(period)!;
      periodData.count++;
      periodData.value += parseFloat(opp.amount || "0");
      periodData.opportunities.push({
        id: opp.id,
        name: opp.name,
        amount: parseFloat(opp.amount || "0"),
        closeDate: opp.closeDate?.toISOString() || null,
      });
    });
    
    const opportunitiesByCloseDate = Array.from(oppsByPeriod.entries())
      .map(([period, data]) => ({
        period,
        count: data.count,
        value: data.value,
        opportunities: data.opportunities,
      }))
      .sort((a, b) => {
        if (a.period === "No Date") return 1;
        if (b.period === "No Date") return -1;
        return a.period.localeCompare(b.period);
      });
    
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
      opportunitiesByCloseDate,
    };
  }
  
  async getSalesWaterfallData(year: number): Promise<{
    name: string;
    amount: number;
    stage: string;
    closeDate: string | null;
  }[]> {
    // Get all opportunities for the specified year (based on close date or created date)
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);
    
    const opps = await db
      .select({
        id: schema.opportunities.id,
        name: schema.opportunities.name,
        amount: schema.opportunities.amount,
        stage: schema.opportunities.stage,
        closeDate: schema.opportunities.closeDate,
      })
      .from(schema.opportunities)
      .where(
        sql`${schema.opportunities.includeInForecast} = true AND (
          (${schema.opportunities.closeDate} >= ${startOfYear} AND ${schema.opportunities.closeDate} <= ${endOfYear})
          OR (${schema.opportunities.closeDate} IS NULL AND ${schema.opportunities.createdAt} >= ${startOfYear})
        )`
      )
      .orderBy(schema.opportunities.createdAt);
    
    return opps.map(opp => ({
      name: opp.name,
      amount: parseFloat(opp.amount || "0"),
      stage: opp.stage,
      closeDate: opp.closeDate?.toISOString() || null,
    }));
  }
  
  // ========== TAGS ==========
  
  async getAllTags(): Promise<schema.Tag[]> {
    return await db.select().from(schema.tags).orderBy(schema.tags.name);
  }
  
  async getTagById(id: string): Promise<schema.Tag | undefined> {
    const result = await db.select().from(schema.tags).where(eq(schema.tags.id, id)).limit(1);
    return result[0];
  }
  
  async createTag(tag: schema.InsertTag): Promise<schema.Tag> {
    const result = await db.insert(schema.tags)
      .values({ ...tag, updatedAt: new Date() })
      .returning();
    return result[0];
  }
  
  async updateTag(id: string, tag: Partial<schema.InsertTag>): Promise<schema.Tag> {
    const result = await db.update(schema.tags)
      .set({ ...tag, updatedAt: new Date() })
      .where(eq(schema.tags.id, id))
      .returning();
    return result[0];
  }
  
  async deleteTag(id: string): Promise<void> {
    await db.delete(schema.tags).where(eq(schema.tags.id, id));
  }
  
  // ========== ENTITY TAGS ==========
  
  async getEntityTags(entity: string, entityId: string): Promise<schema.Tag[]> {
    const result = await db
      .select({
        id: schema.tags.id,
        name: schema.tags.name,
        color: schema.tags.color,
        createdBy: schema.tags.createdBy,
        createdAt: schema.tags.createdAt,
        updatedAt: schema.tags.updatedAt,
      })
      .from(schema.entityTags)
      .innerJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
      .where(and(
        eq(schema.entityTags.entity, entity),
        eq(schema.entityTags.entityId, entityId)
      ));
    
    return result;
  }
  
  async addEntityTags(entity: string, entityId: string, tagIds: string[], userId: string): Promise<void> {
    if (tagIds.length === 0) return;
    
    const values = tagIds.map(tagId => ({
      entity,
      entityId,
      tagId,
      createdBy: userId,
    }));
    
    await db.insert(schema.entityTags)
      .values(values)
      .onConflictDoNothing();
  }
  
  async removeEntityTag(entity: string, entityId: string, tagId: string): Promise<void> {
    await db.delete(schema.entityTags)
      .where(and(
        eq(schema.entityTags.entity, entity),
        eq(schema.entityTags.entityId, entityId),
        eq(schema.entityTags.tagId, tagId)
      ));
  }
  
  // ========== ADMIN OPERATIONS ==========
  
  async resetDatabase(): Promise<void> {
    // Delete all CRM entity data in reverse dependency order
    // This preserves system configuration (roles, permissions, id_patterns)
    await db.delete(schema.entityTags);
    await db.delete(schema.activities);
    await db.delete(schema.leads);
    await db.delete(schema.opportunities);
    await db.delete(schema.contacts);
    await db.delete(schema.accounts);
    
    // Reset ID pattern counters to their starting values
    const patterns = await db.select().from(schema.idPatterns);
    for (const pattern of patterns) {
      await db.update(schema.idPatterns)
        .set({ counter: pattern.startValue || 1 })
        .where(eq(schema.idPatterns.id, pattern.id));
    }
  }
}

export const storage = new PostgresStorage();
export { eq, sql, and, gte, lte, ne, asc, desc, inArray };
