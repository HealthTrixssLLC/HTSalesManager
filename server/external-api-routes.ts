// External API routes for forecasting app integration
// Provides read-only access to accounts and opportunities data

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { storage, db } from "./db";
import { normalizeEmail } from "./lib/normalize-email";
import { authenticateApiKey, createApiKeyRateLimiter, requirePermission, ApiKeyRequest } from "./api-key-auth";
import { commentEntityAliases, type CommentEntity } from "./comment-entity";
import { comments, users } from "@shared/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

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

// ===== ETag / optimistic-concurrency helpers (Phase: stale-write protection) =====

/**
 * Derive an opaque ETag token from a record's updatedAt timestamp.
 * Format: quoted base64url of the ISO-8601 timestamp (millisecond precision).
 * Returns undefined when the record has no updatedAt.
 */
function recordETag(updatedAt: Date | string | null | undefined): string | undefined {
  if (!updatedAt) return undefined;
  const d = new Date(updatedAt);
  if (isNaN(d.getTime())) return undefined;
  return `"${Buffer.from(d.toISOString()).toString("base64url")}"`;
}

// RFC 9110 entity-tag grammar: strong form is DQUOTE *etagc DQUOTE, where
// etagc = %x21 / %x23-7E / obs-text (no embedded double quotes).
const STRONG_ENTITY_TAG_RE = /^"([\x21\x23-\x7E\x80-\xFF]*)"$/;

/**
 * RFC 9110 If-Match evaluation with STRONG comparison:
 * - "*" matches any existing representation
 * - a comma-separated list of entity tags matches if any strong tag equals the current one
 * - weak validators ("W/...") are syntactically valid but never satisfy strong comparison
 * - a blank header or ANY malformed member (e.g. bare unquoted tokens) makes the
 *   whole header malformed — the precondition must fail rather than be ignored
 */
function evaluateIfMatch(header: string, currentTag: string | undefined): "match" | "mismatch" | "malformed" {
  const h = header.trim();
  if (h.length === 0) return "malformed";
  if (h === "*") return currentTag !== undefined ? "match" : "mismatch";
  const current = currentTag ? STRONG_ENTITY_TAG_RE.exec(currentTag) : null;
  let matched = false;
  for (const raw of h.split(",")) {
    const t = raw.trim();
    if (t.startsWith("W/")) {
      // Weak entity-tag: must still be well-formed, but never matches strongly
      if (!STRONG_ENTITY_TAG_RE.test(t.slice(2))) return "malformed";
      continue;
    }
    const m = STRONG_ENTITY_TAG_RE.exec(t); // requires quoted entity-tag form
    if (!m) return "malformed";
    if (current && m[1] === current[1]) matched = true;
  }
  return matched ? "match" : "mismatch";
}

/** Set the ETag response header and mirror it as `_version` on the payload. */
function attachVersion(res: Response, payload: Record<string, any>, updatedAt: Date | string | null | undefined): void {
  const tag = recordETag(updatedAt);
  if (tag) {
    res.setHeader("ETag", tag);
    payload._version = tag;
  }
}

async function withLegacyId<T extends { id: string }>(entity: string, payload: T): Promise<T & { legacyId: string | null }> {
  const legacyId = await storage.getLegacyId(entity, payload.id);
  return { ...payload, legacyId };
}

/** Read-only ID resolution: canonical PK wins, then legacy_id_map for this entity. Writes must not use this. */
async function loadRecordForRead(
  entity: string,
  getById: (id: string) => Promise<any>,
  id: string,
  orgId: string | undefined,
): Promise<any | undefined> {
  const byPk = await getById(id);
  if (byPk) {
    return keyOrgOwns(byPk, orgId) ? byPk : undefined;
  }
  const canonical = await storage.findCanonicalIdByLegacy(entity, id);
  if (!canonical || canonical === id) return undefined;
  const mapped = await getById(canonical);
  if (!mapped || !keyOrgOwns(mapped, orgId)) return undefined;
  return mapped;
}

async function includeExactIdMatch<T extends { id: string; organizationId?: string | null }>(
  entity: string,
  records: T[],
  search: string | undefined,
  orgId: string | undefined,
  getById: (id: string) => Promise<T | undefined>,
): Promise<T[]> {
  if (!search) return records;
  const extraIds = new Set<string>();
  extraIds.add(search);
  const mapped = await storage.findCanonicalIdByLegacy(entity, search);
  if (mapped) extraIds.add(mapped);
  let next = records;
  for (const extraId of extraIds) {
    if (next.some(r => r.id === extraId)) continue;
    const extra = await getById(extraId);
    if (extra && keyOrgOwns(extra, orgId)) next = [extra, ...next];
  }
  return next;
}

async function applyLegacyIdListFilter<T extends { id: string }>(
  entity: string,
  records: T[],
  legacyId: string | undefined,
): Promise<T[]> {
  if (!legacyId) return records;
  const canonical = await storage.findCanonicalIdByLegacy(entity, legacyId);
  if (!canonical) return [];
  return records.filter(r => r.id === canonical);
}

// ===== Query-parameter parsing helpers (Phase B list filters) =====

