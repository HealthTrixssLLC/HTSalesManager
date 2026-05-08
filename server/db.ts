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
// Expose a module-level raw pg Pool for operations that need direct parameterized queries
// (e.g., updating PostgreSQL text[] array columns which Drizzle sql template can't handle)
let rawPgPool: PgPool | null = null;

if (isNeonDatabase) {
  // Use Neon serverless driver (WebSocket-based) for Replit
  console.log('Using Neon serverless database driver');
  neonConfig.webSocketConstructor = ws;
  
  // Configure connection pooling for better reliability
  const pool = new NeonPool({ 
    connectionString: process.env.DATABASE_URL,
    max: 10,                    // Maximum 10 connections in pool
    idleTimeoutMillis: 30000,   // Close idle connections after 30s
    connectionTimeoutMillis: 60000, // 60s timeout for new connections
  });
  
  db = neonDrizzle(pool, { schema });
} else {
  // Use standard pg driver for Docker/local PostgreSQL
  console.log('Using standard PostgreSQL driver');
  const pool = new PgPool({ 
    connectionString: process.env.DATABASE_URL,
    max: 20,                    // Maximum 20 connections in pool
    idleTimeoutMillis: 30000,   // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // 10s timeout for new connections
  });
  rawPgPool = pool;
  db = pgDrizzle(pool, { schema });
}

export { db };

export class PostgresStorage implements IStorage {
  // ========== AUTH & USER MANAGEMENT ==========
  
