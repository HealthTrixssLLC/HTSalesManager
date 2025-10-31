// API routes for Health Trixss CRM
// All routes with authentication, RBAC, and audit logging

import type { Express } from "express";
import { z } from "zod";
import { storage } from "./db";
import { hashPassword, verifyPassword, generateToken, authenticate, optionalAuthenticate, type AuthRequest } from "./auth";
import { requirePermission, requireRole, DEFAULT_ROLE } from "./rbac";
import {
  insertUserSchema,
  insertAccountSchema,
  insertContactSchema,
  insertLeadSchema,
  insertOpportunitySchema,
  insertActivitySchema,
} from "@shared/schema";
import { backupService } from "./backup-service";

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
      const { createAccount, accountName, createContact, createOpportunity, opportunityName, opportunityAmount } = req.body;
      
      const lead = await storage.getLeadById(leadId);
      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }
      
      if (lead.status === "converted") {
        return res.status(400).json({ error: "Lead already converted" });
      }
      
      let accountId = null;
      let contactId = null;
      let opportunityId = null;
      
      // Create Account if requested
      if (createAccount) {
        const account = await storage.createAccount({
          id: "",
          name: accountName || lead.company || `${lead.firstName} ${lead.lastName}`,
          type: "customer",
          ownerId: lead.ownerId,
        });
        accountId = account.id;
        await createAudit(req, "create", "Account", account.id, null, account);
      }
      
      // Create Contact if requested
      if (createContact) {
        const contact = await storage.createContact({
          id: "",
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email || null,
          phone: lead.phone || null,
          accountId: accountId,
          ownerId: lead.ownerId,
        });
        contactId = contact.id;
        await createAudit(req, "create", "Contact", contact.id, null, contact);
      }
      
      // Create Opportunity if requested
      if (createOpportunity && accountId) {
        const opportunity = await storage.createOpportunity({
          id: "",
          name: opportunityName || `${lead.firstName} ${lead.lastName} - Opportunity`,
          accountId,
          stage: "prospecting",
          amount: opportunityAmount || "0",
          ownerId: lead.ownerId,
          probability: 10,
          closeDate: null,
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
      const { pattern } = req.body;
      const updatedPattern = await storage.updateIdPattern(req.params.id, { pattern });
      
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
}