/** Return trimmed string value of a query param, or undefined when absent/empty */
function qs(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Strict ISO 8601 timestamp: YYYY-MM-DDTHH:MM(:SS(.fff)?)? with optional Z/±HH:MM offset.
// The T separator and a time component are required (date-only values are rejected).
const ISO_8601_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parse an ISO 8601 timestamp query param strictly. Returns { error } when present but invalid.
 * Rejects malformed strings (including date-only and space-separated forms) AND invalid
 * calendar values (e.g., 2024-02-30, hour 25) that new Date() would silently normalize.
 */
function parseDateParam(value: unknown, name: string): { date?: Date; error?: { error: string; message: string } } {
  const raw = qs(value);
  if (!raw) return {};
  const invalid = { error: { error: `Invalid ${name}`, message: `${name} must be a valid ISO 8601 timestamp (e.g., 2024-01-01T00:00:00Z)` } };

  const m = ISO_8601_RE.exec(raw);
  if (!m) return invalid;
  const [, y, mo, da, h, mi, s] = m;
  const year = +y, month = +mo, day = +da;
  if (month < 1 || month > 12) return invalid;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return invalid;
  if (+h > 23 || +mi > 59 || (s !== undefined && +s > 59)) return invalid;

  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return invalid;
  return { date: parsed };
}

/** Validate an enum query param. Returns { error } when present but not in allowed list. */
function parseEnumParam(value: unknown, name: string, allowed: readonly string[], lowercase = false): { value?: string; error?: { error: string; message: string } } {
  let raw = qs(value);
  if (!raw) return {};
  if (lowercase) raw = raw.toLowerCase();
  if (!allowed.includes(raw)) {
    return { error: { error: `Invalid ${name}`, message: `${name} must be one of: ${allowed.join(", ")}` } };
  }
  return { value: raw };
}

const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"] as const;
const LEAD_SOURCES = ["website", "referral", "phone", "email", "event", "partner", "lead_generation", "other"] as const;
const LEAD_RATINGS = ["hot", "warm", "cold"] as const;
const OPPORTUNITY_STAGES = ["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"] as const;

/**
 * Machine-readable error codes for external API error responses.
 * Purely additive: the existing `error`/`message` string fields are kept
 * unchanged so existing clients keep working; new clients branch on `code`.
 */
export type ExternalApiErrorCode =
  | "VALIDATION_ERROR"      // 400 — payload or parameter failed validation
  | "INSUFFICIENT_SCOPE"    // 403 — key lacks a permission or org binding
  | "NOT_FOUND"             // 404 — missing or cross-org record
  | "LEAD_ARCHIVED"         // 409 — restore the Lead before modifying or converting it
  | "TAG_ALREADY_EXISTS"    // 409 — duplicate tag name in org
  | "IDEMPOTENCY_CONFLICT"  // 409 — externalId replayed with a different body
  | "CONVERSION_CONFLICT"   // 409 — convert retry disagrees with stored conversion
  | "STALE_RECORD"          // 412 — If-Match precondition failed
  | "RATE_LIMITED";         // 429 — per-key rate limit exceeded

/** Send a consistent error envelope: { error, code, message?, ...extra }. */
function apiError(
  res: Response,
  status: number,
  code: ExternalApiErrorCode,
  error: string,
  extra?: Record<string, any>,
) {
  return res.status(status).json({ error, code, ...extra });
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

// ========== TAG HELPERS ==========

/** Lean tag shape returned by all external tag surfaces */
function formatTagLean(t: { id: string; name: string; color: string }) {
  return { id: t.id, name: t.name, color: t.color };
}

/**
 * Filter a record's tags down to the calling org's tags before exposing them.
 * Tags from other orgs (or legacy org-less internal tags) attached through
 * internal paths must never leak through the external API.
 */
function orgVisibleTags(tags: Array<{ id: string; name: string; color: string; organizationId?: string | null }>, orgId: string | undefined) {
  return tags.filter(t => !!orgId && t.organizationId === orgId).map(formatTagLean);
}

/**
 * Resolve ?tag=<name> / ?tagId=<id> list-filter params to a tag ID.
 * - Both params together -> 400
 * - tag (name) requires an org-bound key (403 otherwise) and must exist in the org (404)
 * - tagId must exist and, for org-bound keys, belong to the org (404; no info leak)
 */
async function resolveTagFilter(req: ApiKeyRequest, orgId: string | undefined): Promise<{ tagId?: string; error?: { status: number; body: any } }> {
  const tagName = qs(req.query.tag);
  const tagIdParam = qs(req.query.tagId);
  if (!tagName && !tagIdParam) return {};
  if (tagName && tagIdParam) {
    return { error: { status: 400, body: {
      error: "Invalid tag filter",
      message: "Provide either tag or tagId, not both",
    } } };
  }
  if (tagName) {
    if (!orgId) {
      return { error: { status: 403, body: {
        error: "Organization-bound API key required",
        message: "Filtering by tag name requires an API key bound to an organization",
      } } };
    }
    const tag = await storage.getTagByName(tagName, orgId);
    if (!tag) {
      return { error: { status: 404, body: {
        error: "Tag not found",
        message: `No tag found with name: ${tagName}`,
      } } };
    }
    return { tagId: tag.id };
  }
  if (!orgId) {
    return { error: { status: 403, body: {
      error: "Organization-bound API key required",
      message: "Filtering by tag requires an API key bound to an organization",
    } } };
  }
  const tag = await storage.getTagById(tagIdParam!);
  if (!tag || tag.organizationId !== orgId) {
    return { error: { status: 404, body: {
      error: "Tag not found",
      message: `No tag found with ID: ${tagIdParam}`,
    } } };
  }
  return { tagId: tag.id };
}

// ========== ACCOUNTS ENDPOINTS ==========

/** Format the public account detail representation (without optional expansions). */
function formatAccountDetailResponse(account: any) {
  return {
    id: account.id,
    name: account.name,
    accountNumber: account.accountNumber ?? null,
    type: account.type ?? null,
    category: account.category ?? null,
    ownerId: account.ownerId ?? null,
    industry: account.industry ?? null,
    website: account.website ?? null,
    phone: account.phone ?? null,
    billingAddress: account.billingAddress ?? null,
    shippingAddress: account.shippingAddress ?? null,
    externalId: account.externalId ?? null,
    createdAt: account.createdAt ?? null,
    updatedAt: account.updatedAt ?? null,
  };
}

/**
 * GET /api/v1/external/accounts
 * List all accounts with optional filtering and pagination
 * 
 * Query Parameters:
 * - search: Case-insensitive substring match on account name
 * - name: Case-insensitive substring match on account name
 * - updatedSince: ISO 8601 timestamp (e.g., 2024-01-01T00:00:00Z)
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 * - expand: Comma-separated list of related entities to include (e.g., "opportunities")
 */
router.get("/accounts", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
  try {
    const {
      limit = "100",
      offset = "0",
      expand = "",
    } = req.query;
    
    // Parse and validate parameters
    const limitNum = Math.min(Math.max(parseInt(limit as string) || 100, 1), 1000);
    const offsetNum = Math.max(parseInt(offset as string) || 0, 0);
    const expandList = (expand as string).split(",").filter(Boolean);
    const orgId = getKeyOrgId(req);
    
    const updatedSinceParsed = parseDateParam(req.query.updatedSince, "updatedSince");
    if (updatedSinceParsed.error) return res.status(400).json(updatedSinceParsed.error);
    
    const tagFilter = await resolveTagFilter(req, orgId);
    if (tagFilter.error) return res.status(tagFilter.error.status).json(tagFilter.error.body);
    
    // Get accounts scoped to the API key's org, filtered server-side
    let accounts = await storage.getAllAccounts(orgId, {
      search: qs(req.query.search),
      name: qs(req.query.name),
      updatedSince: updatedSinceParsed.date,
      tagId: tagFilter.tagId,
    });
    accounts = await includeExactIdMatch("Account", accounts, qs(req.query.search) || qs(req.query.name), orgId, (id) => storage.getAccountById(id));
    accounts = await applyLegacyIdListFilter("Account", accounts, qs(req.query.legacyId));
    
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
      if (expandList.includes("legacyId") || qs(req.query.legacyId)) {
        leanAccount.legacyId = (await storage.getLegacyIds("Account", [account.id]))[account.id] ?? null;
      }

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
router.get("/accounts/:id", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
  try {
    const { expand = "" } = req.query;
    const expandList = (expand as string).split(",").filter(Boolean);
    const orgId = getKeyOrgId(req);
    
    const account = await loadRecordForRead("Account", (id) => storage.getAccountById(id), req.params.id, orgId);
    
    if (!account) {
      return res.status(404).json({
        error: "Account not found",
        message: `No account found with ID: ${req.params.id}`
      });
    }
    
    const response: any = await withLegacyId("Account", formatAccountDetailResponse(account));
    
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
    
    if (expandList.includes("tags")) {
      const entityTags = await storage.getEntityTags("Account", account.id);
      response.tags = orgVisibleTags(entityTags, orgId);
    }
    
    attachVersion(res, response, account.updatedAt);
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

/** Format the public opportunity detail representation (without optional expansions). */
function formatMoney(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

function formatOpportunityDetailResponse(opp: any) {
  return {
    id: opp.id,
    accountId: opp.accountId,
    name: opp.name,
    stage: opp.stage,
    amount: formatMoney(opp.amount),
    closeDate: opp.closeDate,
    ownerId: opp.ownerId ?? null,
    probability: opp.probability ?? null,
    status: opp.status ?? null,
    actualCloseDate: opp.actualCloseDate ?? null,
    actualRevenue: formatMoney(opp.actualRevenue),
    estCloseDate: opp.estCloseDate ?? null,
    estRevenue: formatMoney(opp.estRevenue),
    rating: opp.rating ?? null,
    includeInForecast: opp.includeInForecast,
    implementationStartDate: opp.implementationStartDate ?? null,
    implementationEndDate: opp.implementationEndDate ?? null,
    billingEndDate: opp.billingEndDate ?? null,
    description: opp.description ?? null,
    externalId: opp.externalId ?? null,
    createdAt: opp.createdAt,
    updatedAt: opp.updatedAt,
  };
}

/**
 * GET /api/v1/external/opportunities
 * List all opportunities with optional filtering and pagination
 * 
 * Query Parameters:
 * - search: Case-insensitive substring match on opportunity name
 * - accountId: Exact account ID match
 * - status: Case-insensitive exact match on status text (e.g., Won, Lost, Open)
 * - stage: Pipeline stage (prospecting, qualification, proposal, negotiation, closed_won, closed_lost)
 * - ownerId: Exact owner (user) ID match
 * - rating: Case-insensitive exact match (e.g., Hot, Warm, Cold)
 * - updatedSince: ISO 8601 timestamp
 * - includeInForecast: Filter by forecast inclusion (true/false/all, default: true)
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 * - expand: Comma-separated list of related entities (e.g., "account,resources")
 */
router.get("/opportunities", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
  try {
    const {
      includeInForecast = "true",
      limit = "100",
      offset = "0",
      expand = "",
    } = req.query;
    
    // Parse parameters
    const limitNum = Math.min(Math.max(parseInt(limit as string) || 100, 1), 1000);
    const offsetNum = Math.max(parseInt(offset as string) || 0, 0);
    const expandList = (expand as string).split(",").filter(Boolean);
    const orgId = getKeyOrgId(req);
    
    // Validate filter parameters
    const updatedSinceParsed = parseDateParam(req.query.updatedSince, "updatedSince");
    if (updatedSinceParsed.error) return res.status(400).json(updatedSinceParsed.error);
    
    const stageParsed = parseEnumParam(req.query.stage, "stage", OPPORTUNITY_STAGES);
    if (stageParsed.error) return res.status(400).json(stageParsed.error);
    
    if (!["true", "false", "all"].includes(includeInForecast as string)) {
      return res.status(400).json({
        error: "Invalid includeInForecast",
        message: "includeInForecast must be one of: true, false, all",
      });
    }
    
    const tagFilter = await resolveTagFilter(req, orgId);
    if (tagFilter.error) return res.status(tagFilter.error.status).json(tagFilter.error.body);
    
    // Get opportunities scoped to the API key's org, filtered server-side
    let opportunities = await storage.getAllOpportunities(orgId, {
      search: qs(req.query.search),
      accountId: qs(req.query.accountId),
      status: qs(req.query.status),
      stage: stageParsed.value,
      ownerId: qs(req.query.ownerId),
      rating: qs(req.query.rating),
      includeInForecast: includeInForecast === "all" ? undefined : includeInForecast === "true",
      updatedSince: updatedSinceParsed.date,
      tagId: tagFilter.tagId,
    });
    opportunities = await includeExactIdMatch("Opportunity", opportunities, qs(req.query.search), orgId, (id) => storage.getOpportunityById(id));
    opportunities = await applyLegacyIdListFilter("Opportunity", opportunities, qs(req.query.legacyId));
    
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
        amount: formatMoney(opp.amount),
        closeDate: opp.closeDate,
        ownerId: opp.ownerId,
        probability: opp.probability,
        status: opp.status,
        actualCloseDate: opp.actualCloseDate,
        actualRevenue: formatMoney(opp.actualRevenue),
        estCloseDate: opp.estCloseDate,
        estRevenue: formatMoney(opp.estRevenue),
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
router.get("/opportunities/:id", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
  try {
    const { expand = "" } = req.query;
    const expandList = (expand as string).split(",").filter(Boolean);
    const orgId = getKeyOrgId(req);
    
    const opp = await loadRecordForRead("Opportunity", (id) => storage.getOpportunityById(id), req.params.id, orgId);
    
    if (!opp) {
      return res.status(404).json({
        error: "Opportunity not found",
        message: `No opportunity found with ID: ${req.params.id}`
      });
    }
    
    const response: any = await withLegacyId("Opportunity", formatOpportunityDetailResponse(opp));
    
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
    
    if (expandList.includes("tags")) {
      const entityTags = await storage.getEntityTags("Opportunity", opp.id);
      response.tags = orgVisibleTags(entityTags, orgId);
    }
    
    attachVersion(res, response, opp.updatedAt);
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
router.post("/opportunities/:id/contacts", requirePermission("crm.write"), async (req: ApiKeyRequest, res) => {
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
router.delete("/opportunities/:id/contacts/:contactId", requirePermission("crm.write"), async (req: ApiKeyRequest, res) => {
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
    department: contact.department ?? null,
    mailingStreet: contact.mailingStreet ?? contact.mailing_street ?? null,
    mailingCity: contact.mailingCity ?? contact.mailing_city ?? null,
    mailingState: contact.mailingState ?? contact.mailing_state ?? null,
    mailingPostalCode: contact.mailingPostalCode ?? contact.mailing_postal_code ?? null,
    mailingCountry: contact.mailingCountry ?? contact.mailing_country ?? null,
    description: contact.description ?? null,
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
 * - search: Case-insensitive substring match on "first last" name
 * - email: Case-insensitive exact email match
 * - accountId: Exact account ID match
 * - updatedSince: ISO 8601 timestamp
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 * - expand: "account" — includes { id, name } on each contact
 */
router.get("/contacts", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Contact access requires an API key bound to an organization",
      });
    }

    const { limit = "100", offset = "0", expand = "" } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 1000);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);
    const expandList = (expand as string).split(",").filter(Boolean);

    const updatedSinceParsed = parseDateParam(req.query.updatedSince, "updatedSince");
    if (updatedSinceParsed.error) return res.status(400).json(updatedSinceParsed.error);

    const tagFilter = await resolveTagFilter(req, orgId);
    if (tagFilter.error) return res.status(tagFilter.error.status).json(tagFilter.error.body);

    // Get contacts scoped to the API key's org, filtered server-side
    let contacts = await storage.getAllContacts(orgId, {
      search: qs(req.query.search),
      email: qs(req.query.email),
      accountId: qs(req.query.accountId),
      updatedSince: updatedSinceParsed.date,
      tagId: tagFilter.tagId,
    });
    contacts = await includeExactIdMatch("Contact", contacts, qs(req.query.search), orgId, (id) => storage.getContactById(id));
    contacts = await applyLegacyIdListFilter("Contact", contacts, qs(req.query.legacyId));

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
router.get("/contacts/:id", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
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

    const contact = await loadRecordForRead("Contact", (id) => storage.getContactById(id), req.params.id, orgId);
    if (!contact) {
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

    const contactPayload: any = await withLegacyId("Contact", formatContactResponse(contact, account));
    if (expandList.includes("tags")) {
      const entityTags = await storage.getEntityTags("Contact", contact.id);
      contactPayload.tags = orgVisibleTags(entityTags, orgId);
    }

    attachVersion(res, contactPayload, contact.updatedAt);
    return res.json({ data: contactPayload });
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
router.get("/logs", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
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
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 1000);
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
  const archivedAt = lead.archivedAt ?? lead.archived_at ?? null;
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
    ownerId: lead.ownerId ?? lead.owner_id ?? null,
    externalId: lead.externalId ?? lead.external_id ?? null,
    convertedAccountId: lead.convertedAccountId ?? lead.converted_account_id ?? null,
    convertedContactId: lead.convertedContactId ?? lead.converted_contact_id ?? null,
    convertedOpportunityId: lead.convertedOpportunityId ?? lead.converted_opportunity_id ?? null,
    convertedAt: lead.convertedAt ?? lead.converted_at ?? null,
    archived: Boolean(archivedAt),
    archivedAt,
    organizationId: lead.organizationId ?? lead.organization_id ?? null,
    organizationName: orgName,
    createdAt: lead.createdAt ?? lead.created_at ?? null,
    updatedAt: lead.updatedAt ?? lead.updated_at ?? null,
  };
}

const CANONICAL_LEAD_ID_RE = /^LEAD-\d{6}$/;

function isArchivedLead(lead: any): boolean {
  return Boolean(lead?.archivedAt ?? lead?.archived_at);
}

function leadLifecycleIfMatch(
  req: ApiKeyRequest,
  lead: any,
): { expectedUpdatedAt?: Date; stale?: Record<string, any> } {
  const ifMatchRaw = req.headers["if-match"];
  const ifMatch = Array.isArray(ifMatchRaw) ? ifMatchRaw.join(",") : ifMatchRaw;
  if (typeof ifMatch !== "string") return {};

  const currentTag = recordETag(lead.updatedAt ?? lead.updated_at);
  if (evaluateIfMatch(ifMatch, currentTag) !== "match") {
    return {
      stale: {
        error: "Precondition failed",
        code: "STALE_RECORD",
        message: "The lead was modified since you last fetched it. Re-fetch the record and retry with its current version.",
        ...(currentTag ? { currentVersion: currentTag } : {}),
      },
    };
  }

  return ifMatch.trim() === "*"
    ? {}
    : { expectedUpdatedAt: new Date(lead.updatedAt ?? lead.updated_at) };
}

/**
 * POST /api/v1/external/leads
 * Create a new lead. Requires an organization-bound API key.
 * The lead is always assigned to the API key's organization.
 * If a lead with the same email already exists in the organization,
 * no duplicate is created — the existing lead is returned with duplicate: true.
 */
router.post("/leads", requirePermission("crm.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Lead creation requires an API key bound to an organization. Ask your CRM administrator to create an organization-scoped API key in the Admin Console.",
      });
    }

    const parsed = externalLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
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
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Invalid organization", {
        message: "The organization bound to this API key no longer exists",
      });
    }

    // Duplicate detection: same normalized email within the same organization.
    // normalizeEmail trims whitespace; the DB index uses lower(BTRIM(email)).
    const normalizedEmail = normalizeEmail(data.email);
    if (normalizedEmail) {
      const existingLeads = await storage.getAllLeads(orgId, { includeArchived: true });
      const emailKey = normalizedEmail.toLowerCase();
      const duplicate = existingLeads.find(
        (l: any) => normalizeEmail(l.email)?.toLowerCase() === emailKey
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
        email: normalizedEmail,
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
      if (isUniqueViolation && normalizedEmail) {
        const existingLeads = await storage.getAllLeads(orgId, { includeArchived: true });
        const emailKey = normalizedEmail.toLowerCase();
        const existing = existingLeads.find(
          (l: any) => normalizeEmail(l.email)?.toLowerCase() === emailKey
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
 * Query params:
 * - search: Case-insensitive substring match on "first last" name or company
 * - email: Case-insensitive exact email match
 * - status: Lead status (new, contacted, qualified, unqualified, converted)
 * - rating: Lead temperature (hot, warm, cold)
 * - source: Lead source (website, referral, phone, email, event, partner, lead_generation, other)
 * - includeArchived: true to include archived history (default false)
 * - updatedSince: ISO 8601 timestamp
 * - limit (default 100, max 1000), offset
 */
router.get("/leads", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Lead access requires an API key bound to an organization",
      });
    }

    const { limit = "100", offset = "0" } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 1000);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);

    const updatedSinceParsed = parseDateParam(req.query.updatedSince, "updatedSince");
    if (updatedSinceParsed.error) return res.status(400).json(updatedSinceParsed.error);

    const statusParsed = parseEnumParam(req.query.status, "status", LEAD_STATUSES);
    if (statusParsed.error) return res.status(400).json(statusParsed.error);

    const ratingParsed = parseEnumParam(req.query.rating, "rating", LEAD_RATINGS, true);
    if (ratingParsed.error) return res.status(400).json(ratingParsed.error);

    const sourceParsed = parseEnumParam(req.query.source, "source", LEAD_SOURCES);
    if (sourceParsed.error) return res.status(400).json(sourceParsed.error);

    const includeArchivedRaw = qs(req.query.includeArchived);
    if (includeArchivedRaw !== undefined && includeArchivedRaw !== "true" && includeArchivedRaw !== "false") {
      return apiError(res, 400, "VALIDATION_ERROR", "Invalid includeArchived value", {
        message: "includeArchived must be true or false",
      });
    }
    const includeArchived = includeArchivedRaw === "true";

    const tagFilter = await resolveTagFilter(req, orgId);
    if (tagFilter.error) return res.status(tagFilter.error.status).json(tagFilter.error.body);

    const organization = await storage.getOrganizationById(orgId);
    let leads = await storage.getAllLeads(orgId, {
      search: qs(req.query.search),
      email: qs(req.query.email),
      status: statusParsed.value,
      rating: ratingParsed.value,
      source: sourceParsed.value,
      updatedSince: updatedSinceParsed.date,
      tagId: tagFilter.tagId,
      includeArchived,
    });
    leads = await includeExactIdMatch("Lead", leads as any, qs(req.query.search), orgId, (id) => storage.getLeadById(id));
    leads = await applyLegacyIdListFilter("Lead", leads as any, qs(req.query.legacyId));
    // includeExactIdMatch deliberately bypasses the list SQL to support direct
    // canonical/legacy searches, so apply the archive visibility rule again.
    if (!includeArchived) leads = leads.filter((lead: any) => !isArchivedLead(lead));

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
router.get("/leads/:id", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Lead access requires an API key bound to an organization",
      });
    }

    const lead = await loadRecordForRead("Lead", (id) => storage.getLeadById(id), req.params.id, orgId);
    if (!lead) {
      return res.status(404).json({
        error: "Lead not found",
        message: `No lead found with ID: ${req.params.id}`,
      });
    }

    const organization = await storage.getOrganizationById(orgId);
    const expandList = ((req.query.expand as string) || "").split(",").filter(Boolean);
    const leadPayload: any = await withLegacyId("Lead", formatLeadResponse(lead, organization?.name ?? null));
    if (expandList.includes("tags")) {
      const entityTags = await storage.getEntityTags("Lead", lead.id);
      leadPayload.tags = orgVisibleTags(entityTags, orgId);
    }
    attachVersion(res, leadPayload, lead.updatedAt);
    return res.json({ data: leadPayload });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching lead:", error);
    return res.status(500).json({
      error: "Failed to fetch lead",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

async function leadLifecycleResponse(
  res: Response,
  lead: any,
  orgId: string,
  stateKey: "alreadyArchived" | "alreadyActive",
): Promise<void> {
  const organization = await storage.getOrganizationById(orgId);
  const payload = await withLegacyId("Lead", formatLeadResponse(lead, organization?.name ?? null));
  attachVersion(res, payload, lead.updatedAt ?? lead.updated_at);
  res.json({ data: payload, [stateKey]: true });
}

function makeLeadLifecycleHandler(action: "archive" | "restore") {
  const archive = action === "archive";
  const verb = archive ? "archive" : "restore";
  const alreadyKey = archive ? "alreadyArchived" : "alreadyActive";

  return async (req: ApiKeyRequest, res: Response) => {
    try {
      const orgId = getKeyOrgId(req);
      if (!orgId) {
        return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
          message: `Lead ${verb} requires an API key bound to an organization`,
        });
      }
      if (!CANONICAL_LEAD_ID_RE.test(req.params.id)) {
        return apiError(res, 400, "VALIDATION_ERROR", "Canonical Lead ID required", {
          message: "Lead lifecycle operations require a canonical ID in the form LEAD-000001",
        });
      }

      const existing = await storage.getLeadById(req.params.id);
      if (!existing || !keyOrgOwns(existing, orgId)) {
        return apiError(res, 404, "NOT_FOUND", "Lead not found", {
          message: `No lead found with ID: ${req.params.id}`,
        });
      }

      const concurrency = leadLifecycleIfMatch(req, existing);
      if (concurrency.stale) return res.status(412).json(concurrency.stale);

      const alreadyInTargetState = archive ? isArchivedLead(existing) : !isArchivedLead(existing);
      if (alreadyInTargetState) {
        return leadLifecycleResponse(res, existing, orgId, alreadyKey);
      }

      const updated = archive
        ? await storage.archiveLead(existing.id, orgId, concurrency.expectedUpdatedAt)
        : await storage.restoreLead(existing.id, orgId, concurrency.expectedUpdatedAt);

      if (!updated) {
        const recheck = await storage.getLeadById(existing.id);
        if (recheck && keyOrgOwns(recheck, orgId)) {
          if (concurrency.expectedUpdatedAt) {
            return res.status(412).json({
              error: "Precondition failed",
              code: "STALE_RECORD",
              message: "The lead was modified since you last fetched it. Re-fetch the record and retry with its current version.",
              currentVersion: recordETag((recheck as any).updatedAt),
            });
          }
          return leadLifecycleResponse(res, recheck, orgId, alreadyKey);
        }
        return apiError(res, 404, "NOT_FOUND", "Lead not found", {
          message: `No lead found with ID: ${req.params.id}`,
        });
      }

      storage.createAuditLog({
        actorId: null,
        action: `external_api_${verb}_lead`,
        resource: "Lead",
        resourceId: updated.id,
        before: {
          archivedAt: (existing as any).archivedAt ?? null,
          status: existing.status,
        },
        after: {
          archivedAt: (updated as any).archivedAt ?? null,
          status: updated.status,
          apiKeyId: req.apiKey?.id,
          apiKeyName: req.apiKey?.name,
        },
        ipAddress: req.ip || req.connection.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null,
      }).catch(err => {
        console.error(`[EXTERNAL-API] Failed to create Lead ${verb} audit log:`, err);
      });

      const organization = await storage.getOrganizationById(orgId);
      const payload = await withLegacyId("Lead", formatLeadResponse(updated, organization?.name ?? null));
      attachVersion(res, payload, (updated as any).updatedAt);
      return res.json({ data: payload, [alreadyKey]: false });
    } catch (error) {
      console.error(`[EXTERNAL-API] Error attempting to ${verb} lead:`, error);
      return res.status(500).json({
        error: `Failed to ${verb} lead`,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
}

// Lead archival is the supported lifecycle-removal operation. These state
// transitions preserve all CRM history; external hard deletion is unsupported.
router.post("/leads/:id/archive", requirePermission("crm.write"), makeLeadLifecycleHandler("archive"));
router.post("/leads/:id/restore", requirePermission("crm.write"), makeLeadLifecycleHandler("restore"));

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
  // Optional client-supplied idempotency token: replays with the same
  // (org, externalId) return the original activity instead of a duplicate.
  externalId: z.string().trim().min(1).max(100).optional(),
}).strict().refine(
  (data) => {
    // relatedType and relatedId must both be present or both absent
    const hasType = !!data.relatedType;
    const hasId = !!data.relatedId;
    return hasType === hasId;
  },
  { message: "relatedType and relatedId must both be provided together" }
);

/** Response shape for activity creation (201) and idempotent replay (200). */
function formatCreatedActivity(activity: any) {
  return {
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
    externalId: activity.externalId ?? null,
    organizationId: activity.organizationId,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  };
}

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
router.post("/activities", requirePermission("activities.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Activity creation requires an API key bound to an organization. Ask your CRM administrator to create an organization-scoped API key in the Admin Console.",
      });
    }

    const parsed = externalActivitySchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
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
        return apiError(res, 404, "NOT_FOUND", "Related record not found", {
          message: `No ${data.relatedType} found with ID: ${data.relatedId}`,
        });
      }
    }

    const activityValues = {
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
      externalId: data.externalId ?? null,
      ownerId: null,
    } as any;

    // Create the activity record. When an externalId idempotency token is
    // supplied, the claim is atomic (advisory-lock + transaction) so
    // concurrent retries with the same token can never create duplicates.
    let activity;
    let created = true;
    if (data.externalId) {
      const result = await storage.findOrCreateActivityByExternalId(data.externalId, orgId, activityValues);
      activity = result.activity;
      created = result.created;
      if (!created) {
        // Idempotent replay: identical intent (same type + subject) → 200
        // with the original record; different intent → 409 so a token reuse
        // bug is surfaced, not hidden.
        if (activity.type === data.type && activity.subject === data.subject) {
          return res.status(200).json({ data: formatCreatedActivity(activity) });
        }
        return apiError(res, 409, "IDEMPOTENCY_CONFLICT", "External ID already used by a different activity", {
          message: `An activity with externalId "${data.externalId}" already exists in this organization but has a different type or subject. Use a new externalId for a new activity, or replay with the original payload.`,
          existingActivityId: activity.id,
        });
      }
    } else {
      activity = await storage.createActivity(activityValues);
    }

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

    return res.status(201).json({ data: formatCreatedActivity(activity) });
  } catch (error) {
    console.error("[EXTERNAL-API] Error creating activity:", error);
    return res.status(500).json({
      error: "Failed to create activity",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ========== PHASE A: ACTIVITY READ ENDPOINTS ==========

const ACTIVITY_TYPES = ["call", "email", "meeting", "task", "note"] as const;
const ACTIVITY_STATUSES = ["pending", "completed", "cancelled"] as const;
const ACTIVITY_PRIORITIES = ["low", "medium", "high"] as const;
const ACTIVITY_RELATED_TYPES = ["Contact", "Lead", "Account", "Opportunity"] as const;

/** Format an activity record for external API responses */
function formatActivityResponse(activity: any) {
  return {
    id: activity.id,
    type: activity.type,
    subject: activity.subject,
    status: activity.status,
    priority: activity.priority,
    notes: activity.notes,
    dueAt: activity.dueAt,
    completedAt: activity.completedAt,
    ownerId: activity.ownerId,
    relatedType: activity.relatedType,
    relatedId: activity.relatedId,
    organizationId: activity.organizationId,
    externalId: activity.externalId,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  };
}

/**
 * GET /api/v1/external/activities
 * List activities for the API key's organization with filtering and pagination.
 *
 * Query Parameters:
 * - relatedType: Enum (Contact, Lead, Account, Opportunity); invalid → 400
 * - relatedId: Exact match on related record ID
 * - type: Enum (call, email, meeting, task, note); invalid → 400
 * - status: Enum (pending, completed, cancelled); invalid → 400
 * - priority: Enum (low, medium, high); invalid → 400
 * - dueBefore: ISO 8601 — activities with dueAt strictly before this timestamp
 * - dueAfter: ISO 8601 — activities with dueAt strictly after this timestamp
 * - updatedSince: ISO 8601 — activities updated strictly after this timestamp
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 */
router.get("/activities", requirePermission("activities.read"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Activity access requires an API key bound to an organization",
      });
    }

    const { limit = "100", offset = "0" } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 1000);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);

    const dueBeforeParsed = parseDateParam(req.query.dueBefore, "dueBefore");
    if (dueBeforeParsed.error) return res.status(400).json(dueBeforeParsed.error);
    const dueAfterParsed = parseDateParam(req.query.dueAfter, "dueAfter");
    if (dueAfterParsed.error) return res.status(400).json(dueAfterParsed.error);
    const updatedSinceParsed = parseDateParam(req.query.updatedSince, "updatedSince");
    if (updatedSinceParsed.error) return res.status(400).json(updatedSinceParsed.error);

    const typeParsed = parseEnumParam(req.query.type, "type", ACTIVITY_TYPES);
    if (typeParsed.error) return res.status(400).json(typeParsed.error);
    const statusParsed = parseEnumParam(req.query.status, "status", ACTIVITY_STATUSES);
    if (statusParsed.error) return res.status(400).json(statusParsed.error);
    const priorityParsed = parseEnumParam(req.query.priority, "priority", ACTIVITY_PRIORITIES);
    if (priorityParsed.error) return res.status(400).json(priorityParsed.error);
    const relatedTypeParsed = parseEnumParam(req.query.relatedType, "relatedType", ACTIVITY_RELATED_TYPES);
    if (relatedTypeParsed.error) return res.status(400).json(relatedTypeParsed.error);

    const tagFilter = await resolveTagFilter(req, orgId);
    if (tagFilter.error) return res.status(tagFilter.error.status).json(tagFilter.error.body);

    // Org-scoped, filtered server-side
    let activities = await storage.getActivities(orgId, {
      relatedType: relatedTypeParsed.value,
      relatedId: qs(req.query.relatedId),
      type: typeParsed.value,
      status: statusParsed.value,
      priority: priorityParsed.value,
      dueBefore: dueBeforeParsed.date,
      dueAfter: dueAfterParsed.date,
      updatedSince: updatedSinceParsed.date,
      tagId: tagFilter.tagId,
    });
    activities = await includeExactIdMatch("Activity", activities, qs(req.query.search), orgId, async (id) => storage.getActivityById(id, orgId));
    activities = await applyLegacyIdListFilter("Activity", activities, qs(req.query.legacyId));

    const total = activities.length;
    const page = activities.slice(offsetNum, offsetNum + limitNum);

    return res.json({
      data: page.map(formatActivityResponse),
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + page.length < total,
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching activities:", error);
    return res.status(500).json({
      error: "Failed to fetch activities",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/v1/external/activities/:id
 * Get a specific activity by ID (org-scoped: a cross-org record is
 * indistinguishable from a missing one — both return 404).
 */
router.get("/activities/:id", requirePermission("activities.read"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Activity access requires an API key bound to an organization",
      });
    }

    // Org-scoped lookup: missing and cross-org records are indistinguishable.
    // Read-only legacy resolution: if the PK misses, map via legacy_id_map.
    let activity = await storage.getActivityById(req.params.id, orgId);
    if (!activity) {
      const canonical = await storage.findCanonicalIdByLegacy("Activity", req.params.id);
      if (canonical) activity = await storage.getActivityById(canonical, orgId);
    }
    if (!activity) {
      return apiError(res, 404, "NOT_FOUND", "Not Found", {
        message: `No activity found with ID: ${req.params.id}`,
      });
    }

    const expandList = ((req.query.expand as string) || "").split(",").filter(Boolean);
    const activityPayload: any = await withLegacyId("Activity", formatActivityResponse(activity));
    if (expandList.includes("tags")) {
      const entityTags = await storage.getEntityTags("Activity", activity.id);
      activityPayload.tags = orgVisibleTags(entityTags, orgId);
    }
    attachVersion(res, activityPayload, activity.updatedAt);
    return res.json({ data: activityPayload });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching activity:", error);
    return res.status(500).json({
      error: "Failed to fetch activity",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});


// ========== TAGS ENDPOINTS ==========
// External tag management and per-record tag assignment.
// All tag routes require an org-bound API key; tags are strictly org-scoped
// and cross-org tags/records are indistinguishable from missing ones (404).

/** Per-entity config for the entity-tag routes */
type TagRoutePermission = Parameters<typeof requirePermission>[0];
const TAG_ENTITIES: Record<string, {
  label: string;
  readPermission: TagRoutePermission;
  writePermission: TagRoutePermission;
  getById: (id: string, orgId: string) => Promise<any>;
}> = {
  accounts: { label: "Account", readPermission: "crm.read", writePermission: "crm.write", getById: async (id) => storage.getAccountById(id) },
  contacts: { label: "Contact", readPermission: "crm.read", writePermission: "crm.write", getById: async (id) => storage.getContactById(id) },
  leads: { label: "Lead", readPermission: "crm.read", writePermission: "crm.write", getById: async (id) => storage.getLeadById(id) },
  opportunities: { label: "Opportunity", readPermission: "crm.read", writePermission: "crm.write", getById: async (id) => storage.getOpportunityById(id) },
  activities: { label: "Activity", readPermission: "activities.read", writePermission: "activities.write", getById: async (id, orgId) => storage.getActivityById(id, orgId) },
};

function orgBoundRequired(res: Response, what: string) {
  return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
    message: `${what} requires an API key bound to an organization`,
  });
}

/**
 * GET /api/v1/external/tags
 * List the calling org's tags.
 *
 * Query Parameters:
 * - search: Case-insensitive substring match on tag name
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 */
router.get("/tags", requirePermission("crm.read"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) return orgBoundRequired(res, "Tag access");

    const { limit = "100", offset = "0" } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 1000);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);
    const search = qs(req.query.search)?.toLowerCase();

    let tags = await storage.getAllTags(orgId);
    if (search) {
      tags = tags.filter(t => t.name.toLowerCase().includes(search));
    }

    const total = tags.length;
    const page = tags.slice(offsetNum, offsetNum + limitNum);

    return res.json({
      data: page.map(formatTagLean),
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + page.length < total,
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching tags:", error);
    return res.status(500).json({
      error: "Failed to fetch tags",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

const externalCreateTagSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100, "name must be at most 100 characters"),
}).strict();

/**
 * POST /api/v1/external/tags
 * Create an org-scoped tag. Name is normalized (trimmed, internal whitespace
 * collapsed) and must be unique within the org (case-insensitive) — 409 on duplicate.
 */
router.post("/tags", requirePermission("crm.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) return orgBoundRequired(res, "Tag creation");

    const parsed = externalCreateTagSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
        message: parsed.error.errors.map(e => e.message).join("; "),
        details: parsed.error.errors,
      });
    }

    const normalized = parsed.data.name.trim().replace(/\s+/g, " ");
    if (!normalized) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
        message: "name is required",
      });
    }

    const existing = await storage.getTagByName(normalized, orgId);
    if (existing) {
      return apiError(res, 409, "TAG_ALREADY_EXISTS", "Tag already exists", {
        message: `A tag named "${existing.name}" already exists in this organization`,
        existingTagId: existing.id,
      });
    }

    const tag = await storage.createTag({
      name: normalized,
      organizationId: orgId,
      createdBy: null, // External API requests are key-scoped, not user-scoped
    });

    return res.status(201).json({ data: formatTagLean(tag) });
  } catch (error) {
    console.error("[EXTERNAL-API] Error creating tag:", error);
    return res.status(500).json({
      error: "Failed to create tag",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

const externalAssignTagSchema = z.object({
  tagId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(100).optional(),
}).strict().refine(
  (data) => !!data.tagId !== !!data.name,
  { message: "Provide exactly one of tagId or name" }
);

/** Fetch the record for an entity-tag route; sends the 404 itself when missing/cross-org. */
async function loadTaggableRecord(entityKey: string, id: string, orgId: string, res: Response): Promise<any | undefined> {
  const cfg = TAG_ENTITIES[entityKey];
  const record = await cfg.getById(id, orgId);
  // getActivityById is already org-scoped; the others need an explicit ownership check
  if (!record || (entityKey !== "activities" && !keyOrgOwns(record, orgId))) {
    apiError(res, 404, "NOT_FOUND", `${cfg.label} not found`, {
      message: `No ${cfg.label.toLowerCase()} found with ID: ${id}`,
    });
    return undefined;
  }
  return record;
}

for (const [entityKey, cfg] of Object.entries(TAG_ENTITIES)) {
  /**
   * GET /api/v1/external/{entity}/:id/tags
   * List tags attached to a record (org-scoped; cross-org record -> 404).
   */
  router.get(`/${entityKey}/:id/tags`, requirePermission(cfg.readPermission), async (req: ApiKeyRequest, res) => {
    try {
      const orgId = getKeyOrgId(req);
      if (!orgId) return orgBoundRequired(res, "Tag access");

      const record = await loadTaggableRecord(entityKey, req.params.id, orgId, res);
      if (!record) return;

      const entityTags = await storage.getEntityTags(cfg.label, req.params.id);
      return res.json({ data: orgVisibleTags(entityTags, orgId) });
    } catch (error) {
      console.error(`[EXTERNAL-API] Error fetching ${cfg.label} tags:`, error);
      return res.status(500).json({
        error: "Failed to fetch tags",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/v1/external/{entity}/:id/tags
   * Assign a tag by { tagId } or { name }. The tag must already exist in the
   * org (404 otherwise — no auto-create). Idempotent: re-assigning an already
   * assigned tag is a no-op. Returns the record's current tag list.
   */
  router.post(`/${entityKey}/:id/tags`, requirePermission(cfg.writePermission), async (req: ApiKeyRequest, res) => {
    try {
      const orgId = getKeyOrgId(req);
      if (!orgId) return orgBoundRequired(res, "Tag assignment");

      const record = await loadTaggableRecord(entityKey, req.params.id, orgId, res);
      if (!record) return;

      const parsed = externalAssignTagSchema.safeParse(req.body);
      if (!parsed.success) {
        return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
          message: parsed.error.errors.map(e => e.message).join("; "),
          details: parsed.error.errors,
        });
      }

      let tag;
      if (parsed.data.tagId) {
        tag = await storage.getTagById(parsed.data.tagId);
        // Cross-org tags are indistinguishable from missing ones
        if (tag && tag.organizationId !== orgId) tag = undefined;
      } else {
        tag = await storage.getTagByName(parsed.data.name!, orgId);
      }
      if (!tag) {
        return apiError(res, 404, "NOT_FOUND", "Tag not found", {
          message: parsed.data.tagId
            ? `No tag found with ID: ${parsed.data.tagId}`
            : `No tag found with name: ${parsed.data.name}`,
        });
      }

      // Idempotent: onConflictDoNothing under the hood
      await storage.addEntityTags(cfg.label, req.params.id, [tag.id], null);

      const entityTags = await storage.getEntityTags(cfg.label, req.params.id);
      return res.json({ data: orgVisibleTags(entityTags, orgId) });
    } catch (error) {
      console.error(`[EXTERNAL-API] Error assigning ${cfg.label} tag:`, error);
      return res.status(500).json({
        error: "Failed to assign tag",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * DELETE /api/v1/external/{entity}/:id/tags/:tagId
   * Remove a tag assignment. Returns 204 even when the assignment did not
   * exist (idempotent); 404 when the record or tag is missing/cross-org.
   */
  router.delete(`/${entityKey}/:id/tags/:tagId`, requirePermission(cfg.writePermission), async (req: ApiKeyRequest, res) => {
    try {
      const orgId = getKeyOrgId(req);
      if (!orgId) return orgBoundRequired(res, "Tag removal");

      const record = await loadTaggableRecord(entityKey, req.params.id, orgId, res);
      if (!record) return;

      const tag = await storage.getTagById(req.params.tagId);
      if (!tag || tag.organizationId !== orgId) {
        return apiError(res, 404, "NOT_FOUND", "Tag not found", {
          message: `No tag found with ID: ${req.params.tagId}`,
        });
      }

      await storage.removeEntityTag(cfg.label, req.params.id, tag.id);
      return res.status(204).send();
    } catch (error) {
      console.error(`[EXTERNAL-API] Error removing ${cfg.label} tag:`, error);
      return res.status(500).json({
        error: "Failed to remove tag",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

// ========== PHASE E: CONTROLLED PATCH ENDPOINTS ==========
// Strict partial updates with per-entity mutable-field allowlists.
// See server/external-patch-config.ts for the allowlists and schemas.

import { MUTABLE_FIELDS, IMMUTABLE_FIELDS, PATCH_SCHEMAS, classifyPatchFields } from "./external-patch-config";

type PatchEntity = "account" | "contact" | "lead" | "opportunity" | "activity";

interface PatchEntityConfig {
  entity: PatchEntity;
  label: string;
  getById: (id: string) => Promise<any>;
  patch: (id: string, orgId: string | undefined, fields: Record<string, any>, expectedUpdatedAt?: Date) => Promise<any>;
}

const PATCH_ENTITIES: Record<string, PatchEntityConfig> = {
  accounts: { entity: "account", label: "Account", getById: (id) => storage.getAccountById(id), patch: (id, o, f, e) => storage.patchAccount(id, o, f, e) },
  contacts: { entity: "contact", label: "Contact", getById: (id) => storage.getContactById(id), patch: (id, o, f, e) => storage.patchContact(id, o, f, e) },
  leads: { entity: "lead", label: "Lead", getById: (id) => storage.getLeadById(id), patch: (id, o, f, e) => storage.patchLead(id, o, f, e) },
  opportunities: { entity: "opportunity", label: "Opportunity", getById: (id) => storage.getOpportunityById(id), patch: (id, o, f, e) => storage.patchOpportunity(id, o, f, e) },
  activities: { entity: "activity", label: "Activity", getById: (id) => storage.getActivityById(id), patch: (id, o, f, e) => storage.patchActivity(id, o, f, e) },
};

async function formatPatchResponse(
  entity: PatchEntity,
  updated: any,
  orgId: string | undefined,
): Promise<Record<string, any>> {
  switch (entity) {
    case "account":
      return formatAccountDetailResponse(updated);
    case "contact":
      return formatContactResponse(updated);
    case "lead": {
      const recordOrgId = updated.organizationId ?? updated.organization_id ?? orgId;
      const organization = recordOrgId
        ? await storage.getOrganizationById(recordOrgId)
        : undefined;
      return formatLeadResponse(updated, organization?.name ?? null);
    }
    case "opportunity":
      return formatOpportunityDetailResponse(updated);
    case "activity":
      return formatActivityResponse(updated);
    default:
      throw new Error(`Unsupported PATCH entity: ${entity}`);
  }
}

function makePatchHandler(cfg: PatchEntityConfig) {
  return async (req: ApiKeyRequest, res: Response) => {
    try {
      const orgId = getKeyOrgId(req);
      const body = req.body;

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return apiError(res, 400, "VALIDATION_ERROR", "Invalid request body", {
          message: "Request body must be a JSON object of fields to update",
        });
      }

      // Immutability check — canonical id, org ownership, createdAt, audit fields
      const { immutable, unknown } = classifyPatchFields(cfg.entity, body);
      if (immutable.length > 0) {
        return apiError(res, 400, "VALIDATION_ERROR", "Immutable fields cannot be modified", {
          message: `The following fields are immutable: ${immutable.join(", ")}`,
          rejectedFields: immutable,
        });
      }

      // Allowlist check — reject unknown fields with the offending keys
      if (unknown.length > 0) {
        return apiError(res, 400, "VALIDATION_ERROR", "Unknown fields rejected", {
          message: `The following fields are not allowed for ${cfg.label} updates: ${unknown.join(", ")}`,
          rejectedFields: unknown,
          allowedFields: MUTABLE_FIELDS[cfg.entity],
        });
      }

      if (Object.keys(body).length === 0) {
        return apiError(res, 400, "VALIDATION_ERROR", "Empty update", {
          message: "Provide at least one field to update",
          allowedFields: MUTABLE_FIELDS[cfg.entity],
        });
      }

      // Value validation for the allowlisted fields
      const parsed = PATCH_SCHEMAS[cfg.entity].safeParse(body);
      if (!parsed.success) {
        return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
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
        return apiError(res, 404, "NOT_FOUND", `${cfg.label} not found`, {
          message: `No ${cfg.label.toLowerCase()} found with ID: ${req.params.id}`,
        });
      }
      if (cfg.entity === "lead" && isArchivedLead(existing)) {
        return apiError(res, 409, "LEAD_ARCHIVED", "Lead is archived", {
          message: "This Lead is archived and must be restored before it can be modified.",
        });
      }

      // Referenced-record ownership: a mutable accountId must point to an
      // account in the record's own organization (tenant-safe relationships)
      if (typeof updates.accountId === "string" && updates.accountId.length > 0) {
        const refAccount = await storage.getAccountById(updates.accountId);
        const recordOrgId = (existing as any).organizationId ?? orgId;
        if (!refAccount || (recordOrgId && refAccount.organizationId !== recordOrgId)) {
          return apiError(res, 404, "NOT_FOUND", "Related account not found", {
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
          return apiError(res, 404, "NOT_FOUND", "Related owner not found", {
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
          return apiError(res, 400, "VALIDATION_ERROR", "Implementation start date must be before end date", {
            message: "implementationStartDate must not be after implementationEndDate",
          });
        }
        if (endDate && billingEnd && new Date(billingEnd) < new Date(endDate)) {
          return apiError(res, 400, "VALIDATION_ERROR", "Billing end date must not be before implementation end date (billing start)", {
            message: "billingEndDate must not be before implementationEndDate",
          });
        }
      }

      // Optional optimistic concurrency: If-Match header carries the ETag the
      // client last saw. On mismatch the write is rejected with 412 so a stale
      // client can never silently overwrite a newer version of the record.
      const ifMatchRaw = req.headers["if-match"];
      const ifMatch = Array.isArray(ifMatchRaw) ? ifMatchRaw.join(",") : ifMatchRaw;
      let expectedUpdatedAt: Date | undefined;
      if (typeof ifMatch === "string") {
        const currentTag = recordETag((existing as any).updatedAt);
        if (evaluateIfMatch(ifMatch, currentTag) !== "match") {
          const staleRes: Record<string, any> = {
            error: "Precondition failed",
            code: "STALE_RECORD",
            message: `The ${cfg.label.toLowerCase()} was modified since you last fetched it. Re-fetch the record and retry with its current version.`,
          };
          if (currentTag) staleRes.currentVersion = currentTag;
          return res.status(412).json(staleRes);
        }
        // A specific entity-tag pins the UPDATE to the version the client saw.
        // If-Match: * only requires that the representation exists; it must not
        // pin the write to a specific updatedAt value.
        if (ifMatch.trim() !== "*") {
          expectedUpdatedAt = new Date((existing as any).updatedAt);
        }
      }

      // Org-scoped update (WHERE also constrains organizationId as defense in
      // depth; when If-Match was supplied, WHERE additionally pins updated_at
      // so a concurrent writer between our read and this UPDATE causes 0 rows)
      const updated = await cfg.patch(req.params.id, orgId, updates, expectedUpdatedAt);
      if (!updated) {
        const recheck = await cfg.getById(req.params.id);
        if (cfg.entity === "lead" && recheck && keyOrgOwns(recheck, orgId) && isArchivedLead(recheck)) {
          return apiError(res, 409, "LEAD_ARCHIVED", "Lead is archived", {
            message: "This Lead is archived and must be restored before it can be modified.",
          });
        }
        // Distinguish "record vanished" (404) from "record changed underneath
        // the conditional update" (412) when an If-Match precondition was used.
        if (expectedUpdatedAt) {
          if (recheck && keyOrgOwns(recheck, orgId)) {
            return res.status(412).json({
              error: "Precondition failed",
              code: "STALE_RECORD",
              message: `The ${cfg.label.toLowerCase()} was modified since you last fetched it. Re-fetch the record and retry with its current version.`,
              currentVersion: recordETag((recheck as any).updatedAt),
            });
          }
        }
        return apiError(res, 404, "NOT_FOUND", `${cfg.label} not found`, {
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

      const updatedPayload = await withLegacyId(
        cfg.label,
        await formatPatchResponse(cfg.entity, updated, orgId) as { id: string },
      );
      attachVersion(res, updatedPayload, (updated as any).updatedAt);
      return res.json({ data: updatedPayload });
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
  // Key-level permission scopes (Phase F): activities require activities.write,
  // all CRM entities require crm.write
  const writePermission = cfg.entity === "activity" ? "activities.write" : "crm.write";
  router.patch(`/${path}/:id`, requirePermission(writePermission), makePatchHandler(cfg));
}

// ========== DOCUMENT REFERENCE ENDPOINTS ==========
// Documents live in external systems (SharePoint, OneDrive, GitHub, ...);
// the CRM stores only the reference (canonical URL + metadata) and links
// to CRM entities. No binaries and no temporary signed URLs.

const DOCUMENT_ENTITY_TYPES = ["account", "opportunity", "contact", "lead"] as const;
type DocEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

/**
 * Reject canonical URLs that carry credentials or temporary signatures.
 * Returns an error string when the URL is unacceptable, null when OK.
 *
 * Checks BOTH the query string and the URL fragment (OAuth implicit-flow
 * tokens arrive as `#access_token=...`), and matches credential parameter
 * names by pattern rather than a fixed list, so spelling variants like
 * `api_key`, `apikey`, `X-Amz-*`, `id_token`, `client_secret` are all caught.
 */
function isCredentialParamName(rawName: string): boolean {
  const name = rawName.toLowerCase();
  // Exact short names used by signed-URL schemes (Azure SAS et al.)
  const exact = new Set([
    "sig", "se", "sp", "sv", "st", "spr", "sr", "skoid", "sktid", // Azure SAS
    "sas", "tempurl", "temp_url_sig", "temp_url_expires",
    "signature", "expires", "awsaccesskeyid", // AWS legacy presigned
    "key", "code",
  ]);
  if (exact.has(name)) return true;
  // Cloud-provider presigned prefixes
  if (name.startsWith("x-amz-") || name.startsWith("x-goog-")) return true;
  // Any parameter whose name contains a credential-ish word
  return /(token|secret|password|passwd|credential|signature|apikey|api_key|api-key|accesskey|access_key|access-key|auth|bearer|session)/.test(name);
}

function findCredentialParam(pairs: Iterable<string>): string | null {
  const keys = Array.from(pairs);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key && isCredentialParamName(key)) return key;
  }
  return null;
}

function validateCanonicalUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "canonicalUrl must be a valid absolute URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "canonicalUrl must use http or https";
  }
  if (url.username || url.password) {
    return "canonicalUrl must not embed credentials";
  }
  // Query string check
  const badQueryParam = findCredentialParam(url.searchParams.keys());
  if (badQueryParam) {
    return `canonicalUrl must be a stable, non-credential URL (query parameter '${badQueryParam}' indicates a temporary, signed, or credential-bearing URL)`;
  }
  // Fragment check: OAuth implicit-flow and similar tokens are delivered in
  // the fragment (e.g., #access_token=...). Parse it as a query string when it
  // contains key=value pairs.
  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (fragment.includes("=")) {
    const fragParams = new URLSearchParams(fragment.startsWith("?") ? fragment.slice(1) : fragment);
    const badFragParam = findCredentialParam(fragParams.keys());
    if (badFragParam) {
      return `canonicalUrl must be a stable, non-credential URL (fragment parameter '${badFragParam}' indicates a credential-bearing URL)`;
    }
  }
  return null;
}

const createDocumentSchema = z.object({
  title: z.string().min(1, "title is required").max(500),
  documentType: z.string().max(100).nullish(),
  sourceSystem: z.string().max(100).nullish(),
  canonicalUrl: z.string().min(1, "canonicalUrl is required").max(2048),
  version: z.string().max(100).nullish(),
  status: z.string().max(50).nullish(),
  mimeType: z.string().max(255).nullish(),
  externalId: z.string().max(255).nullish(),
});

const createDocumentLinkSchema = z.object({
  entityType: z.enum(DOCUMENT_ENTITY_TYPES),
  entityId: z.string().min(1, "entityId is required").max(100),
});

function formatDocumentResponse(doc: any, links?: any[]) {
  const response: any = {
    id: doc.id,
    organizationId: doc.organizationId,
    title: doc.title,
    documentType: doc.documentType ?? null,
    sourceSystem: doc.sourceSystem ?? null,
    canonicalUrl: doc.canonicalUrl,
    version: doc.version ?? null,
    status: doc.status,
    mimeType: doc.mimeType ?? null,
    externalId: doc.externalId ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (links !== undefined) {
    response.links = links.map(l => ({
      entityType: l.entityType,
      entityId: l.entityId,
      createdAt: l.createdAt,
    }));
  }
  return response;
}

/**
 * POST /api/v1/external/documents
 * Create a document reference. Requires an org-bound API key.
 */
router.post("/documents", requirePermission("documents.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Document creation requires an API key bound to an organization",
      });
    }

    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors.map(e => ({ field: e.path.join("."), message: e.message })),
      });
    }
    const data = parsed.data;

    const urlError = validateCanonicalUrl(data.canonicalUrl);
    if (urlError) {
      return res.status(400).json({ error: "Invalid canonicalUrl", message: urlError });
    }

    const doc = await storage.createDocumentReference({
      organizationId: orgId,
      title: data.title,
      documentType: data.documentType ?? null,
      sourceSystem: data.sourceSystem ?? null,
      canonicalUrl: data.canonicalUrl,
      version: data.version ?? null,
      status: data.status ?? "active",
      mimeType: data.mimeType ?? null,
      externalId: data.externalId ?? null,
    });

    return res.status(201).json({ data: formatDocumentResponse(doc, []) });
  } catch (error) {
    console.error("[EXTERNAL-API] Error creating document:", error);
    return res.status(500).json({
      error: "Failed to create document",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/v1/external/documents
 * List document references for the org.
 * Query params: entityType, entityId, updatedSince, limit, offset
 */
router.get("/documents", requirePermission("documents.read"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Document access requires an API key bound to an organization",
      });
    }

    const { entityType, entityId, updatedSince, limit = "100", offset = "0" } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 1000);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);

    if (entityType && !DOCUMENT_ENTITY_TYPES.includes(entityType as DocEntityType)) {
      return res.status(400).json({
        error: "Invalid entityType",
        message: `entityType must be one of: ${DOCUMENT_ENTITY_TYPES.join(", ")}`,
      });
    }

    let sinceDate: Date | undefined;
    if (updatedSince && typeof updatedSince === "string") {
      sinceDate = new Date(updatedSince);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({
          error: "Invalid updatedSince",
          message: "updatedSince must be a valid ISO 8601 timestamp",
        });
      }
    }

    const { data, total } = await storage.listDocumentReferences({
      orgId,
      entityType: entityType as DocEntityType | undefined,
      entityId: entityId as string | undefined,
      updatedSince: sinceDate,
      limit: limitNum,
      offset: offsetNum,
    });

    return res.json({
      data: data.map(d => formatDocumentResponse(d)),
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + data.length < total,
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error listing documents:", error);
    return res.status(500).json({
      error: "Failed to list documents",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/v1/external/documents/:id
 * Retrieve a single document reference (with its entity links).
 */
router.get("/documents/:id", requirePermission("documents.read"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Document access requires an API key bound to an organization",
      });
    }

    const doc = await storage.getDocumentReferenceById(req.params.id, orgId);
    if (!doc) {
      return res.status(404).json({
        error: "Document not found",
        message: `No document found with ID: ${req.params.id}`,
      });
    }

    const links = await storage.getDocumentLinks(doc.id);
    return res.json({ data: formatDocumentResponse(doc, links) });
  } catch (error) {
    console.error("[EXTERNAL-API] Error fetching document:", error);
    return res.status(500).json({
      error: "Failed to fetch document",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /api/v1/external/documents/:id/links
 * Link a document reference to a CRM entity in the same organization.
 * Body: { entityType, entityId }
 */
router.post("/documents/:id/links", requirePermission("documents.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Document linking requires an API key bound to an organization",
      });
    }

    const parsed = createDocumentLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors.map(e => ({ field: e.path.join("."), message: e.message })),
      });
    }
    const { entityType, entityId } = parsed.data;

    const doc = await storage.getDocumentReferenceById(req.params.id, orgId);
    if (!doc) {
      return res.status(404).json({
        error: "Document not found",
        message: `No document found with ID: ${req.params.id}`,
      });
    }

    // Entity must exist and belong to the same organization as the document
    const entityOrgId = await storage.getEntityOrganizationId(entityType, entityId);
    if (!entityOrgId || entityOrgId !== doc.organizationId) {
      return res.status(404).json({
        error: "Entity not found",
        message: `No ${entityType} found with ID: ${entityId}`,
      });
    }

    const { link, created } = await storage.createDocumentLink(doc.id, entityType, entityId);
    return res.status(created ? 201 : 200).json({
      data: {
        documentId: doc.id,
        entityType: link.entityType,
        entityId: link.entityId,
        createdAt: link.createdAt,
      },
      created,
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error linking document:", error);
    return res.status(500).json({
      error: "Failed to link document",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * DELETE /api/v1/external/documents/:id/links/:entityType/:entityId
 * Remove a document-to-entity link.
 */
router.delete("/documents/:id/links/:entityType/:entityId", requirePermission("documents.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return res.status(403).json({
        error: "Organization-bound API key required",
        message: "Document linking requires an API key bound to an organization",
      });
    }

    const { entityType, entityId } = req.params;
    if (!DOCUMENT_ENTITY_TYPES.includes(entityType as DocEntityType)) {
      return res.status(400).json({
        error: "Invalid entityType",
        message: `entityType must be one of: ${DOCUMENT_ENTITY_TYPES.join(", ")}`,
      });
    }

    const doc = await storage.getDocumentReferenceById(req.params.id, orgId);
    if (!doc) {
      return res.status(404).json({
        error: "Document not found",
        message: `No document found with ID: ${req.params.id}`,
      });
    }

    const removed = await storage.deleteDocumentLink(doc.id, entityType as DocEntityType, entityId);
    if (!removed) {
      return res.status(404).json({
        error: "Link not found",
        message: `Document ${doc.id} is not linked to ${entityType} ${entityId}`,
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error("[EXTERNAL-API] Error unlinking document:", error);
    return res.status(500).json({
      error: "Failed to unlink document",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ========== CREATE ACCOUNT / CONTACT / OPPORTUNITY ==========

const optCreateStr = (max: number) => z.string().trim().max(max).nullable().optional();

const externalAccountCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  accountNumber: optCreateStr(100),
  type: z.enum(["customer", "prospect", "partner", "vendor", "other"]).nullable().optional(),
  category: optCreateStr(200),
  ownerId: optCreateStr(50),
  industry: optCreateStr(200),
  website: optCreateStr(500),
  phone: optCreateStr(50),
  billingAddress: optCreateStr(1000),
  shippingAddress: optCreateStr(1000),
  externalId: z.string().trim().min(1).max(100).optional(),
}).strict();

const externalContactCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  accountId: optCreateStr(100),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: optCreateStr(50),
  mobile: optCreateStr(50),
  title: optCreateStr(200),
  department: optCreateStr(200),
  mailingStreet: optCreateStr(300),
  mailingCity: optCreateStr(200),
  mailingState: optCreateStr(100),
  mailingPostalCode: optCreateStr(40),
  mailingCountry: optCreateStr(100),
  description: optCreateStr(5000),
  ownerId: optCreateStr(50),
  externalId: z.string().trim().min(1).max(100).optional(),
}).strict();

const isoCreateDate = z.string().trim().min(1).refine(
  (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isNaN(Date.parse(s)),
  { message: "Must be YYYY-MM-DD or an ISO 8601 timestamp" },
).transform((s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s));
const decimalCreate = z.union([z.number(), z.string()])
  .transform(v => String(v))
  .refine(v => /^-?\d+(\.\d+)?$/.test(v), "Must be a decimal number")
  .nullable();

const externalOpportunityCreateSchema = z.object({
  accountId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  closeDate: isoCreateDate,
  stage: z.enum(["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]).optional(),
  amount: decimalCreate.optional(),
  ownerId: optCreateStr(50),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  status: optCreateStr(100),
  actualCloseDate: isoCreateDate.nullable().optional(),
  actualRevenue: decimalCreate.optional(),
  estCloseDate: isoCreateDate.nullable().optional(),
  estRevenue: decimalCreate.optional(),
  rating: optCreateStr(50),
  includeInForecast: z.boolean().optional(),
  implementationStartDate: isoCreateDate.nullable().optional(),
  implementationEndDate: isoCreateDate.nullable().optional(),
  billingEndDate: isoCreateDate.nullable().optional(),
  description: optCreateStr(10000),
  externalId: z.string().trim().min(1).max(100).optional(),
}).strict();

async function assertOwnerInOrg(ownerId: string | null | undefined, orgId: string, res: Response): Promise<boolean> {
  if (!ownerId) return true;
  const membership = await storage.getOrgMembership(ownerId, orgId);
  if (!membership) {
    apiError(res, 404, "NOT_FOUND", "Related owner not found", {
      message: `No user with ID ${ownerId} is a member of this record's organization`,
    });
    return false;
  }
  return true;
}

router.post("/accounts", requirePermission("crm.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Account creation requires an API key bound to an organization",
      });
    }
    const parsed = externalAccountCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
        message: "The account payload is invalid",
        details: parsed.error.errors.map(e => ({ field: e.path.join(".") || "(root)", message: e.message })),
      });
    }
    const data = parsed.data;
    if (!(await assertOwnerInOrg(data.ownerId, orgId, res))) return;

    const values = {
      name: data.name,
      accountNumber: data.accountNumber ?? null,
      type: data.type ?? null,
      category: data.category ?? null,
      ownerId: data.ownerId ?? null,
      industry: data.industry ?? null,
      website: data.website ?? null,
      phone: data.phone ?? null,
      billingAddress: data.billingAddress ?? null,
      shippingAddress: data.shippingAddress ?? null,
      organizationId: orgId,
      externalId: data.externalId ?? null,
      sourceSystem: `External API (${req.apiKey?.name || "unknown key"})`,
    } as any;

    let account;
    let created = true;
    if (data.externalId) {
      const result = await storage.findOrCreateAccountByExternalId(data.externalId, orgId, values);
      account = result.account;
      created = result.created;
      if (!created) {
        if (account.name === data.name) {
          const payload = await withLegacyId("Account", formatAccountDetailResponse(account));
          attachVersion(res, payload, account.updatedAt);
          return res.status(200).json({ duplicate: true, data: payload });
        }
        return apiError(res, 409, "IDEMPOTENCY_CONFLICT", "External ID already used by a different account", {
          message: `An account with externalId "${data.externalId}" already exists in this organization but has a different name.`,
          existingAccountId: account.id,
        });
      }
    } else {
      account = await storage.createAccount(values);
    }

    const payload = await withLegacyId("Account", formatAccountDetailResponse(account));
    attachVersion(res, payload, account.updatedAt);
    return res.status(201).json({ duplicate: false, data: payload });
  } catch (error) {
    console.error("[EXTERNAL-API] Error creating account:", error);
    return res.status(500).json({ error: "Failed to create account", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.post("/contacts", requirePermission("crm.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Contact creation requires an API key bound to an organization",
      });
    }
    const parsed = externalContactCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
        message: "The contact payload is invalid",
        details: parsed.error.errors.map(e => ({ field: e.path.join(".") || "(root)", message: e.message })),
      });
    }
    const data = parsed.data;
    if (!(await assertOwnerInOrg(data.ownerId, orgId, res))) return;

    if (data.accountId) {
      const refAccount = await storage.getAccountById(data.accountId);
      if (!refAccount || !keyOrgOwns(refAccount, orgId)) {
        return apiError(res, 404, "NOT_FOUND", "Related account not found", {
          message: `No account found with ID: ${data.accountId}`,
        });
      }
    }

    const values = {
      firstName: data.firstName,
      lastName: data.lastName,
      accountId: data.accountId ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      mobile: data.mobile ?? null,
      title: data.title ?? null,
      department: data.department ?? null,
      mailingStreet: data.mailingStreet ?? null,
      mailingCity: data.mailingCity ?? null,
      mailingState: data.mailingState ?? null,
      mailingPostalCode: data.mailingPostalCode ?? null,
      mailingCountry: data.mailingCountry ?? null,
      description: data.description ?? null,
      ownerId: data.ownerId ?? null,
      organizationId: orgId,
      externalId: data.externalId ?? null,
      sourceSystem: `External API (${req.apiKey?.name || "unknown key"})`,
    } as any;

    let contact;
    let created = true;
    if (data.externalId) {
      const result = await storage.findOrCreateContactByExternalId(data.externalId, orgId, values);
      contact = result.contact;
      created = result.created;
      if (!created) {
        const sameIntent =
          contact.firstName === data.firstName &&
          contact.lastName === data.lastName &&
          (normalizeEmail(contact.email) || null) === (normalizeEmail(data.email) || null);
        if (sameIntent) {
          const payload = await withLegacyId("Contact", formatContactResponse(contact));
          attachVersion(res, payload, contact.updatedAt);
          return res.status(200).json({ duplicate: true, data: payload });
        }
        return apiError(res, 409, "IDEMPOTENCY_CONFLICT", "External ID already used by a different contact", {
          message: `A contact with externalId "${data.externalId}" already exists in this organization but has different identity fields.`,
          existingContactId: contact.id,
        });
      }
    } else {
      contact = await storage.createContact(values);
    }

    const payload = await withLegacyId("Contact", formatContactResponse(contact));
    attachVersion(res, payload, contact.updatedAt);
    return res.status(201).json({ duplicate: false, data: payload });
  } catch (error) {
    console.error("[EXTERNAL-API] Error creating contact:", error);
    return res.status(500).json({ error: "Failed to create contact", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.post("/opportunities", requirePermission("crm.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Opportunity creation requires an API key bound to an organization",
      });
    }
    const parsed = externalOpportunityCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
        message: "The opportunity payload is invalid",
        details: parsed.error.errors.map(e => ({ field: e.path.join(".") || "(root)", message: e.message })),
      });
    }
    const data = parsed.data;
    if (!(await assertOwnerInOrg(data.ownerId, orgId, res))) return;

    const refAccount = await storage.getAccountById(data.accountId);
    if (!refAccount || !keyOrgOwns(refAccount, orgId)) {
      return apiError(res, 404, "NOT_FOUND", "Related account not found", {
        message: `No account found with ID: ${data.accountId}`,
      });
    }

    const startDate = data.implementationStartDate ? new Date(data.implementationStartDate) : null;
    const endDate = data.implementationEndDate ? new Date(data.implementationEndDate) : null;
    const billingEnd = data.billingEndDate ? new Date(data.billingEndDate) : null;
    if (startDate && endDate && startDate > endDate) {
      return apiError(res, 400, "VALIDATION_ERROR", "Implementation start date must be before end date", {
        message: "implementationStartDate must not be after implementationEndDate",
      });
    }
    if (endDate && billingEnd && billingEnd < endDate) {
      return apiError(res, 400, "VALIDATION_ERROR", "Billing end date must not be before implementation end date (billing start)", {
        message: "billingEndDate must not be before implementationEndDate",
      });
    }

    const values = {
      accountId: data.accountId,
      name: data.name,
      closeDate: new Date(data.closeDate),
      stage: data.stage ?? "prospecting",
      amount: data.amount ?? null,
      ownerId: data.ownerId ?? null,
      probability: data.probability ?? 0,
      status: data.status ?? null,
      actualCloseDate: data.actualCloseDate ? new Date(data.actualCloseDate) : null,
      actualRevenue: data.actualRevenue ?? null,
      estCloseDate: data.estCloseDate ? new Date(data.estCloseDate) : null,
      estRevenue: data.estRevenue ?? null,
      rating: data.rating ?? null,
      includeInForecast: data.includeInForecast ?? true,
      implementationStartDate: startDate,
      implementationEndDate: endDate,
      billingEndDate: billingEnd,
      description: data.description ?? null,
      organizationId: orgId,
      externalId: data.externalId ?? null,
      sourceSystem: `External API (${req.apiKey?.name || "unknown key"})`,
    } as any;

    let opportunity;
    let created = true;
    if (data.externalId) {
      const result = await storage.findOrCreateOpportunityByExternalId(data.externalId, orgId, values);
      opportunity = result.opportunity;
      created = result.created;
      if (!created) {
        if (opportunity.name === data.name && opportunity.accountId === data.accountId) {
          const payload = await withLegacyId("Opportunity", formatOpportunityDetailResponse(opportunity));
          attachVersion(res, payload, opportunity.updatedAt);
          return res.status(200).json({ duplicate: true, data: payload });
        }
        return apiError(res, 409, "IDEMPOTENCY_CONFLICT", "External ID already used by a different opportunity", {
          message: `An opportunity with externalId "${data.externalId}" already exists in this organization but has a different name or account.`,
          existingOpportunityId: opportunity.id,
        });
      }
    } else {
      opportunity = await storage.createOpportunity(values);
    }

    const payload = await withLegacyId("Opportunity", formatOpportunityDetailResponse(opportunity));
    attachVersion(res, payload, opportunity.updatedAt);
    return res.status(201).json({ duplicate: false, data: payload });
  } catch (error) {
    console.error("[EXTERNAL-API] Error creating opportunity:", error);
    return res.status(500).json({ error: "Failed to create opportunity", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

const externalLeadConvertSchema = z.object({
  accountId: z.string().trim().min(1).max(100).optional(),
  createAccount: z.boolean().optional(),
  account: z.object({
    name: z.string().trim().min(1).max(300).optional(),
    type: z.enum(["customer", "prospect", "partner", "vendor", "other"]).optional(),
    industry: optCreateStr(200),
    website: optCreateStr(500),
    phone: optCreateStr(50),
    billingAddress: optCreateStr(1000),
    shippingAddress: optCreateStr(1000),
  }).strict().optional(),
  createContact: z.boolean().optional(),
  createOpportunity: z.boolean().optional(),
  includeInForecast: z.boolean().optional(),
  opportunity: z.object({
    name: z.string().trim().min(1).max(300).optional(),
    amount: decimalCreate.optional(),
    stage: z.enum(["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]).optional(),
    closeDate: isoCreateDate.optional(),
    probability: z.number().int().min(0).max(100).optional(),
  }).strict().optional(),
}).strict();

router.post("/leads/:id/convert", requirePermission("crm.write"), async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Lead conversion requires an API key bound to an organization",
      });
    }
    if (!req.params.id.startsWith("LEAD-")) {
      return apiError(res, 404, "NOT_FOUND", "Lead not found", {
        message: `No lead found with ID: ${req.params.id}`,
      });
    }
    const parsed = externalLeadConvertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
        message: "The convert payload is invalid",
        details: parsed.error.errors.map(e => ({ field: e.path.join(".") || "(root)", message: e.message })),
      });
    }
    const data = parsed.data;
    const result = await storage.convertLead(req.params.id, orgId, {
      accountId: data.accountId,
      createAccount: data.accountId ? false : data.createAccount !== false,
      accountData: data.account,
      createContact: data.createContact !== false,
      createOpportunity: data.createOpportunity === true,
      opportunityData: data.opportunity
        ? { ...data.opportunity, includeInForecast: data.includeInForecast }
        : (data.includeInForecast !== undefined ? { includeInForecast: data.includeInForecast } : undefined),
    });

    if (result.status === "not_found") {
      return apiError(res, 404, "NOT_FOUND", "Lead not found", {
        message: `No lead found with ID: ${req.params.id}`,
      });
    }
    if (result.status === "archived") {
      return apiError(res, 409, "LEAD_ARCHIVED", "Lead is archived", {
        message: "This Lead is archived and must be restored before it can be converted.",
      });
    }
    if (result.status === "bad_account") {
      return apiError(res, 404, "NOT_FOUND", "Related account not found", {
        message: `No account found with ID: ${data.accountId}`,
      });
    }
    if (result.status === "conflict") {
      return apiError(res, 409, "CONVERSION_CONFLICT", "Lead already converted with different targets", {
        message: "This lead was already converted to a different account. The existing conversion was not changed.",
      });
    }

    const organization = await storage.getOrganizationById(orgId);
    const leadPayload = await withLegacyId("Lead", formatLeadResponse(result.lead, organization?.name ?? null));
    let accountPayload = null;
    let contactPayload = null;
    let opportunityPayload = null;
    const accountId = result.status === "already_converted" ? result.accountId : result.account?.id ?? null;
    const contactId = result.status === "already_converted" ? result.contactId : result.contact?.id ?? null;
    const opportunityId = result.status === "already_converted" ? result.opportunityId : result.opportunity?.id ?? null;
    if (accountId) {
      const account = result.status === "converted" ? result.account : await storage.getAccountById(accountId);
      if (account) accountPayload = await withLegacyId("Account", formatAccountDetailResponse(account));
    }
    if (contactId) {
      const contact = result.status === "converted" ? result.contact : await storage.getContactById(contactId);
      if (contact) contactPayload = await withLegacyId("Contact", formatContactResponse(contact));
    }
    if (opportunityId) {
      const opportunity = result.status === "converted" ? result.opportunity : await storage.getOpportunityById(opportunityId);
      if (opportunity) opportunityPayload = await withLegacyId("Opportunity", formatOpportunityDetailResponse(opportunity));
    }

    attachVersion(res, leadPayload, result.lead.updatedAt);
    const created = result.status === "converted";
    return res.status(created ? 201 : 200).json({
      converted: true,
      created,
      data: {
        lead: leadPayload,
        
        // Stable convenience IDs retained at the top level for external API clients.
        accountId,
        contactId,
        opportunityId,

        // Full related resources.
        account: accountPayload,
        contact: contactPayload,
        opportunity: opportunityPayload,
        conversion: {
          leadId: result.lead.id,
          accountId,
          contactId,
          opportunityId,
        },
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error converting lead:", error);
    return res.status(500).json({ error: "Failed to convert lead", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

// ========== COMMENTS ==========

const COMMENT_ROUTE_ENTITIES: Record<string, {
  label: CommentEntity;
  readPermission: Parameters<typeof requirePermission>[0];
  writePermission: Parameters<typeof requirePermission>[0];
  getById: (id: string, orgId: string) => Promise<any>;
}> = {
  accounts: { label: "Account", readPermission: "crm.read", writePermission: "crm.write", getById: (id) => storage.getAccountById(id) },
  contacts: { label: "Contact", readPermission: "crm.read", writePermission: "crm.write", getById: (id) => storage.getContactById(id) },
  leads: { label: "Lead", readPermission: "crm.read", writePermission: "crm.write", getById: (id) => storage.getLeadById(id) },
  opportunities: { label: "Opportunity", readPermission: "crm.read", writePermission: "crm.write", getById: (id) => storage.getOpportunityById(id) },
  activities: { label: "Activity", readPermission: "activities.read", writePermission: "activities.write", getById: (id, orgId) => storage.getActivityById(id, orgId) },
};

const externalCommentCreateSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  parentId: z.string().trim().min(1).max(50).optional(),
}).strict();

const firstClassCommentCreateSchema = z.object({
  entityType: z.enum(["account", "contact", "lead", "opportunity", "activity"]),
  entityId: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(10000),
  parentId: z.string().trim().min(1).max(50).optional(),
}).strict();

const ENTITY_TYPE_TO_ROUTE: Record<string, string> = {
  account: "accounts",
  contact: "contacts",
  lead: "leads",
  opportunity: "opportunities",
  activity: "activities",
};

router.post("/comments", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Comment creation requires an API key bound to an organization",
      });
    }
    const parsed = firstClassCommentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
        message: "The comment payload is invalid",
        details: parsed.error.errors.map(e => ({ field: e.path.join(".") || "(root)", message: e.message })),
      });
    }
    const routeKey = ENTITY_TYPE_TO_ROUTE[parsed.data.entityType];
    const cfg = COMMENT_ROUTE_ENTITIES[routeKey];
    const granted = req.apiKey?.permissions ?? [];
    if (!granted.includes(cfg.writePermission)) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Insufficient permissions", {
        message: `This API key does not have the '${cfg.writePermission}' permission required for this operation`,
        requiredPermission: cfg.writePermission,
      });
    }
    const parent = await cfg.getById(parsed.data.entityId, orgId);
    if (!parent || (routeKey !== "activities" && !keyOrgOwns(parent, orgId))) {
      return apiError(res, 404, "NOT_FOUND", `${cfg.label} not found`, {
        message: `No ${cfg.label.toLowerCase()} found with ID: ${parsed.data.entityId}`,
      });
    }
    const createdBy = req.apiKey?.createdBy;
    if (!createdBy) {
      return res.status(500).json({ error: "Failed to create comment", message: "API key has no owning user" });
    }
    let depth = 0;
    if (parsed.data.parentId) {
      const [parentComment] = await db.select().from(comments).where(eq(comments.id, parsed.data.parentId)).limit(1);
      if (!parentComment || parentComment.entity !== cfg.label || parentComment.entityId !== parent.id) {
        return apiError(res, 400, "VALIDATION_ERROR", "Invalid parent comment", {
          message: "parentId must refer to a comment on the same record",
        });
      }
      depth = parentComment.depth + 1;
      if (depth > 2) {
        return apiError(res, 400, "VALIDATION_ERROR", "Maximum comment depth exceeded", {
          message: "Comments may be nested at most 2 levels",
        });
      }
    }
    const [created] = await db.insert(comments).values({
      entity: cfg.label,
      entityId: parent.id,
      body: parsed.data.body,
      parentId: parsed.data.parentId || null,
      depth,
      createdBy,
    }).returning();
    const author = await storage.getUserById(createdBy);
    return res.status(201).json({ data: formatExternalComment(created, author?.name ?? null) });
  } catch (error) {
    console.error("[EXTERNAL-API] Error creating comment:", error);
    return res.status(500).json({ error: "Failed to create comment", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.get("/comments", async (req: ApiKeyRequest, res) => {
  try {
    const orgId = getKeyOrgId(req);
    if (!orgId) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
        message: "Comment access requires an API key bound to an organization",
      });
    }
    const entityType = qs(req.query.entityType);
    const entityId = qs(req.query.entityId);
    if (!entityType || !entityId || !ENTITY_TYPE_TO_ROUTE[entityType]) {
      return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
        message: "entityType and entityId are required; entityType must be account, contact, lead, opportunity, or activity",
      });
    }
    const routeKey = ENTITY_TYPE_TO_ROUTE[entityType];
    const cfg = COMMENT_ROUTE_ENTITIES[routeKey];
    const granted = req.apiKey?.permissions ?? [];
    if (!granted.includes(cfg.readPermission)) {
      return apiError(res, 403, "INSUFFICIENT_SCOPE", "Insufficient permissions", {
        requiredPermission: cfg.readPermission,
      });
    }
    const parent = await loadRecordForRead(cfg.label, (id) => cfg.getById(id, orgId), entityId, orgId);
    if (!parent || (routeKey !== "activities" && !keyOrgOwns(parent, orgId))) {
      return apiError(res, 404, "NOT_FOUND", `${cfg.label} not found`, {
        message: `No ${cfg.label.toLowerCase()} found with ID: ${entityId}`,
      });
    }
    const limitNum = Math.min(Math.max(parseInt(String(req.query.limit || "100"), 10) || 100, 1), 1000);
    const offsetNum = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
    const aliases = commentEntityAliases(cfg.label);
    const rows = await db.select({
      comment: comments,
      createdByName: users.name,
    }).from(comments)
      .leftJoin(users, eq(comments.createdBy, users.id))
      .where(and(inArray(comments.entity, aliases), eq(comments.entityId, parent.id)))
      .orderBy(desc(comments.createdAt))
      .limit(limitNum)
      .offset(offsetNum);
    const [{ count: total }] = await db.select({ count: sql<number>`count(*)` })
      .from(comments)
      .where(and(inArray(comments.entity, aliases), eq(comments.entityId, parent.id)));
    return res.json({
      data: rows.map(r => formatExternalComment(r.comment, r.createdByName ?? null)),
      pagination: {
        total: Number(total),
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + rows.length < Number(total),
      },
    });
  } catch (error) {
    console.error("[EXTERNAL-API] Error listing comments:", error);
    return res.status(500).json({ error: "Failed to list comments", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

function formatExternalComment(row: any, createdByName: string | null) {
  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entityId,
    parentId: row.parentId ?? null,
    depth: row.depth,
    body: row.body,
    createdBy: row.createdBy,
    createdByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

for (const [entityKey, cfg] of Object.entries(COMMENT_ROUTE_ENTITIES)) {
  router.get(`/${entityKey}/:id/comments`, requirePermission(cfg.readPermission), async (req: ApiKeyRequest, res) => {
    try {
      const orgId = getKeyOrgId(req);
      if (!orgId) {
        return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
          message: "Comment access requires an API key bound to an organization",
        });
      }
      const parent = await loadRecordForRead(cfg.label, (id) => cfg.getById(id, orgId), req.params.id, orgId);
      if (!parent || (entityKey !== "activities" && !keyOrgOwns(parent, orgId))) {
        return apiError(res, 404, "NOT_FOUND", `${cfg.label} not found`, {
          message: `No ${cfg.label.toLowerCase()} found with ID: ${req.params.id}`,
        });
      }
      const limitNum = Math.min(Math.max(parseInt(String(req.query.limit || "100"), 10) || 100, 1), 1000);
      const offsetNum = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
      const aliases = commentEntityAliases(cfg.label);
      const rows = await db.select({
        comment: comments,
        createdByName: users.name,
      }).from(comments)
        .leftJoin(users, eq(comments.createdBy, users.id))
        .where(and(inArray(comments.entity, aliases), eq(comments.entityId, parent.id)))
        .orderBy(desc(comments.createdAt))
        .limit(limitNum)
        .offset(offsetNum);
      const [{ count: total }] = await db.select({ count: sql<number>`count(*)` })
        .from(comments)
        .where(and(inArray(comments.entity, aliases), eq(comments.entityId, parent.id)));
      return res.json({
        data: rows.map(r => formatExternalComment(r.comment, r.createdByName ?? null)),
        pagination: {
          total: Number(total),
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + rows.length < Number(total),
        },
      });
    } catch (error) {
      console.error(`[EXTERNAL-API] Error listing ${cfg.label} comments:`, error);
      return res.status(500).json({ error: "Failed to list comments", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  router.post(`/${entityKey}/:id/comments`, requirePermission(cfg.writePermission), async (req: ApiKeyRequest, res) => {
    try {
      const orgId = getKeyOrgId(req);
      if (!orgId) {
        return apiError(res, 403, "INSUFFICIENT_SCOPE", "Organization-bound API key required", {
          message: "Comment creation requires an API key bound to an organization",
        });
      }
      const parent = await cfg.getById(req.params.id, orgId);
      if (!parent || (entityKey !== "activities" && !keyOrgOwns(parent, orgId))) {
        return apiError(res, 404, "NOT_FOUND", `${cfg.label} not found`, {
          message: `No ${cfg.label.toLowerCase()} found with ID: ${req.params.id}`,
        });
      }
      const parsed = externalCommentCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return apiError(res, 400, "VALIDATION_ERROR", "Validation failed", {
          message: "The comment payload is invalid",
          details: parsed.error.errors.map(e => ({ field: e.path.join(".") || "(root)", message: e.message })),
        });
      }
      const createdBy = req.apiKey?.createdBy;
      if (!createdBy) {
        return res.status(500).json({ error: "Failed to create comment", message: "API key has no owning user" });
      }
      let depth = 0;
      if (parsed.data.parentId) {
        const [parentComment] = await db.select().from(comments).where(eq(comments.id, parsed.data.parentId)).limit(1);
        if (!parentComment || parentComment.entity !== cfg.label || parentComment.entityId !== parent.id) {
          return apiError(res, 400, "VALIDATION_ERROR", "Invalid parent comment", {
            message: "parentId must refer to a comment on the same record",
          });
        }
        depth = parentComment.depth + 1;
        if (depth > 2) {
          return apiError(res, 400, "VALIDATION_ERROR", "Maximum comment depth exceeded", {
            message: "Comments may be nested at most 2 levels",
          });
        }
      }
      const [created] = await db.insert(comments).values({
        entity: cfg.label,
        entityId: parent.id,
        body: parsed.data.body,
        parentId: parsed.data.parentId || null,
        depth,
        createdBy,
      }).returning();
      const author = await storage.getUserById(createdBy);
      return res.status(201).json({ data: formatExternalComment(created, author?.name ?? null) });
    } catch (error) {
      console.error(`[EXTERNAL-API] Error creating ${cfg.label} comment:`, error);
      return res.status(500).json({ error: "Failed to create comment", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });
}

export default router;