  async getUserByEmail(email: string): Promise<(User & { password: string }) | undefined> {
    const result = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    return result[0] as (User & { password: string }) | undefined;
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

  async mergeUsers(primaryId: string, secondaryIds: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      // Re-attribute core CRM FK references
      await tx.update(schema.accounts).set({ ownerId: primaryId }).where(inArray(schema.accounts.ownerId, secondaryIds));
      await tx.update(schema.contacts).set({ ownerId: primaryId }).where(inArray(schema.contacts.ownerId, secondaryIds));
      await tx.update(schema.leads).set({ ownerId: primaryId }).where(inArray(schema.leads.ownerId, secondaryIds));
      await tx.update(schema.opportunities).set({ ownerId: primaryId }).where(inArray(schema.opportunities.ownerId, secondaryIds));
      await tx.update(schema.activities).set({ ownerId: primaryId }).where(inArray(schema.activities.ownerId, secondaryIds));
      await tx.update(schema.auditLogs).set({ actorId: primaryId }).where(inArray(schema.auditLogs.actorId, secondaryIds));
      await tx.update(schema.comments).set({ createdBy: primaryId }).where(inArray(schema.comments.createdBy, secondaryIds));
      await tx.update(schema.comments).set({ editedBy: primaryId }).where(inArray(schema.comments.editedBy, secondaryIds));
      await tx.update(schema.commentAttachments).set({ uploadedBy: primaryId }).where(inArray(schema.commentAttachments.uploadedBy, secondaryIds));
      await tx.update(schema.apiKeys).set({ createdBy: primaryId }).where(inArray(schema.apiKeys.createdBy, secondaryIds));
      await tx.update(schema.apiKeys).set({ revokedBy: primaryId }).where(inArray(schema.apiKeys.revokedBy, secondaryIds));
      await tx.update(schema.tags).set({ createdBy: primaryId }).where(inArray(schema.tags.createdBy, secondaryIds));
      await tx.update(schema.entityTags).set({ createdBy: primaryId }).where(inArray(schema.entityTags.createdBy, secondaryIds));
      await tx.update(schema.backupJobs).set({ initiatedBy: primaryId }).where(inArray(schema.backupJobs.initiatedBy, secondaryIds));
      await tx.update(schema.crmDocuments).set({ uploadedBy: primaryId }).where(inArray(schema.crmDocuments.uploadedBy, secondaryIds));
      await tx.update(schema.llmConfigurations).set({ updatedBy: primaryId }).where(inArray(schema.llmConfigurations.updatedBy, secondaryIds));

      // Re-attribute lead-generation module FK references
      await tx.update(schema.researchDocuments).set({ createdBy: primaryId }).where(inArray(schema.researchDocuments.createdBy, secondaryIds));
      await tx.update(schema.icpProfiles).set({ createdBy: primaryId }).where(inArray(schema.icpProfiles.createdBy, secondaryIds));
      await tx.update(schema.icpProfileVersions).set({ createdBy: primaryId }).where(inArray(schema.icpProfileVersions.createdBy, secondaryIds));
      await tx.update(schema.offers).set({ createdBy: primaryId }).where(inArray(schema.offers.createdBy, secondaryIds));
      await tx.update(schema.taskPlaybooks).set({ createdBy: primaryId }).where(inArray(schema.taskPlaybooks.createdBy, secondaryIds));
      await tx.update(schema.leadGenerationRuns).set({ ownerId: primaryId }).where(inArray(schema.leadGenerationRuns.ownerId, secondaryIds));
      await tx.update(schema.leadGenerationRuns).set({ createdBy: primaryId }).where(inArray(schema.leadGenerationRuns.createdBy, secondaryIds));
      await tx.update(schema.candidateLeads).set({ reviewedBy: primaryId }).where(inArray(schema.candidateLeads.reviewedBy, secondaryIds));
      await tx.update(schema.candidateLeads).set({ createdBy: primaryId }).where(inArray(schema.candidateLeads.createdBy, secondaryIds));
      await tx.update(schema.reviewDecisions).set({ decidedBy: primaryId }).where(inArray(schema.reviewDecisions.decidedBy, secondaryIds));
      await tx.update(schema.lgAuditEvents).set({ actorId: primaryId }).where(inArray(schema.lgAuditEvents.actorId, secondaryIds));
      await tx.update(schema.aiConfigs).set({ createdBy: primaryId }).where(inArray(schema.aiConfigs.createdBy, secondaryIds));

      // Re-attribute savedFilters (CASCADE DELETE, must re-attribute before user delete)
      await tx.update(schema.savedFilters).set({ userId: primaryId }).where(inArray(schema.savedFilters.userId, secondaryIds));

      // Handle opportunityResources: respect unique constraint on (opportunityId, userId)
      for (const secondaryId of secondaryIds) {
        const secondaryResources = await tx.select().from(schema.opportunityResources).where(eq(schema.opportunityResources.userId, secondaryId));
        for (const resource of secondaryResources) {
          const existing = await tx.select().from(schema.opportunityResources)
            .where(and(
              eq(schema.opportunityResources.opportunityId, resource.opportunityId),
              eq(schema.opportunityResources.userId, primaryId)
            ))
            .limit(1);
          if (existing.length > 0) {
            await tx.delete(schema.opportunityResources).where(eq(schema.opportunityResources.id, resource.id));
          } else {
            await tx.update(schema.opportunityResources).set({ userId: primaryId }).where(eq(schema.opportunityResources.id, resource.id));
          }
        }
      }

      // Handle userRoles: add secondary users' roles to primary if not already assigned
      const primaryRoles = await tx.select().from(schema.userRoles).where(eq(schema.userRoles.userId, primaryId));
      const primaryRoleIds = new Set(primaryRoles.map(r => r.roleId));
      for (const secondaryId of secondaryIds) {
        const secondaryRoles = await tx.select().from(schema.userRoles).where(eq(schema.userRoles.userId, secondaryId));
        for (const role of secondaryRoles) {
          if (!primaryRoleIds.has(role.roleId)) {
            await tx.insert(schema.userRoles).values({ userId: primaryId, roleId: role.roleId });
            primaryRoleIds.add(role.roleId);
          }
        }
      }

      // Delete secondary users (cascades: user_roles, comment_reactions, comment_subscriptions)
      await tx.delete(schema.users).where(inArray(schema.users.id, secondaryIds));
    });
  }

  async assignPermissionToRole(roleId: string, permissionId: string): Promise<void> {
    await db.insert(schema.rolePermissions).values({ roleId, permissionId });
  }
  
  // ========== ACCOUNTS ==========
  
  async getAllAccounts(orgId?: string): Promise<Account[]> {
    try {
      // Use raw SQL for tag aggregation to avoid N+1 queries
      const orgFilter = orgId ? sql`WHERE a.organization_id = ${orgId}` : sql``;
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
        ${orgFilter}
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
      account.id = await this.generateId("Account", account.organizationId || undefined);
    }
    const result = await db.insert(schema.accounts).values(account).returning();
    return result[0];
  }
  
  async updateAccount(id: string, account: Partial<InsertAccount>): Promise<Account> {
    const { organizationId: _orgId, ...safeUpdates } = account;
    const result = await db.update(schema.accounts)
      .set({ ...safeUpdates, updatedAt: new Date() })
      .where(eq(schema.accounts.id, id))
      .returning();
    return result[0];
  }
  
  async deleteAccount(id: string): Promise<void> {
    await db.delete(schema.accounts).where(eq(schema.accounts.id, id));
  }
  
  // ========== CONTACTS ==========
  
  async getAllContacts(orgId?: string): Promise<Contact[]> {
    try {
      // Use raw SQL for tag aggregation to avoid N+1 queries
      const orgFilter = orgId ? sql`WHERE c.organization_id = ${orgId}` : sql``;
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
        ${orgFilter}
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
      contact.id = await this.generateId("Contact", contact.organizationId || undefined);
    }
    const result = await db.insert(schema.contacts).values(contact).returning();
    return result[0];
  }
  
  async updateContact(id: string, contact: Partial<InsertContact>): Promise<Contact> {
    const { organizationId: _orgId, ...safeUpdates } = contact;
    const result = await db.update(schema.contacts)
      .set({ ...safeUpdates, updatedAt: new Date() })
      .where(eq(schema.contacts.id, id))
      .returning();
    return result[0];
  }
  
  async deleteContact(id: string): Promise<void> {
    await db.delete(schema.contacts).where(eq(schema.contacts.id, id));
  }
  
  // ========== LEADS ==========
  
  async getAllLeads(orgId?: string): Promise<Lead[]> {
    try {
      // Use raw SQL for tag aggregation to avoid N+1 queries
      const orgFilter = orgId ? sql`WHERE l.organization_id = ${orgId}` : sql``;
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
        ${orgFilter}
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
      lead.id = await this.generateId("Lead", lead.organizationId || undefined);
    }
    const result = await db.insert(schema.leads).values(lead).returning();
    return result[0];
  }
  
  async updateLead(id: string, lead: Partial<InsertLead>): Promise<Lead> {
    const { organizationId: _orgId, ...safeUpdates } = lead;
    const result = await db.update(schema.leads)
      .set({ ...safeUpdates, updatedAt: new Date() })
      .where(eq(schema.leads.id, id))
      .returning();
    return result[0];
  }
  
  async deleteLead(id: string): Promise<void> {
    await db.delete(schema.leads).where(eq(schema.leads.id, id));
  }
  
  // ========== OPPORTUNITIES ==========
  
  async getAllOpportunities(orgId?: string): Promise<Opportunity[]> {
    try {
      // Use raw SQL for tag aggregation to avoid N+1 queries
      // Explicitly alias all columns to ensure proper snake_case to camelCase conversion
      const orgFilter = orgId ? sql`WHERE o.organization_id = ${orgId}` : sql``;
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
          o.implementation_start_date as "implementationStartDate",
          o.implementation_end_date as "implementationEndDate",
          o.categories,
          o.operational_areas as "operationalAreas",
          o.description,
          o.created_at as "createdAt",
          o.updated_at as "updatedAt",
          a.name as "accountName",
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
        LEFT JOIN accounts a ON a.id = o.account_id
        LEFT JOIN entity_tags et ON et.entity_id = o.id AND et.entity = 'Opportunity'
        LEFT JOIN tags t ON t.id = et.tag_id
        ${orgFilter}
        GROUP BY o.id, a.name
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
      opportunity.id = await this.generateId("Opportunity", opportunity.organizationId || undefined);
    }
    const result = await db.insert(schema.opportunities).values(opportunity).returning();
    return result[0];
  }
  
  async updateOpportunity(id: string, opportunity: Partial<InsertOpportunity>): Promise<Opportunity> {
    // Extract the fields that need explicit SQL handling (array columns + description)
    // Also strip organizationId to prevent cross-org record movement via updates
    const { categories, operationalAreas, description, organizationId: _orgId, ...rest } = opportunity;

    // Step 1: update all standard scalar fields via Drizzle ORM
    await db.update(schema.opportunities)
      .set({ ...rest, updatedAt: new Date() })
      .where(eq(schema.opportunities.id, id));

    // Step 2: explicitly update array/text fields using raw SQL to guarantee correct persistence
    // (Drizzle ORM can have issues with PostgreSQL text[] array columns in .set())
    const hasCategories = categories !== undefined;
    const hasOperationalAreas = operationalAreas !== undefined;
    const hasDescription = description !== undefined;

    // Build a raw parameterized query for the array/text fields
    // Drizzle's sql template serializes JS arrays as pg records (not text[]),
    // so we use rawPgPool.query() for direct parameterized execution
    const setClauses: string[] = [];
    const params: any[] = [];

    if (hasCategories) {
      const catVal = (categories && categories.length > 0) ? categories : null;
      params.push(catVal);
      setClauses.push(`categories = $${params.length}`);
    }
    if (hasOperationalAreas) {
      const areaVal = (operationalAreas && operationalAreas.length > 0) ? operationalAreas : null;
      params.push(areaVal);
      setClauses.push(`operational_areas = $${params.length}`);
    }
    if (hasDescription) {
      params.push(description ?? null);
      setClauses.push(`description = $${params.length}`);
    }

    if (setClauses.length > 0) {
      params.push(id);
      const rawSql = `UPDATE opportunities SET ${setClauses.join(', ')} WHERE id = $${params.length}`;

      if (rawPgPool) {
        // Standard pg driver: pass arrays as JS arrays — pg serializes them correctly as text[]
        await rawPgPool.query(rawSql, params);
      } else {
        // Neon: build ARRAY[...] literal strings to avoid record serialization
        const neonClauses: string[] = [];
        if (hasCategories) {
          const catVal = (categories && categories.length > 0) ? categories : null;
          const arrLit = catVal
            ? `ARRAY[${catVal.map((c: string) => `'${c.replace(/'/g, "''")}'`).join(',')}]::text[]`
            : 'NULL';
          neonClauses.push(`categories = ${arrLit}`);
        }
        if (hasOperationalAreas) {
          const areaVal = (operationalAreas && operationalAreas.length > 0) ? operationalAreas : null;
          const arrLit = areaVal
            ? `ARRAY[${areaVal.map((a: string) => `'${a.replace(/'/g, "''")}'`).join(',')}]::text[]`
            : 'NULL';
          neonClauses.push(`operational_areas = ${arrLit}`);
        }
        if (hasDescription) {
          const escaped = description ? description.replace(/'/g, "''") : null;
          neonClauses.push(`description = ${escaped !== null ? `'${escaped}'` : 'NULL'}`);
        }
        if (neonClauses.length > 0) {
          await db.execute(sql.raw(`UPDATE opportunities SET ${neonClauses.join(', ')} WHERE id = '${id.replace(/'/g, "''")}'`));
        }
      }
    }

    // Return the fully updated record
    const [updated] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, id)).limit(1);
    return updated;
  }
  
  async deleteOpportunity(id: string): Promise<void> {
    await db.delete(schema.opportunities).where(eq(schema.opportunities.id, id));
  }
  
  // ========== ACTIVITIES ==========
  
  async getAllActivities(orgId?: string): Promise<Activity[]> {
    if (orgId) {
      return await db.select().from(schema.activities).where(eq(schema.activities.organizationId, orgId));
    }
    return await db.select().from(schema.activities);
  }
  
  async getActivityById(id: string): Promise<Activity | undefined> {
    const result = await db.select().from(schema.activities).where(eq(schema.activities.id, id)).limit(1);
    return result[0];
  }
  
  async createActivity(activity: InsertActivity): Promise<Activity> {
    const id = await this.generateId("Activity", activity.organizationId || undefined);
    const result = await db.insert(schema.activities).values({
      ...activity,
      id,
      // Convert ISO string dates to Date objects for Drizzle timestamp columns
      dueAt: activity.dueAt ? new Date(activity.dueAt) : null,
      completedAt: activity.completedAt ? new Date(activity.completedAt) : null,
    } as typeof schema.activities.$inferInsert).returning();
    return result[0];
  }
  
  async updateActivity(id: string, activity: Partial<InsertActivity>): Promise<Activity> {
    const { organizationId: _orgId, ...safeUpdates } = activity;
    const result = await db.update(schema.activities)
      .set({ ...safeUpdates, updatedAt: new Date() })
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
  
  async getAllIdPatterns(orgId?: string): Promise<IdPattern[]> {
    if (orgId) {
      // Return only org-specific patterns (strict tenant isolation, no global fallback)
      return await db.select().from(schema.idPatterns)
        .where(eq(schema.idPatterns.organizationId, orgId))
        .orderBy(schema.idPatterns.entity);
    }
    return await db.select().from(schema.idPatterns).orderBy(schema.idPatterns.entity);
  }
  
  async getIdPattern(entity: string, orgId?: string): Promise<IdPattern | undefined> {
    if (orgId) {
      // Return only org-specific pattern (strict tenant isolation, no global fallback)
      const result = await db.select().from(schema.idPatterns)
        .where(and(eq(schema.idPatterns.entity, entity), eq(schema.idPatterns.organizationId, orgId))).limit(1);
      return result[0];
    }
    // Admin/global context: return the unscoped global pattern
    const result = await db.select().from(schema.idPatterns)
      .where(and(eq(schema.idPatterns.entity, entity), isNull(schema.idPatterns.organizationId))).limit(1);
    return result[0];
  }
  
  async updateIdPattern(id: string, pattern: Partial<IdPattern>): Promise<IdPattern> {
    const result = await db.update(schema.idPatterns)
      .set({ ...pattern, updatedAt: new Date() })
      .where(eq(schema.idPatterns.id, id))
      .returning();
    return result[0];
  }
  
  async generateId(entity: string, orgId?: string): Promise<string> {
    const defaultPatterns: Record<string, string> = {
      "Account": "ACCT-{YYYY}-{SEQ:5}",
      "Contact": "CONT-{YY}{MM}-{SEQ:5}",
      "Lead": "LEAD-{SEQ:6}",
      "Opportunity": "OPP-{YYYY}-{SEQ:6}",
      "Activity": "ACT-{YY}{MM}-{SEQ:5}",
    };

    // --- Step 1: Resolve the global (null-org) counter pattern ---
    // The GLOBAL pattern is always the authoritative counter to ensure IDs are
    // globally unique across all orgs. Per-org patterns only customize the format string.
    let globalPattern = await this.getIdPattern(entity, undefined);
    if (!globalPattern) {
      const defaultFmt = defaultPatterns[entity] || `${entity.toUpperCase()}-{SEQ:6}`;
      const inserted = await db.insert(schema.idPatterns).values({
        entity,
        pattern: defaultFmt,
        counter: 0,
        startValue: 1,
        organizationId: null,
      }).returning();
      globalPattern = inserted[0];
    }
    if (!globalPattern) {
      throw new Error(`Failed to find or create global ID pattern for entity: ${entity}`);
    }

    // --- Step 2: Atomically increment the GLOBAL counter ---
    const [updatedGlobal] = await db.update(schema.idPatterns)
      .set({ counter: sql`${schema.idPatterns.counter} + 1`, updatedAt: new Date() })
      .where(eq(schema.idPatterns.id, globalPattern.id))
      .returning();

    const counter = updatedGlobal.counter;
    const startValue = updatedGlobal.startValue || 1;
    const sequenceNumber = startValue + (counter - 1);

    // --- Step 3: Resolve format string ---
    // Prefer org-specific format (for custom prefixes) but NEVER use its counter.
    let formatPattern = updatedGlobal.pattern;
    if (orgId) {
      const orgSpecific = await this.getIdPattern(entity, orgId);
      if (orgSpecific) {
        formatPattern = orgSpecific.pattern;
        // Mirror lastIssued on the org-specific row for UI display purposes only
        await db.update(schema.idPatterns)
          .set({ lastIssued: null, updatedAt: new Date() })
          .where(eq(schema.idPatterns.id, orgSpecific.id));
      }
    }

    // --- Step 4: Generate the ID string ---
    const now = new Date();
    const generatedId = formatPattern
      .replace("{PREFIX}", entity.substring(0, 4).toUpperCase())
      .replace("{YYYY}", now.getFullYear().toString())
      .replace("{YY}", now.getFullYear().toString().slice(2))
      .replace("{MM}", (now.getMonth() + 1).toString().padStart(2, "0"))
      .replace(/{SEQ:(\d+)}/g, (_: string, len: string) => sequenceNumber.toString().padStart(parseInt(len), "0"));

    // Update lastIssued on global pattern for admin visibility
    await db.update(schema.idPatterns)
      .set({ lastIssued: generatedId })
      .where(eq(schema.idPatterns.id, updatedGlobal.id));

    return generatedId;
  }
  
  // ========== ACCOUNT CATEGORIES ==========
  
  async getAllAccountCategories(orgId?: string): Promise<AccountCategory[]> {
    // Strict tenant isolation: return only org-specific categories when orgId is provided.
    // When orgId is not provided: return only global categories (null org) for admin/bootstrap contexts.
    const condition = orgId
      ? eq(schema.accountCategories.organizationId, orgId)
      : isNull(schema.accountCategories.organizationId);
    return await db.select().from(schema.accountCategories)
      .where(condition)
      .orderBy(asc(schema.accountCategories.name));
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
  
  async getDashboardStats(year: number, orgId?: string): Promise<{
    totalAccounts: number;
    totalContacts: number;
    totalLeads: number;
    totalOpportunities: number;
    pipelineByStage: { stage: string; count: number; value: number }[];
    newLeadsThisMonth: number;
    winRate: number;
    totalClosedDeals: number;
    opportunitiesByCloseDate: { period: string; count: number; value: number; opportunities: { id: string; name: string; amount: number; closeDate: string | null }[] }[];
  }> {
    // Year date range
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    // Org filter helpers
    const accountOrgFilter = orgId ? eq(schema.accounts.organizationId, orgId) : undefined;
    const contactOrgFilter = orgId ? eq(schema.contacts.organizationId, orgId) : undefined;
    const leadOrgFilter = orgId ? eq(schema.leads.organizationId, orgId) : undefined;
    const oppOrgFilter = orgId ? eq(schema.opportunities.organizationId, orgId) : undefined;

    // Get counts (accounts and contacts are all-time)
    const accounts = await db.select({ count: sql<number>`count(*)` })
      .from(schema.accounts)
      .where(accountOrgFilter);
    const contacts = await db.select({ count: sql<number>`count(*)` })
      .from(schema.contacts)
      .where(contactOrgFilter);

    // Leads created in the selected year
    const leads = await db.select({ count: sql<number>`count(*)` })
      .from(schema.leads)
      .where(and(
        leadOrgFilter,
        gte(schema.leads.createdAt, yearStart),
        lte(schema.leads.createdAt, yearEnd)
      ));

    // Opportunities with close date in the selected year
    const opportunities = await db.select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(and(
        oppOrgFilter,
        eq(schema.opportunities.includeInForecast, true),
        isNotNull(schema.opportunities.closeDate),
        gte(schema.opportunities.closeDate, yearStart),
        lte(schema.opportunities.closeDate, yearEnd)
      ));
    
    // Get pipeline by stage scoped to selected year
    const pipeline = await db
      .select({
        stage: schema.opportunities.stage,
        count: sql<number>`count(*)`,
        value: sql<number>`sum(cast(${schema.opportunities.amount} as numeric))`,
      })
      .from(schema.opportunities)
      .where(and(
        oppOrgFilter,
        eq(schema.opportunities.includeInForecast, true),
        isNotNull(schema.opportunities.closeDate),
        gte(schema.opportunities.closeDate, yearStart),
        lte(schema.opportunities.closeDate, yearEnd)
      ))
      .groupBy(schema.opportunities.stage);
    
    // New leads this month within the selected year
    const now = new Date();
    const targetMonth = year === now.getFullYear() ? now.getMonth() : 11;
    const startOfMonth = new Date(year, targetMonth, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(year, targetMonth + 1, 0, 23, 59, 59, 999);
    
    const newLeads = await db.select({ count: sql<number>`count(*)` })
      .from(schema.leads)
      .where(and(
        leadOrgFilter,
        gte(schema.leads.createdAt, startOfMonth),
        lte(schema.leads.createdAt, endOfMonth)
      ));
    
    // Win rate = closed_won / (closed_won + closed_lost) for the selected year.
    // Scoped to close date in the selected year; only includeInForecast deals; pipeline excluded.
    const closedWon = await db.select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(and(
        oppOrgFilter,
        eq(schema.opportunities.stage, "closed_won"),
        eq(schema.opportunities.includeInForecast, true),
        isNotNull(schema.opportunities.closeDate),
        gte(schema.opportunities.closeDate, yearStart),
        lte(schema.opportunities.closeDate, yearEnd)
      ));
    
    const closedLost = await db.select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(and(
        oppOrgFilter,
        eq(schema.opportunities.stage, "closed_lost"),
        eq(schema.opportunities.includeInForecast, true),
        isNotNull(schema.opportunities.closeDate),
        gte(schema.opportunities.closeDate, yearStart),
        lte(schema.opportunities.closeDate, yearEnd)
      ));
    
    const wonCount = Number(closedWon[0]?.count ?? 0);
    const lostCount = Number(closedLost[0]?.count ?? 0);
    const totalClosed = wonCount + lostCount;
    const winRate = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 0;
    
    // Get upcoming opportunities grouped by close date (month)
    // Only include open opportunities (not closed_won or closed_lost)
    const nowDate = new Date();
    const sixMonthsLater = new Date(nowDate);
    sixMonthsLater.setMonth(nowDate.getMonth() + 6);
    
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
          oppOrgFilter,
          eq(schema.opportunities.includeInForecast, true),
          notInArray(schema.opportunities.stage, ["closed_won", "closed_lost"]),
          or(
            and(
              isNotNull(schema.opportunities.closeDate),
              gte(schema.opportunities.closeDate, nowDate),
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
      totalClosedDeals: wonCount + lostCount,
      opportunitiesByCloseDate,
    };
  }
  
  async getSalesWaterfallData(year: number, orgId?: string): Promise<{
    name: string;
    amount: number;
    stage: string;
    closeDate: string | null;
  }[]> {
    // Get all opportunities for the specified year (based on close date or created date)
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);
    
    const oppOrgFilter = orgId ? eq(schema.opportunities.organizationId, orgId) : undefined;

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
        and(
          oppOrgFilter,
          sql`${schema.opportunities.includeInForecast} = true AND (
            (${schema.opportunities.closeDate} >= ${startOfYear} AND ${schema.opportunities.closeDate} <= ${endOfYear})
            OR (${schema.opportunities.closeDate} IS NULL AND ${schema.opportunities.createdAt} >= ${startOfYear})
          )`
        )
      )
      .orderBy(schema.opportunities.createdAt);
    
    return opps.map(opp => ({
      name: opp.name,
      amount: parseFloat(opp.amount || "0"),
      stage: opp.stage,
      closeDate: opp.closeDate?.toISOString() || null,
    }));
  }
  
  // ========== API KEYS ==========
  
  async getAllApiKeys(orgId?: string): Promise<schema.ApiKey[]> {
    return await db.select().from(schema.apiKeys)
      .where(orgId ? eq(schema.apiKeys.organizationId, orgId) : undefined)
      .orderBy(desc(schema.apiKeys.createdAt));
  }
  
  async getApiKeyById(id: string): Promise<schema.ApiKey | undefined> {
    const result = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).limit(1);
    return result[0];
  }
  
  async getApiKeyByHashedKey(hashedKey: string): Promise<schema.ApiKey | undefined> {
    const result = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.hashedKey, hashedKey)).limit(1);
    return result[0];
  }
  
  async createApiKey(apiKey: schema.InsertApiKey): Promise<schema.ApiKey> {
    const result = await db.insert(schema.apiKeys).values(apiKey).returning();
    return result[0];
  }
  
  async updateApiKeyLastUsed(id: string): Promise<void> {
    await db.update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, id));
  }
  
  async revokeApiKey(id: string, userId: string): Promise<schema.ApiKey> {
    const result = await db.update(schema.apiKeys)
      .set({
        isActive: false,
        revokedBy: userId,
        revokedAt: new Date(),
      })
      .where(eq(schema.apiKeys.id, id))
      .returning();
    return result[0];
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
  
  async getEntityTagsBulk(entity: string, entityIds: string[]): Promise<Array<{ entityId: string; id: string; name: string; color: string }>> {
    if (entityIds.length === 0) return [];
    const result = await db
      .select({
        entityId: schema.entityTags.entityId,
        id: schema.tags.id,
        name: schema.tags.name,
        color: schema.tags.color,
      })
      .from(schema.entityTags)
      .innerJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
      .where(and(
        eq(schema.entityTags.entity, entity),
        inArray(schema.entityTags.entityId, entityIds)
      ));
    return result;
  }

  async getActivityTagsBulk(activityIds: string[], orgId?: string): Promise<Array<{ entityId: string; id: string; name: string; color: string }>> {
    if (activityIds.length === 0) return [];
    const result = await db
      .select({
        entityId: schema.entityTags.entityId,
        id: schema.tags.id,
        name: schema.tags.name,
        color: schema.tags.color,
      })
      .from(schema.entityTags)
      .innerJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
      .innerJoin(schema.activities, eq(schema.activities.id, schema.entityTags.entityId))
      .where(and(
        eq(schema.entityTags.entity, "Activity"),
        inArray(schema.entityTags.entityId, activityIds),
        orgId ? eq(schema.activities.organizationId, orgId) : undefined
      ));
    return result;
  }

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
  
  // ========== OPPORTUNITY RESOURCES ==========
  
  async getOpportunityResources(opportunityId: string): Promise<schema.OpportunityResource[]> {
    return await db.select().from(schema.opportunityResources)
      .where(eq(schema.opportunityResources.opportunityId, opportunityId));
  }
  
  async addOpportunityResource(resource: schema.InsertOpportunityResource): Promise<schema.OpportunityResource> {
    const result = await db.insert(schema.opportunityResources).values(resource).returning();
    return result[0];
  }
  
  async removeOpportunityResource(id: string): Promise<void> {
    await db.delete(schema.opportunityResources).where(eq(schema.opportunityResources.id, id));
  }
  
  async getAllOpportunityResources(): Promise<schema.OpportunityResource[]> {
    return await db.select().from(schema.opportunityResources);
  }
  
  // ========== LLM CONFIGURATION ==========
  
  async getLlmConfiguration(orgId?: string): Promise<schema.LlmConfiguration | undefined> {
    if (orgId) {
      // Return only org-specific config (strict tenant isolation, no global fallback)
      const result = await db.select().from(schema.llmConfigurations)
        .where(eq(schema.llmConfigurations.organizationId, orgId)).limit(1);
      return result[0];
    }
    // Admin/global context: return unscoped global config
    const result = await db.select().from(schema.llmConfigurations)
      .where(isNull(schema.llmConfigurations.organizationId)).limit(1);
    return result[0];
  }
  
  async upsertLlmConfiguration(config: Partial<schema.InsertLlmConfiguration> & { updatedBy?: string }, orgId?: string): Promise<schema.LlmConfiguration> {
    const existing = await this.getLlmConfiguration(orgId);
    if (existing && existing.organizationId === (orgId || null)) {
      const result = await db.update(schema.llmConfigurations)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(schema.llmConfigurations.id, existing.id))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(schema.llmConfigurations).values({
        provider: "openai",
        modelName: "gpt-4o",
        temperature: "0.7",
        maxTokens: 4096,
        requestTimeout: 60,
        enabledAgents: ["market_research", "company_discovery", "lead_discovery", "strategy", "communication_drafting"],
        agentModelOverrides: {},
        ...config,
        organizationId: orgId || null,
      }).returning();
      return result[0];
    }
  }
  
  // ========== CRM DOCUMENT ATTACHMENTS ==========

  async getDocuments(entityType: schema.CrmDocumentEntityType, entityId: string): Promise<schema.CrmDocument[]> {
    return await db
      .select()
      .from(schema.crmDocuments)
      .where(
        and(
          eq(schema.crmDocuments.entityType, entityType),
          eq(schema.crmDocuments.entityId, entityId)
        )
      )
      .orderBy(desc(schema.crmDocuments.createdAt));
  }

  async getDocumentById(id: string): Promise<schema.CrmDocument | undefined> {
    const [doc] = await db
      .select()
      .from(schema.crmDocuments)
      .where(eq(schema.crmDocuments.id, id));
    return doc;
  }

  async createDocument(data: schema.InsertCrmDocument): Promise<schema.CrmDocument> {
    const [doc] = await db.insert(schema.crmDocuments).values(data).returning();
    return doc;
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(schema.crmDocuments).where(eq(schema.crmDocuments.id, id));
  }

  // ========== ORGANIZATIONS ==========

  async getAllOrganizations(): Promise<schema.Organization[]> {
    return await db.select().from(schema.organizations).orderBy(asc(schema.organizations.name));
  }

  async getOrganizationById(id: string): Promise<schema.Organization | undefined> {
    const result = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id)).limit(1);
    return result[0];
  }

  async createOrganization(org: schema.InsertOrganization): Promise<schema.Organization> {
    const result = await db.insert(schema.organizations).values(org).returning();
    return result[0];
  }

  async updateOrganization(id: string, org: Partial<schema.InsertOrganization>): Promise<schema.Organization> {
    const result = await db.update(schema.organizations)
      .set({ ...org, updatedAt: new Date() })
      .where(eq(schema.organizations.id, id))
      .returning();
    return result[0];
  }

  async deleteOrganization(id: string): Promise<void> {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, id));
  }

  async getOrganizationMembers(organizationId: string): Promise<(schema.UserOrganization & { user: schema.User; roleName: string })[]> {
    const result = await db
      .select({
        id: schema.userOrganizations.id,
        userId: schema.userOrganizations.userId,
        organizationId: schema.userOrganizations.organizationId,
        roleId: schema.userOrganizations.roleId,
        isDefault: schema.userOrganizations.isDefault,
        createdAt: schema.userOrganizations.createdAt,
        user: {
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          status: schema.users.status,
          createdAt: schema.users.createdAt,
          updatedAt: schema.users.updatedAt,
        },
        roleName: schema.roles.name,
      })
      .from(schema.userOrganizations)
      .innerJoin(schema.users, eq(schema.userOrganizations.userId, schema.users.id))
      .innerJoin(schema.roles, eq(schema.userOrganizations.roleId, schema.roles.id))
      .where(eq(schema.userOrganizations.organizationId, organizationId));
    return result as unknown as (schema.UserOrganization & { user: User; roleName: string })[];
  }

  async getUserOrganizations(userId: string): Promise<(schema.UserOrganization & { organization: schema.Organization; roleName: string })[]> {
    const result = await db
      .select({
        id: schema.userOrganizations.id,
        userId: schema.userOrganizations.userId,
        organizationId: schema.userOrganizations.organizationId,
        roleId: schema.userOrganizations.roleId,
        isDefault: schema.userOrganizations.isDefault,
        createdAt: schema.userOrganizations.createdAt,
        organization: schema.organizations,
        roleName: schema.roles.name,
      })
      .from(schema.userOrganizations)
      .innerJoin(schema.organizations, eq(schema.userOrganizations.organizationId, schema.organizations.id))
      .innerJoin(schema.roles, eq(schema.userOrganizations.roleId, schema.roles.id))
      .where(eq(schema.userOrganizations.userId, userId));
    return result as unknown as (schema.UserOrganization & { organization: schema.Organization; roleName: string })[];
  }

  async addOrganizationMember(entry: schema.InsertUserOrganization): Promise<schema.UserOrganization> {
    const result = await db.insert(schema.userOrganizations).values(entry).returning();
    return result[0];
  }

  async updateOrganizationMember(userId: string, organizationId: string, roleId: string): Promise<schema.UserOrganization> {
    const result = await db.update(schema.userOrganizations)
      .set({ roleId })
      .where(and(
        eq(schema.userOrganizations.userId, userId),
        eq(schema.userOrganizations.organizationId, organizationId)
      ))
      .returning();
    return result[0];
  }

  async removeOrganizationMember(userId: string, organizationId: string): Promise<void> {
    await db.delete(schema.userOrganizations)
      .where(and(
        eq(schema.userOrganizations.userId, userId),
        eq(schema.userOrganizations.organizationId, organizationId)
      ));
  }

  async setDefaultOrganization(userId: string, organizationId: string): Promise<void> {
    // Clear all defaults for this user, then set the new default
    await db.update(schema.userOrganizations)
      .set({ isDefault: false })
      .where(eq(schema.userOrganizations.userId, userId));
    await db.update(schema.userOrganizations)
      .set({ isDefault: true })
      .where(and(
        eq(schema.userOrganizations.userId, userId),
        eq(schema.userOrganizations.organizationId, organizationId)
      ));
  }

  async getDefaultOrganization(userId: string): Promise<schema.Organization | undefined> {
    const result = await db
      .select({ organization: schema.organizations })
      .from(schema.userOrganizations)
      .innerJoin(schema.organizations, eq(schema.userOrganizations.organizationId, schema.organizations.id))
      .where(and(
        eq(schema.userOrganizations.userId, userId),
        eq(schema.userOrganizations.isDefault, true)
      ))
      .limit(1);
    return result[0]?.organization;
  }

  async getOrgMembership(userId: string, organizationId: string): Promise<(schema.UserOrganization & { roleName: string }) | undefined> {
    const result = await db
      .select({ membership: schema.userOrganizations, roleName: schema.roles.name })
      .from(schema.userOrganizations)
      .innerJoin(schema.roles, eq(schema.userOrganizations.roleId, schema.roles.id))
      .where(and(
        eq(schema.userOrganizations.userId, userId),
        eq(schema.userOrganizations.organizationId, organizationId)
      ))
      .limit(1);
    if (!result[0]) return undefined;
    return { ...result[0].membership, roleName: result[0].roleName };
  }

  async bulkAssignData(targetOrgId: string, sourceOrgId: string | "all"): Promise<{ accounts: number; contacts: number; leads: number; opportunities: number; activities: number; total: number }> {
    let accountsUpdated = 0;
    let contactsUpdated = 0;
    let leadsUpdated = 0;
    let opportunitiesUpdated = 0;
    let activitiesUpdated = 0;

    const isAll = sourceOrgId === "all";

    await db.transaction(async (tx) => {
      const aResult = await tx.update(schema.accounts)
        .set({ organizationId: targetOrgId })
        .where(isAll ? ne(schema.accounts.organizationId, targetOrgId) : eq(schema.accounts.organizationId, sourceOrgId))
        .returning({ id: schema.accounts.id });
      accountsUpdated = aResult.length;

      const cResult = await tx.update(schema.contacts)
        .set({ organizationId: targetOrgId })
        .where(isAll ? ne(schema.contacts.organizationId, targetOrgId) : eq(schema.contacts.organizationId, sourceOrgId))
        .returning({ id: schema.contacts.id });
      contactsUpdated = cResult.length;

      const lResult = await tx.update(schema.leads)
        .set({ organizationId: targetOrgId })
        .where(isAll ? ne(schema.leads.organizationId, targetOrgId) : eq(schema.leads.organizationId, sourceOrgId))
        .returning({ id: schema.leads.id });
      leadsUpdated = lResult.length;

      const oResult = await tx.update(schema.opportunities)
        .set({ organizationId: targetOrgId })
        .where(isAll ? ne(schema.opportunities.organizationId, targetOrgId) : eq(schema.opportunities.organizationId, sourceOrgId))
        .returning({ id: schema.opportunities.id });
      opportunitiesUpdated = oResult.length;

      const acResult = await tx.update(schema.activities)
        .set({ organizationId: targetOrgId })
        .where(isAll ? ne(schema.activities.organizationId, targetOrgId) : eq(schema.activities.organizationId, sourceOrgId))
        .returning({ id: schema.activities.id });
      activitiesUpdated = acResult.length;
    });

    return {
      accounts: accountsUpdated,
      contacts: contactsUpdated,
      leads: leadsUpdated,
      opportunities: opportunitiesUpdated,
      activities: activitiesUpdated,
      total: accountsUpdated + contactsUpdated + leadsUpdated + opportunitiesUpdated + activitiesUpdated,
    };
  }

  // ========== ADMIN OPERATIONS ==========
  
  async resetDatabase(): Promise<void> {
    // Delete all CRM entity data in reverse dependency order
    // This preserves system configuration (roles, permissions, id_patterns)
    await db.delete(schema.entityTags);
    await db.delete(schema.opportunityResources);
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

export async function fixEntityTagsEntityNames(): Promise<void> {
  const mappings: [string, string][] = [
    ["opportunities", "Opportunity"],
    ["accounts", "Account"],
    ["contacts", "Contact"],
    ["leads", "Lead"],
    ["activities", "Activity"],
  ];

  for (const [wrong, correct] of mappings) {
    await db.execute(
      sql`UPDATE entity_tags SET entity = ${correct} WHERE entity = ${wrong}`
    );
  }

  console.log("Entity tags entity names normalized");
}
