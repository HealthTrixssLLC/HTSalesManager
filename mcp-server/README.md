# Health Trixss CRM — MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes the Health Trixss CRM as callable tools for any MCP-compatible AI agent (Claude Desktop, Cursor, custom agents, etc.).

---

## Prerequisites

1. A running instance of Health Trixss CRM (local or deployed).
2. An **API key** generated from the CRM's Admin Console.
3. Node.js 18+ installed on the machine that runs the MCP server.

---

## Generating an API Key

1. Log in to the CRM as an **Admin** user.
2. Navigate to **Admin Console** → **API Keys** tab.
3. Click **"Generate New API Key"**.
4. Give the key a descriptive name (e.g., `Claude Desktop`) and click **Generate**.
5. **Copy the key immediately** — it is displayed only once.

> The API key carries the permissions of the user who created it. Create the key with an account that has the required roles (Admin or appropriate Sales role).

---

## Environment Variables

| Variable        | Required | Description                                                   |
|-----------------|----------|---------------------------------------------------------------|
| `CRM_BASE_URL`  | Yes      | Base URL of your CRM instance (no trailing slash). Example: `https://your-crm.repl.co` |
| `CRM_API_KEY`   | Yes      | API key copied from the Admin Console (`htcrm_…`).           |

---

## Running the Server Directly

```bash
# Install dependencies (from the repo root)
npm install

# Run the MCP server
CRM_BASE_URL=https://your-crm.repl.co \
CRM_API_KEY=htcrm_your_key_here \
npx tsx mcp-server/index.ts
```

---

## Claude Desktop Configuration

Add the following block to your Claude Desktop configuration file.

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "crm": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/repo/mcp-server/index.ts"],
      "env": {
        "CRM_BASE_URL": "https://your-crm.repl.co",
        "CRM_API_KEY": "htcrm_your_key_here"
      }
    }
  }
}
```

Replace `/absolute/path/to/repo` with the actual path to your cloned repository and fill in the correct `CRM_BASE_URL` and `CRM_API_KEY` values.

Restart Claude Desktop after saving.

---

## Cursor Configuration

Add to your Cursor `mcp.json` (`.cursor/mcp.json` in the project root or the global one at `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "crm": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/repo/mcp-server/index.ts"],
      "env": {
        "CRM_BASE_URL": "https://your-crm.repl.co",
        "CRM_API_KEY": "htcrm_your_key_here"
      }
    }
  }
}
```

---

## Available Tools

### Accounts
| Tool | Description |
|------|-------------|
| `list_accounts` | List accounts with optional search/filter |
| `get_account` | Get a single account by ID |
| `create_account` | Create a new account |
| `update_account` | Update fields on an existing account |

### Contacts
| Tool | Description |
|------|-------------|
| `list_contacts` | List contacts with optional search/filter |
| `get_contact` | Get a single contact by ID |
| `create_contact` | Create a new contact |
| `update_contact` | Update fields on an existing contact |

### Leads
| Tool | Description |
|------|-------------|
| `list_leads` | List leads with optional search/status filter |
| `get_lead` | Get a single lead by ID |
| `create_lead` | Create a new lead |
| `update_lead` | Update fields on an existing lead |
| `convert_lead` | Convert a lead to Account, Contact, and/or Opportunity |

### Opportunities
| Tool | Description |
|------|-------------|
| `list_opportunities` | List opportunities with optional search/filter |
| `get_opportunity` | Get a single opportunity by ID |
| `create_opportunity` | Create a new opportunity |
| `update_opportunity` | Update fields on an existing opportunity |

### Activities
| Tool | Description |
|------|-------------|
| `list_activities` | List activities (supports `all`, `upcoming`, `pending` filter) |
| `create_activity` | Create a call, email, meeting, task, or note |
| `update_activity` | Update an existing activity |

### Lead Generation
| Tool | Description |
|------|-------------|
| `list_icps` | List ICP (Ideal Customer Profile) definitions |
| `create_icp` | Create a new ICP profile |
| `list_playbooks` | List outreach task playbooks |
| `create_playbook` | Create a new playbook |
| `list_runs` | List Lead Generation runs |
| `start_run` | Create and start a new Lead Generation run |
| `list_candidates` | List candidate leads from runs |
| `research_candidate` | Get detailed research data for a candidate |

### Search
| Tool | Description |
|------|-------------|
| `global_search` | Search across all entities (accounts, contacts, leads, opportunities) |

---

## How Authentication Works

The MCP server passes your `CRM_API_KEY` as the `x-api-key` HTTP header on every request. The CRM backend verifies the key against its API Keys table and authenticates the request using the permissions of the user who created the key.

The key must be active and not expired. Revoke it at any time from the Admin Console.

---

## Error Handling

If a tool call fails (e.g. record not found, permission denied, network error), the server returns an MCP error result with `isError: true` and a human-readable message. The agent can read the error text and decide how to proceed without the server crashing.
