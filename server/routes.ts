// API routes for Health Trixss CRM
// All routes with authentication, RBAC, and audit logging
//
// SECURITY NOTE: All routes are protected with tiered rate limiting:
// - authRateLimiter: 5 req/min (login, register, logout)
// - sensitiveRateLimiter: 20 req/min (admin operations, backups, API keys)
// - crudRateLimiter: 100 req/min (POST/PUT/PATCH/DELETE operations)
// - readRateLimiter: 200 req/min (GET operations)
// Rate limiters are applied as middleware on each route handler

import type { Express} from "express";
import { z } from "zod";
import { storage, db, eq, and, sql, asc, desc, inArray, gte, lte, ne } from "./db";
import { hashPassword, verifyPassword, generateToken, authenticate, optionalAuthenticate, type AuthRequest } from "./auth";
import { requirePermission, requireRole, DEFAULT_ROLE, hasPermission } from "./rbac";
import { authRateLimiter, sensitiveRateLimiter, crudRateLimiter, readRateLimiter } from "./rate-limiters";
import {
  insertUserSchema,
  insertAccountSchema,
  insertContactSchema,
  insertLeadSchema,
  insertOpportunitySchema,
  insertActivitySchema,
  insertActivityAssociationSchema,
  insertCommentSchema,
  insertCommentReactionSchema,
  insertCommentAttachmentSchema,
  insertApiKeySchema,
  comments,
  commentReactions,
  commentAttachments,
  commentSubscriptions,
  users,
  accounts,
  contacts,
  leads,
  opportunities,
  activities,
  activityAssociations,
  auditLogs,
} from "@shared/schema";
import { backupService } from "./backup-service";
import * as analyticsService from "./analytics-service";
import { DynamicsMapper, type DynamicsMappingConfig } from "./dynamics-mapper";
import { generateApiKey } from "./api-key-utils";
import externalApiRoutes from "./external-api-routes";
import multer from "multer";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import {
  accountCsvRowSchema,
  contactCsvRowSchema,
  leadCsvRowSchema,
  opportunityCsvRowSchema,
  activityCsvRowSchema,
  type AccountCsvRow,
  type ContactCsvRow,
  type LeadCsvRow,
  type OpportunityCsvRow,
  type ActivityCsvRow,
} from "./csv-schemas";

// Configure multer for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// Audit logging helper
async function createAudit(req: AuthRequest, action: string, resource: string, resourceId: string | null, before: any, after: any) {
  try {
    await storage.createAuditLog({
      actorId: req.user?.id || null,
      action,
      resource,
      resourceId,
      before,
      after,
      ipAddress: req.ip || req.connection.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });
  } catch (error) {
    console.error("Error creating audit log:", error);
  }
}

