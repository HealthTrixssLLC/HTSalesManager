// External API routes for forecasting app integration
// Provides read-only access to accounts and opportunities data

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "./db";
import { authenticateApiKey, createApiKeyRateLimiter, ApiKeyRequest } from "./api-key-auth";

/** Extract org ID from API key (null = system key, no org restriction) */
function getKeyOrgId(req: ApiKeyRequest): string | undefined {
  return req.apiKey?.organizationId ?? undefined;
}

/** Enforce org ownership on a fetched record — returns false if cross-org */
function keyOrgOwns(record: { organizationId?: string | null } | null | undefined, orgId: string | undefined): boolean {
  if (!orgId) return true; // System key: no restriction
  if (!record) return false;
  return record.organizationId === orgId;
}

const router = Router();

// Apply API key authentication to all external routes
router.use(authenticateApiKey);

// Audit logging middleware for external API requests
// IMPORTANT: Must come BEFORE rate limiter to capture 429 responses
router.use(async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  let responseBody: any = null;
  let logged = false; // Prevent duplicate logging
  
  // Capture response details
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Override send to capture response
  res.send = function(data: any) {
    responseBody = data;
    return originalSend.call(this, data);
  };
  
  // Override json to capture response
  res.json = function(data: any) {
    responseBody = data;
    return originalJson.call(this, data);
  };
  
  // Helper to create and log audit record
  const createAuditLog = (statusCode: number, aborted: boolean = false) => {
    if (logged) return; // Prevent duplicate logging
    logged = true;
    
    const latency = Date.now() - startTime;
    const isSuccess = statusCode >= 200 && statusCode < 300;
    const isClientError = statusCode >= 400 && statusCode < 500;
    const isServerError = statusCode >= 500;
    
    // Prepare log data
    const logData: any = {
      endpoint: req.path,
      method: req.method,
      statusCode,
      latencyMs: latency,
      apiKeyName: req.apiKey?.name,
      queryParams: req.query,
      success: isSuccess,
      aborted, // Track if client disconnected early
    };
    
    // Add error details for failures
    if (isClientError || isServerError) {
      logData.errorType = isClientError ? 'client_error' : 'server_error';
      
      // Parse error from response body
      try {
        const parsedBody = typeof responseBody === 'string' 
          ? JSON.parse(responseBody) 
          : responseBody;
        
        if (parsedBody?.error) {
          logData.error = parsedBody.error;
          logData.errorMessage = parsedBody.message;
        }
      } catch (e) {
        // Response body wasn't JSON
      }
      
      // Add resource ID for 404 errors
      if (statusCode === 404 && req.params?.id) {
        logData.resourceId = req.params.id;
        logData.resourceType = req.path.includes('accounts') ? 'account' : 'opportunity';
      }
    }
    
    // Add response size (limit to 1MB for performance)
    if (responseBody) {
      const bodyString = typeof responseBody === 'string' 
        ? responseBody 
        : JSON.stringify(responseBody);
      const bodySize = Math.min(bodyString.length, 1048576); // Cap at 1MB
      logData.responseSizeBytes = bodySize;
    }
    
    // Log API request to audit log (fire and forget)
    storage.createAuditLog({
      actorId: null, // External API requests are not user-scoped
      action: isSuccess ? "external_api_request_success" : "external_api_request_failure",
      resource: "api_key",
      resourceId: req.apiKey?.id || null,
      before: null,
      after: logData,
      ipAddress: req.ip || req.connection.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    }).catch(err => {
      console.error("[EXTERNAL-API] Failed to create audit log:", err);
    });
  };
  
  // Log after response is sent (normal case)
  res.on('finish', () => {
    createAuditLog(res.statusCode, false);
  });
  
  // Log if client disconnects early (DDoS abuse, network issues, etc.)
  res.on('close', () => {
    if (!logged) {
      // Response wasn't finished - client disconnected
      createAuditLog(res.statusCode || 499, true); // 499 = Client Closed Request
    }
  });
  
  next();
});

// Apply rate limiting based on API key configuration
// Placed AFTER logging middleware so 429 responses are captured in audit logs
router.use(createApiKeyRateLimiter());

// ========== ACCOUNTS ENDPOINTS ==========

/**
 * GET /api/v1/external/accounts
 * List all accounts with optional filtering and pagination
 * 
 * Query Parameters:
 * - updatedSince: ISO 8601 timestamp (e.g., 2024-01-01T00:00:00Z)
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 * - expand: Comma-separated list of related entities to include (e.g., "opportunities")
 */
