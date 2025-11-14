// External API routes for forecasting app integration
// Provides read-only access to accounts and opportunities data

import { Router, Response, NextFunction } from "express";
import { storage } from "./db";
import { authenticateApiKey, createApiKeyRateLimiter, ApiKeyRequest } from "./api-key-auth";

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

export default router;
