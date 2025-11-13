// External API routes for forecasting app integration
// Provides read-only access to accounts and opportunities data

import { Router, Response, NextFunction } from "express";
import { storage } from "./db";
import { authenticateApiKey, createApiKeyRateLimiter, ApiKeyRequest } from "./api-key-auth";

const router = Router();

// Apply API key authentication to all external routes
router.use(authenticateApiKey);

// Apply rate limiting based on API key configuration
router.use(createApiKeyRateLimiter());

// Audit logging middleware for external API requests
router.use(async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Capture response details
  const originalSend = res.send;
  res.send = function(data: any) {
    const latency = Date.now() - startTime;
    
    // Log API request to audit log (fire and forget)
    storage.createAuditLog({
      actorId: null, // External API requests are not user-scoped
      action: "external_api_request",
      resource: "api_key",
      resourceId: req.apiKey?.id || null,
      before: null,
      after: {
        endpoint: req.path,
        method: req.method,
        statusCode: res.statusCode,
        latencyMs: latency,
        apiKeyName: req.apiKey?.name,
        queryParams: req.query,
      },
      ipAddress: req.ip || req.connection.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    }).catch(err => {
      console.error("[EXTERNAL-API] Failed to create audit log:", err);
    });
    
    return originalSend.call(this, data);
  };
  
  next();
});

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
    
    // Get all accounts
    let accounts = await storage.getAllAccounts();
    
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
      
      // Optionally include related opportunities
      if (expandList.includes("opportunities")) {
        const allOpps = await storage.getAllOpportunities();
        leanAccount.opportunities = allOpps
          .filter(o => o.accountId === account.id && o.includeInForecast)
          .map(o => ({
            id: o.id,
            name: o.name,
            stage: o.stage,
            amount: o.amount,
            closeDate: o.closeDate,
            probability: o.probability,
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
    
    const account = await storage.getAccountById(req.params.id);
    
    if (!account) {
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
      primaryContactName: account.primaryContactName,
      primaryContactEmail: account.primaryContactEmail,
      externalId: account.externalId,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
    
    // Optionally include related data
    if (expandList.includes("opportunities")) {
      const allOpps = await storage.getAllOpportunities();
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
        }));
    }
    
    if (expandList.includes("contacts")) {
      const allContacts = await storage.getAllContacts();
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
 * - expand: Comma-separated list of related entities (e.g., "account")
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
    
    // Get all opportunities
    let opportunities = await storage.getAllOpportunities();
    
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
        externalId: opp.externalId,
        createdAt: opp.createdAt,
        updatedAt: opp.updatedAt,
      };
      
      // Optionally include account data
      if (expandList.includes("account")) {
        const account = await storage.getAccountById(opp.accountId);
        if (account) {
          leanOpp.account = {
            id: account.id,
            name: account.name,
            accountNumber: account.accountNumber,
            type: account.type,
            category: account.category,
          };
        }
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
 * - expand: Comma-separated list of related entities (e.g., "account")
 */
router.get("/opportunities/:id", async (req: ApiKeyRequest, res) => {
  try {
    const { expand = "" } = req.query;
    const expandList = (expand as string).split(",").filter(Boolean);
    
    const opp = await storage.getOpportunityById(req.params.id);
    
    if (!opp) {
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
      externalId: opp.externalId,
      createdAt: opp.createdAt,
      updatedAt: opp.updatedAt,
    };
    
    // Optionally include account data
    if (expandList.includes("account")) {
      const account = await storage.getAccountById(opp.accountId);
      if (account) {
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
    
    return res.json({ data: response });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching opportunity:", error);
    return res.status(500).json({
      error: "Failed to fetch opportunity",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

export default router;