router.get("/accounts", async (req: ApiKeyRequest, res) => {
  try {
    const {
      updatedSince,
      limit = "100",
      offset = "0",
      expand = "",
    } = req.query;
    
    // Parse and validate parameters
    const limitNum = Math.min(parseInt(limit as string) || 100, 1000);
    const offsetNum = parseInt(offset as string) || 0;
    const expandList = (expand as string).split(",").filter(Boolean);
    const orgId = getKeyOrgId(req);
    
    // Get accounts scoped to the API key's org
    let accounts = await storage.getAllAccounts(orgId);
    
    // Filter by updatedSince if provided
    if (updatedSince) {
      const sinceDate = new Date(updatedSince as string);
      if (!isNaN(sinceDate.getTime())) {
        accounts = accounts.filter(a => 
          new Date(a.updatedAt) > sinceDate
        );
      }
    }
    
    // Apply pagination
    const total = accounts.length;
    const paginatedAccounts = accounts.slice(offsetNum, offsetNum + limitNum);
    
    // Prepare lean response (focused on forecasting needs)
    const response = await Promise.all(paginatedAccounts.map(async (account) => {
      const leanAccount: any = {
        id: account.id,
        name: account.name,
        accountNumber: account.accountNumber,
        type: account.type,
        category: account.category,
        ownerId: account.ownerId,
        industry: account.industry,
        externalId: account.externalId,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      };
      
      // Optionally include related opportunities (scoped to same org)
      if (expandList.includes("opportunities")) {
        const allOpps = await storage.getAllOpportunities(orgId);
        leanAccount.opportunities = allOpps
          .filter(o => o.accountId === account.id && o.includeInForecast)
          .map(o => ({
            id: o.id,
            name: o.name,
            stage: o.stage,
            amount: o.amount,
            closeDate: o.closeDate,
            probability: o.probability,
            implementationStartDate: o.implementationStartDate,
            implementationEndDate: o.implementationEndDate,
            billingEndDate: o.billingEndDate,
          }));
      }
      
      return leanAccount;
    }));
    
    return res.json({
      data: response,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total,
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching accounts:", error);
    return res.status(500).json({
      error: "Failed to fetch accounts",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * GET /api/v1/external/accounts/:id
 * Get a specific account by ID
 * 
 * Query Parameters:
 * - expand: Comma-separated list of related entities (e.g., "opportunities,contacts")
 */
router.get("/accounts/:id", async (req: ApiKeyRequest, res) => {
  try {
    const { expand = "" } = req.query;
    const expandList = (expand as string).split(",").filter(Boolean);
    const orgId = getKeyOrgId(req);
    
    const account = await storage.getAccountById(req.params.id);
    
    if (!account || !keyOrgOwns(account, orgId)) {
      return res.status(404).json({
        error: "Account not found",
        message: `No account found with ID: ${req.params.id}`
      });
    }
    
    // Lean response
    const response: any = {
      id: account.id,
      name: account.name,
      accountNumber: account.accountNumber,
      type: account.type,
      category: account.category,
      ownerId: account.ownerId,
      industry: account.industry,
      website: account.website,
      phone: account.phone,
      externalId: account.externalId,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
    
    // Optionally include related data (scoped to same org)
    if (expandList.includes("opportunities")) {
      const allOpps = await storage.getAllOpportunities(orgId);
      response.opportunities = allOpps
        .filter(o => o.accountId === account.id && o.includeInForecast)
        .map(o => ({
          id: o.id,
          name: o.name,
          stage: o.stage,
          amount: o.amount,
          closeDate: o.closeDate,
          probability: o.probability,
          rating: o.rating,
          implementationStartDate: o.implementationStartDate,
          implementationEndDate: o.implementationEndDate,
          billingEndDate: o.billingEndDate,
        }));
    }
    
    if (expandList.includes("contacts")) {
      const allContacts = await storage.getAllContacts(orgId);
      response.contacts = allContacts
        .filter(c => c.accountId === account.id)
        .map(c => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
          mobile: c.mobile,
          title: c.title,
        }));
    }
    
    return res.json({ data: response });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching account:", error);
    return res.status(500).json({
      error: "Failed to fetch account",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// ========== OPPORTUNITIES ENDPOINTS ==========

/**
 * GET /api/v1/external/opportunities
 * List all opportunities with optional filtering and pagination
 * 
 * Query Parameters:
 * - updatedSince: ISO 8601 timestamp
 * - includeInForecast: Filter by forecast inclusion (true/false/all, default: true)
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 * - expand: Comma-separated list of related entities (e.g., "account,resources")
 */
router.get("/opportunities", async (req: ApiKeyRequest, res) => {
  try {
    const {
      updatedSince,
      includeInForecast = "true",
      limit = "100",
      offset = "0",
      expand = "",
    } = req.query;
    
    // Parse parameters
    const limitNum = Math.min(parseInt(limit as string) || 100, 1000);
    const offsetNum = parseInt(offset as string) || 0;
    const expandList = (expand as string).split(",").filter(Boolean);
    const orgId = getKeyOrgId(req);
    
    // Get opportunities scoped to the API key's org
    let opportunities = await storage.getAllOpportunities(orgId);
    
    // Filter by includeInForecast (default to true for forecasting app)
    if (includeInForecast !== "all") {
      const shouldInclude = includeInForecast === "true";
      opportunities = opportunities.filter(o => o.includeInForecast === shouldInclude);
    }
    
    // Filter by updatedSince if provided
    if (updatedSince) {
      const sinceDate = new Date(updatedSince as string);
      if (!isNaN(sinceDate.getTime())) {
        opportunities = opportunities.filter(o => 
          new Date(o.updatedAt) > sinceDate
        );
      }
    }
    
    // Apply pagination
    const total = opportunities.length;
    const paginatedOpps = opportunities.slice(offsetNum, offsetNum + limitNum);
    
    // Prepare lean response
    const response = await Promise.all(paginatedOpps.map(async (opp) => {
      const leanOpp: any = {
        id: opp.id,
        accountId: opp.accountId,
        name: opp.name,
        stage: opp.stage,
        amount: opp.amount,
        closeDate: opp.closeDate,
        ownerId: opp.ownerId,
        probability: opp.probability,
        status: opp.status,
        actualCloseDate: opp.actualCloseDate,
        actualRevenue: opp.actualRevenue,
        estCloseDate: opp.estCloseDate,
        estRevenue: opp.estRevenue,
        rating: opp.rating,
        includeInForecast: opp.includeInForecast,
        implementationStartDate: opp.implementationStartDate,
        implementationEndDate: opp.implementationEndDate,
        billingEndDate: opp.billingEndDate,
        externalId: opp.externalId,
        createdAt: opp.createdAt,
        updatedAt: opp.updatedAt,
      };
      
      // Optionally include account data (only if it belongs to the same org)
      if (expandList.includes("account")) {
        const account = await storage.getAccountById(opp.accountId);
        if (account && keyOrgOwns(account, orgId)) {
          leanOpp.account = {
            id: account.id,
            name: account.name,
            accountNumber: account.accountNumber,
            type: account.type,
            category: account.category,
          };
        }
      }
      
      // Optionally include resource assignments (org-scoped via parent opportunity)
      if (expandList.includes("resources")) {
        const resources = await storage.getOpportunityResources(opp.id);
        leanOpp.resources = resources.map(r => ({
          userId: r.userId,
          role: r.role,
          allocationPercentage: r.allocation,
          startDate: r.startDate,
          endDate: r.endDate,
        }));
      }
      
      return leanOpp;
    }));
    
    return res.json({
      data: response,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total,
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching opportunities:", error);
    return res.status(500).json({
      error: "Failed to fetch opportunities",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * GET /api/v1/external/opportunities/:id
 * Get a specific opportunity by ID
 * 
 * Query Parameters:
 * - expand: Comma-separated list of related entities (e.g., "account,resources")
 */
router.get("/opportunities/:id", async (req: ApiKeyRequest, res) => {
  try {
    const { expand = "" } = req.query;
    const expandList = (expand as string).split(",").filter(Boolean);
    const orgId = getKeyOrgId(req);
    
    const opp = await storage.getOpportunityById(req.params.id);
    
    if (!opp || !keyOrgOwns(opp, orgId)) {
      return res.status(404).json({
        error: "Opportunity not found",
        message: `No opportunity found with ID: ${req.params.id}`
      });
    }
    
    // Lean response
    const response: any = {
      id: opp.id,
      accountId: opp.accountId,
      name: opp.name,
      stage: opp.stage,
      amount: opp.amount,
      closeDate: opp.closeDate,
      ownerId: opp.ownerId,
      probability: opp.probability,
      status: opp.status,
      actualCloseDate: opp.actualCloseDate,
      actualRevenue: opp.actualRevenue,
      estCloseDate: opp.estCloseDate,
      estRevenue: opp.estRevenue,
      rating: opp.rating,
      includeInForecast: opp.includeInForecast,
      implementationStartDate: opp.implementationStartDate,
      implementationEndDate: opp.implementationEndDate,
      billingEndDate: opp.billingEndDate,
      externalId: opp.externalId,
      createdAt: opp.createdAt,
      updatedAt: opp.updatedAt,
    };
    
    // Optionally include account data (only if it belongs to the same org)
    if (expandList.includes("account")) {
      const account = await storage.getAccountById(opp.accountId);
      if (account && keyOrgOwns(account, orgId)) {
        response.account = {
          id: account.id,
          name: account.name,
          accountNumber: account.accountNumber,
          type: account.type,
          category: account.category,
          industry: account.industry,
        };
      }
    }
    
    // Optionally include resource assignments (org-scoped via parent opportunity)
    if (expandList.includes("resources")) {
      const resources = await storage.getOpportunityResources(opp.id);
      response.resources = resources.map(r => ({
        userId: r.userId,
        role: r.role,
        allocationPercentage: r.allocation,
        startDate: r.startDate,
        endDate: r.endDate,
      }));
    }
    
    // Optionally include associated contacts with role and isPrimary flag
    if (expandList.includes("contacts")) {
      const links = await storage.getOpportunityContacts(opp.id);
      response.contacts = links.map(l => ({
        contactId: l.contactId,
        role: l.role,
        isPrimary: l.isPrimary,
        firstName: l.contact.firstName,
        lastName: l.contact.lastName,
        email: l.contact.email,
        phone: l.contact.phone,
        title: l.contact.title,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      }));
    }
    
    return res.json({ data: response });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching opportunity:", error);
    return res.status(500).json({
      error: "Failed to fetch opportunity",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// ========== OPPORTUNITY-CONTACT RELATIONSHIP ENDPOINTS ==========

const linkContactSchema = z.object({
  contactId: z.string().min(1, "contactId is required"),
  role: z.enum([
    "economic_buyer", "champion", "technical_contact", "contract_contact",
    "executive_sponsor", "decision_maker", "influencer", "other",
  ]),
  isPrimary: z.boolean().optional().default(false),
}).strict();

/**
 * POST /api/v1/external/opportunities/:id/contacts
 * Link a contact to an opportunity with a role (optional isPrimary flag).
 */
router.post("/opportunities/:id/contacts", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    
    const opp = await storage.getOpportunityById(req.params.id);
    if (!opp || !keyOrgOwns(opp, orgId)) {
      return res.status(404).json({
        error: "Opportunity not found",
        message: `No opportunity found with ID: ${req.params.id}`
      });
    }
    
    const parsed = linkContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors.map(e => ({ field: e.path.join("."), message: e.message })),
      });
    }
    
    // Contact must exist and be visible to the key's org
    const contact = await storage.getContactById(parsed.data.contactId);
    if (!contact || !keyOrgOwns(contact, orgId)) {
      return res.status(404).json({
        error: "Contact not found",
        message: `No contact found with ID: ${parsed.data.contactId}`
      });
    }
    
    try {
      const link = await storage.linkContactToOpportunity({
        opportunityId: opp.id,
        contactId: parsed.data.contactId,
        role: parsed.data.role,
        isPrimary: parsed.data.isPrimary,
      });
      return res.status(201).json({ data: link });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "DUPLICATE_LINK") {
        return res.status(409).json({
          error: "Contact already linked",
          message: "This contact is already linked to the opportunity"
        });
      }
      if (msg === "ORG_MISMATCH") {
        return res.status(404).json({
          error: "Contact not found",
          message: `No contact found with ID: ${parsed.data.contactId}`
        });
      }
      throw err;
    }
  } catch (error) {
    console.error("[EXTERNAL-API] Error linking contact to opportunity:", error);
    return res.status(500).json({
      error: "Failed to link contact",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * DELETE /api/v1/external/opportunities/:id/contacts/:contactId
 * Remove the opportunity-contact relationship (does not delete the contact).
 */
router.delete("/opportunities/:id/contacts/:contactId", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    
    const opp = await storage.getOpportunityById(req.params.id);
    if (!opp || !keyOrgOwns(opp, orgId)) {
      return res.status(404).json({
        error: "Opportunity not found",
        message: `No opportunity found with ID: ${req.params.id}`
      });
    }
    
    const removed = await storage.unlinkContactFromOpportunity(opp.id, req.params.contactId);
    if (!removed) {
      return res.status(404).json({
        error: "Relationship not found",
        message: "This contact is not linked to the opportunity"
      });
    }
    
    return res.status(204).send();
  } catch (error) {
    console.error("[EXTERNAL-API] Error unlinking contact from opportunity:", error);
    return res.status(500).json({
      error: "Failed to unlink contact",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// ========== CONTACTS ENDPOINTS ==========

/**
 * Format a contact record for external API responses.
 * Always includes all guaranteed fields (null when not set).
 */
function formatContactResponse(contact: any, account?: { id: string; name: string } | null) {
  const response: any = {
    id: contact.id,
    firstName: contact.firstName ?? contact.first_name ?? null,
    lastName: contact.lastName ?? contact.last_name ?? null,
    title: contact.title ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    mobile: contact.mobile ?? null,
    accountId: contact.accountId ?? contact.account_id ?? null,
    ownerId: contact.ownerId ?? contact.owner_id ?? null,
    externalId: contact.externalId ?? contact.external_id ?? null,
    createdAt: contact.createdAt ?? contact.created_at ?? null,
    updatedAt: contact.updatedAt ?? contact.updated_at ?? null,
  };
  if (account !== undefined) {
    response.account = account ? { id: account.id, name: account.name } : null;
  }
  return response;
}

/**
 * GET /api/v1/external/contacts
 * List all contacts for the API key's organization with optional filtering and pagination.
 *
 * Query Parameters:
 * - updatedSince: ISO 8601 timestamp
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 * - expand: "account" — includes { id, name } on each contact
 */
router.get("/contacts", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Contact access requires an API key bound to an organization",
      });
    }

    const { updatedSince, limit = "100", offset = "0", expand = "" } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10) || 100, 1000);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);
    const expandList = (expand as string).split(",").filter(Boolean);

    if (updatedSince && typeof updatedSince === "string") {
      const parsed = new Date(updatedSince);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({
          error: "Invalid updatedSince",
          message: "updatedSince must be a valid ISO 8601 timestamp",
        });
      }
    }

    let contacts = await storage.getAllContacts(orgId);

    // Filter by updatedSince if provided
    if (updatedSince && typeof updatedSince === "string") {
      const sinceDate = new Date(updatedSince);
      contacts = contacts.filter((c: any) => {
        const updated = c.updatedAt ?? c.updated_at;
        return updated ? new Date(updated) > sinceDate : false;
      });
    }

    const total = contacts.length;
    const page = contacts.slice(offsetNum, offsetNum + limitNum);

    // Optionally expand account (lean { id, name } per contact)
    let accountCache: Map<string, { id: string; name: string } | null> | null = null;
    if (expandList.includes("account")) {
      accountCache = new Map();
    }

    const data = await Promise.all(page.map(async (contact: any) => {
      let account: { id: string; name: string } | null | undefined = undefined;
      if (accountCache !== null) {
        const acctId = contact.accountId ?? contact.account_id;
        if (acctId) {
          if (!accountCache.has(acctId)) {
            const acct = await storage.getAccountById(acctId);
            accountCache.set(acctId, acct && keyOrgOwns(acct, orgId) ? { id: acct.id, name: acct.name } : null);
          }
          account = accountCache.get(acctId) ?? null;
        } else {
          account = null;
        }
      }
      return formatContactResponse(contact, account);
    }));

    return res.json({
      data,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + page.length < total,
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching contacts:", error);
    return res.status(500).json({
      error: "Failed to fetch contacts",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/v1/external/contacts/:id
 * Fetch a single contact by ID (org-scoped).
 *
 * Query Parameters:
 * - expand: "account" — includes { id, name } on the contact
 */
router.get("/contacts/:id", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Contact access requires an API key bound to an organization",
      });
    }

    const { expand = "" } = req.query;
    const expandList = (expand as string).split(",").filter(Boolean);

    const contact = await storage.getContactById(req.params.id);
    if (!contact || !keyOrgOwns(contact, orgId)) {
      return res.status(404).json({
        error: "Contact not found",
        message: `No contact found with ID: ${req.params.id}`,
      });
    }

    let account: { id: string; name: string } | null | undefined = undefined;
    if (expandList.includes("account")) {
      const acctId = contact.accountId;
      if (acctId) {
        const acct = await storage.getAccountById(acctId);
        account = acct && keyOrgOwns(acct, orgId) ? { id: acct.id, name: acct.name } : null;
      } else {
        account = null;
      }
    }

    return res.json({ data: formatContactResponse(contact, account) });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching contact:", error);
    return res.status(500).json({
      error: "Failed to fetch contact",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ========== AUDIT LOGS ENDPOINT ==========

/**
 * GET /api/v1/external/logs
 * Access audit logs for debugging and monitoring (programmatic access with API key)
 * 
 * Query Parameters:
 * - startDate: ISO 8601 timestamp (e.g., 2024-01-01T00:00:00Z)
 * - endDate: ISO 8601 timestamp
 * - status: HTTP status code (e.g., 200, 401, 404, 429, 500)
 * - action: Action type filter (auth_success, auth_failure, request_success, request_failure)
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 */
router.get("/logs", async (req: ApiKeyRequest, res) => {
  try {
    const {
      startDate,
      endDate,
      status,
      action,
      limit = "100",
      offset = "0",
    } = req.query;
    
    // Import database utilities
    const { db, sql, and, gte, lte, eq, desc } = await import("./db");
    const { auditLogs } = await import("@shared/schema");
    
    // CRITICAL SECURITY: API key must be present (authentication required)
    if (!req.apiKey?.id) {
      return res.status(403).json({
        error: "Forbidden",
        message: "API key authentication required"
      });
    }
    
    // Validate and parse parameters
    const limitNum = Math.min(parseInt(limit as string, 10) || 100, 1000);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);
    
    // Validate date parameters (strict ISO 8601)
    if (startDate && typeof startDate === 'string') {
      const parsed = new Date(startDate);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({
          error: "Invalid startDate",
          message: "startDate must be valid ISO 8601 timestamp"
        });
      }
    }
    if (endDate && typeof endDate === 'string') {
      const parsed = new Date(endDate);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({
          error: "Invalid endDate",
          message: "endDate must be valid ISO 8601 timestamp"
        });
      }
    }
    
    // Validate status parameter (must be valid HTTP status code)
    if (status && typeof status === 'string') {
      const statusNum = parseInt(status, 10);
      if (isNaN(statusNum) || statusNum < 100 || statusNum > 599) {
        return res.status(400).json({
          error: "Invalid status",
          message: "status must be valid HTTP status code (100-599)"
        });
      }
    }
    
    // Validate action parameter (must be from allowed list)
    if (action && typeof action === 'string') {
      const allowedActions = ['auth_success', 'auth_failure', 'request_success', 'request_failure'];
      if (!allowedActions.includes(action)) {
        return res.status(400).json({
          error: "Invalid action",
          message: `action must be one of: ${allowedActions.join(', ')}`
        });
      }
    }
    
    // Build filters for external API actions only
    const filters: any[] = [];
    filters.push(sql`${auditLogs.action} LIKE 'external_api_%'`);
    
    // CRITICAL SECURITY: Only show logs for THIS API key (resourceId = API key ID)
    filters.push(eq(auditLogs.resourceId, req.apiKey.id));
    
    // Date range filter
    if (startDate && typeof startDate === 'string') {
      const startDateTime = new Date(startDate);
      filters.push(gte(auditLogs.createdAt, startDateTime));
    }
    if (endDate && typeof endDate === 'string') {
      const endDateTime = new Date(endDate);
      filters.push(lte(auditLogs.createdAt, endDateTime));
    }
    
    // Status code filter
    if (status) {
      filters.push(sql`${auditLogs.after}->>'statusCode' = ${status as string}`);
    }
    
    // Action type filter (allow simplified names)
    if (action && typeof action === 'string') {
      const actionMap: Record<string, string> = {
        'auth_success': 'external_api_auth_success',
        'auth_failure': 'external_api_auth_failure',
        'request_success': 'external_api_request_success',
        'request_failure': 'external_api_request_failure',
      };
      const fullAction = actionMap[action];
      filters.push(eq(auditLogs.action, fullAction));
    }
    
    // Fetch logs with pagination
    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(...filters))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitNum)
      .offset(offsetNum);
    
    // Get total count for pagination
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(and(...filters));
    
    const total = Number(countResult[0]?.count || 0);
    
    // Format logs for API response
    const formattedLogs = logs.map((log: any) => {
      const metadata = log.after || {};
      return {
        timestamp: log.createdAt,
        action: log.action,
        endpoint: metadata.endpoint || null,
        method: metadata.method || null,
        statusCode: metadata.statusCode || null,
        latencyMs: metadata.latencyMs || null,
        responseSizeBytes: metadata.responseSizeBytes || null,
        aborted: metadata.aborted || false,
        errorType: metadata.errorType || null,
        errorCode: metadata.errorCode || null,
        errorMessage: metadata.errorMessage || null,
        resourceType: metadata.resourceType || null,
        resourceId: metadata.resourceId || null,
        queryParams: metadata.queryParams || null,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
      };
    });
    
    return res.json({
      data: formattedLogs,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + logs.length < total,
      }
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching logs:", error);
    return res.status(500).json({
      error: "Failed to fetch logs",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// ========== LEAD CREATION ENDPOINTS ==========

// Validation schema for external lead submissions
const externalLeadSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(200),
  lastName: z.string().trim().min(1, "Last name is required").max(200),
  email: z.string().trim().email("Invalid email address").max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(300).optional(),
  title: z.string().trim().max(200).optional(),
  topic: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  source: z.enum(["website", "referral", "phone", "email", "event", "partner", "lead_generation", "other"]).optional(),
  rating: z.enum(["hot", "warm", "cold"]).optional(),
}).strict();

/** Format a lead for external API responses.
 * Handles both camelCase (Drizzle select) and snake_case (raw SQL) row shapes. */
function formatLeadResponse(lead: any, orgName: string | null) {
  return {
    id: lead.id,
    firstName: lead.firstName ?? lead.first_name ?? null,
    lastName: lead.lastName ?? lead.last_name ?? null,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    title: lead.title,
    topic: lead.topic,
    status: lead.status,
    source: lead.source,
    rating: lead.rating,
    organizationId: lead.organizationId ?? lead.organization_id ?? null,
    organizationName: orgName,
    createdAt: lead.createdAt ?? lead.created_at ?? null,
    updatedAt: lead.updatedAt ?? lead.updated_at ?? null,
  };
}

/**
 * POST /api/v1/external/leads
 * Create a new lead. Requires an organization-bound API key.
 * The lead is always assigned to the API key's organization.
 * If a lead with the same email already exists in the organization,
 * no duplicate is created — the existing lead is returned with duplicate: true.
 */
router.post("/leads", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Lead creation requires an API key bound to an organization. Ask your CRM administrator to create an organization-scoped API key in the Admin Console.",
      });
    }

    const parsed = externalLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        message: "The lead payload is invalid",
        details: parsed.error.errors.map(e => ({
          field: e.path.join(".") || "(root)",
          message: e.message,
        })),
      });
    }
    const data = parsed.data;

    const organization = await storage.getOrganizationById(orgId);
    if (!organization) {
      return res.status(403).json({
        error: "Invalid organization",
        message: "The organization bound to this API key no longer exists",
      });
    }

    // Duplicate detection: same email within the same organization
    if (data.email) {
      const existingLeads = await storage.getAllLeads(orgId);
      const emailLower = data.email.toLowerCase();
      const duplicate = existingLeads.find(
        (l: any) => l.email && l.email.toLowerCase() === emailLower
      );
      if (duplicate) {
        return res.status(200).json({
          duplicate: true,
          message: "A lead with this email already exists in the organization. No new lead was created.",
          data: formatLeadResponse(duplicate, organization.name),
        });
      }
    }

    let lead;
    try {
      lead = await storage.createLead({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        company: data.company ?? null,
        title: data.title ?? null,
        topic: data.topic ?? data.notes ?? null,
        source: data.source ?? null,
        rating: data.rating ?? null,
        status: "new",
        organizationId: orgId,
        sourceSystem: `External API (${req.apiKey?.name || "unknown key"})`,
      } as any);
    } catch (createError: any) {
      // Unique index violation (leads_org_email_unique_idx): another request
      // with the same email won the race. Return the existing lead instead of a 500.
      const isUniqueViolation =
        createError?.code === "23505" ||
        createError?.cause?.code === "23505" ||
        /duplicate key value/i.test(createError?.message || "");
      if (isUniqueViolation && data.email) {
        const existingLeads = await storage.getAllLeads(orgId);
        const emailLower = data.email.toLowerCase();
        const existing = existingLeads.find(
          (l: any) => l.email && l.email.toLowerCase() === emailLower
        );
        if (existing) {
          return res.status(200).json({
            duplicate: true,
            message: "A lead with this email already exists in the organization. No new lead was created.",
            data: formatLeadResponse(existing, organization.name),
          });
        }
      }
      throw createError;
    }

    return res.status(201).json({
      duplicate: false,
      data: formatLeadResponse(lead, organization.name),
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error creating lead:", error);
    return res.status(500).json({
      error: "Failed to create lead",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/v1/external/leads
 * List leads for the API key's organization (read-back/confirmation).
 * Query params: updatedSince (ISO 8601), limit (default 100, max 1000), offset
 */
router.get("/leads", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Lead access requires an API key bound to an organization",
      });
    }

    const { updatedSince, limit = "100", offset = "0" } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10) || 100, 1000);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);

    const organization = await storage.getOrganizationById(orgId);
    let leads = await storage.getAllLeads(orgId);

    if (updatedSince && typeof updatedSince === "string") {
      const sinceDate = new Date(updatedSince);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({
          error: "Invalid updatedSince",
          message: "updatedSince must be a valid ISO 8601 timestamp",
        });
      }
      leads = leads.filter((l: any) => {
        const updated = l.updatedAt ?? l.updated_at;
        return updated ? new Date(updated) > sinceDate : false;
      });
    }

    const total = leads.length;
    const page = leads.slice(offsetNum, offsetNum + limitNum);

    return res.json({
      data: page.map((l: any) => formatLeadResponse(l, organization?.name ?? null)),
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + page.length < total,
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching leads:", error);
    return res.status(500).json({
      error: "Failed to fetch leads",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/v1/external/leads/:id
 * Fetch a single lead by ID (org-scoped).
 */
router.get("/leads/:id", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Lead access requires an API key bound to an organization",
      });
    }

    const lead = await storage.getLeadById(req.params.id);
    if (!lead || !keyOrgOwns(lead, orgId)) {
      return res.status(404).json({
        error: "Lead not found",
        message: `No lead found with ID: ${req.params.id}`,
      });
    }

    const organization = await storage.getOrganizationById(orgId);
    return res.json({ data: formatLeadResponse(lead, organization?.name ?? null) });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching lead:", error);
    return res.status(500).json({
      error: "Failed to fetch lead",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ========== ACTIVITIES ENDPOINT ==========

// Validation schema for external activity creation
const externalActivitySchema = z.object({
  type: z.enum(["call", "email", "meeting", "task", "note"]),
  subject: z.string().trim().min(1, "Subject is required").max(500),
  status: z.enum(["pending", "completed", "cancelled"]).optional().default("completed"),
  notes: z.string().trim().max(10000).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  relatedType: z.enum(["Contact", "Lead", "Account", "Opportunity"]).optional(),
  relatedId: z.string().trim().min(1).max(100).optional(),
}).strict().refine(
  (data) => {
    // relatedType and relatedId must both be present or both absent
    const hasType = !!data.relatedType;
    const hasId = !!data.relatedId;
    return hasType === hasId;
  },
  { message: "relatedType and relatedId must both be provided together" }
);

/**
 * POST /api/v1/external/activities
 * Create a new activity and optionally link it to a CRM record.
 *
 * Required fields: type, subject
 * Optional fields: status, notes, dueAt, completedAt, priority, relatedType, relatedId
 *
 * When relatedType + relatedId are provided, the referenced record must belong
 * to the same org as the API key; returns 404 if not found or wrong org.
 */
router.post("/activities", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Activity creation requires an API key bound to an organization. Ask your CRM administrator to create an organization-scoped API key in the Admin Console.",
      });
    }

    const parsed = externalActivitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        message: "The activity payload is invalid",
        details: parsed.error.errors.map(e => ({
          field: e.path.join(".") || "(root)",
          message: e.message,
        })),
      });
    }
    const data = parsed.data;

    // Related-entity authorization check — verify the record belongs to this org
    if (data.relatedType && data.relatedId) {
      let relatedRecord: { organizationId?: string | null } | undefined | null;
      switch (data.relatedType) {
        case "Contact":     relatedRecord = await storage.getContactById(data.relatedId); break;
        case "Lead":        relatedRecord = await storage.getLeadById(data.relatedId); break;
        case "Account":     relatedRecord = await storage.getAccountById(data.relatedId); break;
        case "Opportunity": relatedRecord = await storage.getOpportunityById(data.relatedId); break;
      }
      if (!relatedRecord || !keyOrgOwns(relatedRecord, orgId)) {
        return res.status(404).json({
          error: "Related record not found",
          message: `No ${data.relatedType} found with ID: ${data.relatedId}`,
        });
      }
    }

    // Create the activity record
    const activity = await storage.createActivity({
      organizationId: orgId,
      type: data.type,
      subject: data.subject,
      status: data.status,
      notes: data.notes ?? null,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      completedAt: data.completedAt ? new Date(data.completedAt) : null,
      priority: data.priority ?? "medium",
      relatedType: data.relatedType ?? null,
      relatedId: data.relatedId ?? null,
      ownerId: null,
    } as any);

    // Create activity_associations row so the activity appears on the related entity's timeline
    if (data.relatedType && data.relatedId) {
      const { db } = await import("./db");
      const { activityAssociations } = await import("@shared/schema");
      await db.insert(activityAssociations).values({
        activityId: activity.id,
        entityType: data.relatedType,
        entityId: data.relatedId,
      });
    }

    return res.status(201).json({
      data: {
        id: activity.id,
        type: activity.type,
        subject: activity.subject,
        status: activity.status,
        priority: activity.priority,
        notes: activity.notes,
        dueAt: activity.dueAt,
        completedAt: activity.completedAt,
        relatedType: activity.relatedType,
        relatedId: activity.relatedId,
        organizationId: activity.organizationId,
        createdAt: activity.createdAt,
        updatedAt: activity.updatedAt,
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error creating activity:", error);
    return res.status(500).json({
      error: "Failed to create activity",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ========== PHASE E: CONTROLLED PATCH ENDPOINTS ==========
// Strict partial updates with per-entity mutable-field allowlists.
// See server/external-patch-config.ts for the allowlists and schemas.

import { MUTABLE_FIELDS, IMMUTABLE_FIELDS, PATCH_SCHEMAS, classifyPatchFields } from "./external-patch-config";

/**
 * Phase F stub: key-level write permissions arrive in Phase F.
 * Until then, a key is treated as read-only when its name or description
 * contains the marker "[read-only]". TODO(Phase F): replace with a real
 * permissions column on api_keys.
 */
function keyIsReadOnly(req: ApiKeyRequest): boolean {
  const marker = "[read-only]";
  return !!(
    req.apiKey?.name?.toLowerCase().includes(marker) ||
    req.apiKey?.description?.toLowerCase().includes(marker)
  );
}

type PatchEntity = "account" | "contact" | "lead" | "opportunity" | "activity";

interface PatchEntityConfig {
  entity: PatchEntity;
  label: string;
  getById: (id: string) => Promise<any>;
  patch: (id: string, orgId: string | undefined, fields: Record<string, any>) => Promise<any>;
}

const PATCH_ENTITIES: Record<string, PatchEntityConfig> = {
  accounts: { entity: "account", label: "Account", getById: (id) => storage.getAccountById(id), patch: (id, o, f) => storage.patchAccount(id, o, f) },
  contacts: { entity: "contact", label: "Contact", getById: (id) => storage.getContactById(id), patch: (id, o, f) => storage.patchContact(id, o, f) },
  leads: { entity: "lead", label: "Lead", getById: (id) => storage.getLeadById(id), patch: (id, o, f) => storage.patchLead(id, o, f) },
  opportunities: { entity: "opportunity", label: "Opportunity", getById: (id) => storage.getOpportunityById(id), patch: (id, o, f) => storage.patchOpportunity(id, o, f) },
  activities: { entity: "activity", label: "Activity", getById: (id) => storage.getActivityById(id), patch: (id, o, f) => storage.patchActivity(id, o, f) },
};

function makePatchHandler(cfg: PatchEntityConfig) {
  return async (req: ApiKeyRequest, res: Response) => {
    try {
      // Write-permission check (Phase F stub)
      if (keyIsReadOnly(req)) {
        return res.status(403).json({
          error: "Read-only API key",
          message: "This API key does not have write permissions",
        });
      }

      const orgId = getKeyOrgId(req);
      const body = req.body;

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({
          error: "Invalid request body",
          message: "Request body must be a JSON object of fields to update",
        });
      }

      // Immutability check — canonical id, org ownership, createdAt, audit fields
      const { immutable, unknown } = classifyPatchFields(cfg.entity, body);
      if (immutable.length > 0) {
        return res.status(400).json({
          error: "Immutable fields cannot be modified",
          message: `The following fields are immutable: ${immutable.join(", ")}`,
          rejectedFields: immutable,
        });
      }

      // Allowlist check — reject unknown fields with the offending keys
      if (unknown.length > 0) {
        return res.status(400).json({
          error: "Unknown fields rejected",
          message: `The following fields are not allowed for ${cfg.label} updates: ${unknown.join(", ")}`,
          rejectedFields: unknown,
          allowedFields: MUTABLE_FIELDS[cfg.entity],
        });
      }

      if (Object.keys(body).length === 0) {
        return res.status(400).json({
          error: "Empty update",
          message: "Provide at least one field to update",
          allowedFields: MUTABLE_FIELDS[cfg.entity],
        });
      }

      // Value validation for the allowlisted fields
      const parsed = PATCH_SCHEMAS[cfg.entity].safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          message: `The ${cfg.label.toLowerCase()} payload is invalid`,
          details: parsed.error.errors.map(e => ({
            field: e.path.join(".") || "(root)",
            message: e.message,
          })),
        });
      }
      // Only apply fields that were actually provided (partial update semantics)
      const updates: Record<string, any> = {};
      for (const key of Object.keys(body)) {
        if (key in parsed.data && parsed.data[key] !== undefined) updates[key] = parsed.data[key];
      }

      // Fetch + org-scope check (404 for missing or cross-org records)
      const existing = await cfg.getById(req.params.id);
      if (!existing || !keyOrgOwns(existing, orgId)) {
        return res.status(404).json({
          error: `${cfg.label} not found`,
          message: `No ${cfg.label.toLowerCase()} found with ID: ${req.params.id}`,
        });
      }

      // Referenced-record ownership: a mutable accountId must point to an
      // account in the record's own organization (tenant-safe relationships)
      if (typeof updates.accountId === "string" && updates.accountId.length > 0) {
        const refAccount = await storage.getAccountById(updates.accountId);
        const recordOrgId = (existing as any).organizationId ?? orgId;
        if (!refAccount || (recordOrgId && refAccount.organizationId !== recordOrgId)) {
          return res.status(404).json({
            error: "Related account not found",
            message: `No account found with ID: ${updates.accountId}`,
          });
        }
      }

      // Referenced-user ownership: a mutable ownerId must belong to a user
      // with an active membership in the record's organization
      if (typeof updates.ownerId === "string" && updates.ownerId.length > 0) {
        const recordOrgId = (existing as any).organizationId ?? orgId;
        const membership = recordOrgId
          ? await storage.getOrgMembership(updates.ownerId, recordOrgId)
          : undefined;
        if (recordOrgId && !membership) {
          return res.status(404).json({
            error: "Related owner not found",
            message: `No user with ID ${updates.ownerId} is a member of this record's organization`,
          });
        }
      }

      // Opportunity date invariants, validated against the merged record
      // (mirrors the internal opportunity update route)
      if (cfg.entity === "opportunity") {
        const startDate = updates.implementationStartDate !== undefined ? updates.implementationStartDate : (existing as any).implementationStartDate;
        const endDate = updates.implementationEndDate !== undefined ? updates.implementationEndDate : (existing as any).implementationEndDate;
        const billingEnd = updates.billingEndDate !== undefined ? updates.billingEndDate : (existing as any).billingEndDate;
        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
          return res.status(400).json({
            error: "Implementation start date must be before end date",
            message: "implementationStartDate must not be after implementationEndDate",
          });
        }
        if (endDate && billingEnd && new Date(billingEnd) < new Date(endDate)) {
          return res.status(400).json({
            error: "Billing end date must not be before implementation end date (billing start)",
            message: "billingEndDate must not be before implementationEndDate",
          });
        }
      }

      // Org-scoped update (WHERE also constrains organizationId as defense in depth)
      const updated = await cfg.patch(req.params.id, orgId, updates);
      if (!updated) {
        return res.status(404).json({
          error: `${cfg.label} not found`,
          message: `No ${cfg.label.toLowerCase()} found with ID: ${req.params.id}`,
        });
      }

      // Record-level mutation audit log (in addition to the request-level middleware log)
      const before: Record<string, any> = {};
      for (const key of Object.keys(updates)) before[key] = (existing as any)[key] ?? null;
      storage.createAuditLog({
        actorId: null,
        action: "external_api_patch",
        resource: cfg.label,
        resourceId: req.params.id,
        before,
        after: { ...updates, apiKeyId: req.apiKey?.id, apiKeyName: req.apiKey?.name },
        ipAddress: req.ip || req.connection.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null,
      }).catch(err => {
        console.error("[EXTERNAL-API] Failed to create PATCH audit log:", err);
      });

      return res.json({ data: updated });
    } catch (error) {
      console.error(`[EXTERNAL-API] Error patching ${cfg.label.toLowerCase()}:`, error);
      return res.status(500).json({
        error: `Failed to update ${cfg.label.toLowerCase()}`,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
}

/**
 * PATCH /api/v1/external/accounts/:id
 * PATCH /api/v1/external/contacts/:id
 * PATCH /api/v1/external/leads/:id
 * PATCH /api/v1/external/opportunities/:id
 * PATCH /api/v1/external/activities/:id
 *
 * Strict partial update: only allowlisted fields may be changed; immutable
 * fields (id, organizationId, createdAt, audit fields) and unknown fields
 * return 400 listing the rejected keys. Org scoping enforced (404 cross-org).
 */
for (const [path, cfg] of Object.entries(PATCH_ENTITIES)) {
  router.patch(`/${path}/:id`, makePatchHandler(cfg));
}

export default router;
