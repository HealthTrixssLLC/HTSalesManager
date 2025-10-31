// API routes for Health Trixss CRM
// All routes with authentication, RBAC, and audit logging

import type { Express } from "express";
import { z } from "zod";
import { storage, db, eq, and, sql, asc, desc, inArray } from "./db";
import { hashPassword, verifyPassword, generateToken, authenticate, optionalAuthenticate, type AuthRequest } from "./auth";
import { requirePermission, requireRole, DEFAULT_ROLE } from "./rbac";
import {
  insertUserSchema,
  insertAccountSchema,
  insertContactSchema,
  insertLeadSchema,
  insertOpportunitySchema,
  insertActivitySchema,
  insertCommentSchema,
  insertCommentReactionSchema,
  insertCommentAttachmentSchema,
  comments,
  commentReactions,
  commentAttachments,
  commentSubscriptions,
  users,
} from "@shared/schema";
import { backupService } from "./backup-service";
import multer from "multer";
import { parse } from "csv-parse/sync";

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
  
  app.post("/api/register", async (req, res) => {
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
  
  app.post("/api/login", async (req, res) => {
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
  
  app.post("/api/logout", (req, res) => {
    res.clearCookie("token");
    return res.json({ success: true });
  });
  
  app.get("/api/user", optionalAuthenticate, (req: AuthRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    return res.json(req.user);
  });
  
  // ========== ACCOUNTS ROUTES ==========
  
  app.get("/api/accounts", authenticate, requirePermission("Account", "read"), async (req: AuthRequest, res) => {
    try {
      const accounts = await storage.getAllAccounts();
      return res.json(accounts);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });
  
  app.get("/api/accounts/:id", authenticate, requirePermission("Account", "read"), async (req: AuthRequest, res) => {
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
  
  app.post("/api/accounts", authenticate, requirePermission("Account", "create"), async (req: AuthRequest, res) => {
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
  
  app.patch("/api/accounts/:id", authenticate, requirePermission("Account", "update"), async (req: AuthRequest, res) => {
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
  
  app.delete("/api/accounts/:id", authenticate, requirePermission("Account", "delete"), async (req: AuthRequest, res) => {
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
  
  // ========== CONTACTS ROUTES ==========
  
  app.get("/api/contacts", authenticate, requirePermission("Contact", "read"), async (req: AuthRequest, res) => {
    try {
      const contacts = await storage.getAllContacts();
      return res.json(contacts);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });
  
  app.post("/api/contacts", authenticate, requirePermission("Contact", "create"), async (req: AuthRequest, res) => {
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
  
  // ========== LEADS ROUTES ==========
  
  app.get("/api/leads", authenticate, requirePermission("Lead", "read"), async (req: AuthRequest, res) => {
    try {
      const leads = await storage.getAllLeads();
      return res.json(leads);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch leads" });
    }
  });
  
  app.get("/api/leads/:id", authenticate, requirePermission("Lead", "read"), async (req: AuthRequest, res) => {
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
  
  app.post("/api/leads", authenticate, requirePermission("Lead", "create"), async (req: AuthRequest, res) => {
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
  
  // Lead Conversion
  app.post("/api/leads/:id/convert", authenticate, requirePermission("Lead", "convert"), async (req: AuthRequest, res) => {
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
  
  // ========== OPPORTUNITIES ROUTES ==========
  
  app.get("/api/opportunities", authenticate, requirePermission("Opportunity", "read"), async (req: AuthRequest, res) => {
    try {
      const opportunities = await storage.getAllOpportunities();
      return res.json(opportunities);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch opportunities" });
    }
  });
  
  app.post("/api/opportunities", authenticate, requirePermission("Opportunity", "create"), async (req: AuthRequest, res) => {
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
  
  app.patch("/api/opportunities/:id", authenticate, requirePermission("Opportunity", "update"), async (req: AuthRequest, res) => {
    try {
      const before = await storage.getOpportunityById(req.params.id);
      if (!before) {
        return res.status(404).json({ error: "Opportunity not found" });
      }
      
      const opportunity = await storage.updateOpportunity(req.params.id, req.body);
      
      await createAudit(req, "update", "Opportunity", opportunity.id, before, opportunity);
      
      return res.json(opportunity);
    } catch (error) {
      return res.status(500).json({ error: "Failed to update opportunity" });
    }
  });
  
  // ========== ACTIVITIES ROUTES ==========
  
  app.get("/api/activities", authenticate, requirePermission("Activity", "read"), async (req: AuthRequest, res) => {
    try {
      const activities = await storage.getAllActivities();
      return res.json(activities);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch activities" });
    }
  });
  
  app.post("/api/activities", authenticate, requirePermission("Activity", "create"), async (req: AuthRequest, res) => {
    try {
      const data = insertActivitySchema.parse(req.body);
      const activity = await storage.createActivity(data);
      
      await createAudit(req, "create", "Activity", activity.id, null, activity);
      
      return res.json(activity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to create activity" });
    }
  });
  
  // ========== DASHBOARD ROUTES ==========
  
  app.get("/api/dashboard/stats", authenticate, async (req: AuthRequest, res) => {
    try {
      const stats = await storage.getDashboardStats();
      return res.json(stats);
    } catch (error) {
      console.error("Dashboard stats error:", error);
      return res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });
  
  app.get("/api/dashboard/sales-waterfall/:year", authenticate, async (req: AuthRequest, res) => {
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
  
  app.get("/api/audit-logs", authenticate, requirePermission("AuditLog", "read"), async (req: AuthRequest, res) => {
    try {
      const logs = await storage.getAllAuditLogs();
      return res.json(logs);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });
  
  // ========== ADMIN ROUTES ==========
  
  app.get("/api/admin/users", authenticate, requireRole("Admin"), async (req: AuthRequest, res) => {
    try {
      const users = await storage.getAllUsers();
      return res.json(users);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch users" });
    }
  });
  
  app.get("/api/admin/roles", authenticate, requireRole("Admin"), async (req: AuthRequest, res) => {
    try {
      const roles = await storage.getAllRoles();
      return res.json(roles);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch roles" });
    }
  });
  
  app.get("/api/admin/id-patterns", authenticate, requireRole("Admin"), async (req: AuthRequest, res) => {
    try {
      const patterns = await storage.getAllIdPatterns();
      return res.json(patterns);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch ID patterns" });
    }
  });
  
  app.patch("/api/admin/id-patterns/:id", authenticate, requireRole("Admin"), async (req: AuthRequest, res) => {
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
  
  app.post("/api/admin/backup", authenticate, requireRole("Admin"), async (req: AuthRequest, res) => {
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
  
  app.post("/api/admin/restore", authenticate, requireRole("Admin"), async (req: AuthRequest, res) => {
    try {
      // Expect raw binary data in request body
      const backupBuffer = req.body as Buffer;
      
      if (!backupBuffer) {
        return res.status(400).json({ error: "Missing backup data" });
      }
      
      // Encryption key is required
      const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
      if (!encryptionKey) {
        return res.status(500).json({ error: "Server configuration error: encryption key not configured" });
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
        return res.status(400).json({
          success: false,
          error: "Restore failed",
          details: result.errors,
        });
      }
    } catch (error) {
      console.error("Restore error:", error);
      return res.status(500).json({ error: "Failed to restore backup" });
    }
  });
  
  app.post("/api/admin/reset-database", authenticate, requireRole("Admin"), async (req: AuthRequest, res) => {
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
  
  app.get("/api/export/accounts", authenticate, requirePermission("Account", "read"), async (req: AuthRequest, res) => {
    try {
      const accounts = await storage.getAllAccounts();
      
      const headers = ["id", "name", "email", "phone", "address", "website", "industry", "annualRevenue", "ownerId", "createdAt"];
      const csv = arrayToCSV(accounts, headers);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="accounts-${Date.now()}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Export accounts error:", error);
      return res.status(500).json({ error: "Failed to export accounts" });
    }
  });
  
  app.get("/api/export/contacts", authenticate, requirePermission("Contact", "read"), async (req: AuthRequest, res) => {
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
  
  app.get("/api/export/leads", authenticate, requirePermission("Lead", "read"), async (req: AuthRequest, res) => {
    try {
      const leads = await storage.getAllLeads();
      
      const headers = ["id", "company", "firstName", "lastName", "email", "phone", "title", "status", "source", "ownerId", "convertedAccountId", "convertedDate", "createdAt"];
      const csv = arrayToCSV(leads, headers);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="leads-${Date.now()}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Export leads error:", error);
      return res.status(500).json({ error: "Failed to export leads" });
    }
  });
  
  app.get("/api/export/opportunities", authenticate, requirePermission("Opportunity", "read"), async (req: AuthRequest, res) => {
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
  
  app.get("/api/export/activities", authenticate, requirePermission("Activity", "read"), async (req: AuthRequest, res) => {
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
  
  app.post("/api/import/accounts", authenticate, requirePermission("Account", "create"), upload.single("file"), async (req: AuthRequest, res) => {
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
      });
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      // Process each record
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          // Prepare account data
          const accountData: any = {
            id: row.id || "", // Will be auto-generated if empty
            name: row.name,
            type: row.type || null,
            industry: row.industry || null,
            website: row.website || null,
            phone: row.phone || null,
            billingAddress: row.billingAddress || null,
            shippingAddress: row.shippingAddress || null,
            ownerId: req.user!.id,
          };
          
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
            data: row,
          });
        }
      }
      
      return res.json(results);
    } catch (error: any) {
      console.error("Import accounts error:", error);
      return res.status(500).json({ error: "Failed to import accounts", details: error.message });
    }
  });
  
  app.post("/api/import/contacts", authenticate, requirePermission("Contact", "create"), upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          const contactData: any = {
            id: row.id || "",
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email || null,
            phone: row.phone || null,
            title: row.title || null,
            accountId: row.accountId || null,
            ownerId: req.user!.id,
          };
          
          const validated = insertContactSchema.parse(contactData);
          await storage.createContact(validated);
          await createAudit(req, "import", "Contact", validated.id, null, validated);
          
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 2,
            error: error.message,
            data: row,
          });
        }
      }
      
      return res.json(results);
    } catch (error: any) {
      console.error("Import contacts error:", error);
      return res.status(500).json({ error: "Failed to import contacts", details: error.message });
    }
  });
  
  app.post("/api/import/leads", authenticate, requirePermission("Lead", "create"), upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          const leadData: any = {
            id: row.id || "",
            firstName: row.firstName,
            lastName: row.lastName,
            company: row.company || null,
            email: row.email || null,
            phone: row.phone || null,
            status: row.status || "new",
            source: row.source || "other",
            ownerId: req.user!.id,
          };
          
          const validated = insertLeadSchema.parse(leadData);
          await storage.createLead(validated);
          await createAudit(req, "import", "Lead", validated.id, null, validated);
          
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 2,
            error: error.message,
            data: row,
          });
        }
      }
      
      return res.json(results);
    } catch (error: any) {
      console.error("Import leads error:", error);
      return res.status(500).json({ error: "Failed to import leads", details: error.message });
    }
  });
  
  app.post("/api/import/opportunities", authenticate, requirePermission("Opportunity", "create"), upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          const oppData: any = {
            id: row.id || "",
            name: row.name,
            accountId: row.accountId,
            stage: row.stage || "prospecting",
            amount: row.amount ? String(row.amount) : "0",
            probability: row.probability ? Number(row.probability) : 0,
            closeDate: row.closeDate ? (row.closeDate.trim() === "" ? null : row.closeDate) : null,
            ownerId: req.user!.id,
          };
          
          const validated = insertOpportunitySchema.parse(oppData);
          await storage.createOpportunity(validated);
          await createAudit(req, "import", "Opportunity", validated.id, null, validated);
          
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 2,
            error: error.message,
            data: row,
          });
        }
      }
      
      return res.json(results);
    } catch (error: any) {
      console.error("Import opportunities error:", error);
      return res.status(500).json({ error: "Failed to import opportunities", details: error.message });
    }
  });
  
  app.post("/api/import/activities", authenticate, requirePermission("Activity", "create"), upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      
      const results = {
        total: records.length,
        success: 0,
        failed: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>,
      };
      
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          const activityData: any = {
            id: row.id || "",
            type: row.type || "task",
            subject: row.subject,
            dueAt: row.dueAt ? (row.dueAt.trim() === "" ? null : row.dueAt) : null,
            completedAt: row.completedAt ? (row.completedAt.trim() === "" ? null : row.completedAt) : null,
            relatedType: row.relatedType || null,
            relatedId: row.relatedId || null,
            notes: row.notes || null,
            ownerId: req.user!.id,
          };
          
          const validated = insertActivitySchema.parse(activityData);
          await storage.createActivity(validated);
          await createAudit(req, "import", "Activity", validated.id, null, validated);
          
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 2,
            error: error.message,
            data: row,
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
  app.get("/api/:entity/:id/comments", authenticate, requirePermission("Comment", "read"), async (req: AuthRequest, res) => {
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
        
        const commentIds = commentsWithAttachments.map(c => c.commentId);
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
      const commentIds = results.map(r => r.comment.id);
      const editorIds = results
        .map(r => r.comment.editedBy)
        .filter((id): id is string => id !== null);
      
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
      const enrichedComments = results.map((result) => {
        const reactionsData = reactionsByComment.get(result.comment.id) || [];
        
        // Aggregate reactions
        const reactions: Record<string, number> = {};
        for (const reaction of reactionsData) {
          reactions[reaction.emoji] = (reactions[reaction.emoji] || 0) + 1;
        }
        
        // Find user's reaction
        const userReaction = reactionsData.find(r => r.userId === req.user!.id)?.emoji || null;
        
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
  app.post("/api/:entity/:id/comments", authenticate, requirePermission("Comment", "create"), async (req: AuthRequest, res) => {
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
  app.patch("/api/:entity/:id/comments/:commentId", authenticate, async (req: AuthRequest, res) => {
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
        await requirePermission(req, "Comment", "update");
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
  app.delete("/api/:entity/:id/comments/:commentId", authenticate, async (req: AuthRequest, res) => {
    try {
      const { commentId } = req.params;
      
      const [existingComment] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      if (!existingComment) {
        return res.status(404).json({ error: "Comment not found" });
      }
      
      // Check if user owns the comment or has delete permission
      if (existingComment.createdBy !== req.user!.id) {
        await requirePermission(req, "Comment", "delete");
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
  app.post("/api/:entity/:id/comments/:commentId/pin", authenticate, requirePermission("Comment", "pin"), async (req: AuthRequest, res) => {
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
  app.post("/api/:entity/:id/comments/:commentId/resolve", authenticate, requirePermission("Comment", "resolve"), async (req: AuthRequest, res) => {
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
  app.post("/api/:entity/:id/comments/:commentId/reactions", authenticate, requirePermission("Comment", "react"), async (req: AuthRequest, res) => {
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
  app.post("/api/:entity/:id/comments/:commentId/subscribe", authenticate, async (req: AuthRequest, res) => {
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
  app.delete("/api/:entity/:id/comments/:commentId/subscribe", authenticate, async (req: AuthRequest, res) => {
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
}