export function registerRoutes(app: Express) {
  
  // ========== AUTHENTICATION ROUTES ==========
  
  app.post("/api/register", authRateLimiter, async (req, res) => {
    try {
      const data = insertUserSchema.parse(req.body);
      
      // Check if user already exists
      const existing = await storage.getUserByEmail(data.email);
      if (existing) {
        return res.status(400).json({ error: "User with this email already exists" });
      }
      
      // Hash password
      const hashedPassword = await hashPassword(data.password);
      
      // Create user
      const user = await storage.createUser({
        ...data,
        password: hashedPassword,
      });
      
      // Assign role: If no admin users exist, make this user an admin
      let userRole: string | undefined;
      try {
        const roles = await storage.getAllRoles();
        const adminRole = roles.find(r => r.name === "Admin");
        
        console.log(`[Registration] Available roles: ${roles.map(r => r.name).join(", ")}`);
        console.log(`[Registration] Admin role found: ${!!adminRole}`);
        
        // Check if there are any admin users
        const allUsers = await storage.getAllUsers();
        let hasAdmin = false;
        
        console.log(`[Registration] Total users before new user: ${allUsers.length - 1}`); // -1 because new user is included
        
        for (const u of allUsers) {
          if (u.id === user.id) continue; // Skip the newly created user
          const userRoles = await storage.getUserRoles(u.id);
          if (userRoles.some(r => r.name === "Admin")) {
            hasAdmin = true;
            console.log(`[Registration] Found existing admin: ${u.email}`);
            break;
          }
        }
        
        // If no admin exists, make this user an admin
        if (!hasAdmin && adminRole) {
          console.log(`[Registration] Assigning Admin role to first user: ${user.email}`);
          await storage.assignRoleToUser(user.id, adminRole.id);
          userRole = "Admin";
          
          // Verify assignment
          const verifyRoles = await storage.getUserRoles(user.id);
          console.log(`[Registration] Verification - User roles after assignment: ${verifyRoles.map(r => r.name).join(", ")}`);
        } else {
          // Otherwise, assign default role (SalesRep)
          console.log(`[Registration] Assigning ${DEFAULT_ROLE} role to user: ${user.email}`);
          const defaultRole = roles.find(r => r.name === DEFAULT_ROLE);
          if (defaultRole) {
            await storage.assignRoleToUser(user.id, defaultRole.id);
            userRole = DEFAULT_ROLE;
          }
        }
      } catch (error) {
        console.error("Error assigning role:", error);
      }
      
      // Generate token
      const token = generateToken(user);
      
      // Set cookie
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });
      
      return res.json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to register user" });
    }
  });
  
  app.post("/api/login", authRateLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      
      // Get user with password
      const userWithPassword = await storage.getUserByEmail(email);
      if (!userWithPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      // Verify password
      const valid = await verifyPassword(password, userWithPassword.password);
      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      // Get user without password
      const user = await storage.getUserById(userWithPassword.id);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      
      // Generate token
      const token = generateToken(user);
      
      // Set cookie
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });
      
      return res.json(user);
    } catch (error) {
      return res.status(500).json({ error: "Failed to login" });
    }
  });
  
  app.post("/api/logout", authRateLimiter, (req, res) => {
    res.clearCookie("token");
    return res.json({ success: true });
  });
  
  app.get("/api/user", optionalAuthenticate, readRateLimiter, (req: AuthRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    return res.json(req.user);
  });
  
  // Get all users (for dropdowns)
  app.get("/api/users", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const allUsers = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
        })
        .from(users)
        .where(eq(users.status, "active"));
      
      return res.json(allUsers);
    } catch (error) {
      console.error("Failed to fetch users:", error);
      return res.status(500).json({ error: "Failed to fetch users" });
    }
  });
  
  // ========== ACCOUNTS ROUTES ==========
  
  // Get accounts summary statistics
  app.get("/api/accounts/summary", authenticate, requirePermission("Account", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const allAccounts = await storage.getAllAccounts();
      const allUsers = await storage.getAllUsers();
      
      // Total count
      const totalCount = allAccounts.length;
      
      // Breakdown by type
      const byType = {
        customer: allAccounts.filter(a => a.type === "customer").length,
        partner: allAccounts.filter(a => a.type === "partner").length,
        prospect: allAccounts.filter(a => a.type === "prospect").length,
        vendor: allAccounts.filter(a => a.type === "vendor").length,
        other: allAccounts.filter(a => a.type === "other").length,
      };
      
      // Breakdown by category
      const categoryMap = new Map<string, number>();
      allAccounts.forEach(a => {
        if (a.category) {
          categoryMap.set(a.category, (categoryMap.get(a.category) || 0) + 1);
        }
      });
      const byCategory = Object.fromEntries(categoryMap);
      
      // Count by owner
      const ownerMap = new Map<string, { count: number; ownerName: string }>();
      allAccounts.forEach(a => {
        if (a.ownerId) {
          const owner = allUsers.find(u => u.id === a.ownerId);
          const ownerName = owner ? owner.name : "Unknown";
          const current = ownerMap.get(a.ownerId);
          ownerMap.set(a.ownerId, {
            count: (current?.count || 0) + 1,
            ownerName,
          });
        }
      });
      const byOwner = Object.fromEntries(
        Array.from(ownerMap.entries()).map(([id, data]) => [id, data])
      );
      
      // Recent additions
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const last7Days = allAccounts.filter(a => new Date(a.createdAt) >= sevenDaysAgo).length;
      const last30Days = allAccounts.filter(a => new Date(a.createdAt) >= thirtyDaysAgo).length;
      
      return res.json({
        totalCount,
        byType,
        byCategory,
        byOwner,
        recentAdditions: {
          last7Days,
          last30Days,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch accounts summary" });
    }
  });
  
  app.get("/api/accounts", authenticate, requirePermission("Account", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      let accounts = await storage.getAllAccounts();
      
      // Apply search filter
      const search = req.query.search as string | undefined;
      if (search) {
        const searchLower = search.toLowerCase();
        accounts = accounts.filter(a =>
          a.name?.toLowerCase().includes(searchLower) ||
          a.accountNumber?.toLowerCase().includes(searchLower) ||
          a.industry?.toLowerCase().includes(searchLower) ||
          a.website?.toLowerCase().includes(searchLower)
        );
      }
      
      // Apply type filter
      const type = req.query.type as string | undefined;
      if (type) {
        accounts = accounts.filter(a => a.type === type);
      }
      
      // Apply category filter
      const category = req.query.category as string | undefined;
      if (category) {
        accounts = accounts.filter(a => a.category === category);
      }
      
      // Apply owner filter
      const ownerId = req.query.ownerId as string | undefined;
      if (ownerId) {
        accounts = accounts.filter(a => a.ownerId === ownerId);
      }
      
      // Apply sorting
      const sortBy = (req.query.sortBy as string) || "name";
      const sortOrder = (req.query.sortOrder as string) || "asc";
      
      accounts.sort((a, b) => {
        let aVal: any = a[sortBy as keyof typeof a];
        let bVal: any = b[sortBy as keyof typeof b];
        
        // Handle null/undefined values
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        
        // Convert to strings for comparison
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        
        if (sortOrder === "asc") {
          return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        } else {
          return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
        }
      });
      
      return res.json(accounts);
    } catch (error) {
      console.error('[ACCOUNTS-ROUTE] Error fetching accounts:', error);
      console.error('[ACCOUNTS-ROUTE] Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('[ACCOUNTS-ROUTE] Error stack:', error instanceof Error ? error.stack : 'No stack');
      return res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });
  
  app.get("/api/accounts/:id", authenticate, requirePermission("Account", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const account = await storage.getAccountById(req.params.id);
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      return res.json(account);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch account" });
    }
  });
  
  app.post("/api/accounts", authenticate, requirePermission("Account", "create"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertAccountSchema.parse(req.body);
      const account = await storage.createAccount(data);
      
      await createAudit(req, "create", "Account", account.id, null, account);
      
      return res.json(account);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to create account" });
    }
  });
  
  app.patch("/api/accounts/:id", authenticate, requirePermission("Account", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const before = await storage.getAccountById(req.params.id);
      if (!before) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      const account = await storage.updateAccount(req.params.id, req.body);
      
      await createAudit(req, "update", "Account", account.id, before, account);
      
      return res.json(account);
    } catch (error) {
      return res.status(500).json({ error: "Failed to update account" });
    }
  });
  
  app.delete("/api/accounts/:id", authenticate, requirePermission("Account", "delete"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const before = await storage.getAccountById(req.params.id);
      if (!before) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      await storage.deleteAccount(req.params.id);
      
      await createAudit(req, "delete", "Account", req.params.id, before, null);
      
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Failed to delete account" });
    }
  });
  
  // Get related data for an account (contacts, opportunities, activities)
  app.get("/api/accounts/:id/related", authenticate, requirePermission("Account", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const accountId = req.params.id;
      
      // Verify account exists
      const account = await storage.getAccountById(accountId);
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      // Fetch related data
      const [allContacts, allOpportunities, allActivities, activityAssocs] = await Promise.all([
        storage.getAllContacts(),
        storage.getAllOpportunities(),
        storage.getAllActivities(),
        // Fetch activity associations for this account
        db.select().from(activityAssociations).where(
          and(
            eq(activityAssociations.entityType, "Account"),
            eq(activityAssociations.entityId, accountId)
          )
        ),
      ]);
      
      const contacts = allContacts.filter(c => c.accountId === accountId);
      const opportunities = allOpportunities.filter(o => o.accountId === accountId);
      
      // Get activities from BOTH the deprecated relatedType/relatedId fields AND the activity_associations table
      const activitiesFromDeprecated = allActivities.filter(a => a.relatedType === "Account" && a.relatedId === accountId);
      const activityIdsFromAssociations = activityAssocs.map((a: any) => a.activityId);
      const activitiesFromAssociations = allActivities.filter(a => activityIdsFromAssociations.includes(a.id));
      
      // Merge and deduplicate activities
      const activitiesMap = new Map();
      [...activitiesFromDeprecated, ...activitiesFromAssociations].forEach(activity => {
        activitiesMap.set(activity.id, activity);
      });
      const activities = Array.from(activitiesMap.values());
      
      return res.json({
        contacts: { items: contacts, total: contacts.length },
        opportunities: { items: opportunities, total: opportunities.length },
        activities: { items: activities, total: activities.length },
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch related data" });
    }
  });
  
  // Bulk update accounts
  app.post("/api/accounts/bulk-update", authenticate, requirePermission("Account", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { accountIds, updates } = req.body;
      
      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ error: "Account IDs array is required" });
      }
      
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: "Updates object is required" });
      }
      
      let updatedCount = 0;
      for (const accountId of accountIds) {
        const account = await storage.getAccountById(accountId);
        if (account) {
          const updatedAccount = await storage.updateAccount(accountId, updates);
          await createAudit(req, "bulk_update", "Account", accountId, account, updatedAccount);
          updatedCount++;
        }
      }
      
      return res.json({ success: true, count: updatedCount });
    } catch (error) {
      console.error("Bulk update accounts error:", error);
      return res.status(500).json({ error: "Failed to bulk update accounts" });
    }
  });
  
  // ========== CONTACTS ROUTES ==========
  
  // Get contacts summary statistics
  app.get("/api/contacts/summary", authenticate, requirePermission("Contact", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const allContacts = await storage.getAllContacts();
      const allAccounts = await storage.getAllAccounts();
      
      // Total count
      const totalCount = allContacts.length;
      
      // Count contacts with accounts
      const withAccount = allContacts.filter(c => c.accountId).length;
      const withoutAccount = allContacts.filter(c => !c.accountId).length;
      
      // Count by account (top 5)
      const accountMap = new Map<string, { count: number; accountName: string }>();
      allContacts.forEach(c => {
        if (c.accountId) {
          const account = allAccounts.find(a => a.id === c.accountId);
          const accountName = account ? account.name : "Unknown";
          const current = accountMap.get(c.accountId);
          accountMap.set(c.accountId, {
            count: (current?.count || 0) + 1,
            accountName,
          });
        }
      });
      
      const topAccounts = Array.from(accountMap.entries())
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 5)
        .map(([id, data]) => ({ accountId: id, count: data.count, accountName: data.accountName }));
      
      // Recent additions
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const last7Days = allContacts.filter(c => new Date(c.createdAt) >= sevenDaysAgo).length;
      const last30Days = allContacts.filter(c => new Date(c.createdAt) >= thirtyDaysAgo).length;
      
      // Email distribution
      const withEmail = allContacts.filter(c => c.email).length;
      const withoutEmail = allContacts.filter(c => !c.email).length;
      
      return res.json({
        totalCount,
        accountDistribution: {
          withAccount,
          withoutAccount,
        },
        topAccounts,
        recentAdditions: {
          last7Days,
          last30Days,
        },
        emailDistribution: {
          withEmail,
          withoutEmail,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch contacts summary" });
    }
  });
  
  app.get("/api/contacts", authenticate, requirePermission("Contact", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      let contacts = await storage.getAllContacts();
      
      // Apply search filter
      const search = req.query.search as string | undefined;
      if (search) {
        const searchLower = search.toLowerCase();
        contacts = contacts.filter(c =>
          c.firstName?.toLowerCase().includes(searchLower) ||
          c.lastName?.toLowerCase().includes(searchLower) ||
          c.email?.toLowerCase().includes(searchLower) ||
          c.phone?.toLowerCase().includes(searchLower) ||
          c.title?.toLowerCase().includes(searchLower)
        );
      }
      
      // Apply account filter
      const accountId = req.query.accountId as string | undefined;
      if (accountId) {
        contacts = contacts.filter(c => c.accountId === accountId);
      }
      
      // Apply owner filter
      const ownerId = req.query.ownerId as string | undefined;
      if (ownerId) {
        contacts = contacts.filter(c => c.ownerId === ownerId);
      }
      
      // Apply "has email" filter
      const hasEmail = req.query.hasEmail as string | undefined;
      if (hasEmail === "true") {
        contacts = contacts.filter(c => c.email && c.email.length > 0);
      } else if (hasEmail === "false") {
        contacts = contacts.filter(c => !c.email || c.email.length === 0);
      }
      
      // Apply sorting
      const sortBy = (req.query.sortBy as string) || "firstName";
      const sortOrder = (req.query.sortOrder as string) || "asc";
      
      contacts.sort((a, b) => {
        let aVal: any = a[sortBy as keyof typeof a];
        let bVal: any = b[sortBy as keyof typeof b];
        
        // Handle null/undefined values
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        
        // Convert to strings for comparison
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        
        if (sortOrder === "asc") {
          return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        } else {
          return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
        }
      });
      
      return res.json(contacts);
    } catch (error) {
      console.error('[CONTACTS-ROUTE] Error fetching contacts:', error);
      console.error('[CONTACTS-ROUTE] Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('[CONTACTS-ROUTE] Error stack:', error instanceof Error ? error.stack : 'No stack');
      return res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });
  
  app.get("/api/contacts/:id", authenticate, requirePermission("Contact", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const contact = await storage.getContactById(req.params.id);
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }
      return res.json(contact);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch contact" });
    }
  });
  
  app.post("/api/contacts", authenticate, requirePermission("Contact", "create"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(data);
      
      await createAudit(req, "create", "Contact", contact.id, null, contact);
      
      return res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to create contact" });
    }
  });
  
  app.patch("/api/contacts/:id", authenticate, requirePermission("Contact", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const before = await storage.getContactById(req.params.id);
      if (!before) {
        return res.status(404).json({ error: "Contact not found" });
      }
      
      const data = insertContactSchema.omit({ id: true }).parse(req.body);
      
      const contact = await storage.updateContact(req.params.id, data);
      
      await createAudit(req, "update", "Contact", contact.id, before, contact);
      
      return res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to update contact" });
    }
  });
  
  // Get related data for a contact (account, opportunities, activities)
  app.get("/api/contacts/:id/related", authenticate, requirePermission("Contact", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const contactId = req.params.id;
      
      const contact = await storage.getContactById(contactId);
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }
      
      const [account, allOpportunities, allActivities, activityAssocs] = await Promise.all([
        contact.accountId ? storage.getAccountById(contact.accountId) : Promise.resolve(null),
        storage.getAllOpportunities(),
        storage.getAllActivities(),
        // Fetch activity associations for this contact
        db.select().from(activityAssociations).where(
          and(
            eq(activityAssociations.entityType, "Contact"),
            eq(activityAssociations.entityId, contactId)
          )
        ),
      ]);
      
      const opportunities = allOpportunities.filter(o => o.accountId === contact.accountId);
      
      // Get activities from BOTH the deprecated relatedType/relatedId fields AND the activity_associations table
      const activitiesFromDeprecated = allActivities.filter(a => a.relatedType === "Contact" && a.relatedId === contactId);
      const activityIdsFromAssociations = activityAssocs.map((a: any) => a.activityId);
      const activitiesFromAssociations = allActivities.filter(a => activityIdsFromAssociations.includes(a.id));
      
      // Merge and deduplicate activities
      const activitiesMap = new Map();
      [...activitiesFromDeprecated, ...activitiesFromAssociations].forEach(activity => {
        activitiesMap.set(activity.id, activity);
      });
      const activities = Array.from(activitiesMap.values());
      
      return res.json({
        account: account ? { items: [account], total: 1 } : { items: [], total: 0 },
        opportunities: { items: opportunities, total: opportunities.length },
        activities: { items: activities, total: activities.length },
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch related data" });
    }
  });
  
  // Bulk update contacts
  app.post("/api/contacts/bulk-update", authenticate, requirePermission("Contact", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { contactIds, updates } = req.body;
      
      if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ error: "Contact IDs array is required" });
      }
      
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: "Updates object is required" });
      }
      
      let updatedCount = 0;
      for (const contactId of contactIds) {
        const contact = await storage.getContactById(contactId);
        if (contact) {
          const updatedContact = await storage.updateContact(contactId, updates);
          await createAudit(req, "bulk_update", "Contact", contactId, contact, updatedContact);
          updatedCount++;
        }
      }
      
      return res.json({ success: true, count: updatedCount });
    } catch (error) {
      console.error("Bulk update contacts error:", error);
      return res.status(500).json({ error: "Failed to bulk update contacts" });
    }
  });
  
  // ========== LEADS ROUTES ==========
  
  // Get leads summary statistics
  app.get("/api/leads/summary", authenticate, requirePermission("Lead", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const allLeads = await storage.getAllLeads();
      
      // Total count
      const totalCount = allLeads.length;
      
      // Breakdown by status
      const byStatus = {
        new: allLeads.filter(l => l.status === "new").length,
        contacted: allLeads.filter(l => l.status === "contacted").length,
        qualified: allLeads.filter(l => l.status === "qualified").length,
        unqualified: allLeads.filter(l => l.status === "unqualified").length,
        converted: allLeads.filter(l => l.status === "converted").length,
      };
      
      // Breakdown by source
      const sourceMap = new Map<string, number>();
      allLeads.forEach(l => {
        if (l.source) {
          sourceMap.set(l.source, (sourceMap.get(l.source) || 0) + 1);
        }
      });
      const bySource = Object.fromEntries(sourceMap);
      
      // Conversion rate
      const convertedCount = byStatus.converted;
      const conversionRate = totalCount > 0 ? ((convertedCount / totalCount) * 100).toFixed(1) : "0.0";
      
      // Recent additions
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const last7Days = allLeads.filter(l => new Date(l.createdAt) >= sevenDaysAgo).length;
      const last30Days = allLeads.filter(l => new Date(l.createdAt) >= thirtyDaysAgo).length;
      
      // Breakdown by rating (stored in topic field for now, or we can add a rating field)
      // For now, we'll just return placeholder data
      const byRating = {
        hot: 0,
        warm: 0,
        cold: 0,
      };
      
      return res.json({
        totalCount,
        byStatus,
        bySource,
        conversionRate,
        recentAdditions: {
          last7Days,
          last30Days,
        },
        byRating,
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch leads summary" });
    }
  });
  
  app.get("/api/leads", authenticate, requirePermission("Lead", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      let leads = await storage.getAllLeads();
      
      // Apply search filter
      const search = req.query.search as string | undefined;
      if (search) {
        const searchLower = search.toLowerCase();
        leads = leads.filter(l =>
          l.firstName?.toLowerCase().includes(searchLower) ||
          l.lastName?.toLowerCase().includes(searchLower) ||
          l.email?.toLowerCase().includes(searchLower) ||
          l.phone?.toLowerCase().includes(searchLower) ||
          l.company?.toLowerCase().includes(searchLower) ||
          l.topic?.toLowerCase().includes(searchLower)
        );
      }
      
      // Apply status filter
      const status = req.query.status as string | undefined;
      if (status) {
        leads = leads.filter(l => l.status === status);
      }
      
      // Apply source filter
      const source = req.query.source as string | undefined;
      if (source) {
        leads = leads.filter(l => l.source === source);
      }
      
      // Apply owner filter
      const ownerId = req.query.ownerId as string | undefined;
      if (ownerId) {
        leads = leads.filter(l => l.ownerId === ownerId);
      }
      
      // Apply rating filter
      const rating = req.query.rating as string | undefined;
      if (rating) {
        leads = leads.filter(l => l.rating === rating);
      }
      
      // Apply sorting
      const sortBy = (req.query.sortBy as string) || "createdAt";
      const sortOrder = (req.query.sortOrder as string) || "desc";
      
      leads.sort((a, b) => {
        let aVal: any = a[sortBy as keyof typeof a];
        let bVal: any = b[sortBy as keyof typeof b];
        
        // Handle null/undefined values
        if (aVal === null || aVal === undefined) aVal = "";
        if (bVal === null || bVal === undefined) bVal = "";
        
        // Convert to lowercase for string comparison
        if (typeof aVal === "string") aVal = aVal.toLowerCase();
        if (typeof bVal === "string") bVal = bVal.toLowerCase();
        
        if (sortOrder === "asc") {
          return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
          return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
      });
      
      return res.json(leads);
    } catch (error) {
      console.error('[LEADS-ROUTE] Error fetching leads:', error);
      console.error('[LEADS-ROUTE] Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('[LEADS-ROUTE] Error stack:', error instanceof Error ? error.stack : 'No stack');
      return res.status(500).json({ error: "Failed to fetch leads" });
    }
  });
  
  app.get("/api/leads/:id", authenticate, requirePermission("Lead", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }
      return res.json(lead);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch lead" });
    }
  });
  
  app.post("/api/leads", authenticate, requirePermission("Lead", "create"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertLeadSchema.parse(req.body);
      const lead = await storage.createLead(data);
      
      await createAudit(req, "create", "Lead", lead.id, null, lead);
      
      return res.json(lead);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to create lead" });
    }
  });
  
  // Get related data for a lead (activities, conversion info)
  app.get("/api/leads/:id/related", authenticate, requirePermission("Lead", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const leadId = req.params.id;
      
      const lead = await storage.getLeadById(leadId);
      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }
      
      const [allActivities, activityAssocs] = await Promise.all([
        storage.getAllActivities(),
        // Fetch activity associations for this lead
        db.select().from(activityAssociations).where(
          and(
            eq(activityAssociations.entityType, "Lead"),
            eq(activityAssociations.entityId, leadId)
          )
        ),
      ]);
      
      // Get activities from BOTH the deprecated relatedType/relatedId fields AND the activity_associations table
      const activitiesFromDeprecated = allActivities.filter(a => a.relatedType === "Lead" && a.relatedId === leadId);
      const activityIdsFromAssociations = activityAssocs.map((a: any) => a.activityId);
      const activitiesFromAssociations = allActivities.filter(a => activityIdsFromAssociations.includes(a.id));
      
      // Merge and deduplicate activities
      const activitiesMap = new Map();
      [...activitiesFromDeprecated, ...activitiesFromAssociations].forEach(activity => {
        activitiesMap.set(activity.id, activity);
      });
      const activities = Array.from(activitiesMap.values());
      
      // If converted, fetch the converted entities
      const conversionData: any = {};
      if (lead.status === "converted") {
        const [convertedAccount, convertedContact, convertedOpportunity] = await Promise.all([
          lead.convertedAccountId ? storage.getAccountById(lead.convertedAccountId) : Promise.resolve(null),
          lead.convertedContactId ? storage.getContactById(lead.convertedContactId) : Promise.resolve(null),
          lead.convertedOpportunityId ? storage.getOpportunityById(lead.convertedOpportunityId) : Promise.resolve(null),
        ]);
        conversionData.convertedAccount = convertedAccount;
        conversionData.convertedContact = convertedContact;
        conversionData.convertedOpportunity = convertedOpportunity;
      }
      
      return res.json({
        activities: { items: activities, total: activities.length },
        ...conversionData,
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch related data" });
    }
  });
  
  // Lead Conversion
  app.post("/api/leads/:id/convert", authenticate, requirePermission("Lead", "convert"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const leadId = req.params.id;
      const { 
        accountId: existingAccountId, 
        accountData, 
        createAccount, 
        accountName, 
        createOpportunity, 
        opportunityData,
        opportunityName,
        opportunityAmount
      } = req.body;
      
      const lead = await storage.getLeadById(leadId);
      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }
      
      if (lead.status === "converted") {
        return res.status(400).json({ error: "Lead already converted" });
      }
      
      let accountId = existingAccountId;
      let contactId = null;
      let opportunityId = null;
      
      // Create Account if requested (backwards compatible with old wizard)
      if (createAccount || (!accountId && accountData)) {
        const account = await storage.createAccount({
          id: "",
          name: accountData?.name || accountName || lead.company || `${lead.firstName} ${lead.lastName}`,
          type: accountData?.type || "customer",
          industry: accountData?.industry || null,
          website: accountData?.website || null,
          phone: accountData?.phone || null,
          billingAddress: accountData?.billingAddress || null,
          shippingAddress: accountData?.shippingAddress || null,
          ownerId: lead.ownerId,
        });
        accountId = account.id;
        await createAudit(req, "create", "Account", account.id, null, account);
      }
      
      // Always create contact from lead
      const contact = await storage.createContact({
        id: "",
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email || null,
        phone: lead.phone || null,
        title: null,
        accountId: accountId,
        ownerId: lead.ownerId,
      });
      contactId = contact.id;
      await createAudit(req, "create", "Contact", contact.id, null, contact);
      
      // Create Opportunity if requested (backwards compatible with old wizard)
      if (createOpportunity && accountId) {
        const opportunity = await storage.createOpportunity({
          id: "",
          name: opportunityData?.name || opportunityName || `${lead.firstName} ${lead.lastName} - Opportunity`,
          accountId,
          stage: opportunityData?.stage || "prospecting",
          amount: opportunityData?.amount || opportunityAmount || "0",
          probability: opportunityData?.probability !== undefined ? opportunityData.probability : 10,
          closeDate: opportunityData?.closeDate || null,
          ownerId: lead.ownerId,
        });
        opportunityId = opportunity.id;
        await createAudit(req, "create", "Opportunity", opportunity.id, null, opportunity);
      }
      
      // Update lead status
      const updatedLead = await storage.updateLead(leadId, {
        status: "converted",
        convertedAccountId: accountId,
        convertedContactId: contactId,
        convertedOpportunityId: opportunityId,
        convertedAt: new Date(),
      } as any);
      
      await createAudit(req, "convert", "Lead", leadId, lead, updatedLead);
      
      return res.json({
        lead: updatedLead,
        accountId,
        contactId,
        opportunityId,
      });
    } catch (error) {
      console.error("Lead conversion error:", error);
      return res.status(500).json({ error: "Failed to convert lead" });
    }
  });

  // Update lead
  app.patch("/api/leads/:id", authenticate, requirePermission("Lead", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const leadId = req.params.id;
      const lead = await storage.getLeadById(leadId);
      
      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }

      const updatedLead = await storage.updateLead(leadId, req.body);
      await createAudit(req, "update", "Lead", leadId, lead, updatedLead);
      
      return res.json(updatedLead);
    } catch (error) {
      console.error("Lead update error:", error);
      return res.status(500).json({ error: "Failed to update lead" });
    }
  });

  // Delete lead
  app.delete("/api/leads/:id", authenticate, requirePermission("Lead", "delete"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const leadId = req.params.id;
      const lead = await storage.getLeadById(leadId);
      
      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }

      await storage.deleteLead(leadId);
      await createAudit(req, "delete", "Lead", leadId, lead, null);
      
      return res.json({ success: true, message: "Lead deleted successfully" });
    } catch (error) {
      console.error("Lead delete error:", error);
      return res.status(500).json({ error: "Failed to delete lead" });
    }
  });
  
  // Bulk update leads
  app.post("/api/leads/bulk-update", authenticate, requirePermission("Lead", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { leadIds, updates } = req.body;
      
      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ error: "Lead IDs array is required" });
      }
      
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: "Updates object is required" });
      }
      
      let updatedCount = 0;
      for (const leadId of leadIds) {
        const lead = await storage.getLeadById(leadId);
        if (lead) {
          const updatedLead = await storage.updateLead(leadId, updates);
          await createAudit(req, "bulk_update", "Lead", leadId, lead, updatedLead);
          updatedCount++;
        }
      }
      
      return res.json({ success: true, count: updatedCount });
    } catch (error) {
      console.error("Bulk update error:", error);
      return res.status(500).json({ error: "Failed to bulk update leads" });
    }
  });
  
  // ========== OPPORTUNITIES ROUTES ==========
  
  app.get("/api/opportunities", authenticate, requirePermission("Opportunity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      // Fetch opportunities with account information
      const opportunitiesWithAccounts = await db
        .select({
          id: opportunities.id,
          accountId: opportunities.accountId,
          name: opportunities.name,
          stage: opportunities.stage,
          amount: opportunities.amount,
          closeDate: opportunities.closeDate,
          ownerId: opportunities.ownerId,
          probability: opportunities.probability,
          status: opportunities.status,
          actualCloseDate: opportunities.actualCloseDate,
          actualRevenue: opportunities.actualRevenue,
          estCloseDate: opportunities.estCloseDate,
          estRevenue: opportunities.estRevenue,
          rating: opportunities.rating,
          externalId: opportunities.externalId,
          sourceSystem: opportunities.sourceSystem,
          sourceRecordId: opportunities.sourceRecordId,
          importStatus: opportunities.importStatus,
          importNotes: opportunities.importNotes,
          includeInForecast: opportunities.includeInForecast,
          createdAt: opportunities.createdAt,
          updatedAt: opportunities.updatedAt,
          accountName: accounts.name,
        })
        .from(opportunities)
        .leftJoin(accounts, eq(opportunities.accountId, accounts.id));
      
      return res.json(opportunitiesWithAccounts);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch opportunities" });
    }
  });
  
  app.get("/api/opportunities/:id", authenticate, requirePermission("Opportunity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const opportunity = await storage.getOpportunityById(req.params.id);
      if (!opportunity) {
        return res.status(404).json({ error: "Opportunity not found" });
      }
      return res.json(opportunity);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch opportunity" });
    }
  });
  
  app.post("/api/opportunities", authenticate, requirePermission("Opportunity", "create"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertOpportunitySchema.parse(req.body);
      const opportunity = await storage.createOpportunity(data);
      
      await createAudit(req, "create", "Opportunity", opportunity.id, null, opportunity);
      
      return res.json(opportunity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to create opportunity" });
    }
  });
  
  app.patch("/api/opportunities/:id", authenticate, requirePermission("Opportunity", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const before = await storage.getOpportunityById(req.params.id);
      if (!before) {
        return res.status(404).json({ error: "Opportunity not found" });
      }
      
      // Convert date strings to Date objects
      const updateData = { ...req.body };
      
      const parseDate = (dateValue: any): Date | null => {
        if (!dateValue) return null;
        if (dateValue instanceof Date) return dateValue;
        if (typeof dateValue === 'string' && dateValue.trim() !== '') {
          const parsed = new Date(dateValue);
          return isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
      };
      
      if (updateData.closeDate !== undefined) {
        updateData.closeDate = parseDate(updateData.closeDate);
      }
      if (updateData.actualCloseDate !== undefined) {
        updateData.actualCloseDate = parseDate(updateData.actualCloseDate);
      }
      if (updateData.estCloseDate !== undefined) {
        updateData.estCloseDate = parseDate(updateData.estCloseDate);
      }
      
      const opportunity = await storage.updateOpportunity(req.params.id, updateData);
      
      await createAudit(req, "update", "Opportunity", opportunity.id, before, opportunity);
      
      return res.json(opportunity);
    } catch (error) {
      console.error("Update opportunity error:", error);
      return res.status(500).json({ error: "Failed to update opportunity" });
    }
  });
  
  app.delete("/api/opportunities/:id", authenticate, requirePermission("Opportunity", "delete"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const before = await storage.getOpportunityById(req.params.id);
      if (!before) {
        return res.status(404).json({ error: "Opportunity not found" });
      }
      
      await storage.deleteOpportunity(req.params.id);
      
      await createAudit(req, "delete", "Opportunity", req.params.id, before, null);
      
      return res.json({ success: true });
    } catch (error) {
      console.error("Delete opportunity error:", error);
      return res.status(500).json({ error: "Failed to delete opportunity" });
    }
  });
  
  // Get related data for an opportunity (account, contacts, activities)
  app.get("/api/opportunities/:id/related", authenticate, requirePermission("Opportunity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const opportunityId = req.params.id;
      
      const opportunity = await storage.getOpportunityById(opportunityId);
      if (!opportunity) {
        return res.status(404).json({ error: "Opportunity not found" });
      }
      
      const [account, allContacts, allActivities, activityAssocs] = await Promise.all([
        storage.getAccountById(opportunity.accountId),
        storage.getAllContacts(),
        storage.getAllActivities(),
        // Fetch activity associations for this opportunity
        db.select().from(activityAssociations).where(
          and(
            eq(activityAssociations.entityType, "Opportunity"),
            eq(activityAssociations.entityId, opportunityId)
          )
        ),
      ]);
      
      const contacts = allContacts.filter(c => c.accountId === opportunity.accountId);
      
      // Get activities from BOTH the deprecated relatedType/relatedId fields AND the activity_associations table
      const activitiesFromDeprecated = allActivities.filter(a => a.relatedType === "Opportunity" && a.relatedId === opportunityId);
      const activityIdsFromAssociations = activityAssocs.map((a: any) => a.activityId);
      const activitiesFromAssociations = allActivities.filter(a => activityIdsFromAssociations.includes(a.id));
      
      // Merge and deduplicate activities
      const activitiesMap = new Map();
      [...activitiesFromDeprecated, ...activitiesFromAssociations].forEach(activity => {
        activitiesMap.set(activity.id, activity);
      });
      const activities = Array.from(activitiesMap.values());
      
      return res.json({
        account: account ? { items: [account], total: 1 } : { items: [], total: 0 },
        contacts: { items: contacts, total: contacts.length },
        activities: { items: activities, total: activities.length },
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch related data" });
    }
  });
  
  // Bulk update opportunities
  app.post("/api/opportunities/bulk-update", authenticate, requirePermission("Opportunity", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { opportunityIds, updates } = req.body;
      
      if (!opportunityIds || !Array.isArray(opportunityIds) || opportunityIds.length === 0) {
        return res.status(400).json({ error: "Opportunity IDs array is required" });
      }
      
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: "Updates object is required" });
      }
      
      let updatedCount = 0;
      for (const opportunityId of opportunityIds) {
        const opportunity = await storage.getOpportunityById(opportunityId);
        if (opportunity) {
          const updatedOpportunity = await storage.updateOpportunity(opportunityId, updates);
          await createAudit(req, "bulk_update", "Opportunity", opportunityId, opportunity, updatedOpportunity);
          updatedCount++;
        }
      }
      
      return res.json({ success: true, count: updatedCount });
    } catch (error) {
      console.error("Bulk update opportunities error:", error);
      return res.status(500).json({ error: "Failed to bulk update opportunities" });
    }
  });
  
  // ========== ACTIVITIES ROUTES ==========
  
  app.get("/api/activities", authenticate, requirePermission("Activity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const activities = await storage.getAllActivities();
      return res.json(activities);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch activities" });
    }
  });
  
  app.get("/api/activities/upcoming", authenticate, requirePermission("Activity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      const upcomingActivities = await db.select()
        .from(activities)
        .where(
          and(
            gte(activities.dueAt, now),
            lte(activities.dueAt, thirtyDaysFromNow),
            ne(activities.status, 'completed')
          )
        )
        .orderBy(asc(activities.dueAt))
        .limit(50);
      
      return res.json(upcomingActivities);
    } catch (error) {
      console.error("Upcoming activities error:", error);
      return res.status(500).json({ error: "Failed to fetch upcoming activities" });
    }
  });

  app.get("/api/activities/pending", authenticate, requirePermission("Activity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      // Get all activities that are not completed (pending or cancelled)
      const pendingActivities = await db.select()
        .from(activities)
        .where(ne(activities.status, 'completed'))
        .orderBy(asc(activities.dueAt))
        .limit(100);
      
      return res.json(pendingActivities);
    } catch (error) {
      console.error("Pending activities error:", error);
      return res.status(500).json({ error: "Failed to fetch pending activities" });
    }
  });
  
  app.get("/api/activities/summary", authenticate, requirePermission("Activity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const allActivities = await storage.getAllActivities();
      const allUsers = await storage.getAllUsers();
      
      // Total count
      const totalCount = allActivities.length;
      
      // Breakdown by status
      const byStatus = {
        pending: allActivities.filter(a => a.status === "pending").length,
        completed: allActivities.filter(a => a.status === "completed").length,
        cancelled: allActivities.filter(a => a.status === "cancelled").length,
      };
      
      // Breakdown by type
      const byType = {
        call: allActivities.filter(a => a.type === "call").length,
        email: allActivities.filter(a => a.type === "email").length,
        meeting: allActivities.filter(a => a.type === "meeting").length,
        task: allActivities.filter(a => a.type === "task").length,
        note: allActivities.filter(a => a.type === "note").length,
      };
      
      // Breakdown by priority
      const byPriority = {
        high: allActivities.filter(a => a.priority === "high").length,
        medium: allActivities.filter(a => a.priority === "medium").length,
        low: allActivities.filter(a => a.priority === "low").length,
      };
      
      // Time-based metrics
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      // Overdue activities (pending with due date in the past)
      const overdueActivities = allActivities.filter(a => 
        a.status === "pending" && a.dueAt && new Date(a.dueAt) < now
      );
      const overdue = overdueActivities.length;
      const overdueHighPriority = overdueActivities.filter(a => a.priority === "high").length;
      
      // Due this week (pending with due date in next 7 days)
      const dueThisWeekActivities = allActivities.filter(a =>
        a.status === "pending" && a.dueAt && 
        new Date(a.dueAt) >= now && new Date(a.dueAt) <= sevenDaysFromNow
      );
      const dueThisWeek = dueThisWeekActivities.length;
      const dueThisWeekByType = {
        meeting: dueThisWeekActivities.filter(a => a.type === "meeting").length,
        call: dueThisWeekActivities.filter(a => a.type === "call").length,
      };
      
      // Recent additions
      const last7Days = allActivities.filter(a => new Date(a.createdAt) >= sevenDaysAgo).length;
      
      // Count by owner
      const ownerMap = new Map<string, { count: number; ownerName: string }>();
      allActivities.forEach(a => {
        if (a.ownerId) {
          const owner = allUsers.find(u => u.id === a.ownerId);
          const ownerName = owner ? owner.name : "Unknown";
          const current = ownerMap.get(a.ownerId);
          ownerMap.set(a.ownerId, {
            count: (current?.count || 0) + 1,
            ownerName,
          });
        }
      });
      const byOwner = Object.fromEntries(
        Array.from(ownerMap.entries()).map(([id, data]) => [id, data])
      );
      
      return res.json({
        totalCount,
        byStatus,
        byType,
        byPriority,
        overdue,
        overdueHighPriority,
        dueThisWeek,
        dueThisWeekByType,
        recentAdditions: {
          last7Days,
        },
        byOwner,
      });
    } catch (error) {
      console.error("Activities summary error:", error);
      return res.status(500).json({ error: "Failed to fetch activities summary" });
    }
  });
  
  app.get("/api/activities/:id", authenticate, requirePermission("Activity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const activity = await storage.getActivityById(req.params.id);
      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }
      return res.json(activity);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch activity" });
    }
  });
  
  app.post("/api/activities", authenticate, requirePermission("Activity", "create"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertActivitySchema.parse(req.body);
      
      // Convert string dates to Date objects for database storage
      const activityData = {
        ...data,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        completedAt: data.completedAt ? new Date(data.completedAt) : null,
      };
      
      const activity = await storage.createActivity(activityData as any);
      
      // IMPORTANT: Also create activity_associations entry if relatedType and relatedId are provided
      // This ensures the activity shows up on entity detail pages
      if (data.relatedType && data.relatedId) {
        try {
          await db.insert(activityAssociations).values({
            activityId: activity.id,
            entityType: data.relatedType,
            entityId: data.relatedId,
          });
        } catch (assocError) {
          console.error("[ACTIVITIES-ROUTE] Failed to create activity association:", assocError);
          // Don't fail the entire request if association creation fails
        }
      }
      
      await createAudit(req, "create", "Activity", activity.id, null, activity);
      
      return res.json(activity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      console.error("Failed to create activity:", error);
      return res.status(500).json({ error: "Failed to create activity" });
    }
  });
  
  // Bulk update activities - MUST be before /:id route
  app.patch("/api/activities/bulk-update", authenticate, requirePermission("Activity", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { activityIds, updates } = req.body;
      
      if (!Array.isArray(activityIds) || activityIds.length === 0) {
        return res.status(400).json({ error: "Activity IDs are required" });
      }
      
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: "Updates are required" });
      }
      
      // Convert string dates to Date objects for database storage
      const processedUpdates = { ...updates };
      if (processedUpdates.dueAt) {
        processedUpdates.dueAt = new Date(processedUpdates.dueAt);
      }
      if (processedUpdates.completedAt) {
        processedUpdates.completedAt = new Date(processedUpdates.completedAt);
      }
      
      const updatedActivities = [];
      
      for (const activityId of activityIds) {
        const before = await storage.getActivityById(activityId);
        if (before) {
          const activity = await storage.updateActivity(activityId, processedUpdates);
          await createAudit(req, "update", "Activity", activity.id, before, activity);
          updatedActivities.push(activity);
        }
      }
      
      return res.json({ 
        success: true, 
        updated: updatedActivities.length,
        activities: updatedActivities 
      });
    } catch (error) {
      console.error("Failed to bulk update activities:", error);
      return res.status(500).json({ error: "Failed to bulk update activities" });
    }
  });
  
  app.patch("/api/activities/:id", authenticate, requirePermission("Activity", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const before = await storage.getActivityById(req.params.id);
      if (!before) {
        return res.status(404).json({ error: "Activity not found" });
      }
      
      // Convert string dates to Date objects for database storage
      const updates = { ...req.body };
      if (updates.dueAt) {
        updates.dueAt = new Date(updates.dueAt);
      }
      if (updates.completedAt) {
        updates.completedAt = new Date(updates.completedAt);
      }
      
      const activity = await storage.updateActivity(req.params.id, updates);
      
      await createAudit(req, "update", "Activity", activity.id, before, activity);
      
      return res.json(activity);
    } catch (error) {
      console.error("Failed to update activity:", error);
      return res.status(500).json({ error: "Failed to update activity" });
    }
  });
  
  app.delete("/api/activities/:id", authenticate, requirePermission("Activity", "delete"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const before = await storage.getActivityById(req.params.id);
      if (!before) {
        return res.status(404).json({ error: "Activity not found" });
      }
      
      await storage.deleteActivity(req.params.id);
      
      await createAudit(req, "delete", "Activity", req.params.id, before, null);
      
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Failed to delete activity" });
    }
  });
  
  // Get related data for an activity (polymorphic parent entity)
  app.get("/api/activities/:id/related", authenticate, requirePermission("Activity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const activityId = req.params.id;
      
      const activity = await storage.getActivityById(activityId);
      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }
      
      // Fetch the related entity based on relatedType and relatedId
      let relatedEntity = null;
      if (activity.relatedType && activity.relatedId) {
        if (activity.relatedType === "Account") {
          relatedEntity = await storage.getAccountById(activity.relatedId);
        } else if (activity.relatedType === "Contact") {
          relatedEntity = await storage.getContactById(activity.relatedId);
        } else if (activity.relatedType === "Opportunity") {
          relatedEntity = await storage.getOpportunityById(activity.relatedId);
        } else if (activity.relatedType === "Lead") {
          relatedEntity = await storage.getLeadById(activity.relatedId);
        }
      }
      
      return res.json({
        relatedEntity: relatedEntity ? { type: activity.relatedType, data: relatedEntity } : null,
      });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch related data" });
    }
  });

  // ========== ACTIVITY ASSOCIATIONS ROUTES ==========

  // Get all associations for an activity
  app.get("/api/activities/:id/associations", authenticate, requirePermission("Activity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const activityId = req.params.id;
      
      // Verify activity exists
      const activity = await storage.getActivityById(activityId);
      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }
      
      // Get all associations
      const associations = await db
        .select()
        .from(activityAssociations)
        .where(eq(activityAssociations.activityId, activityId));
      
      // Fetch entity details for each association
      const associationsWithDetails = await Promise.all(
        associations.map(async (assoc: any) => {
          let entityDetails: any = null;
          let entityName = "";
          
          if (assoc.entityType === "Account") {
            entityDetails = await storage.getAccountById(assoc.entityId);
            entityName = entityDetails?.name || assoc.entityId;
          } else if (assoc.entityType === "Contact") {
            entityDetails = await storage.getContactById(assoc.entityId);
            entityName = entityDetails ? `${entityDetails.firstName} ${entityDetails.lastName}` : assoc.entityId;
          } else if (assoc.entityType === "Lead") {
            entityDetails = await storage.getLeadById(assoc.entityId);
            entityName = entityDetails ? `${entityDetails.firstName} ${entityDetails.lastName}` : assoc.entityId;
          } else if (assoc.entityType === "Opportunity") {
            entityDetails = await storage.getOpportunityById(assoc.entityId);
            entityName = entityDetails?.name || assoc.entityId;
          }
          
          return {
            ...assoc,
            entity: entityDetails,
            entityName,
          };
        })
      );
      
      return res.json(associationsWithDetails);
    } catch (error) {
      console.error("Failed to fetch associations:", error);
      return res.status(500).json({ error: "Failed to fetch associations" });
    }
  });

  // Create new association for an activity
  app.post("/api/activities/:id/associations", authenticate, requirePermission("Activity", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const activityId = req.params.id;
      
      // Verify activity exists
      const activity = await storage.getActivityById(activityId);
      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }
      
      const data = insertActivityAssociationSchema.parse({
        ...req.body,
        activityId,
      });
      
      // Verify entity exists
      let entityExists = false;
      if (data.entityType === "Account") {
        entityExists = !!(await storage.getAccountById(data.entityId));
      } else if (data.entityType === "Contact") {
        entityExists = !!(await storage.getContactById(data.entityId));
      } else if (data.entityType === "Lead") {
        entityExists = !!(await storage.getLeadById(data.entityId));
      } else if (data.entityType === "Opportunity") {
        entityExists = !!(await storage.getOpportunityById(data.entityId));
      }
      
      if (!entityExists) {
        return res.status(404).json({ error: `${data.entityType} not found` });
      }
      
      // Check if association already exists
      const existing = await db
        .select()
        .from(activityAssociations)
        .where(
          and(
            eq(activityAssociations.activityId, activityId),
            eq(activityAssociations.entityType, data.entityType),
            eq(activityAssociations.entityId, data.entityId)
          )
        );
      
      if (existing.length > 0) {
        return res.status(400).json({ error: "Association already exists" });
      }
      
      // Create association
      const [association] = await db
        .insert(activityAssociations)
        .values(data)
        .returning();
      
      await createAudit(req, "create", "ActivityAssociation", association.id, null, association);
      
      return res.json(association);
    } catch (error) {
      console.error("Failed to create association:", error);
      return res.status(500).json({ error: "Failed to create association" });
    }
  });

  // Delete an association
  app.delete("/api/activity-associations/:id", authenticate, requirePermission("Activity", "update"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const associationId = req.params.id;
      
      // Get association before deleting
      const [association] = await db
        .select()
        .from(activityAssociations)
        .where(eq(activityAssociations.id, associationId));
      
      if (!association) {
        return res.status(404).json({ error: "Association not found" });
      }
      
      // Delete association
      await db
        .delete(activityAssociations)
        .where(eq(activityAssociations.id, associationId));
      
      await createAudit(req, "delete", "ActivityAssociation", associationId, association, null);
      
      return res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete association:", error);
      return res.status(500).json({ error: "Failed to delete association" });
    }
  });

  // Search entities for autocomplete (accounts, contacts, leads, opportunities)
  app.get("/api/entities/search", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { q, type } = req.query;
      
      if (!q || typeof q !== "string" || q.length < 1) {
        return res.json([]);
      }
      
      const searchTerm = `%${q.toLowerCase()}%`;
      const results: any[] = [];
      
      // Search accounts (if type not specified or type is Account)
      if (!type || type === "Account") {
        const accountResults = await db
          .select({
            id: accounts.id,
            name: accounts.name,
            type: sql<string>`'Account'`,
            displayName: accounts.name,
          })
          .from(accounts)
          .where(
            sql`LOWER(${accounts.name}) LIKE ${searchTerm} OR LOWER(${accounts.id}) LIKE ${searchTerm}`
          )
          .limit(10);
        results.push(...accountResults);
      }
      
      // Search contacts (if type not specified or type is Contact)
      if (!type || type === "Contact") {
        const contactResults = await db
          .select({
            id: contacts.id,
            name: sql<string>`${contacts.firstName} || ' ' || ${contacts.lastName}`,
            type: sql<string>`'Contact'`,
            displayName: sql<string>`${contacts.firstName} || ' ' || ${contacts.lastName}`,
          })
          .from(contacts)
          .where(
            sql`LOWER(${contacts.firstName} || ' ' || ${contacts.lastName}) LIKE ${searchTerm} OR LOWER(${contacts.id}) LIKE ${searchTerm} OR LOWER(${contacts.email}) LIKE ${searchTerm}`
          )
          .limit(10);
        results.push(...contactResults);
      }
      
      // Search leads (if type not specified or type is Lead)
      if (!type || type === "Lead") {
        const leadResults = await db
          .select({
            id: leads.id,
            name: sql<string>`${leads.firstName} || ' ' || ${leads.lastName}`,
            type: sql<string>`'Lead'`,
            displayName: sql<string>`${leads.firstName} || ' ' || ${leads.lastName} || ' (' || ${leads.company} || ')'`,
          })
          .from(leads)
          .where(
            sql`LOWER(${leads.firstName} || ' ' || ${leads.lastName}) LIKE ${searchTerm} OR LOWER(${leads.company}) LIKE ${searchTerm} OR LOWER(${leads.id}) LIKE ${searchTerm}`
          )
          .limit(10);
        results.push(...leadResults);
      }
      
      // Search opportunities (if type not specified or type is Opportunity)
      if (!type || type === "Opportunity") {
        const opportunityResults = await db
          .select({
            id: opportunities.id,
            name: opportunities.name,
            type: sql<string>`'Opportunity'`,
            displayName: opportunities.name,
          })
          .from(opportunities)
          .where(
            sql`LOWER(${opportunities.name}) LIKE ${searchTerm} OR LOWER(${opportunities.id}) LIKE ${searchTerm}`
          )
          .limit(10);
        results.push(...opportunityResults);
      }
      
      return res.json(results);
    } catch (error) {
      console.error("Failed to search entities:", error);
      return res.status(500).json({ error: "Failed to search entities" });
    }
  });
  
  // ========== DASHBOARD ROUTES ==========
  
  app.get("/api/dashboard/stats", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const stats = await storage.getDashboardStats();
      return res.json(stats);
    } catch (error) {
      console.error("Dashboard stats error:", error);
      return res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });
  
  app.get("/api/dashboard/sales-waterfall/:year", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const year = parseInt(req.params.year);
      if (isNaN(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ error: "Invalid year" });
      }
      
      const waterfallData = await storage.getSalesWaterfallData(year);
      return res.json(waterfallData);
    } catch (error) {
      console.error("Sales waterfall error:", error);
      return res.status(500).json({ error: "Failed to fetch sales waterfall data" });
    }
  });
  
  // ========== AUDIT LOG ROUTES ==========
  
  app.get("/api/audit-logs", authenticate, requirePermission("AuditLog", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const logs = await storage.getAllAuditLogs();
      return res.json(logs);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });
  
  // ========== TAG ROUTES ==========
  
  app.get("/api/tags", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const tags = await storage.getAllTags();
      return res.json(tags);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch tags" });
    }
  });
  
  app.post("/api/tags", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const tag = await storage.createTag({
        ...req.body,
        createdBy: req.user!.id,
      });
      return res.status(201).json(tag);
    } catch (error) {
      return res.status(500).json({ error: "Failed to create tag" });
    }
  });
  
  app.patch("/api/tags/:id", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const tag = await storage.updateTag(req.params.id, req.body);
      return res.json(tag);
    } catch (error) {
      return res.status(500).json({ error: "Failed to update tag" });
    }
  });
  
  app.delete("/api/tags/:id", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      await storage.deleteTag(req.params.id);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Failed to delete tag" });
    }
  });
  
  // Entity tag routes
  app.get("/api/:entity/:entityId/tags", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { entity, entityId } = req.params;
      const tags = await storage.getEntityTags(entity, entityId);
      return res.json(tags);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch entity tags" });
    }
  });
  
  app.post("/api/:entity/:entityId/tags", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { entity, entityId } = req.params;
      const { tagIds } = req.body;
      await storage.addEntityTags(entity, entityId, tagIds, req.user!.id);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Failed to add entity tags" });
    }
  });
  
  app.delete("/api/:entity/:entityId/tags/:tagId", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { entity, entityId, tagId } = req.params;
      await storage.removeEntityTag(entity, entityId, tagId);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Failed to remove entity tag" });
    }
  });
  
  // Bulk tag operations
  app.post("/api/:entity/bulk-tags", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { entity } = req.params;
      const { entityIds, tagIds } = req.body;
      
      for (const entityId of entityIds) {
        await storage.addEntityTags(entity, entityId, tagIds, req.user!.id);
      }
      
      return res.json({ success: true, count: entityIds.length });
    } catch (error) {
      console.error("Bulk tag assignment error:", error);
      return res.status(500).json({ error: "Failed to assign tags" });
    }
  });
  
  // ========== ADMIN ROUTES ==========
  
  app.get("/api/admin/users", authenticate, requireRole("Admin"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const users = await storage.getAllUsers();
      // Fetch roles for each user
      const usersWithRoles = await Promise.all(
        users.map(async (user) => {
          const roles = await storage.getUserRoles(user.id);
          return { ...user, roles };
        })
      );
      return res.json(usersWithRoles);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch users" });
    }
  });
  
  app.post("/api/admin/users", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { name, email, password, roleId } = req.body;
      
      // Validate required fields
      if (!name || !email || !password || !roleId) {
        return res.status(400).json({ error: "Name, email, password, and role are required" });
      }
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "User with this email already exists" });
      }
      
      // Hash password using the auth helper
      const hashedPassword = await hashPassword(password);
      
      // Create user
      const newUser = await storage.createUser({
        name,
        email,
        password: hashedPassword,
        status: "active"
      });
      
      // Assign role
      await storage.assignRoleToUser(newUser.id, roleId);
      
      // Create audit log
      await createAudit(req, "create", "User", newUser.id, null, { ...newUser, roleId });
      
      return res.json(newUser);
    } catch (error) {
      console.error("Error creating user:", error);
      return res.status(500).json({ error: "Failed to create user" });
    }
  });
  
  app.patch("/api/admin/users/:id", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { name, email, status, roleId } = req.body;
      
      // Get the before state
      const before = await storage.getUserById(id);
      if (!before) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Update user attributes
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email;
      if (status !== undefined) updateData.status = status;
      
      const updatedUser = await storage.updateUser(id, updateData);
      
      // Update role if provided
      if (roleId !== undefined) {
        await storage.updateUserRole(id, roleId);
      }
      
      // Create audit log
      await createAudit(req, "update", "User", id, before, { ...updatedUser, roleId });
      
      return res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user:", error);
      return res.status(500).json({ error: "Failed to update user" });
    }
  });
  
  app.get("/api/admin/roles", authenticate, requireRole("Admin"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const roles = await storage.getAllRoles();
      return res.json(roles);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch roles" });
    }
  });
  
  app.get("/api/admin/id-patterns", authenticate, requireRole("Admin"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const patterns = await storage.getAllIdPatterns();
      return res.json(patterns);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch ID patterns" });
    }
  });
  
  app.patch("/api/admin/id-patterns/:id", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { pattern, startValue, counter } = req.body;
      const updates: any = {};
      
      if (pattern !== undefined) updates.pattern = pattern;
      if (startValue !== undefined) updates.startValue = startValue;
      if (counter !== undefined) updates.counter = counter;
      
      const updatedPattern = await storage.updateIdPattern(req.params.id, updates);
      
      await createAudit(req, "update", "IdPattern", req.params.id, null, updatedPattern);
      
      return res.json(updatedPattern);
    } catch (error) {
      return res.status(500).json({ error: "Failed to update ID pattern" });
    }
  });
  
  // ========== ACCOUNT CATEGORIES ROUTES ==========
  
  app.get("/api/admin/categories", authenticate, requireRole("Admin"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const categories = await storage.getAllAccountCategories();
      return res.json(categories);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch categories" });
    }
  });
  
  app.post("/api/admin/categories", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { name, description, isActive } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Category name is required" });
      }
      
      const category = await storage.createAccountCategory({
        name: name.trim(),
        description: description || null,
        isActive: isActive !== undefined ? isActive : true,
      });
      
      await createAudit(req, "create", "AccountCategory", category.id, null, category);
      
      return res.json(category);
    } catch (error: any) {
      if (error?.message?.includes("unique")) {
        return res.status(400).json({ error: "Category name already exists" });
      }
      return res.status(500).json({ error: "Failed to create category" });
    }
  });
  
  app.patch("/api/admin/categories/:id", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { name, description, isActive } = req.body;
      const updates: any = {};
      
      if (name !== undefined) updates.name = name.trim();
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.isActive = isActive;
      
      const before = await storage.getAccountCategory(req.params.id);
      const updatedCategory = await storage.updateAccountCategory(req.params.id, updates);
      
      await createAudit(req, "update", "AccountCategory", req.params.id, before, updatedCategory);
      
      return res.json(updatedCategory);
    } catch (error: any) {
      if (error?.message?.includes("unique")) {
        return res.status(400).json({ error: "Category name already exists" });
      }
      return res.status(500).json({ error: "Failed to update category" });
    }
  });
  
  app.delete("/api/admin/categories/:id", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      const category = await storage.getAccountCategory(req.params.id);
      if (!category) {
        return res.status(404).json({ error: "Category not found" });
      }
      
      await storage.deleteAccountCategory(req.params.id);
      
      await createAudit(req, "delete", "AccountCategory", req.params.id, category, null);
      
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Failed to delete category" });
    }
  });
  
  app.post("/api/admin/backup", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      const job = await storage.createBackupJob({
        status: "in_progress",
        initiatedBy: req.user?.id || null,
      });
      
      try {
        // Create encrypted backup - encryption key is required
        const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
        if (!encryptionKey) {
          await storage.updateBackupJob(job.id, { 
            status: "failed",
            errorMessage: "BACKUP_ENCRYPTION_KEY environment variable not set",
          });
          return res.status(500).json({ error: "Server configuration error: encryption key not configured" });
        }
        
        const { data, checksum, size } = await backupService.createBackup(encryptionKey);
        
        // Update job status
        await storage.updateBackupJob(job.id, {
          status: "completed",
          checksum,
          sizeBytes: size,
          completedAt: new Date(),
        });
        
        await createAudit(req, "create", "BackupJob", job.id, null, { ...job, status: "completed", checksum, size });
        
        // Send backup file as download
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="healthtrixss-backup-${Date.now()}.htb"`);
        res.setHeader("X-Backup-Checksum", checksum);
        return res.send(data);
      } catch (backupError) {
        // Update job as failed with error message
        const errorMessage = backupError instanceof Error ? backupError.message : "Unknown error";
        await storage.updateBackupJob(job.id, { 
          status: "failed",
          errorMessage,
        });
        throw backupError;
      }
    } catch (error) {
      console.error("Backup error:", error);
      return res.status(500).json({ error: "Failed to create backup" });
    }
  });
  
  app.post("/api/admin/restore", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      // Body should be a Buffer from express.raw() middleware
      let backupBuffer = req.body;
      
      // Check if we received binary data (can be Buffer or Uint8Array)
      if (!backupBuffer || (!Buffer.isBuffer(backupBuffer) && !(backupBuffer instanceof Uint8Array))) {
        return res.status(400).json({ 
          success: false,
          error: "Invalid backup file format",
          details: ["Expected binary data. Received: " + typeof backupBuffer]
        });
      }
      
      // Convert Uint8Array to Buffer if needed
      if (backupBuffer instanceof Uint8Array && !Buffer.isBuffer(backupBuffer)) {
        backupBuffer = Buffer.from(backupBuffer);
      }
      
      // Encryption key is required
      const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
      if (!encryptionKey) {
        return res.status(500).json({ 
          success: false,
          error: "Server configuration error: encryption key not configured",
          details: []
        });
      }
      
      const result = await backupService.restoreBackup(backupBuffer, encryptionKey);
      
      if (result.success) {
        await createAudit(req, "restore", "Database", null, null, { 
          recordsRestored: result.recordsRestored,
          warnings: result.errors,
        });
        
        return res.json({
          success: true,
          recordsRestored: result.recordsRestored,
          warnings: result.errors,
        });
      } else {
        console.error("Restore failed with errors:", result.errors);
        return res.status(400).json({
          success: false,
          error: `Restore failed: ${result.errors[0] || 'Unknown error'}`,
          details: result.errors,
        });
      }
    } catch (error) {
      console.error("Restore error (full):", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error("Error stack:", errorStack);
      return res.status(500).json({ 
        success: false,
        error: `Failed to restore backup: ${errorMessage}`,
        details: [errorMessage, errorStack].filter(Boolean)
      });
    }
  });
  
  app.post("/api/admin/reset-database", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      // Delete CRM entity data (in reverse dependency order)
      await storage.resetDatabase();
      
      await createAudit(req, "reset", "Database", null, null, { 
        message: "Database reset - all CRM data cleared",
        timestamp: new Date().toISOString(),
      });
      
      return res.json({ success: true, message: "Database reset successfully" });
    } catch (error) {
      console.error("Database reset error:", error);
      return res.status(500).json({ error: "Failed to reset database" });
    }
  });

  app.post("/api/admin/clear-accounts", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      // Delete all accounts and related data (in reverse dependency order)
      // Delete comments related to accounts
      await db.execute(sql`DELETE FROM comments WHERE entity_type = 'Account'`);
      
      // Delete activities linked to accounts
      await db.execute(sql`DELETE FROM activities WHERE account_id IS NOT NULL`);
      
      // Delete opportunities (they reference accounts)
      await db.execute(sql`DELETE FROM opportunities`);
      
      // Delete contacts (they reference accounts)
      await db.execute(sql`DELETE FROM contacts`);
      
      // Finally delete accounts
      await db.execute(sql`DELETE FROM accounts`);
      
      await createAudit(req, "delete", "Account", null, null, { 
        message: "All accounts cleared",
        timestamp: new Date().toISOString(),
      });
      
      return res.json({ success: true, message: "All accounts cleared successfully" });
    } catch (error) {
      console.error("Clear accounts error:", error);
      return res.status(500).json({ error: "Failed to clear accounts" });
    }
  });

  app.post("/api/admin/system-reset", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      // Create audit log BEFORE deleting users
      await createAudit(req, "reset", "System", null, null, { 
        message: "System reset - all users deleted. Next registration will become Admin.",
        timestamp: new Date().toISOString(),
      });
      
      // Set all foreign key references to users to NULL before deleting users
      // This preserves CRM data while removing user ownership
      await db.execute(sql`UPDATE audit_logs SET actor_id = NULL WHERE actor_id IS NOT NULL`);
      await db.execute(sql`UPDATE accounts SET owner_id = NULL WHERE owner_id IS NOT NULL`);
      await db.execute(sql`UPDATE contacts SET owner_id = NULL WHERE owner_id IS NOT NULL`);
      await db.execute(sql`UPDATE leads SET owner_id = NULL WHERE owner_id IS NOT NULL`);
      await db.execute(sql`UPDATE opportunities SET owner_id = NULL WHERE owner_id IS NOT NULL`);
      await db.execute(sql`UPDATE activities SET owner_id = NULL WHERE owner_id IS NOT NULL`);
      
      // Delete all user-role associations
      await db.execute(sql`DELETE FROM user_roles`);
      
      // Delete all users - this will automatically invalidate all sessions
      // The next registration will become Admin (first user logic)
      await db.execute(sql`DELETE FROM users`);
      
      return res.json({ 
        success: true, 
        message: "System reset successfully. All users deleted. Next registration will become Admin." 
      });
    } catch (error) {
      console.error("System reset error:", error);
      return res.status(500).json({ error: "Failed to reset system" });
    }
  });
  
  // ========== DYNAMICS 365 IMPORT ROUTES ==========
  
  app.post("/api/admin/dynamics/transform-accounts", authenticate, requireRole("Admin"), sensitiveRateLimiter, upload.fields([
    { name: 'excelFile', maxCount: 1 },
    { name: 'mappingConfig', maxCount: 1 },
    { name: 'templateCsv', maxCount: 1 }
  ]), async (req: AuthRequest, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      
      if (!files.excelFile || !files.mappingConfig || !files.templateCsv) {
        return res.status(400).json({ 
          error: "Missing required files. Please provide excelFile, mappingConfig, and templateCsv" 
        });
      }

      // Parse mapping config
      const configBuffer = files.mappingConfig[0].buffer;
      const config: DynamicsMappingConfig = JSON.parse(configBuffer.toString('utf-8'));

      // Get template CSV content
      const templateCsv = files.templateCsv[0].buffer.toString('utf-8');

      // Get Excel buffer
      const excelBuffer = files.excelFile[0].buffer;

      // Fetch existing accounts for lookup (if enabled)
      let existingAccounts: any[] = [];
      if (config.account_lookup?.enabled) {
        existingAccounts = await db.select({
          id: accounts.id,
          name: accounts.name
        }).from(accounts);
      }

      // Create mapper and transform
      const mapper = new DynamicsMapper(config);
      const result = mapper.transform(excelBuffer, templateCsv, existingAccounts);

      // Convert to CSV
      const csvContent = mapper.toCSV(result.data);

      // Create audit log
      await createAudit(req, "transform", "DynamicsImport", null, null, {
        sourceFile: files.excelFile[0].originalname,
        stats: result.stats,
      });

      // Return CSV file
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="accounts_aligned.csv"');
      
      return res.send(csvContent);
    } catch (error: any) {
      console.error("Dynamics transform error:", error);
      return res.status(500).json({ 
        error: "Failed to transform accounts", 
        details: error.message 
      });
    }
  });
  
  app.post("/api/admin/dynamics/transform-contacts", authenticate, requireRole("Admin"), sensitiveRateLimiter, upload.fields([
    { name: 'excelFile', maxCount: 1 },
    { name: 'mappingConfig', maxCount: 1 },
    { name: 'templateCsv', maxCount: 1 }
  ]), async (req: AuthRequest, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      
      if (!files.excelFile || !files.mappingConfig || !files.templateCsv) {
        return res.status(400).json({ 
          error: "Missing required files. Please provide excelFile, mappingConfig, and templateCsv" 
        });
      }

      // Parse mapping config
      const configBuffer = files.mappingConfig[0].buffer;
      const config: DynamicsMappingConfig = JSON.parse(configBuffer.toString('utf-8'));

      // Get template CSV content
      const templateCsv = files.templateCsv[0].buffer.toString('utf-8');

      // Get Excel buffer
      const excelBuffer = files.excelFile[0].buffer;

      // Fetch existing accounts for lookup (if enabled)
      let existingAccounts: any[] = [];
      if (config.account_lookup?.enabled) {
        existingAccounts = await db.select({
          id: accounts.id,
          name: accounts.name
        }).from(accounts);
      }

      // Create mapper and transform
      const mapper = new DynamicsMapper(config);
      const result = mapper.transform(excelBuffer, templateCsv, existingAccounts);

      // Convert to CSV
      const csvContent = mapper.toCSV(result.data);

      // Create audit log
      await createAudit(req, "transform", "DynamicsImport", null, null, {
        sourceFile: files.excelFile[0].originalname,
        entity: "contacts",
        stats: result.stats,
      });

      // Return CSV file
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="contacts_aligned.csv"');
      
      return res.send(csvContent);
    } catch (error: any) {
      console.error("Dynamics contacts transform error:", error);
      return res.status(500).json({ 
        error: "Failed to transform contacts", 
        details: error.message 
      });
    }
  });
  
  app.post("/api/admin/dynamics/transform-leads", authenticate, requireRole("Admin"), sensitiveRateLimiter, upload.fields([
    { name: 'excelFile', maxCount: 1 },
    { name: 'mappingConfig', maxCount: 1 },
    { name: 'templateCsv', maxCount: 1 }
  ]), async (req: AuthRequest, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      
      if (!files.excelFile || !files.mappingConfig || !files.templateCsv) {
        return res.status(400).json({ 
          error: "Missing required files. Please provide excelFile, mappingConfig, and templateCsv" 
        });
      }

      // Parse mapping config
      const configBuffer = files.mappingConfig[0].buffer;
      const config: DynamicsMappingConfig = JSON.parse(configBuffer.toString('utf-8'));

      // Get template CSV content
      const templateCsv = files.templateCsv[0].buffer.toString('utf-8');

      // Get Excel buffer
      const excelBuffer = files.excelFile[0].buffer;

      // Leads don't need account lookup (no account relationships)
      const existingAccounts: any[] = [];

      // Create mapper and transform
      const mapper = new DynamicsMapper(config);
      const result = mapper.transform(excelBuffer, templateCsv, existingAccounts);

      // Convert to CSV
      const csvContent = mapper.toCSV(result.data);

      // Create audit log
      await createAudit(req, "transform", "DynamicsImport", null, null, {
        sourceFile: files.excelFile[0].originalname,
        entity: "leads",
        stats: result.stats,
      });

      // Return CSV file
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="leads_aligned.csv"');
      
      return res.send(csvContent);
    } catch (error: any) {
      console.error("Dynamics leads transform error:", error);
      return res.status(500).json({ 
        error: "Failed to transform leads", 
        details: error.message 
      });
    }
  });
  
  app.post("/api/admin/dynamics/transform-opportunities", authenticate, requireRole("Admin"), sensitiveRateLimiter, upload.fields([
    { name: 'excelFile', maxCount: 1 },
    { name: 'mappingConfig', maxCount: 1 },
    { name: 'templateCsv', maxCount: 1 }
  ]), async (req: AuthRequest, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      
      if (!files.excelFile || !files.mappingConfig || !files.templateCsv) {
        return res.status(400).json({ 
          error: "Missing required files. Please provide excelFile, mappingConfig, and templateCsv" 
        });
      }

      // Parse mapping config
      const configBuffer = files.mappingConfig[0].buffer;
      const config: DynamicsMappingConfig = JSON.parse(configBuffer.toString('utf-8'));

      // Get template CSV content
      const templateCsv = files.templateCsv[0].buffer.toString('utf-8');

      // Get Excel buffer
      const excelBuffer = files.excelFile[0].buffer;

      // Fetch existing accounts for accountId lookup
      const existingAccounts = await storage.getAllAccounts();

      // Create mapper and transform
      const mapper = new DynamicsMapper(config);
      const result = mapper.transform(excelBuffer, templateCsv, existingAccounts);

      // Set ownerId to the current user for all opportunities
      result.data = result.data.map(row => ({
        ...row,
        ownerId: req.user!.id
      }));

      // Convert to CSV
      const csvContent = mapper.toCSV(result.data);

      // Create audit log
      await createAudit(req, "transform", "DynamicsImport", null, null, {
        sourceFile: files.excelFile[0].originalname,
        entity: "opportunities",
        stats: result.stats,
      });

      // Return CSV file
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="opportunities_aligned.csv"');
      
      return res.send(csvContent);
    } catch (error: any) {
      console.error("Dynamics opportunities transform error:", error);
      return res.status(500).json({ 
        error: "Failed to transform opportunities", 
        details: error.message 
      });
    }
  });
  
  app.post("/api/admin/dynamics/transform-activities", authenticate, requireRole("Admin"), sensitiveRateLimiter, upload.fields([
    { name: 'excelFile', maxCount: 1 },
    { name: 'mappingConfig', maxCount: 1 },
    { name: 'templateCsv', maxCount: 1 }
  ]), async (req: AuthRequest, res) => {
    try {
      console.log('\n=== ACTIVITY TRANSFORM DIAGNOSTICS ===');
      console.log('[ACTIVITY-TRANSFORM] Starting activity transformation');
      console.log('[ACTIVITY-TRANSFORM] Timestamp:', new Date().toISOString());
      console.log('[ACTIVITY-TRANSFORM] User:', req.user?.email);
      
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      
      if (!files.excelFile || !files.mappingConfig || !files.templateCsv) {
        return res.status(400).json({ 
          error: "Missing required files. Please provide excelFile, mappingConfig, and templateCsv" 
        });
      }

      // Parse mapping config
      const configBuffer = files.mappingConfig[0].buffer;
      const config: DynamicsMappingConfig = JSON.parse(configBuffer.toString('utf-8'));

      // Get template CSV content
      const templateCsv = files.templateCsv[0].buffer.toString('utf-8');

      // Get Excel buffer
      const excelBuffer = files.excelFile[0].buffer;

      console.log('[ACTIVITY-TRANSFORM] Files loaded:', {
        excelFile: files.excelFile[0].originalname,
        excelSize: files.excelFile[0].size,
        mappingConfigSize: files.mappingConfig[0].size,
        templateCsvSize: files.templateCsv[0].size
      });

      // Database diagnostic - test connection before queries
      console.log('[ACTIVITY-TRANSFORM] Testing database connection...');
      try {
        const testQuery = await db.execute(sql`SELECT 1 as test`);
        console.log('[ACTIVITY-TRANSFORM] Database connection test successful:', testQuery);
      } catch (dbError) {
        console.error('[ACTIVITY-TRANSFORM] Database connection test FAILED:', dbError);
      }

      // Fetch all entities for related entity lookup with detailed diagnostics
      console.log('[ACTIVITY-TRANSFORM] Fetching existing entities from database...');
      const startTime = Date.now();

      console.log('[ACTIVITY-TRANSFORM] Querying accounts...');
      const accountsStart = Date.now();
      const accountsResult = await db.select({
        id: accounts.id,
        externalId: accounts.externalId,
        accountNumber: accounts.accountNumber,
        name: accounts.name
      }).from(accounts);
      console.log(`[ACTIVITY-TRANSFORM] Accounts query took ${Date.now() - accountsStart}ms, returned ${accountsResult.length} rows`);
      if (accountsResult.length > 0) {
        console.log('[ACTIVITY-TRANSFORM] Sample account:', accountsResult[0]);
      }

      console.log('[ACTIVITY-TRANSFORM] Querying contacts...');
      const contactsStart = Date.now();
      const contactsResult = await db.select({
        id: contacts.id,
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName
      }).from(contacts);
      console.log(`[ACTIVITY-TRANSFORM] Contacts query took ${Date.now() - contactsStart}ms, returned ${contactsResult.length} rows`);
      if (contactsResult.length > 0) {
        console.log('[ACTIVITY-TRANSFORM] Sample contact:', contactsResult[0]);
      }

      console.log('[ACTIVITY-TRANSFORM] Querying leads...');
      const leadsStart = Date.now();
      const leadsResult = await db.select({
        id: leads.id,
        email: leads.email,
        firstName: leads.firstName,
        lastName: leads.lastName
      }).from(leads);
      console.log(`[ACTIVITY-TRANSFORM] Leads query took ${Date.now() - leadsStart}ms, returned ${leadsResult.length} rows`);
      if (leadsResult.length > 0) {
        console.log('[ACTIVITY-TRANSFORM] Sample lead:', leadsResult[0]);
      }

      console.log('[ACTIVITY-TRANSFORM] Querying opportunities...');
      const opportunitiesStart = Date.now();
      const opportunitiesResult = await db.select({
        id: opportunities.id,
        externalId: opportunities.externalId,
        name: opportunities.name
      }).from(opportunities);
      console.log(`[ACTIVITY-TRANSFORM] Opportunities query took ${Date.now() - opportunitiesStart}ms, returned ${opportunitiesResult.length} rows`);
      if (opportunitiesResult.length > 0) {
        console.log('[ACTIVITY-TRANSFORM] Sample opportunity:', opportunitiesResult[0]);
      }

      const totalQueryTime = Date.now() - startTime;
      console.log(`[ACTIVITY-TRANSFORM] All entity queries completed in ${totalQueryTime}ms`);

      const existingEntities = {
        accounts: accountsResult,
        contacts: contactsResult,
        leads: leadsResult,
        opportunities: opportunitiesResult
      };

      console.log('[ACTIVITY-TRANSFORM] Entity counts summary:', {
        accounts: existingEntities.accounts.length,
        contacts: existingEntities.contacts.length,
        leads: existingEntities.leads.length,
        opportunities: existingEntities.opportunities.length,
        total: existingEntities.accounts.length + existingEntities.contacts.length + 
               existingEntities.leads.length + existingEntities.opportunities.length
      });

      // Create mapper and transform
      console.log('[ACTIVITY-TRANSFORM] Creating DynamicsMapper and starting transformation...');
      const mapper = new DynamicsMapper(config);
      const result = mapper.transform(excelBuffer, templateCsv, [], existingEntities);

      console.log('[ACTIVITY-TRANSFORM] Transformation complete. Stats:', result.stats);
      console.log('[ACTIVITY-TRANSFORM] Transformed data rows:', result.data.length);
      
      // Log a sample of transformed data
      if (result.data.length > 0) {
        console.log('[ACTIVITY-TRANSFORM] Sample transformed row:', result.data[0]);
      }

      // Set ownerId to the current user for all activities
      result.data = result.data.map(row => ({
        ...row,
        ownerId: req.user!.id
      }));

      // Convert to CSV
      const csvContent = mapper.toCSV(result.data);
      console.log('[ACTIVITY-TRANSFORM] CSV generated, size:', csvContent.length, 'bytes');

      // Create audit log
      await createAudit(req, "transform", "DynamicsImport", null, null, {
        sourceFile: files.excelFile[0].originalname,
        entity: "activities",
        stats: result.stats,
      });

      console.log('[ACTIVITY-TRANSFORM] Activity transformation completed successfully');
      console.log('=== END ACTIVITY TRANSFORM DIAGNOSTICS ===\n');

      // Return CSV file with timestamp
      const timestamp = Date.now();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="activities_aligned_${timestamp}.csv"`);
      
      return res.send(csvContent);
    } catch (error: any) {
      console.error('[ACTIVITY-TRANSFORM] ERROR during transformation:', error);
      console.error('[ACTIVITY-TRANSFORM] Error stack:', error.stack);
      console.log('=== END ACTIVITY TRANSFORM DIAGNOSTICS (ERROR) ===\n');
      return res.status(500).json({ 
        error: "Failed to transform activities", 
        details: error.message 
      });
    }
  });
  
  // ========== DATABASE DIAGNOSTICS ENDPOINT ==========
  
  app.get("/api/admin/diagnostics/database", authenticate, requireRole("Admin"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      console.log('\n=== DATABASE DIAGNOSTICS ===');
      console.log('[DB-DIAGNOSTIC] Starting database diagnostics');
      console.log('[DB-DIAGNOSTIC] Timestamp:', new Date().toISOString());
      console.log('[DB-DIAGNOSTIC] User:', req.user?.email);

      const diagnostics: any = {
        timestamp: new Date().toISOString(),
        database: {
          connected: false,
          connectionTest: null,
        },
        entities: {
          accounts: { count: 0, sample: null, error: null },
          contacts: { count: 0, sample: null, error: null },
          leads: { count: 0, sample: null, error: null },
          opportunities: { count: 0, sample: null, error: null },
          activities: { count: 0, sample: null, error: null },
        },
        queryTimes: {},
      };

      // Test database connection
      try {
        const startConn = Date.now();
        const testResult = await db.execute(sql`SELECT 1 as test, current_database() as db_name, current_user as db_user`);
        diagnostics.database.connected = true;
        diagnostics.database.connectionTest = testResult;
        diagnostics.queryTimes.connectionTest = Date.now() - startConn;
        console.log('[DB-DIAGNOSTIC] Connection test successful:', testResult);
      } catch (error: any) {
        diagnostics.database.error = error.message;
        console.error('[DB-DIAGNOSTIC] Connection test failed:', error);
      }

      // Query each entity type
      try {
        const startAccounts = Date.now();
        const accountsData = await db.select({
          id: accounts.id,
          name: accounts.name,
          externalId: accounts.externalId,
          accountNumber: accounts.accountNumber,
        }).from(accounts).limit(3);
        
        diagnostics.entities.accounts.count = accountsData.length;
        diagnostics.entities.accounts.sample = accountsData[0] || null;
        diagnostics.queryTimes.accounts = Date.now() - startAccounts;
        
        // Get actual count
        const countResult = await db.execute(sql`SELECT COUNT(*) as count FROM ${accounts}`);
        diagnostics.entities.accounts.totalCount = countResult.rows?.[0]?.count || 0;
        
        console.log(`[DB-DIAGNOSTIC] Accounts: ${diagnostics.entities.accounts.totalCount} total`);
      } catch (error: any) {
        diagnostics.entities.accounts.error = error.message;
        console.error('[DB-DIAGNOSTIC] Accounts query failed:', error);
      }

      try {
        const startContacts = Date.now();
        const contactsData = await db.select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
        }).from(contacts).limit(3);
        
        diagnostics.entities.contacts.count = contactsData.length;
        diagnostics.entities.contacts.sample = contactsData[0] || null;
        diagnostics.queryTimes.contacts = Date.now() - startContacts;
        
        const countResult = await db.execute(sql`SELECT COUNT(*) as count FROM ${contacts}`);
        diagnostics.entities.contacts.totalCount = countResult.rows?.[0]?.count || 0;
        
        console.log(`[DB-DIAGNOSTIC] Contacts: ${diagnostics.entities.contacts.totalCount} total`);
      } catch (error: any) {
        diagnostics.entities.contacts.error = error.message;
        console.error('[DB-DIAGNOSTIC] Contacts query failed:', error);
      }

      try {
        const startLeads = Date.now();
        const leadsData = await db.select({
          id: leads.id,
          firstName: leads.firstName,
          lastName: leads.lastName,
          email: leads.email,
        }).from(leads).limit(3);
        
        diagnostics.entities.leads.count = leadsData.length;
        diagnostics.entities.leads.sample = leadsData[0] || null;
        diagnostics.queryTimes.leads = Date.now() - startLeads;
        
        const countResult = await db.execute(sql`SELECT COUNT(*) as count FROM ${leads}`);
        diagnostics.entities.leads.totalCount = countResult.rows?.[0]?.count || 0;
        
        console.log(`[DB-DIAGNOSTIC] Leads: ${diagnostics.entities.leads.totalCount} total`);
      } catch (error: any) {
        diagnostics.entities.leads.error = error.message;
        console.error('[DB-DIAGNOSTIC] Leads query failed:', error);
      }

      try {
        const startOpportunities = Date.now();
        const opportunitiesData = await db.select({
          id: opportunities.id,
          name: opportunities.name,
          externalId: opportunities.externalId,
        }).from(opportunities).limit(3);
        
        diagnostics.entities.opportunities.count = opportunitiesData.length;
        diagnostics.entities.opportunities.sample = opportunitiesData[0] || null;
        diagnostics.queryTimes.opportunities = Date.now() - startOpportunities;
        
        const countResult = await db.execute(sql`SELECT COUNT(*) as count FROM ${opportunities}`);
        diagnostics.entities.opportunities.totalCount = countResult.rows?.[0]?.count || 0;
        
        console.log(`[DB-DIAGNOSTIC] Opportunities: ${diagnostics.entities.opportunities.totalCount} total`);
      } catch (error: any) {
        diagnostics.entities.opportunities.error = error.message;
        console.error('[DB-DIAGNOSTIC] Opportunities query failed:', error);
      }

      try {
        const startActivities = Date.now();
        const activitiesData = await db.select({
          id: activities.id,
          subject: activities.subject,
          type: activities.type,
        }).from(activities).limit(3);
        
        diagnostics.entities.activities.count = activitiesData.length;
        diagnostics.entities.activities.sample = activitiesData[0] || null;
        diagnostics.queryTimes.activities = Date.now() - startActivities;
        
        const countResult = await db.execute(sql`SELECT COUNT(*) as count FROM ${activities}`);
        diagnostics.entities.activities.totalCount = countResult.rows?.[0]?.count || 0;
        
        console.log(`[DB-DIAGNOSTIC] Activities: ${diagnostics.entities.activities.totalCount} total`);
      } catch (error: any) {
        diagnostics.entities.activities.error = error.message;
        console.error('[DB-DIAGNOSTIC] Activities query failed:', error);
      }

      console.log('[DB-DIAGNOSTIC] Database diagnostics complete');
      console.log('=== END DATABASE DIAGNOSTICS ===\n');

      return res.json(diagnostics);
    } catch (error: any) {
      console.error('[DB-DIAGNOSTIC] Unexpected error:', error);
      console.log('=== END DATABASE DIAGNOSTICS (ERROR) ===\n');
      return res.status(500).json({ 
        error: "Database diagnostics failed", 
        details: error.message 
      });
    }
  });
  
  // ========== CSV EXPORT ROUTES ==========
  
  // Helper function to convert array of objects to CSV
  function arrayToCSV(data: any[], headers: string[]): string {
    if (data.length === 0) {
      return headers.join(",") + "\n";
    }
    
    const csvRows = [];
    
    // Add header row
    csvRows.push(headers.join(","));
    
    // Add data rows
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return "";
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        const stringValue = String(value);
        if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      csvRows.push(values.join(","));
    }
    
    return csvRows.join("\n");
  }
  
  app.get("/api/export/accounts", authenticate, requirePermission("Account", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const accounts = await storage.getAllAccounts();
      
      const headers = [
        "id", "name", "accountNumber", "type", "category", "industry", "website", "phone",
        "primaryContactName", "primaryContactEmail", "billingAddress", "shippingAddress",
        "externalId", "sourceSystem", "sourceRecordId", "importStatus", "importNotes"
      ];
      const csv = arrayToCSV(accounts, headers);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="accounts-${Date.now()}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Export accounts error:", error);
      return res.status(500).json({ error: "Failed to export accounts" });
    }
  });
  
  app.get("/api/export/contacts", authenticate, requirePermission("Contact", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const contacts = await storage.getAllContacts();
      
      // Get account names for reference
      const accounts = await storage.getAllAccounts();
      const accountMap = new Map(accounts.map((a: any) => [a.id, a.name]));
      
      // Add account name to contacts
      const enrichedContacts = contacts.map((contact: any) => ({
        ...contact,
        accountName: contact.accountId ? accountMap.get(contact.accountId) : "",
      }));
      
      const headers = ["id", "firstName", "lastName", "email", "phone", "title", "accountId", "accountName", "createdAt"];
      const csv = arrayToCSV(enrichedContacts, headers);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="contacts-${Date.now()}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Export contacts error:", error);
      return res.status(500).json({ error: "Failed to export contacts" });
    }
  });
  
  app.get("/api/export/leads", authenticate, requirePermission("Lead", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const leads = await storage.getAllLeads();
      
      const headers = ["id", "firstName", "lastName", "company", "email", "phone", "topic", "status", "source", "externalId", "sourceSystem", "sourceRecordId", "importStatus", "importNotes", "ownerId", "convertedAccountId", "convertedContactId", "convertedOpportunityId", "convertedAt", "createdAt"];
      const csv = arrayToCSV(leads, headers);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="leads-${Date.now()}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Export leads error:", error);
      return res.status(500).json({ error: "Failed to export leads" });
    }
  });
  
  app.get("/api/export/opportunities", authenticate, requirePermission("Opportunity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const opportunities = await storage.getAllOpportunities();
      
      // Get account names for reference
      const accounts = await storage.getAllAccounts();
      const accountMap = new Map(accounts.map((a: any) => [a.id, a.name]));
      
      // Add account name to opportunities
      const enrichedOpportunities = opportunities.map((opp: any) => ({
        ...opp,
        accountName: opp.accountId ? accountMap.get(opp.accountId) : "",
      }));
      
      const headers = ["id", "name", "accountId", "accountName", "amount", "stage", "probability", "closeDate", "ownerId", "createdAt"];
      const csv = arrayToCSV(enrichedOpportunities, headers);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="opportunities-${Date.now()}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Export opportunities error:", error);
      return res.status(500).json({ error: "Failed to export opportunities" });
    }
  });
  
  app.get("/api/export/activities", authenticate, requirePermission("Activity", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const activities = await storage.getAllActivities();
      
      const headers = ["id", "type", "subject", "description", "dueDate", "status", "priority", "relatedToType", "relatedToId", "assignedToId", "createdAt"];
      const csv = arrayToCSV(activities, headers);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="activities-${Date.now()}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Export activities error:", error);
      return res.status(500).json({ error: "Failed to export activities" });
    }
  });
  
  // ========== CSV IMPORT ROUTES ==========
  
  app.post("/api/import/accounts", authenticate, requirePermission("Account", "create"), crudRateLimiter, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      // Parse CSV
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as unknown[];
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      // Process each record
      for (let i = 0; i < records.length; i++) {
        const rawRow = records[i];
        try {
          // Validate and parse CSV row with Zod schema
          const row = accountCsvRowSchema.parse(rawRow);
          
          // Prepare account data
          const accountData: any = {
            id: row.id,
            name: row.name,
            accountNumber: row.accountNumber || "",
            type: row.type || null,
            category: row.category || "",
            industry: row.industry || "",
            website: row.website || "",
            phone: row.phone || "",
            primaryContactName: row.primaryContactName || "",
            primaryContactEmail: row.primaryContactEmail || "",
            billingAddress: row.billingAddress || "",
            shippingAddress: row.shippingAddress || "",
            externalId: row.externalId || "",
            sourceSystem: row.sourceSystem || "",
            sourceRecordId: row.sourceRecordId || "",
            importStatus: row.importStatus || "",
            importNotes: row.importNotes || "",
            ownerId: req.user!.id,
          };
          
          // Check for duplicate by externalId
          if (accountData.externalId && accountData.externalId.trim() !== "") {
            const [existingByExternalId] = await db.select()
              .from(accounts)
              .where(eq(accounts.externalId, accountData.externalId))
              .limit(1);
            
            if (existingByExternalId) {
              results.skipped++;
              continue;
            }
          }
          
          // Also check by ID if provided
          if (accountData.id && accountData.id.trim() !== "") {
            const existingById = await storage.getAccountById(accountData.id);
            if (existingById) {
              results.skipped++;
              continue;
            }
          }
          
          // Validate with schema
          const validated = insertAccountSchema.parse(accountData);
          
          // Create account
          await storage.createAccount(validated);
          await createAudit(req, "import", "Account", validated.id, null, validated);
          
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 2, // +2 because CSV has header row and arrays are 0-indexed
            error: error.message,
            data: rawRow,
          });
        }
      }
      
      return res.json(results);
    } catch (error: any) {
      console.error("Import accounts error:", error);
      return res.status(500).json({ error: "Failed to import accounts", details: error.message });
    }
  });
  
  app.post("/api/import/contacts", authenticate, requirePermission("Contact", "create"), crudRateLimiter, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as unknown[];
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      for (let i = 0; i < records.length; i++) {
        const rawRow = records[i];
        try {
          // Validate and parse CSV row with Zod schema
          const row = contactCsvRowSchema.parse(rawRow);
          
          const contactData: any = {
            id: row.id,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            phone: row.phone,
            title: row.title,
            accountId: row.accountId,
            externalId: row.externalId,
            sourceSystem: row.sourceSystem,
            sourceRecordId: row.sourceRecordId,
            importStatus: row.importStatus,
            importNotes: row.importNotes,
            ownerId: req.user!.id,
          };
          
          // Check for duplicate by externalId
          if (contactData.externalId) {
            const [existingByExternalId] = await db.select()
              .from(contacts)
              .where(eq(contacts.externalId, contactData.externalId))
              .limit(1);
            
            if (existingByExternalId) {
              results.skipped++;
              continue;
            }
          }
          
          // Also check by ID if provided
          if (contactData.id && contactData.id.trim() !== "") {
            const existingById = await storage.getContactById(contactData.id);
            if (existingById) {
              results.skipped++;
              continue;
            }
          }
          
          // Validate accountId exists if provided
          if (contactData.accountId) {
            const account = await storage.getAccountById(contactData.accountId);
            if (!account) {
              throw new Error(`Account ID '${contactData.accountId}' does not exist. Please import accounts first or use a valid Account ID.`);
            }
          }
          
          const validated = insertContactSchema.parse(contactData);
          await storage.createContact(validated);
          await createAudit(req, "import", "Contact", validated.id, null, validated);
          
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 2,
            error: error.message,
            data: rawRow,
          });
        }
      }
      
      return res.json(results);
    } catch (error: any) {
      console.error("Import contacts error:", error);
      return res.status(500).json({ error: "Failed to import contacts", details: error.message });
    }
  });
  
  app.post("/api/import/leads", authenticate, requirePermission("Lead", "create"), crudRateLimiter, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as unknown[];
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      for (let i = 0; i < records.length; i++) {
        const rawRow = records[i];
        try {
          // Validate and parse CSV row with Zod schema
          const row = leadCsvRowSchema.parse(rawRow);
          
          // Validate enum values before parsing
          const validStatuses = ["new", "contacted", "qualified", "unqualified", "converted"];
          const validSources = ["website", "referral", "phone", "email", "event", "partner", "other"];
          
          if (row.status && !validStatuses.includes(row.status.toLowerCase())) {
            throw new Error(`Invalid status: "${row.status}". Expected one of: ${validStatuses.join(", ")}. Note: values must be lowercase.`);
          }
          
          if (row.source && !validSources.includes(row.source.toLowerCase())) {
            throw new Error(`Invalid source: "${row.source}". Expected one of: ${validSources.join(", ")}. Note: values must be lowercase.`);
          }
          
          const leadData: any = {
            id: row.id,
            firstName: row.firstName,
            lastName: row.lastName,
            company: row.company,
            email: row.email,
            phone: row.phone,
            topic: row.topic,
            status: row.status?.toLowerCase() || "new",
            source: row.source?.toLowerCase() || "other",
            ownerId: req.user!.id,
            externalId: row.externalId,
            sourceSystem: row.sourceSystem,
            sourceRecordId: row.sourceRecordId,
            importStatus: row.importStatus,
            importNotes: row.importNotes,
          };
          
          // Check for duplicate by externalId
          if (leadData.externalId) {
            const [existingByExternalId] = await db.select()
              .from(leads)
              .where(eq(leads.externalId, leadData.externalId))
              .limit(1);
            
            if (existingByExternalId) {
              results.skipped++;
              continue;
            }
          }
          
          // Also check by ID if provided
          if (leadData.id && leadData.id.trim() !== "") {
            const existingById = await storage.getLeadById(leadData.id);
            if (existingById) {
              results.skipped++;
              continue;
            }
          }
          
          const validated = insertLeadSchema.parse(leadData);
          await storage.createLead(validated);
          await createAudit(req, "import", "Lead", validated.id, null, validated);
          
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 2,
            error: error.message,
            data: rawRow,
          });
        }
      }
      
      return res.json(results);
    } catch (error: any) {
      console.error("Import leads error:", error);
      return res.status(500).json({ error: "Failed to import leads", details: error.message });
    }
  });
  
  app.post("/api/import/opportunities", authenticate, requirePermission("Opportunity", "create"), crudRateLimiter, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as unknown[];
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      for (let i = 0; i < records.length; i++) {
        const rawRow = records[i];
        try {
          // Validate and parse CSV row with Zod schema
          const row = opportunityCsvRowSchema.parse(rawRow);
          
          const parseDate = (dateStr: string | null | undefined): Date | null => {
            if (!dateStr || dateStr.trim() === "") return null;
            const parsed = new Date(dateStr);
            return isNaN(parsed.getTime()) ? null : parsed;
          };
          
          // Map Dynamics status to CRM stage
          // Status and stage are the same concept - Dynamics uses "status", we use "stage"
          const validStages = ["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"];
          let stage = "prospecting"; // default
          
          // If status is provided and is a valid stage value, use it
          if (row.status && validStages.includes(row.status.toLowerCase())) {
            stage = row.status.toLowerCase();
          }
          // Otherwise use stage if provided and valid
          else if (row.stage && validStages.includes(row.stage.toLowerCase())) {
            stage = row.stage.toLowerCase();
          }
          
          const oppData: any = {
            id: row.id,
            name: row.name,
            accountId: row.accountId,
            stage: stage,
            amount: row.amount ? String(row.amount) : "0",
            probability: row.probability ? Number(row.probability) : 0,
            closeDate: parseDate(row.closeDate),
            ownerId: req.user!.id,
            status: row.status,
            actualCloseDate: parseDate(row.actualCloseDate),
            actualRevenue: row.actualRevenue ? String(row.actualRevenue) : null,
            estCloseDate: parseDate(row.estCloseDate),
            estRevenue: row.estRevenue ? String(row.estRevenue) : null,
            rating: row.rating,
            externalId: row.externalId,
            sourceSystem: row.sourceSystem,
            sourceRecordId: row.sourceRecordId,
            importStatus: row.importStatus,
            importNotes: row.importNotes,
          };
          
          // Check for duplicate by externalId
          if (oppData.externalId) {
            const [existingByExternalId] = await db.select()
              .from(opportunities)
              .where(eq(opportunities.externalId, oppData.externalId))
              .limit(1);
            
            if (existingByExternalId) {
              results.skipped++;
              continue;
            }
          }
          
          // Also check by ID if provided
          if (oppData.id && oppData.id.trim() !== "") {
            const existingById = await storage.getOpportunityById(oppData.id);
            if (existingById) {
              results.skipped++;
              continue;
            }
          }
          
          const validated = insertOpportunitySchema.parse(oppData);
          await storage.createOpportunity(validated);
          await createAudit(req, "import", "Opportunity", validated.id, null, validated);
          
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 2,
            error: error.message,
            data: rawRow,
          });
        }
      }
      
      return res.json(results);
    } catch (error: any) {
      console.error("Import opportunities error:", error);
      return res.status(500).json({ error: "Failed to import opportunities", details: error.message });
    }
  });
  
  app.post("/api/import/activities", authenticate, requirePermission("Activity", "create"), crudRateLimiter, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as unknown[];
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      // Helper function to parse Dynamics date format (M/D/YY H:MM) to ISO
      const parseDynamicsDate = (dateStr: string | null | undefined): Date | null => {
        if (!dateStr || dateStr.trim() === "") return null;
        
        try {
          // Handle format: "8/12/24 11:33" or "1/10/25 16:07"
          const parts = dateStr.trim().split(" ");
          if (parts.length !== 2) return null;
          
          const [datePart, timePart] = parts;
          const [month, day, year] = datePart.split("/").map(Number);
          const [hour, minute] = timePart.split(":").map(Number);
          
          // Convert 2-digit year to 4-digit (assuming 20xx)
          const fullYear = year < 100 ? 2000 + year : year;
          
          // Create date object (month is 0-indexed in JS)
          const date = new Date(fullYear, month - 1, day, hour, minute, 0);
          
          // Validate the date is valid
          if (isNaN(date.getTime())) return null;
          
          return date;
        } catch (error) {
          console.error("Date parsing error:", error, "for date:", dateStr);
          return null;
        }
      };
      
      for (let i = 0; i < records.length; i++) {
        const rawRow = records[i];
        try {
          // Validate and parse CSV row with Zod schema
          const row = activityCsvRowSchema.parse(rawRow);
          
          const completedAtDate = parseDynamicsDate(row.completedAt);
          
          const activityData: any = {
            id: row.id,
            type: row.type || "task",
            subject: row.subject,
            status: "completed", // Default to completed for imported activities
            priority: "medium", // Default priority
            dueAt: completedAtDate, // Pass Date object directly to database
            completedAt: completedAtDate, // Pass Date object directly to database
            relatedType: row.relatedType,
            relatedId: row.relatedId,
            notes: row.notes,
            externalId: row.externalId,
            sourceSystem: row.sourceSystem,
            sourceRecordId: row.sourceRecordId,
            importStatus: row.importStatus,
            importNotes: row.importNotes,
            ownerId: req.user!.id,
          };
          
          // Check for duplicate by externalId (for Dynamics imports) or id
          if (activityData.externalId) {
            const [existingByExternalId] = await db.select()
              .from(activities)
              .where(eq(activities.externalId, activityData.externalId))
              .limit(1);
            
            if (existingByExternalId) {
              results.skipped++;
              continue;
            }
          }
          
          // Also check by ID if provided
          if (activityData.id) {
            const existingById = await storage.getActivityById(activityData.id);
            if (existingById) {
              results.skipped++;
              continue;
            }
          }
          
          // Skip Zod validation for import - pass Date objects directly to storage
          // The database expects Date objects for timestamp columns
          await storage.createActivity(activityData as any);
          await createAudit(req, "import", "Activity", activityData.id, null, activityData);
          
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 2,
            error: error.message,
            data: rawRow,
          });
        }
      }
      
      return res.json(results);
    } catch (error: any) {
      console.error("Import activities error:", error);
      return res.status(500).json({ error: "Failed to import activities", details: error.message });
    }
  });

  // ========== COMMENTS SYSTEM ENDPOINTS ==========

  // List comments for an entity
  app.get("/api/:entity/:id/comments", authenticate, requirePermission("Comment", "read"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { entity, id } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 25, 100);
      const sort = req.query.sort as string || "newest";
      const filter = req.query.filter as string || "all";
      const search = req.query.search as string || "";
      
      const offset = (page - 1) * pageSize;
      
      // Build query conditions - accumulate all predicates
      const conditions: any[] = [
        eq(comments.entity, entity),
        eq(comments.entityId, id),
      ];
      
      // Apply filters
      if (filter === "withAttachments") {
        const commentsWithAttachments = await db
          .select({ commentId: commentAttachments.commentId })
          .from(commentAttachments)
          .groupBy(commentAttachments.commentId);
        
        const commentIds = commentsWithAttachments.map((c: any) => c.commentId);
        if (commentIds.length === 0) {
          // No attachments exist, return empty result
          return res.json({
            comments: [],
            pagination: { page, pageSize, total: 0, totalPages: 0 },
          });
        }
        conditions.push(inArray(comments.id, commentIds));
      } else if (filter === "mentionsMe") {
        conditions.push(sql`${comments.mentions}::jsonb @> '[{"userId": "${req.user!.id}"}]'`);
      } else if (filter === "fromMe") {
        conditions.push(eq(comments.createdBy, req.user!.id));
      } else if (filter === "resolved") {
        conditions.push(eq(comments.isResolved, true));
      } else if (filter === "unresolved") {
        conditions.push(eq(comments.isResolved, false));
      }
      
      // Apply search
      if (search) {
        conditions.push(sql`${comments.body} ILIKE ${'%' + search + '%'}`);
      }
      
      // Build query with all conditions combined (only join creator, we'll load editor separately)
      const baseQuery = db
        .select({
          comment: comments,
          createdByUser: {
            id: users.id,
            name: users.name,
            email: users.email,
          },
        })
        .from(comments)
        .leftJoin(users, eq(comments.createdBy, users.id))
        .where(and(...conditions));
      
      // Apply sorting
      let query = baseQuery;
      if (sort === "oldest") {
        query = query.orderBy(asc(comments.createdAt));
      } else {
        query = query.orderBy(desc(comments.createdAt));
      }
      
      // Apply pagination
      const results = await query.limit(pageSize).offset(offset);
      
      // Batch load reactions, attachments, replies, and editors to avoid N+1
      const commentIds = results.map((r: any) => r.comment.id);
      const editorIds = results
        .map((r: any) => r.comment.editedBy)
        .filter((id: any): id is string => id !== null);
      
      const [allReactions, allAttachments, allReplyCounts, editors] = await Promise.all([
        commentIds.length > 0
          ? db.select().from(commentReactions).where(inArray(commentReactions.commentId, commentIds))
          : Promise.resolve([]),
        commentIds.length > 0
          ? db.select().from(commentAttachments).where(inArray(commentAttachments.commentId, commentIds))
          : Promise.resolve([]),
        commentIds.length > 0
          ? db.select({ 
              parentId: comments.parentId, 
              count: sql<number>`count(*)` 
            })
            .from(comments)
            .where(inArray(comments.parentId, commentIds))
            .groupBy(comments.parentId)
          : Promise.resolve([]),
        editorIds.length > 0
          ? db.select({ 
              id: users.id, 
              name: users.name, 
              email: users.email 
            })
            .from(users)
            .where(inArray(users.id, editorIds))
          : Promise.resolve([]),
      ]);
      
      // Group data by comment ID and user ID
      const reactionsByComment = new Map<string, typeof allReactions>();
      const attachmentsByComment = new Map<string, typeof allAttachments>();
      const repliesByComment = new Map<string, number>();
      const editorsByUserId = new Map<string, typeof editors[0]>();
      
      for (const reaction of allReactions) {
        if (!reactionsByComment.has(reaction.commentId)) {
          reactionsByComment.set(reaction.commentId, []);
        }
        reactionsByComment.get(reaction.commentId)!.push(reaction);
      }
      
      for (const attachment of allAttachments) {
        if (!attachmentsByComment.has(attachment.commentId)) {
          attachmentsByComment.set(attachment.commentId, []);
        }
        attachmentsByComment.get(attachment.commentId)!.push(attachment);
      }
      
      for (const replyCount of allReplyCounts) {
        if (replyCount.parentId) {
          repliesByComment.set(replyCount.parentId, Number(replyCount.count));
        }
      }
      
      for (const editor of editors) {
        editorsByUserId.set(editor.id, editor);
      }
      
      // Enrich comments with loaded data
      const enrichedComments = results.map((result: any) => {
        const reactionsData = reactionsByComment.get(result.comment.id) || [];
        
        // Aggregate reactions
        const reactions: Record<string, number> = {};
        for (const reaction of reactionsData) {
          reactions[reaction.emoji] = (reactions[reaction.emoji] || 0) + 1;
        }
        
        // Find user's reaction
        const userReaction = reactionsData.find((r: any) => r.userId === req.user!.id)?.emoji || null;
        
        // Get editor info
        const editedByUser = result.comment.editedBy 
          ? editorsByUserId.get(result.comment.editedBy) || null
          : null;
        
        return {
          ...result.comment,
          createdByUser: result.createdByUser,
          editedByUser,
          attachments: attachmentsByComment.get(result.comment.id) || [],
          reactions,
          replyCount: repliesByComment.get(result.comment.id) || 0,
          userReaction,
        };
      });
      
      // Get total count with same conditions
      const [{ count: total }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(comments)
        .where(and(...conditions));
      
      return res.json({
        comments: enrichedComments,
        pagination: {
          page,
          pageSize,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / pageSize),
        },
      });
    } catch (error: any) {
      console.error("List comments error:", error);
      return res.status(500).json({ error: "Failed to list comments", details: error.message });
    }
  });

  // Create a new comment
  app.post("/api/:entity/:id/comments", authenticate, requirePermission("Comment", "create"), crudRateLimiter, async (req: AuthRequest, res) => {
    try{
      
      const { entity, id } = req.params;
      const { body, parentId, mentions } = req.body;
      
      // Calculate depth if reply
      let depth = 0;
      if (parentId) {
        const [parentComment] = await db.select().from(comments).where(eq(comments.id, parentId)).limit(1);
        if (parentComment) {
          depth = parentComment.depth + 1;
          if (depth > 2) {
            return res.status(400).json({ error: "Maximum comment depth exceeded" });
          }
        }
      }
      
      const [newComment] = await db.insert(comments).values({
        entity,
        entityId: id,
        body,
        parentId: parentId || null,
        depth,
        mentions: mentions || [],
        createdBy: req.user!.id,
      }).returning();
      
      await createAudit(req, "create", "Comment", newComment.id, null, newComment);
      
      return res.status(201).json(newComment);
    } catch (error: any) {
      console.error("Create comment error:", error);
      return res.status(500).json({ error: "Failed to create comment", details: error.message });
    }
  });

  // Update a comment
  app.patch("/api/:entity/:id/comments/:commentId", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { commentId } = req.params;
      const { body } = req.body;
      
      // Get existing comment
      const [existingComment] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      if (!existingComment) {
        return res.status(404).json({ error: "Comment not found" });
      }
      
      // Check if user owns the comment or has update permission
      if (existingComment.createdBy !== req.user!.id) {
        const allowed = await hasPermission(req.user!.id, "Comment", "update");
        if (!allowed) {
          return res.status(403).json({ 
            error: "Forbidden",
            message: "You do not have permission to update Comment"
          });
        }
      }
      
      // Check edit window (15 minutes)
      const now = new Date();
      const createdAt = new Date(existingComment.createdAt);
      const minutesSinceCreation = (now.getTime() - createdAt.getTime()) / 1000 / 60;
      
      if (minutesSinceCreation > 15 && existingComment.createdBy === req.user!.id) {
        return res.status(403).json({ error: "Edit window has expired (15 minutes)" });
      }
      
      // Add to edit history
      const editHistory = Array.isArray(existingComment.editHistory) ? existingComment.editHistory : [];
      editHistory.push({
        at: now.toISOString(),
        by: req.user!.id,
        from: existingComment.body,
        to: body,
      });
      
      const [updatedComment] = await db.update(comments)
        .set({
          body,
          editedBy: req.user!.id,
          editHistory,
          updatedAt: now,
        })
        .where(eq(comments.id, commentId))
        .returning();
      
      await createAudit(req, "update", "Comment", commentId, existingComment, updatedComment);
      
      return res.json(updatedComment);
    } catch (error: any) {
      console.error("Update comment error:", error);
      return res.status(500).json({ error: "Failed to update comment", details: error.message });
    }
  });

  // Delete a comment
  app.delete("/api/:entity/:id/comments/:commentId", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { commentId } = req.params;
      
      const [existingComment] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      if (!existingComment) {
        return res.status(404).json({ error: "Comment not found" });
      }
      
      // Check if user owns the comment or has delete permission
      if (existingComment.createdBy !== req.user!.id) {
        const allowed = await hasPermission(req.user!.id, "Comment", "delete");
        if (!allowed) {
          return res.status(403).json({ 
            error: "Forbidden",
            message: "You do not have permission to delete Comment"
          });
        }
      }
      
      await db.delete(comments).where(eq(comments.id, commentId));
      await createAudit(req, "delete", "Comment", commentId, existingComment, null);
      
      return res.status(204).send();
    } catch (error: any) {
      console.error("Delete comment error:", error);
      return res.status(500).json({ error: "Failed to delete comment", details: error.message });
    }
  });

  // Toggle pin on a comment
  app.post("/api/:entity/:id/comments/:commentId/pin", authenticate, requirePermission("Comment", "pin"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      
      const { commentId } = req.params;
      const [existingComment] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      
      if (!existingComment) {
        return res.status(404).json({ error: "Comment not found" });
      }
      
      const [updatedComment] = await db.update(comments)
        .set({ isPinned: !existingComment.isPinned, updatedAt: new Date() })
        .where(eq(comments.id, commentId))
        .returning();
      
      await createAudit(req, existingComment.isPinned ? "unpin" : "pin", "Comment", commentId, existingComment, updatedComment);
      
      return res.json(updatedComment);
    } catch (error: any) {
      console.error("Toggle pin error:", error);
      return res.status(500).json({ error: "Failed to toggle pin", details: error.message });
    }
  });

  // Toggle resolve on a comment
  app.post("/api/:entity/:id/comments/:commentId/resolve", authenticate, requirePermission("Comment", "resolve"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      
      const { commentId } = req.params;
      const [existingComment] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      
      if (!existingComment) {
        return res.status(404).json({ error: "Comment not found" });
      }
      
      const [updatedComment] = await db.update(comments)
        .set({ isResolved: !existingComment.isResolved, updatedAt: new Date() })
        .where(eq(comments.id, commentId))
        .returning();
      
      await createAudit(req, existingComment.isResolved ? "unresolve" : "resolve", "Comment", commentId, existingComment, updatedComment);
      
      return res.json(updatedComment);
    } catch (error: any) {
      console.error("Toggle resolve error:", error);
      return res.status(500).json({ error: "Failed to toggle resolve", details: error.message });
    }
  });

  // Add/remove reaction
  app.post("/api/:entity/:id/comments/:commentId/reactions", authenticate, requirePermission("Comment", "react"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      
      const { commentId } = req.params;
      const { emoji } = req.body;
      
      if (!["👍", "❤️", "🎉", "👀", "🚀"].includes(emoji)) {
        return res.status(400).json({ error: "Invalid emoji" });
      }
      
      // Check if reaction already exists
      const [existingReaction] = await db.select()
        .from(commentReactions)
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userId, req.user!.id),
            eq(commentReactions.emoji, emoji)
          )
        )
        .limit(1);
      
      if (existingReaction) {
        // Remove reaction
        await db.delete(commentReactions).where(eq(commentReactions.id, existingReaction.id));
        return res.json({ action: "removed", emoji });
      } else {
        // Add reaction
        await db.insert(commentReactions).values({
          commentId,
          userId: req.user!.id,
          emoji,
        });
        return res.json({ action: "added", emoji });
      }
    } catch (error: any) {
      console.error("Toggle reaction error:", error);
      return res.status(500).json({ error: "Failed to toggle reaction", details: error.message });
    }
  });

  // Subscribe to comment thread
  app.post("/api/:entity/:id/comments/:commentId/subscribe", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { commentId } = req.params;
      
      // Check if already subscribed
      const [existing] = await db.select()
        .from(commentSubscriptions)
        .where(
          and(
            eq(commentSubscriptions.commentId, commentId),
            eq(commentSubscriptions.userId, req.user!.id)
          )
        )
        .limit(1);
      
      if (existing) {
        return res.json({ subscribed: true, message: "Already subscribed" });
      }
      
      await db.insert(commentSubscriptions).values({
        commentId,
        userId: req.user!.id,
      });
      
      return res.json({ subscribed: true });
    } catch (error: any) {
      console.error("Subscribe error:", error);
      return res.status(500).json({ error: "Failed to subscribe", details: error.message });
    }
  });

  // Unsubscribe from comment thread
  app.delete("/api/:entity/:id/comments/:commentId/subscribe", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { commentId } = req.params;
      
      await db.delete(commentSubscriptions)
        .where(
          and(
            eq(commentSubscriptions.commentId, commentId),
            eq(commentSubscriptions.userId, req.user!.id)
          )
        );
      
      return res.json({ subscribed: false });
    } catch (error: any) {
      console.error("Unsubscribe error:", error);
      return res.status(500).json({ error: "Failed to unsubscribe", details: error.message });
    }
  });

  // ========== ANALYTICS & FORECASTING ROUTES ==========

  // Get comprehensive forecast
  app.get("/api/analytics/forecast", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const targetDate = req.query.targetDate 
        ? new Date(req.query.targetDate as string)
        : undefined;

      const forecast = await analyticsService.calculateForecasts(targetDate);
      return res.json(forecast);
    } catch (error: any) {
      console.error("Forecast error:", error);
      return res.status(500).json({ error: "Failed to calculate forecast", details: error.message });
    }
  });

  // Get historical performance metrics
  app.get("/api/analytics/historical", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const daysBack = parseInt(req.query.days as string) || 90;
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - daysBack);

      const metrics = await analyticsService.getHistoricalMetrics({ start, end });
      return res.json(metrics);
    } catch (error: any) {
      console.error("Historical metrics error:", error);
      return res.status(500).json({ error: "Failed to get historical metrics", details: error.message });
    }
  });

  // Get pipeline velocity metrics
  app.get("/api/analytics/velocity", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const daysBack = parseInt(req.query.days as string) || 90;
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - daysBack);

      const velocity = await analyticsService.getPipelineVelocity({ start, end });
      return res.json(velocity);
    } catch (error: any) {
      console.error("Velocity error:", error);
      return res.status(500).json({ error: "Failed to calculate velocity", details: error.message });
    }
  });

  // Get stage conversion rates
  app.get("/api/analytics/conversions", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const daysBack = parseInt(req.query.days as string) || 90;
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - daysBack);

      const conversions = await analyticsService.getStageConversionRates({ start, end });
      return res.json(conversions);
    } catch (error: any) {
      console.error("Conversions error:", error);
      return res.status(500).json({ error: "Failed to calculate conversions", details: error.message });
    }
  });

  // Get deal closing predictions
  app.get("/api/analytics/predictions", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const daysAhead = parseInt(req.query.days as string) || 30;
      const predictions = await analyticsService.predictDealClosing(daysAhead);
      return res.json(predictions);
    } catch (error: any) {
      console.error("Predictions error:", error);
      return res.status(500).json({ error: "Failed to predict deal closing", details: error.message });
    }
  });

  // Get rep performance metrics
  app.get("/api/analytics/rep-performance", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const daysBack = parseInt(req.query.days as string) || 90;
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - daysBack);

      const performance = await analyticsService.getRepPerformance({ start, end });
      return res.json(performance);
    } catch (error: any) {
      console.error("Rep performance error:", error);
      return res.status(500).json({ error: "Failed to get rep performance", details: error.message });
    }
  });

  // Get pipeline health score
  app.get("/api/analytics/pipeline-health", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const health = await analyticsService.calculatePipelineHealth();
      return res.json(health);
    } catch (error: any) {
      console.error("Pipeline health error:", error);
      return res.status(500).json({ error: "Failed to calculate pipeline health", details: error.message });
    }
  });

  // ========== SALES FORECAST REPORT ==========
  
  app.get("/api/reports/sales-forecast", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { accountId, rating, startDate, endDate } = req.query;
      
      // Build filter conditions (always filter by includeInForecast = true)
      const filters: any[] = [eq(opportunities.includeInForecast, true)];
      if (accountId && typeof accountId === "string") {
        filters.push(eq(opportunities.accountId, accountId));
      }
      if (rating && typeof rating === "string") {
        filters.push(eq(opportunities.rating, rating));
      }
      if (startDate && typeof startDate === "string") {
        filters.push(gte(opportunities.closeDate, new Date(startDate)));
      }
      if (endDate && typeof endDate === "string") {
        filters.push(lte(opportunities.closeDate, new Date(endDate)));
      }
      
      // Fetch opportunities with filters (always include includeInForecast filter)
      const opps = await db.select().from(opportunities).where(and(...filters));
      
      // Fetch all accounts and users for lookups
      const [allAccounts, allUsers] = await Promise.all([
        db.select().from(accounts),
        db.select().from(users)
      ]);
      
      const accountMap = new Map(allAccounts.map((a: any) => [a.id, a.name]));
      const userMap = new Map(allUsers.map((u: any) => [u.id, u.name]));
      
      // Transform opportunities for Excel
      const oppDetails = opps.map((o: any) => ({
        "ID": o.id,
        "Name": o.name,
        "Account": accountMap.get(o.accountId) || o.accountId,
        "Stage": o.stage,
        "Amount": o.amount ? parseFloat(o.amount) : 0,
        "Probability": o.probability || 0,
        "Close Date": o.closeDate ? new Date(o.closeDate).toLocaleDateString() : "",
        "Owner": o.ownerId ? (userMap.get(o.ownerId) || o.ownerId) : "",
        "Status": o.status || "",
        "Rating": o.rating || "",
        "Created": new Date(o.createdAt).toLocaleDateString()
      }));
      
      // Calculate metrics for Executive Summary
      const totalPipeline = opps.reduce((sum: number, o: any) => sum + (o.amount ? parseFloat(o.amount) : 0), 0);
      const weightedForecast = opps.reduce((sum: number, o: any) => {
        const amount = o.amount ? parseFloat(o.amount) : 0;
        const prob = o.probability || 0;
        return sum + (amount * prob / 100);
      }, 0);
      const totalOpps = opps.length;
      const avgDealSize = totalOpps > 0 ? totalPipeline / totalOpps : 0;
      
      // Pipeline by stage
      const byStage = opps.reduce((acc: any, o: any) => {
        const stage = o.stage;
        if (!acc[stage]) {
          acc[stage] = { count: 0, amount: 0 };
        }
        acc[stage].count++;
        acc[stage].amount += o.amount ? parseFloat(o.amount) : 0;
        return acc;
      }, {} as Record<string, { count: number; amount: number }>);
      
      const stageData = Object.entries(byStage).map(([stage, data]: [string, any]) => ({
        "Stage": stage,
        "Count": data.count,
        "Total Amount": data.amount,
        "Avg Amount": data.count > 0 ? data.amount / data.count : 0
      }));
      
      // Monthly forecast
      const monthlyForecast: Record<string, { count: number; weighted: number; total: number }> = {};
      opps.forEach((o: any) => {
        if (o.closeDate) {
          const month = new Date(o.closeDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
          if (!monthlyForecast[month]) {
            monthlyForecast[month] = { count: 0, weighted: 0, total: 0 };
          }
          const amount = o.amount ? parseFloat(o.amount) : 0;
          const prob = o.probability || 0;
          monthlyForecast[month].count++;
          monthlyForecast[month].weighted += amount * prob / 100;
          monthlyForecast[month].total += amount;
        }
      });
      
      const forecastData = Object.entries(monthlyForecast)
        .map(([month, data]: [string, any]) => ({
          "Month": month,
          "Expected Contracts": data.count,
          "Weighted Revenue": data.weighted,
          "Total Pipeline": data.total,
          "Win Probability": data.total > 0 ? (data.weighted / data.total * 100).toFixed(1) + "%" : "0%"
        }))
        .sort((a, b) => new Date(a.Month).getTime() - new Date(b.Month).getTime());
      
      // Create workbook
      const wb = XLSX.utils.book_new();
      
      // Tab 1: Opportunity Details
      const ws1 = XLSX.utils.json_to_sheet(oppDetails);
      XLSX.utils.book_append_sheet(wb, ws1, "Opportunity Details");
      
      // Tab 2: Executive Summary
      const summaryData = [
        { "Metric": "Total Pipeline Value", "Value": totalPipeline.toFixed(2) },
        { "Metric": "Weighted Forecast", "Value": weightedForecast.toFixed(2) },
        { "Metric": "Total Opportunities", "Value": totalOpps },
        { "Metric": "Average Deal Size", "Value": avgDealSize.toFixed(2) },
        { "Metric": "", "Value": "" }, // Spacer
        { "Metric": "Pipeline by Stage", "Value": "" },
        ...stageData.map((d: any) => ({ "Metric": d.Stage, "Value": `${d.Count} opps, $${d['Total Amount'].toFixed(2)}` })),
        { "Metric": "", "Value": "" }, // Spacer
        { "Metric": "Top 10 Opportunities", "Value": "" },
      ];
      
      const ws2 = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws2, "Executive Summary");
      
      // Tab 3: Forecast Table
      const ws3 = XLSX.utils.json_to_sheet(forecastData);
      XLSX.utils.book_append_sheet(wb, ws3, "Revenue Forecast");
      
      // Generate buffer
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      
      // Set headers and send file
      res.setHeader("Content-Disposition", `attachment; filename="sales-forecast-${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return res.send(buffer);
      
    } catch (error: any) {
      console.error("Sales forecast report error:", error);
      return res.status(500).json({ error: "Failed to generate sales forecast report", details: error.message });
    }
  });
  
  // ========== API KEY MANAGEMENT ROUTES ==========
  
  // Get all API keys (admin only)
  app.get("/api/admin/api-keys", authenticate, requireRole("Admin"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const keys = await storage.getAllApiKeys();
      
      // Don't send hashed keys to client
      const sanitized = keys.map(k => ({
        id: k.id,
        name: k.name,
        description: k.description,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        createdBy: k.createdBy,
        revokedBy: k.revokedBy,
        revokedAt: k.revokedAt,
        createdAt: k.createdAt,
      }));
      
      return res.json(sanitized);
    } catch (error) {
      console.error("Error fetching API keys:", error);
      return res.status(500).json({ error: "Failed to fetch API keys" });
    }
  });
  
  // Generate a new API key (admin only)
  app.post("/api/admin/api-keys", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertApiKeySchema.omit({ hashedKey: true, createdBy: true }).parse(req.body);
      
      // Generate API key
      const { publicKey, hashedKey } = generateApiKey();
      
      // Store in database
      const apiKey = await storage.createApiKey({
        ...data,
        hashedKey,
        createdBy: req.user!.id,
      });
      
      // Return public key (only shown once!) and key info
      return res.json({
        apiKey: publicKey,
        id: apiKey.id,
        name: apiKey.name,
        description: apiKey.description,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
        warning: "This is the only time the API key will be shown. Please save it securely.",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      console.error("Error creating API key:", error);
      return res.status(500).json({ error: "Failed to create API key" });
    }
  });
  
  // Revoke an API key (admin only)
  app.delete("/api/admin/api-keys/:id", authenticate, requireRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      const apiKey = await storage.revokeApiKey(req.params.id, req.user!.id);
      return res.json({ success: true, apiKey });
    } catch (error) {
      console.error("Error revoking API key:", error);
      return res.status(500).json({ error: "Failed to revoke API key" });
    }
  });
  
  // Get API access logs (admin only) - for debugging external API calls
  app.get("/api/admin/api-access-logs", authenticate, requireRole("Admin"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { 
        startDate, 
        endDate, 
        apiKeyId, 
        status, 
        action,
        limit = "100",
        offset = "0" 
      } = req.query;
      
      // Build filters for external API actions only
      const filters: any[] = [];
      
      // Filter for external API actions
      filters.push(sql`${auditLogs.action} LIKE 'external_api_%'`);
      
      // Date range filter
      if (startDate) {
        filters.push(gte(auditLogs.createdAt, new Date(startDate as string)));
      }
      if (endDate) {
        filters.push(lte(auditLogs.createdAt, new Date(endDate as string)));
      }
      
      // API key filter (stored in 'after' jsonb as apiKeyName)
      if (apiKeyId) {
        filters.push(sql`${auditLogs.after}->>'apiKeyId' = ${apiKeyId}`);
      }
      
      // Status code filter (stored in 'after' jsonb)
      if (status) {
        filters.push(sql`${auditLogs.after}->>'statusCode' = ${status}`);
      }
      
      // Action type filter
      if (action) {
        filters.push(eq(auditLogs.action, action as string));
      }
      
      // Fetch logs with pagination
      const logs = await db
        .select()
        .from(auditLogs)
        .where(and(...filters))
        .orderBy(desc(auditLogs.createdAt))
        .limit(parseInt(limit as string))
        .offset(parseInt(offset as string));
      
      // Get total count for pagination
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(and(...filters));
      
      const total = Number(countResult[0]?.count || 0);
      
      return res.json({
        logs,
        pagination: {
          total,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          hasMore: parseInt(offset as string) + logs.length < total,
        }
      });
    } catch (error) {
      console.error("Error fetching API access logs:", error);
      return res.status(500).json({ error: "Failed to fetch API access logs" });
    }
  });
  
  // Export API access logs to CSV (admin only) - server-side processing for large datasets
  app.get("/api/admin/api-access-logs/export", authenticate, requireRole("Admin"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, apiKeyId, status, action } = req.query;
      
      // Build filters for external API actions only
      const filters: any[] = [];
      filters.push(sql`${auditLogs.action} LIKE 'external_api_%'`);
      
      if (startDate) {
        filters.push(gte(auditLogs.createdAt, new Date(startDate as string)));
      }
      if (endDate) {
        filters.push(lte(auditLogs.createdAt, new Date(endDate as string)));
      }
      if (apiKeyId) {
        filters.push(sql`${auditLogs.after}->>'apiKeyId' = ${apiKeyId}`);
      }
      if (status) {
        filters.push(sql`${auditLogs.after}->>'statusCode' = ${status}`);
      }
      if (action) {
        filters.push(eq(auditLogs.action, action as string));
      }
      
      // Fetch all matching logs (no pagination for export)
      const logs = await db
        .select()
        .from(auditLogs)
        .where(and(...filters))
        .orderBy(desc(auditLogs.createdAt))
        .limit(10000); // Cap at 10k rows for safety
      
      // CSV Headers
      const headers = [
        "Timestamp",
        "Action",
        "Endpoint",
        "Method",
        "Status Code",
        "API Key Name",
        "API Key ID",
        "IP Address",
        "User Agent",
        "Latency (ms)",
        "Response Size (bytes)",
        "Aborted",
        "Error Type",
        "Error Code",
        "Error Message",
        "Resource Type",
        "Resource ID",
        "Query Params"
      ];
      
      // Build CSV content
      const csvRows = [headers.join(",")];
      
      for (const log of logs) {
        const metadata = log.after || {};
        const row = [
          new Date(log.createdAt).toISOString(),
          log.action,
          metadata.endpoint || "",
          metadata.method || "",
          metadata.statusCode || "",
          metadata.apiKeyName || "",
          metadata.apiKeyId || "",
          log.ipAddress || "",
          `"${(log.userAgent || "").replace(/"/g, '""')}"`, // Escape quotes
          metadata.latency || "",
          metadata.responseSize || "",
          metadata.aborted ? "Yes" : "No",
          metadata.errorType || "",
          metadata.errorCode || "",
          `"${(metadata.errorMessage || "").replace(/"/g, '""')}"`, // Escape quotes
          metadata.resourceType || "",
          metadata.resourceId || "",
          `"${(metadata.query || "").replace(/"/g, '""')}"` // Escape quotes
        ];
        csvRows.push(row.join(","));
      }
      
      const csv = csvRows.join("\n");
      
      // Set response headers for CSV download
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="api-access-logs-${new Date().toISOString()}.csv"`);
      
      return res.send(csv);
    } catch (error) {
      console.error("Error exporting API access logs:", error);
      return res.status(500).json({ error: "Failed to export API access logs" });
    }
  });
  
  // ========== EXTERNAL API ROUTES (FOR FORECASTING APP) ==========
  // Mount external API routes under /api/v1/external
  app.use("/api/v1/external", externalApiRoutes);
}
