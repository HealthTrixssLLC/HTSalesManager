#!/usr/bin/env node
/**
 * Health Trixss CRM — MCP Server
 *
 * Exposes CRM data (accounts, contacts, leads, opportunities, activities,
 * lead-generation) as callable MCP tools for any MCP-compatible AI agent.
 *
 * Required environment variables:
 *   CRM_BASE_URL   – Base URL of the running CRM instance (e.g. https://your-crm.repl.co)
 *   CRM_API_KEY    – API key generated from the Admin Console → API Keys tab
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const CRM_BASE_URL = (process.env.CRM_BASE_URL || "").replace(/\/$/, "");
const CRM_API_KEY = process.env.CRM_API_KEY || "";

if (!CRM_BASE_URL || !CRM_API_KEY) {
  console.error("[CRM-MCP] Fatal: CRM_BASE_URL and CRM_API_KEY must be set.");
  process.exit(1);
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function crmFetch(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<CallToolResult> {
  const url = `${CRM_BASE_URL}${path}`;
  const method = options.method ?? "GET";

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "x-api-key": CRM_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const msg =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, string>).error ??
            (parsed as Record<string, string>).message ??
            text
          : text;
      return {
        isError: true,
        content: [{ type: "text", text: `HTTP ${res.status}: ${msg}` }],
      };
    }

    return {
      content: [
        { type: "text", text: typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2) },
      ],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  // ── ACCOUNTS ──────────────────────────────────────────────────────────────
  {
    name: "list_accounts",
    description:
      "List CRM accounts with optional filtering. Returns a JSON array of account objects.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Full-text search across account name, number, industry, and website.",
        },
        type: {
          type: "string",
          description: 'Filter by account type (e.g. "customer", "partner", "prospect", "vendor").',
        },
        category: { type: "string", description: "Filter by account category." },
        ownerId: { type: "string", description: "Filter by owner user ID." },
        sortBy: { type: "string", description: 'Field to sort by (default: "name").' },
        sortOrder: {
          type: "string",
          enum: ["asc", "desc"],
          description: 'Sort direction (default: "asc").',
        },
      },
    },
  },
  {
    name: "get_account",
    description: "Retrieve a single CRM account by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Account ID (e.g. ACCT-2025-00001)." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_account",
    description: "Create a new CRM account.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Account name (required)." },
        type: {
          type: "string",
          description: 'Account type: "customer", "partner", "prospect", "vendor", or "other".',
        },
        category: { type: "string", description: "Industry category (e.g. Hospital, Clinic)." },
        industry: { type: "string", description: "Industry segment." },
        website: { type: "string", description: "Company website URL." },
        phone: { type: "string", description: "Primary phone number." },
        email: { type: "string", description: "Primary email address." },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zipCode: { type: "string" },
        country: { type: "string" },
        description: { type: "string" },
        ownerId: { type: "string", description: "User ID of the account owner." },
        externalId: { type: "string", description: "ID from an external system (e.g. Salesforce)." },
      },
      required: ["name"],
    },
  },
  {
    name: "update_account",
    description: "Update fields on an existing CRM account.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Account ID to update." },
        name: { type: "string" },
        type: { type: "string" },
        category: { type: "string" },
        industry: { type: "string" },
        website: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zipCode: { type: "string" },
        country: { type: "string" },
        description: { type: "string" },
        ownerId: { type: "string" },
        externalId: { type: "string" },
      },
      required: ["id"],
    },
  },

  // ── CONTACTS ──────────────────────────────────────────────────────────────
  {
    name: "list_contacts",
    description: "List CRM contacts with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Search by name, email, or phone.",
        },
        accountId: { type: "string", description: "Filter by parent account ID." },
        sortBy: { type: "string" },
        sortOrder: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "get_contact",
    description: "Retrieve a single CRM contact by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Contact ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_contact",
    description: "Create a new CRM contact.",
    inputSchema: {
      type: "object",
      properties: {
        firstName: { type: "string", description: "First name (required)." },
        lastName: { type: "string", description: "Last name (required)." },
        email: { type: "string", description: "Email address." },
        phone: { type: "string" },
        mobile: { type: "string" },
        title: { type: "string", description: "Job title." },
        department: { type: "string" },
        accountId: { type: "string", description: "Parent account ID." },
        ownerId: { type: "string" },
        description: { type: "string" },
        externalId: { type: "string" },
      },
      required: ["firstName", "lastName"],
    },
  },
  {
    name: "update_contact",
    description: "Update fields on an existing CRM contact.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Contact ID to update." },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        mobile: { type: "string" },
        title: { type: "string" },
        department: { type: "string" },
        accountId: { type: "string" },
        ownerId: { type: "string" },
        description: { type: "string" },
        externalId: { type: "string" },
      },
      required: ["id"],
    },
  },

  // ── LEADS ─────────────────────────────────────────────────────────────────
  {
    name: "list_leads",
    description: "List CRM leads with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search across name, company, email." },
        status: {
          type: "string",
          description: 'Lead status filter: "new", "contacted", "qualified", "unqualified", "converted".',
        },
        ownerId: { type: "string" },
        sortBy: { type: "string" },
        sortOrder: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "get_lead",
    description: "Retrieve a single CRM lead by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Lead ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_lead",
    description: "Create a new CRM lead.",
    inputSchema: {
      type: "object",
      properties: {
        firstName: { type: "string", description: "First name (required)." },
        lastName: { type: "string", description: "Last name (required)." },
        email: { type: "string" },
        phone: { type: "string" },
        company: { type: "string", description: "Lead's company name." },
        title: { type: "string" },
        source: { type: "string", description: 'Lead source (e.g. "web", "referral", "event").' },
        status: { type: "string", description: 'Status: "new", "contacted", "qualified".' },
        ownerId: { type: "string" },
        description: { type: "string" },
        externalId: { type: "string" },
      },
      required: ["firstName", "lastName"],
    },
  },
  {
    name: "update_lead",
    description: "Update fields on an existing CRM lead.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Lead ID to update." },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        company: { type: "string" },
        title: { type: "string" },
        source: { type: "string" },
        status: { type: "string" },
        ownerId: { type: "string" },
        description: { type: "string" },
        externalId: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "convert_lead",
    description:
      "Convert a CRM lead into an Account, Contact, and/or Opportunity. " +
      "Pass createAccount/createContact/createOpportunity flags to control what gets created.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Lead ID to convert." },
        createAccount: {
          type: "boolean",
          description: "Create an Account from the lead's company info.",
        },
        createContact: {
          type: "boolean",
          description: "Create a Contact from the lead.",
        },
        createOpportunity: {
          type: "boolean",
          description: "Create an Opportunity linked to the new Account.",
        },
        opportunityName: { type: "string", description: "Name for the new Opportunity (if created)." },
        opportunityStage: { type: "string", description: "Pipeline stage for the new Opportunity." },
        opportunityAmount: { type: "number", description: "Estimated deal value." },
        opportunityCloseDate: {
          type: "string",
          description: "Expected close date (ISO 8601 date, e.g. 2025-12-31).",
        },
        accountId: {
          type: "string",
          description: "Existing Account ID to link to instead of creating a new one.",
        },
      },
      required: ["id"],
    },
  },

  // ── OPPORTUNITIES ─────────────────────────────────────────────────────────
  {
    name: "list_opportunities",
    description: "List CRM opportunities with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search across opportunity name and ID." },
        stage: { type: "string", description: "Filter by pipeline stage." },
        accountId: { type: "string", description: "Filter by parent account ID." },
        ownerId: { type: "string" },
        sortBy: { type: "string" },
        sortOrder: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "get_opportunity",
    description: "Retrieve a single CRM opportunity by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Opportunity ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_opportunity",
    description: "Create a new CRM opportunity.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Opportunity name (required)." },
        accountId: { type: "string", description: "Parent account ID (required)." },
        stage: { type: "string", description: "Pipeline stage (required)." },
        amount: { type: "number", description: "Deal value." },
        closeDate: { type: "string", description: "Expected close date (ISO 8601)." },
        probability: { type: "number", description: "Win probability (0–100)." },
        ownerId: { type: "string" },
        description: { type: "string" },
        leadSource: { type: "string" },
        includeInForecast: { type: "boolean" },
        rating: { type: "string", description: '"Hot", "Warm", or "Cold".' },
        externalId: { type: "string" },
      },
      required: ["name", "accountId", "stage"],
    },
  },
  {
    name: "update_opportunity",
    description: "Update fields on an existing CRM opportunity.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Opportunity ID to update." },
        name: { type: "string" },
        accountId: { type: "string" },
        stage: { type: "string" },
        amount: { type: "number" },
        closeDate: { type: "string" },
        probability: { type: "number" },
        ownerId: { type: "string" },
        description: { type: "string" },
        leadSource: { type: "string" },
        includeInForecast: { type: "boolean" },
        rating: { type: "string" },
        status: { type: "string" },
        externalId: { type: "string" },
      },
      required: ["id"],
    },
  },

  // ── ACTIVITIES ────────────────────────────────────────────────────────────
  {
    name: "list_activities",
    description:
      "List CRM activities. Use 'filter' to narrow to upcoming, pending, or all activities.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["all", "upcoming", "pending"],
          description:
            '"upcoming" returns scheduled future activities; "pending" returns incomplete tasks; "all" (default) returns everything.',
        },
        ownerId: { type: "string", description: "Filter by assigned user ID." },
        type: {
          type: "string",
          description: 'Activity type: "call", "email", "meeting", "task", "note".',
        },
      },
    },
  },
  {
    name: "create_activity",
    description: "Create a new CRM activity (call, email, meeting, task, or note).",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["call", "email", "meeting", "task", "note"],
          description: "Activity type (required).",
        },
        subject: { type: "string", description: "Activity subject / title (required)." },
        description: { type: "string" },
        status: {
          type: "string",
          description: '"planned", "completed", "cancelled".',
        },
        priority: {
          type: "string",
          description: '"low", "medium", "high".',
        },
        dueAt: { type: "string", description: "Due date/time (ISO 8601 datetime, e.g. 2025-12-31T14:00:00Z)." },
        completedAt: { type: "string", description: "Completion datetime (ISO 8601)." },
        ownerId: { type: "string" },
        relatedType: {
          type: "string",
          description: 'Entity type to link to: "Account", "Contact", "Lead", "Opportunity".',
        },
        relatedId: { type: "string", description: "ID of the related entity." },
        notes: { type: "string", description: "Activity notes or body text." },
      },
      required: ["type", "subject"],
    },
  },
  {
    name: "update_activity",
    description: "Update fields on an existing CRM activity.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Activity ID to update." },
        type: { type: "string" },
        subject: { type: "string" },
        notes: { type: "string", description: "Activity notes or body text." },
        status: { type: "string" },
        priority: { type: "string" },
        dueAt: { type: "string", description: "Due date/time (ISO 8601 datetime)." },
        completedAt: { type: "string" },
        ownerId: { type: "string" },
      },
      required: ["id"],
    },
  },

  // ── LEAD GENERATION ───────────────────────────────────────────────────────
  {
    name: "list_icps",
    description:
      "List all Ideal Customer Profile (ICP) definitions used by the Lead Generation module.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_icp",
    description: "Create a new Ideal Customer Profile (ICP) for lead generation.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "ICP name (required)." },
        description: { type: "string" },
        isActive: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_playbooks",
    description: "List all outreach task playbooks for the Lead Generation module.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_playbook",
    description: "Create a new outreach task playbook.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Playbook name (required)." },
        description: { type: "string" },
        icpProfileId: { type: "string", description: "ICP profile ID to associate with." },
        isActive: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_runs",
    description: "List all Lead Generation runs.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "start_run",
    description:
      "Create and immediately start a Lead Generation run using the specified ICP profile and playbook.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Run name (required)." },
        icpProfileId: { type: "string", description: "ICP profile ID to use." },
        playbookId: { type: "string", description: "Playbook ID to use." },
        targetCount: {
          type: "number",
          description: "Target number of candidate leads to generate.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_candidates",
    description: "List candidate leads produced by Lead Generation runs.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Filter candidates by run ID." },
        status: {
          type: "string",
          description:
            'Filter by review status: "pending_review", "approved", "rejected", "deferred", "converted".',
        },
        page: { type: "number", description: "Page number (1-based, default 1)." },
        limit: { type: "number", description: "Items per page (default 20, max 100)." },
      },
    },
  },
  {
    name: "research_candidate",
    description:
      "Retrieve detailed research data (evidence, scores, research documents) for a specific candidate lead.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Candidate lead ID." },
      },
      required: ["id"],
    },
  },

  // ── GLOBAL SEARCH ─────────────────────────────────────────────────────────
  {
    name: "global_search",
    description:
      "Search across all CRM entities (accounts, contacts, leads, opportunities) with a single query string.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search query string (required)." },
        type: {
          type: "string",
          description: 'Optional entity type filter: "Account", "Contact", "Lead", "Opportunity" (case-sensitive).',
        },
      },
      required: ["q"],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

function qs(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

async function handleTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    // ACCOUNTS
    case "list_accounts": {
      const { search, type, category, ownerId, sortBy, sortOrder } = args;
      return crmFetch(`/api/accounts${qs({ search, type, category, ownerId, sortBy, sortOrder })}`);
    }
    case "get_account":
      return crmFetch(`/api/accounts/${args.id}`);
    case "create_account": {
      const { id: _id, ...body } = args;
      return crmFetch("/api/accounts", { method: "POST", body });
    }
    case "update_account": {
      const { id, ...body } = args;
      return crmFetch(`/api/accounts/${id}`, { method: "PATCH", body });
    }

    // CONTACTS
    case "list_contacts": {
      const { search, accountId, sortBy, sortOrder } = args;
      return crmFetch(`/api/contacts${qs({ search, accountId, sortBy, sortOrder })}`);
    }
    case "get_contact":
      return crmFetch(`/api/contacts/${args.id}`);
    case "create_contact": {
      const { id: _id, ...body } = args;
      return crmFetch("/api/contacts", { method: "POST", body });
    }
    case "update_contact": {
      const { id, ...body } = args;
      return crmFetch(`/api/contacts/${id}`, { method: "PATCH", body });
    }

    // LEADS
    case "list_leads": {
      const { search, status, ownerId, sortBy, sortOrder } = args;
      return crmFetch(`/api/leads${qs({ search, status, ownerId, sortBy, sortOrder })}`);
    }
    case "get_lead":
      return crmFetch(`/api/leads/${args.id}`);
    case "create_lead": {
      const { id: _id, ...body } = args;
      return crmFetch("/api/leads", { method: "POST", body });
    }
    case "update_lead": {
      const { id, ...body } = args;
      return crmFetch(`/api/leads/${id}`, { method: "PATCH", body });
    }
    case "convert_lead": {
      const { id, ...body } = args;
      return crmFetch(`/api/leads/${id}/convert`, { method: "POST", body });
    }

    // OPPORTUNITIES
    case "list_opportunities": {
      const { search, stage, accountId, ownerId, sortBy, sortOrder } = args;
      return crmFetch(`/api/opportunities${qs({ search, stage, accountId, ownerId, sortBy, sortOrder })}`);
    }
    case "get_opportunity":
      return crmFetch(`/api/opportunities/${args.id}`);
    case "create_opportunity": {
      const { id: _id, ...body } = args;
      return crmFetch("/api/opportunities", { method: "POST", body });
    }
    case "update_opportunity": {
      const { id, ...body } = args;
      return crmFetch(`/api/opportunities/${id}`, { method: "PATCH", body });
    }

    // ACTIVITIES
    case "list_activities": {
      const { filter, ownerId, type } = args;
      if (filter === "upcoming") {
        return crmFetch(`/api/activities/upcoming${qs({ ownerId, type })}`);
      }
      if (filter === "pending") {
        return crmFetch(`/api/activities/pending${qs({ ownerId, type })}`);
      }
      return crmFetch(`/api/activities${qs({ ownerId, type })}`);
    }
    case "create_activity": {
      const { id: _id, ...body } = args;
      return crmFetch("/api/activities", { method: "POST", body });
    }
    case "update_activity": {
      const { id, ...body } = args;
      return crmFetch(`/api/activities/${id}`, { method: "PATCH", body });
    }

    // LEAD GENERATION
    case "list_icps":
      return crmFetch("/api/lead-gen/icps");
    case "create_icp": {
      const { id: _id, ...body } = args;
      return crmFetch("/api/lead-gen/icps", { method: "POST", body });
    }
    case "list_playbooks":
      return crmFetch("/api/lead-gen/playbooks");
    case "create_playbook": {
      const { id: _id, ...body } = args;
      return crmFetch("/api/lead-gen/playbooks", { method: "POST", body });
    }
    case "list_runs":
      return crmFetch("/api/lead-gen/runs");
    case "start_run": {
      // Create the run first, then start it
      const { name, icpProfileId, playbookId, targetCount } = args;
      const createResult = await crmFetch("/api/lead-gen/runs", {
        method: "POST",
        body: { name, icpProfileId, playbookId, targetCount },
      });
      if (createResult.isError) return createResult;

      // Extract the created run ID
      try {
        const created = JSON.parse(
          (createResult.content[0] as { type: string; text: string }).text
        ) as { id: string };
        return crmFetch(`/api/lead-gen/runs/${created.id}/start`, { method: "POST", body: {} });
      } catch {
        return {
          isError: true,
          content: [{ type: "text", text: "Run created but could not parse response to start it." }],
        };
      }
    }
    case "list_candidates": {
      const { runId, status, page, limit } = args;
      return crmFetch(`/api/lead-gen/candidates${qs({ runId, status, page, limit })}`);
    }
    case "research_candidate":
      return crmFetch(`/api/lead-gen/candidates/${args.id}`);

    // GLOBAL SEARCH
    case "global_search": {
      const { q, type } = args;
      return crmFetch(`/api/entities/search${qs({ q, type })}`);
    }

    default:
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
  }
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

const server = new Server(
  { name: "crm-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, (args ?? {}) as Record<string, unknown>);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[CRM-MCP] Server running on stdio — ready for agent connections.");
}

main().catch((err) => {
  console.error("[CRM-MCP] Fatal startup error:", err);
  process.exit(1);
});
