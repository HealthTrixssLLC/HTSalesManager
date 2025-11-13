// Help & Documentation page
// Comprehensive guide including Dynamics 365 migration

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Building2, Users, Target, TrendingUp, Download, Upload, FileText, Database, ShieldCheck, Zap, Key, Code2, Terminal, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-foreground" data-testid="heading-help">Help & Documentation</h1>
        <p className="text-muted-foreground">Everything you need to get started with Health Trixss CRM</p>
      </div>

      <Tabs defaultValue="getting-started" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="getting-started" data-testid="tab-getting-started">Getting Started</TabsTrigger>
          <TabsTrigger value="features" data-testid="tab-features">Features Guide</TabsTrigger>
          <TabsTrigger value="api-docs" data-testid="tab-api-docs">API Documentation</TabsTrigger>
          <TabsTrigger value="migration" data-testid="tab-migration">Dynamics Migration</TabsTrigger>
          <TabsTrigger value="examples" data-testid="tab-examples">Examples</TabsTrigger>
          <TabsTrigger value="faq" data-testid="tab-faq">FAQ</TabsTrigger>
        </TabsList>

        {/* Getting Started Tab */}
        <TabsContent value="getting-started" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Welcome to Health Trixss CRM</CardTitle>
              <CardDescription>Your lightweight Salesforce alternative built for healthcare professionals</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  What is Health Trixss CRM?
                </h3>
                <p className="text-sm text-muted-foreground">
                  Health Trixss CRM is a comprehensive, self-hosted CRM platform designed specifically for healthcare sales teams. 
                  It provides powerful pipeline management, automation, and insights without the complexity and cost of enterprise solutions.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Core Concepts</h3>
                <div className="grid gap-3">
                  <div className="flex gap-3">
                    <Building2 className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">Accounts</p>
                      <p className="text-sm text-muted-foreground">Organizations and companies you do business with</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Users className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">Contacts</p>
                      <p className="text-sm text-muted-foreground">Individual people within accounts</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Target className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">Leads</p>
                      <p className="text-sm text-muted-foreground">Potential customers that can be converted to accounts</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <TrendingUp className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">Opportunities</p>
                      <p className="text-sm text-muted-foreground">Sales deals with stages, amounts, and close dates</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Quick Start Guide</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Create your first Account from the Accounts page</li>
                  <li>Add Contacts to the account</li>
                  <li>Create Leads for potential new business</li>
                  <li>Convert qualified Leads to Accounts and Opportunities</li>
                  <li>Manage your pipeline with the Opportunity Kanban board</li>
                  <li>Track progress with the Sales Waterfall dashboard</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Features Guide Tab */}
        <TabsContent value="features" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Feature Overview</CardTitle>
              <CardDescription>Detailed guide to all CRM features</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Lead Conversion */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-primary">Lead Conversion Wizard</h3>
                <p className="text-sm text-muted-foreground">
                  Convert qualified leads into accounts, contacts, and opportunities with our multi-step wizard.
                </p>
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <p className="text-sm font-medium">How to use:</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Go to Leads page and click "Convert" on any lead</li>
                    <li>The wizard checks for duplicate accounts by name</li>
                    <li>Choose to create a new account or link to existing</li>
                    <li>Optionally create an opportunity with the conversion</li>
                    <li>Review and confirm - the lead is marked as converted</li>
                  </ol>
                </div>
              </div>

              {/* Opportunity Kanban */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-primary">Opportunity Kanban Board</h3>
                <p className="text-sm text-muted-foreground">
                  Visualize and manage your sales pipeline with drag-and-drop stage management.
                </p>
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <p className="text-sm font-medium">Pipeline Stages:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    <li><strong>Prospecting</strong> - Initial contact and qualification</li>
                    <li><strong>Qualification</strong> - Needs analysis and fit assessment</li>
                    <li><strong>Proposal</strong> - Solution presentation and proposal</li>
                    <li><strong>Negotiation</strong> - Terms discussion and finalization</li>
                    <li><strong>Closed Won</strong> - Deal successfully closed</li>
                    <li><strong>Closed Lost</strong> - Deal lost or abandoned</li>
                  </ul>
                </div>
              </div>

              {/* Sales Waterfall */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-primary">Sales Waterfall Dashboard</h3>
                <p className="text-sm text-muted-foreground">
                  Track your progress toward annual sales targets with stage-based waterfall visualization.
                </p>
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <p className="text-sm font-medium">Key features:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Set annual sales targets per year</li>
                    <li>View aggregated pipeline value by stage</li>
                    <li>See "Gap to Target" showing needed pipeline</li>
                    <li>Each stage shows incremental contribution</li>
                    <li>Change years to view historical performance</li>
                  </ul>
                </div>
              </div>

              {/* ID Patterns */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-primary">Custom ID Patterns</h3>
                <p className="text-sm text-muted-foreground">
                  Configure how IDs are generated for each entity type with custom patterns and starting values.
                </p>
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <p className="text-sm font-medium">Pattern Tokens:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    <li><code>&#123;PREFIX&#125;</code> - Custom text (e.g., ACCT, CONT)</li>
                    <li><code>&#123;YYYY&#125;</code> - 4-digit year (2025)</li>
                    <li><code>&#123;YY&#125;</code> - 2-digit year (25)</li>
                    <li><code>&#123;MM&#125;</code> - 2-digit month (01-12)</li>
                    <li><code>&#123;SEQ:n&#125;</code> - Sequential number with n digits</li>
                  </ul>
                  <p className="text-sm font-medium mt-3">Example: <code>ACCT-&#123;YYYY&#125;-&#123;SEQ:5&#125;</code> → ACCT-2025-00001</p>
                </div>
              </div>

              {/* Audit Logs */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-primary">Audit Logging</h3>
                <p className="text-sm text-muted-foreground">
                  Complete audit trail of all changes with before/after snapshots for compliance and tracking.
                </p>
                <div className="bg-muted p-4 rounded-md">
                  <p className="text-sm">All create, update, delete, and convert operations are logged with user, timestamp, IP address, and full data diffs.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Documentation Tab */}
        <TabsContent value="api-docs" className="space-y-4">
          <Alert>
            <Code2 className="h-4 w-4" />
            <AlertTitle>External API for Integrations</AlertTitle>
            <AlertDescription>
              Secure RESTful API for building custom forecasting tools and external integrations
            </AlertDescription>
          </Alert>

          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                API Overview
              </CardTitle>
              <CardDescription>Read-only API for accessing accounts and opportunities data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The External API provides secure, read-only access to your CRM data for building custom forecasting applications, 
                business intelligence tools, and third-party integrations. All endpoints require API key authentication and support 
                pagination, filtering, and delta synchronization.
              </p>
              <div className="bg-muted p-4 rounded-md space-y-2">
                <p className="text-sm font-medium">Base URL</p>
                <code className="text-sm">https://your-crm-domain.com/api/v1/external</code>
                <p className="text-sm font-medium mt-3">Authentication</p>
                <p className="text-sm text-muted-foreground">API Key via <code>x-api-key</code> header</p>
                <p className="text-sm font-medium mt-3">Rate Limit</p>
                <p className="text-sm text-muted-foreground">100 requests per minute (configurable per key)</p>
              </div>
            </CardContent>
          </Card>

          {/* Getting Started */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Getting Started
              </CardTitle>
              <CardDescription>Generate your first API key and make your first request</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <h3 className="font-semibold">Step 1: Generate an API Key</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Navigate to <strong>Admin Console → API Keys</strong> tab (Admin access required)</li>
                  <li>Click <strong>"Generate API Key"</strong></li>
                  <li>Enter a descriptive name (e.g., "Forecasting App Integration")</li>
                  <li>Optionally set an expiration date for security</li>
                  <li>Click <strong>"Generate API Key"</strong> and copy the key immediately</li>
                </ol>
                <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <AlertTitle className="text-yellow-800 dark:text-yellow-200">Important</AlertTitle>
                  <AlertDescription className="text-yellow-700 dark:text-yellow-300 text-sm">
                    The API key is shown only once. Store it securely in your environment variables or secrets manager.
                  </AlertDescription>
                </Alert>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">Step 2: Test Your API Key</h3>
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <p className="text-sm font-medium">Example Request (cURL)</p>
                  <pre className="text-xs bg-background p-3 rounded border overflow-x-auto">
{`curl -H "x-api-key: YOUR_API_KEY_HERE" \\
  https://your-crm-domain.com/api/v1/external/accounts?limit=5`}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Authentication */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Authentication
              </CardTitle>
              <CardDescription>Secure your API requests with API keys</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="font-semibold">API Key Header</h3>
                <p className="text-sm text-muted-foreground">
                  Include your API key in the <code>x-api-key</code> header with every request:
                </p>
                <div className="bg-muted p-3 rounded-md">
                  <code className="text-sm">x-api-key: your_64_character_api_key_here</code>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">Error Responses</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Status Code</th>
                        <th className="text-left p-2">Error</th>
                        <th className="text-left p-2">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-muted-foreground">
                      <tr className="border-b">
                        <td className="p-2"><code>401</code></td>
                        <td className="p-2">Missing API key</td>
                        <td className="p-2">No x-api-key header provided</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-2"><code>401</code></td>
                        <td className="p-2">Invalid API key</td>
                        <td className="p-2">API key not found or invalid</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-2"><code>403</code></td>
                        <td className="p-2">API key expired</td>
                        <td className="p-2">API key has passed expiration date</td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-2"><code>429</code></td>
                        <td className="p-2">Too many requests</td>
                        <td className="p-2">Rate limit exceeded</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Endpoint Reference */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-primary" />
                Endpoint Reference
              </CardTitle>
              <CardDescription>Available API endpoints and parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Accounts Endpoints */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-primary">Accounts API</h3>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded">GET</code>
                    <code className="text-sm">/api/v1/external/accounts</code>
                  </div>
                  <p className="text-sm text-muted-foreground">List all accounts with pagination and filtering</p>
                  
                  <div className="bg-muted p-4 rounded-md space-y-3">
                    <p className="text-sm font-medium">Query Parameters</p>
                    <div className="space-y-2 text-sm">
                      <div className="grid grid-cols-3 gap-2">
                        <code>limit</code>
                        <span className="text-muted-foreground col-span-2">Number of results (default: 100, max: 1000)</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <code>offset</code>
                        <span className="text-muted-foreground col-span-2">Number of results to skip (default: 0)</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <code>updatedSince</code>
                        <span className="text-muted-foreground col-span-2">ISO 8601 timestamp for delta sync</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <code>expand</code>
                        <span className="text-muted-foreground col-span-2">Comma-separated: opportunities</span>
                      </div>
                    </div>

                    <p className="text-sm font-medium mt-4">Example Response</p>
                    <pre className="text-xs bg-background p-3 rounded border overflow-x-auto">
{`{
  "data": [
    {
      "id": "ACT-1019",
      "name": "Allied Behavioral Health",
      "accountNumber": "A001",
      "type": "Provider",
      "category": "Healthcare Provider",
      "industry": "Healthcare",
      "ownerId": "user-123",
      "createdAt": "2025-01-15T10:00:00Z",
      "updatedAt": "2025-01-20T14:30:00Z"
    }
  ],
  "pagination": {
    "total": 156,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}`}
                    </pre>
                  </div>
                </div>

                <div className="space-y-2 mt-4">
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded">GET</code>
                    <code className="text-sm">/api/v1/external/accounts/:id</code>
                  </div>
                  <p className="text-sm text-muted-foreground">Get a single account by ID</p>
                  
                  <div className="bg-muted p-4 rounded-md space-y-3">
                    <p className="text-sm font-medium">Query Parameters</p>
                    <div className="space-y-2 text-sm">
                      <div className="grid grid-cols-3 gap-2">
                        <code>expand</code>
                        <span className="text-muted-foreground col-span-2">opportunities,contacts,leads,activities</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Opportunities Endpoints */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-primary">Opportunities API</h3>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded">GET</code>
                    <code className="text-sm">/api/v1/external/opportunities</code>
                  </div>
                  <p className="text-sm text-muted-foreground">List all opportunities with filtering</p>
                  
                  <div className="bg-muted p-4 rounded-md space-y-3">
                    <p className="text-sm font-medium">Query Parameters</p>
                    <div className="space-y-2 text-sm">
                      <div className="grid grid-cols-3 gap-2">
                        <code>limit</code>
                        <span className="text-muted-foreground col-span-2">Number of results (default: 100, max: 1000)</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <code>offset</code>
                        <span className="text-muted-foreground col-span-2">Number of results to skip</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <code>updatedSince</code>
                        <span className="text-muted-foreground col-span-2">ISO 8601 timestamp</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <code>includeInForecast</code>
                        <span className="text-muted-foreground col-span-2">true/false - Filter by forecast inclusion</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <code>expand</code>
                        <span className="text-muted-foreground col-span-2">account</span>
                      </div>
                    </div>

                    <p className="text-sm font-medium mt-4">Example Response</p>
                    <pre className="text-xs bg-background p-3 rounded border overflow-x-auto">
{`{
  "data": [
    {
      "id": "OPP-2025-00042",
      "name": "Q1 Software License Renewal",
      "accountId": "ACT-1019",
      "stage": "Proposal",
      "amount": 150000,
      "closeDate": "2025-03-31",
      "probability": 75,
      "includeInForecast": true,
      "ownerId": "user-123",
      "createdAt": "2025-01-10T09:00:00Z",
      "updatedAt": "2025-01-25T16:45:00Z"
    }
  ],
  "pagination": {
    "total": 89,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}`}
                    </pre>
                  </div>
                </div>

                <div className="space-y-2 mt-4">
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded">GET</code>
                    <code className="text-sm">/api/v1/external/opportunities/:id</code>
                  </div>
                  <p className="text-sm text-muted-foreground">Get a single opportunity by ID</p>
                  
                  <div className="bg-muted p-4 rounded-md space-y-3">
                    <p className="text-sm font-medium">Query Parameters</p>
                    <div className="space-y-2 text-sm">
                      <div className="grid grid-cols-3 gap-2">
                        <code>expand</code>
                        <span className="text-muted-foreground col-span-2">account</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Implementation Guide */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-primary" />
                Implementation Guide
              </CardTitle>
              <CardDescription>Step-by-step integration examples using Node.js</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <h3 className="font-semibold">1. Initial Setup</h3>
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-x-auto">
{`// Store your API key in environment variables
const API_KEY = process.env.CRM_API_KEY;
const BASE_URL = 'https://your-crm.com/api/v1/external';

// Helper function for API requests
async function crmRequest(endpoint, params = {}) {
  const url = new URL(\`\${BASE_URL}\${endpoint}\`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.append(key, value);
  });

  const response = await fetch(url, {
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(\`API Error: \${response.status}\`);
  }

  return response.json();
}`}
                  </pre>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">2. Fetch Accounts with Pagination</h3>
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-x-auto">
{`// Fetch first 100 accounts
const accountsPage1 = await crmRequest('/accounts', {
  limit: 100,
  offset: 0
});

console.log(\`Total accounts: \${accountsPage1.pagination.total}\`);
console.log(\`Fetched: \${accountsPage1.data.length}\`);
console.log(\`Has more: \${accountsPage1.pagination.hasMore}\`);

// Fetch all accounts using pagination
async function getAllAccounts() {
  let allAccounts = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await crmRequest('/accounts', { limit, offset });
    allAccounts.push(...response.data);
    
    if (!response.pagination.hasMore) break;
    offset += limit;
  }

  return allAccounts;
}`}
                  </pre>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">3. Delta Sync (Incremental Updates)</h3>
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-x-auto">
{`// Store last sync timestamp
let lastSyncTime = '2025-01-01T00:00:00Z';

async function syncNewOpportunities() {
  const response = await crmRequest('/opportunities', {
    updatedSince: lastSyncTime,
    includeInForecast: true,
    limit: 1000
  });

  // Process only changed opportunities
  console.log(\`Found \${response.data.length} updated opportunities\`);
  
  // Update your local database
  for (const opp of response.data) {
    await updateLocalOpportunity(opp);
  }

  // Update sync timestamp for next run
  lastSyncTime = new Date().toISOString();
  await saveLastSyncTime(lastSyncTime);
}

// Run sync every hour
setInterval(syncNewOpportunities, 60 * 60 * 1000);`}
                  </pre>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">4. Expand Related Entities</h3>
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-x-auto">
{`// Fetch account with all related opportunities
const account = await crmRequest('/accounts/ACT-1019', {
  expand: 'opportunities'
});

console.log(\`Account: \${account.name}\`);
console.log(\`Opportunities: \${account.opportunities?.length || 0}\`);

// Fetch opportunity with account details
const opportunity = await crmRequest('/opportunities/OPP-2025-00042', {
  expand: 'account'
});

console.log(\`Opportunity: \${opportunity.name}\`);
console.log(\`Account: \${opportunity.account?.name}\`);`}
                  </pre>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">5. Error Handling</h3>
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-x-auto">
{`async function robustCrmRequest(endpoint, params = {}) {
  try {
    return await crmRequest(endpoint, params);
  } catch (error) {
    if (error.message.includes('429')) {
      // Rate limit exceeded - wait and retry
      console.log('Rate limit hit, waiting 60 seconds...');
      await new Promise(resolve => setTimeout(resolve, 60000));
      return robustCrmRequest(endpoint, params);
    }
    
    if (error.message.includes('401') || error.message.includes('403')) {
      // Authentication error - check API key
      console.error('Authentication failed. Check your API key.');
      throw error;
    }
    
    // Other errors
    console.error(\`API request failed: \${error.message}\`);
    throw error;
  }
}`}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rate Limiting */}
          <Card>
            <CardHeader>
              <CardTitle>Rate Limiting</CardTitle>
              <CardDescription>Understand and respect API rate limits</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Each API key has a configurable rate limit (default: 100 requests per minute). Rate limit information is returned in response headers:
              </p>
              <div className="bg-muted p-4 rounded-md space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <code>RateLimit-Limit</code>
                  <span className="text-muted-foreground">Maximum requests per minute</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <code>RateLimit-Remaining</code>
                  <span className="text-muted-foreground">Remaining requests in current window</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <code>RateLimit-Reset</code>
                  <span className="text-muted-foreground">Time when limit resets (epoch timestamp)</span>
                </div>
              </div>
              <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-900/20">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertTitle className="text-blue-800 dark:text-blue-200">Best Practice</AlertTitle>
                <AlertDescription className="text-blue-700 dark:text-blue-300 text-sm">
                  Implement exponential backoff when you receive 429 responses. Monitor the RateLimit-Remaining header to avoid hitting limits.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Best Practices */}
          <Card>
            <CardHeader>
              <CardTitle>Best Practices</CardTitle>
              <CardDescription>Recommended patterns for reliable integrations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <ShieldCheck className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Secure API Key Storage</p>
                    <p className="text-sm text-muted-foreground">Never hardcode API keys. Use environment variables or secrets managers (AWS Secrets Manager, Azure Key Vault, etc.)</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Key className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Key Rotation</p>
                    <p className="text-sm text-muted-foreground">Rotate API keys regularly (every 90 days recommended). Set expiration dates when generating keys.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Database className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Use Delta Sync</p>
                    <p className="text-sm text-muted-foreground">Use the <code>updatedSince</code> parameter to fetch only changed records. Store the last sync timestamp and use it in subsequent requests.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Zap className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Implement Caching</p>
                    <p className="text-sm text-muted-foreground">Cache responses locally to reduce API calls. Use ETags if available for conditional requests.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <TrendingUp className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Pagination Strategy</p>
                    <p className="text-sm text-muted-foreground">Use appropriate page sizes (100-1000). Don't fetch all data at once if you only need recent changes.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Error Monitoring</p>
                    <p className="text-sm text-muted-foreground">Log all API errors with context. Set up alerts for authentication failures and rate limit violations.</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dynamics Migration Tab */}
        <TabsContent value="migration" className="space-y-4">
          <Alert>
            <Database className="h-4 w-4" />
            <AlertTitle>Migrating from Microsoft Dynamics 365?</AlertTitle>
            <AlertDescription>
              Follow this step-by-step guide to migrate your data from Dynamics 365 to Health Trixss CRM
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Migration Overview</CardTitle>
              <CardDescription>Safe and efficient data migration from Dynamics 365</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Step 1: Export Data from Dynamics 365</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Log in to your Dynamics 365 CRM instance</li>
                  <li>Navigate to <strong>Settings → Data Management → Exports</strong></li>
                  <li>Create a new export job for each entity:
                    <ul className="list-disc list-inside ml-6 mt-1">
                      <li>Accounts</li>
                      <li>Contacts</li>
                      <li>Leads</li>
                      <li>Opportunities</li>
                    </ul>
                  </li>
                  <li>Select all relevant fields for each entity</li>
                  <li>Export as CSV format</li>
                  <li>Download the CSV files to your computer</li>
                </ol>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Step 2: Preserve Custom IDs (Critical for Downstream Systems)</h3>
                <Alert>
                  <Database className="h-4 w-4" />
                  <AlertTitle>Preserve Existing IDs for Downstream Systems</AlertTitle>
                  <AlertDescription>
                    If you have downstream systems (APIs, integrations, reports) that reference your Dynamics 365 record IDs, <strong>include the original IDs in your CSV exports</strong>. Health Trixss CRM will preserve these exact IDs during import, ensuring all your external systems continue to work without changes.
                  </AlertDescription>
                </Alert>
                <div className="bg-muted p-4 rounded-md">
                  <p className="text-sm font-semibold mb-2">Example CSV with Custom IDs:</p>
                  <pre className="text-xs overflow-x-auto bg-background p-2 rounded">
{`id,name,type,industry
ACCT-D365-12345,Mercy Hospital,customer,Healthcare
ACCT-D365-67890,Regional Clinic,prospect,Healthcare`}
                  </pre>
                  <p className="text-xs text-muted-foreground mt-2">
                    ✓ IDs preserved exactly as provided<br/>
                    ✓ Leave ID column empty for auto-generation<br/>
                    ✓ Works for all entities: Accounts, Contacts, Leads, Opportunities
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Step 3: Prepare Your Data (Field Mapping)</h3>
                <div className="bg-muted p-4 rounded-md space-y-3">
                  <p className="text-sm font-medium">Field Mapping Guide:</p>
                  
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Accounts Mapping:</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1">Dynamics 365</th>
                          <th className="text-left py-1">Health Trixss CRM</th>
                        </tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        <tr><td>name</td><td>name</td></tr>
                        <tr><td>emailaddress1</td><td>email</td></tr>
                        <tr><td>telephone1</td><td>phone</td></tr>
                        <tr><td>address1_composite</td><td>address</td></tr>
                        <tr><td>websiteurl</td><td>website</td></tr>
                        <tr><td>industrycode</td><td>industry</td></tr>
                        <tr><td>revenue</td><td>annualRevenue</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Contacts Mapping:</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1">Dynamics 365</th>
                          <th className="text-left py-1">Health Trixss CRM</th>
                        </tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        <tr><td>firstname</td><td>firstName</td></tr>
                        <tr><td>lastname</td><td>lastName</td></tr>
                        <tr><td>emailaddress1</td><td>email</td></tr>
                        <tr><td>telephone1</td><td>phone</td></tr>
                        <tr><td>jobtitle</td><td>title</td></tr>
                        <tr><td>parentcustomerid (lookup)</td><td>accountId (requires mapping)</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Opportunities Mapping:</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1">Dynamics 365</th>
                          <th className="text-left py-1">Health Trixss CRM</th>
                        </tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        <tr><td>name</td><td>name</td></tr>
                        <tr><td>estimatedvalue</td><td>amount</td></tr>
                        <tr><td>estimatedclosedate</td><td>closeDate</td></tr>
                        <tr><td>closeprobability</td><td>probability</td></tr>
                        <tr><td>stepname</td><td>stage (requires conversion)</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Step 4: Stage Conversion</h3>
                <div className="bg-muted p-4 rounded-md">
                  <p className="text-sm font-medium mb-2">Map Dynamics stages to Health Trixss stages:</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1">Dynamics 365 Stage</th>
                        <th className="text-left py-1">Health Trixss Stage</th>
                      </tr>
                    </thead>
                    <tbody className="text-muted-foreground">
                      <tr><td>Qualify / Develop</td><td>prospecting</td></tr>
                      <tr><td>Propose</td><td>qualification</td></tr>
                      <tr><td>Propose / Quote</td><td>proposal</td></tr>
                      <tr><td>Close</td><td>negotiation</td></tr>
                      <tr><td>Won</td><td>closed_won</td></tr>
                      <tr><td>Lost</td><td>closed_lost</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Step 5: Import Order</h3>
                <Alert>
                  <Zap className="h-4 w-4" />
                  <AlertTitle>Important: Import in the correct order!</AlertTitle>
                  <AlertDescription>
                    Due to relationships between entities, you must import in this specific order:
                  </AlertDescription>
                </Alert>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground ml-4">
                  <li><strong>Accounts</strong> first (no dependencies)</li>
                  <li><strong>Contacts</strong> second (depends on Accounts)</li>
                  <li><strong>Leads</strong> (independent, can be imported anytime)</li>
                  <li><strong>Opportunities</strong> last (depends on Accounts)</li>
                </ol>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Step 6: Use the Import Tool</h3>
                <p className="text-sm text-muted-foreground">
                  Once your CSV files are ready with proper field mapping:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Navigate to the <strong>Import</strong> page from the sidebar</li>
                  <li>Select entity type (Accounts, Contacts, Leads, or Opportunities)</li>
                  <li>Upload your CSV file</li>
                  <li>Preview and validate the data</li>
                  <li>Confirm import</li>
                  <li>Review the import summary for any errors</li>
                </ol>
                <div className="mt-3">
                  <Button variant="default" data-testid="button-go-to-import">
                    <Upload className="h-4 w-4 mr-2" />
                    Go to Import Tool
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Step 7: Validation</h3>
                <div className="bg-muted p-4 rounded-md">
                  <p className="text-sm font-medium mb-2">After importing, verify:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Record counts match your Dynamics exports</li>
                    <li>Relationships are maintained (Contact → Account links)</li>
                    <li>All required fields are populated</li>
                    <li>Dates are formatted correctly</li>
                    <li>Currency amounts are accurate</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Download Templates</CardTitle>
              <CardDescription>Pre-formatted CSV templates for easy data preparation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full justify-start" data-testid="button-download-accounts-template">
                <Download className="h-4 w-4 mr-2" />
                Download Accounts CSV Template
              </Button>
              <Button variant="outline" className="w-full justify-start" data-testid="button-download-contacts-template">
                <Download className="h-4 w-4 mr-2" />
                Download Contacts CSV Template
              </Button>
              <Button variant="outline" className="w-full justify-start" data-testid="button-download-leads-template">
                <Download className="h-4 w-4 mr-2" />
                Download Leads CSV Template
              </Button>
              <Button variant="outline" className="w-full justify-start" data-testid="button-download-opportunities-template">
                <Download className="h-4 w-4 mr-2" />
                Download Opportunities CSV Template
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Examples Tab */}
        <TabsContent value="examples" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Common Workflows & Examples</CardTitle>
              <CardDescription>Real-world scenarios and best practices</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-primary">Example 1: Converting a Lead to Account</h3>
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <p className="text-sm"><strong>Scenario:</strong> You received a demo request from "Mercy Hospital" and want to convert it to an account.</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Create a new Lead with company "Mercy Hospital", contact "Dr. Sarah Johnson"</li>
                    <li>After qualification call, click "Convert" on the lead</li>
                    <li>System checks for existing "Mercy Hospital" account</li>
                    <li>Choose "Create New Account"</li>
                    <li>Optionally create opportunity "Q1 2025 Implementation - $250,000"</li>
                    <li>Lead is marked converted, new account and contact created</li>
                  </ol>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-primary">Example 2: Managing Pipeline in Kanban</h3>
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <p className="text-sm"><strong>Scenario:</strong> You completed a proposal presentation and need to move the deal forward.</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Go to Opportunities Kanban board</li>
                    <li>Find your opportunity card in "Proposal" column</li>
                    <li>Drag and drop it to "Negotiation" column</li>
                    <li>Click on the card to update close date or probability</li>
                    <li>Monitor overall pipeline value per stage</li>
                  </ol>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-primary">Example 3: Setting and Tracking Sales Targets</h3>
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <p className="text-sm"><strong>Scenario:</strong> Your 2025 sales target is $5M and you want to track progress.</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Go to Dashboard → Sales Waterfall section</li>
                    <li>Enter "5000000" in Annual Target field</li>
                    <li>Click "Save" to persist the target</li>
                    <li>Chart shows "Gap to Target" bar (red) showing needed pipeline</li>
                    <li>Each stage bar shows your current pipeline contribution</li>
                    <li>Bottom summary shows Target, Actual Pipeline, and Gap to Close</li>
                  </ol>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-primary">Example 4: Customizing ID Patterns</h3>
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <p className="text-sm"><strong>Scenario:</strong> You want account IDs to start at 1000 instead of 1.</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Go to Admin Console → ID Patterns tab</li>
                    <li>Find the "Account" pattern card</li>
                    <li>Click "Edit Pattern"</li>
                    <li>Set Start Value to "1000"</li>
                    <li>Save changes</li>
                    <li>Next account will be ACCT-2025-01000</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FAQ Tab */}
        <TabsContent value="faq" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Frequently Asked Questions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="font-semibold">Can I export my data to CSV?</h3>
                <p className="text-sm text-muted-foreground">
                  Yes! Each entity page (Accounts, Contacts, Leads, Opportunities) has an "Export to CSV" button that allows you to download all records in CSV format.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">What happens to my data during backup/restore?</h3>
                <p className="text-sm text-muted-foreground">
                  Backups are encrypted using AES-256-GCM encryption with a checksum for integrity verification. When you restore, all tables are atomically replaced within a database transaction. Your ID patterns, roles, and permissions are preserved.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">Can I change ID patterns after creating records?</h3>
                <p className="text-sm text-muted-foreground">
                  Yes, but new patterns only apply to future records. Existing record IDs are not changed. The counter continues from where it left off.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">How do I add users to my CRM?</h3>
                <p className="text-sm text-muted-foreground">
                  Go to Admin Console → Users & Roles tab. Click "Add User", provide email and password. Assign one or more roles (Admin, SalesManager, SalesRep, ReadOnly). The first user registered automatically becomes an Admin.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">Are audit logs retroactive?</h3>
                <p className="text-sm text-muted-foreground">
                  No, audit logs only capture changes made after the audit system was enabled. Historical changes before implementation are not logged.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">Can I customize the pipeline stages?</h3>
                <p className="text-sm text-muted-foreground">
                  Currently, the six standard stages (Prospecting, Qualification, Proposal, Negotiation, Closed Won, Closed Lost) are fixed. Custom stages are on the roadmap for future releases.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">How is this different from Salesforce?</h3>
                <p className="text-sm text-muted-foreground">
                  Health Trixss CRM is self-hosted, lightweight, and built specifically for healthcare sales teams. It focuses on core CRM features without the complexity and cost of enterprise solutions. You own your data and infrastructure.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
