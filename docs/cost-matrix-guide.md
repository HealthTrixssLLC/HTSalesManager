# Cost-by-Opportunity Matrix — Implementation Guide

## Overview

This guide describes how to build an application that pulls **Accounts** and **Opportunities** from the CRM external REST API, assembles a cost-capture matrix keyed by opportunity, and feeds that matrix into an accounting system and Azure resource management system (cost allocation tags / budget mapping).

---

## 1. Prerequisites

| Requirement | Detail |
|---|---|
| **API key** | Generated in the CRM under *Admin → API Keys*. Must be active and non-expired. |
| **Base URL** | `https://<your-crm-host>/api/v1/external` |
| **Authentication header** | `x-api-key: <key>` on every request |
| **Rate limit** | Default 100 requests / minute per key; HTTP 429 if exceeded |
| **Org scope** | Org-scoped keys return only that org's data; system keys see all orgs |

---

## 2. Authentication

Every request requires the API key as a header. No CSRF token or session cookie is needed.

```http
GET /api/v1/external/accounts HTTP/1.1
Host: <your-crm-host>
x-api-key: crm_live_xxxxxxxxxxxxxxxxxxxxxxxx
Accept: application/json
```

| HTTP status | Meaning |
|---|---|
| 401 | Key missing, invalid, revoked, or expired |
| 429 | Rate limit exceeded — back off and retry |
| 404 | Record not found or outside your org scope |
| 500 | Server error |

---

## 3. Fetching All Accounts

### Endpoint

```
GET /api/v1/external/accounts
```

### Query parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `limit` | integer | 100 | Max 1000 |
| `offset` | integer | 0 | Pagination cursor |
| `updatedSince` | ISO 8601 datetime | — | Incremental sync filter |
| `expand` | CSV string | — | `opportunities` embeds opportunity list per account |

### Paginating through all accounts

```python
import requests

BASE_URL = "https://<crm-host>/api/v1/external"
HEADERS  = {"x-api-key": "<your-api-key>"}

def fetch_all_accounts(expand=None):
    accounts = []
    offset, limit = 0, 1000
    while True:
        params = {"limit": limit, "offset": offset}
        if expand:
            params["expand"] = expand
        resp = requests.get(f"{BASE_URL}/accounts", headers=HEADERS, params=params)
        resp.raise_for_status()
        body = resp.json()
        accounts.extend(body["data"])
        if not body["pagination"]["hasMore"]:
            break
        offset += limit
    return accounts
```

### Account response fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | Internal CRM ID |
| `name` | string | Account display name |
| `accountNumber` | string | Use as cost centre code |
| `type` | string | `customer`, `partner`, `prospect`, `vendor`, `other` |
| `category` | string | e.g. `enterprise`, `smb` |
| `industry` | string | Available on single-account endpoint |
| `ownerId` | string | CRM user ID |
| `externalId` | string | Your ERP / accounting system ID |
| `createdAt` | ISO datetime | |
| `updatedAt` | ISO datetime | |

---

## 4. Fetching All Opportunities

### Endpoint

```
GET /api/v1/external/opportunities
```

### Query parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `limit` | integer | 100 | Max 1000 |
| `offset` | integer | 0 | Pagination cursor |
| `updatedSince` | ISO 8601 datetime | — | Incremental sync filter |
| `includeInForecast` | `true` \| `false` \| `all` | `true` | Use `all` to retrieve every opportunity |
| `expand` | CSV string | — | `account` embeds account info; `resources` embeds assigned team members |

### Paginating through all opportunities

```python
def fetch_all_opportunities(expand=None, include_forecast="all"):
    opps = []
    offset, limit = 0, 1000
    while True:
        params = {
            "limit": limit,
            "offset": offset,
            "includeInForecast": include_forecast,
        }
        if expand:
            params["expand"] = expand
        resp = requests.get(f"{BASE_URL}/opportunities", headers=HEADERS, params=params)
        resp.raise_for_status()
        body = resp.json()
        opps.extend(body["data"])
        if not body["pagination"]["hasMore"]:
            break
        offset += limit
    return opps
```

### Opportunity response fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | Internal CRM ID |
| `accountId` | string | Parent account |
| `name` | string | Opportunity name |
| `stage` | string | Sales stage |
| `amount` | number | Contract / deal value |
| `probability` | integer | 0–100 % |
| `status` | string | `open`, `closed-won`, `closed-lost` |
| `closeDate` | date | Expected close |
| `actualCloseDate` | date \| null | Set when closed |
| `estCloseDate` | date \| null | Revised estimate |
| `actualRevenue` | number \| null | Recorded on close |
| `estRevenue` | number \| null | Working estimate |
| `rating` | string | `hot`, `warm`, `cold` |
| `includeInForecast` | boolean | |
| `implementationStartDate` | date \| null | When delivery work begins |
| `implementationEndDate` | date \| null | When delivery work ends |
| `billingEndDate` | date \| null | When billing closes — use for accounting period end |
| `externalId` | string | Your ERP / accounting system ID |
| `ownerId` | string | CRM user ID |
| `createdAt` | ISO datetime | |
| `updatedAt` | ISO datetime | |
| `account` | object | Present when `expand=account` |
| `resources` | array | Present when `expand=resources` |

#### Expanded `account` object

```json
{
  "id": "acc_abc123",
  "name": "Acme Corp",
  "accountNumber": "AC-0042",
  "type": "customer",
  "category": "enterprise"
}
```

#### Expanded `resources` array item

```json
{
  "userId": "usr_eng1",
  "role": "Lead Engineer",
  "allocationPercentage": 80,
  "startDate": "2025-04-01",
  "endDate": "2025-09-30"
}
```

---

## 5. Building the Cost Matrix

Each row is one opportunity. Columns cover identifiers, financials, timeline, and Azure tags.

```python
def build_cost_matrix(opportunities, accounts_by_id):
    matrix = []
    for opp in opportunities:
        # Use inline expanded account or fall back to prefetched map
        account = opp.get("account") or accounts_by_id.get(opp["accountId"], {})

        row = {
            # --- Identifiers ---
            "opportunity_id":        opp["id"],
            "opportunity_name":      opp["name"],
            "opportunity_ext_id":    opp.get("externalId"),   # links to ERP record
            "account_id":            account.get("id"),
            "account_name":          account.get("name"),
            "account_number":        account.get("accountNumber"),  # cost centre code
            "account_ext_id":        account.get("externalId"),

            # --- Revenue / budget ---
            "amount":                opp.get("amount"),
            "est_revenue":           opp.get("estRevenue"),
            "actual_revenue":        opp.get("actualRevenue"),
            "probability_pct":       opp.get("probability"),
            "weighted_value":        round(
                                       (opp.get("amount") or 0)
                                       * (opp.get("probability") or 0) / 100, 2),

            # --- Timeline ---
            "implementation_start":  opp.get("implementationStartDate"),
            "implementation_end":    opp.get("implementationEndDate"),
            "billing_end":           opp.get("billingEndDate"),
            "close_date":            opp.get("closeDate"),

            # --- Stage / status ---
            "stage":                 opp.get("stage"),
            "status":                opp.get("status"),
            "include_in_forecast":   opp.get("includeInForecast"),

            # --- Resource allocation ---
            "resources":             opp.get("resources", []),
            "total_allocation_pct":  sum(
                                       r.get("allocationPercentage", 0)
                                       for r in opp.get("resources", [])),

            # --- Azure tag block (see §6) ---
            "azure_tags": {
                "opportunity-id":    opp["id"],
                "opportunity-name":  opp["name"][:128],       # Azure 128-char limit
                "account-number":    account.get("accountNumber", ""),
                "cost-stage":        opp.get("stage", ""),
                "billing-end":       opp.get("billingEndDate", ""),
            },
        }
        matrix.append(row)
    return matrix
```

### Column reference

| Column | Source | Accounting use | Azure use |
|---|---|---|---|
| `opportunity_id` | `opp.id` | Row key | Tag value |
| `opportunity_ext_id` | `opp.externalId` | ERP record link | — |
| `account_number` | `account.accountNumber` | Cost centre code | Tag value |
| `amount` | `opp.amount` | Budget ceiling | Budget alert amount |
| `weighted_value` | amount × probability | Forecast column | — |
| `implementation_start/end` | date fields | Period accrual dates | Resource group lifetime |
| `billing_end` | `opp.billingEndDate` | Invoice cutoff | Budget end date |
| `total_allocation_pct` | sum of resource rows | FTE cost spread | — |
| `azure_tags` | derived | — | Apply to resource group |

---

## 6. Azure Resource Management Integration

### 6a. Tag resource groups by opportunity

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.resource import ResourceManagementClient

SUBSCRIPTION_ID = "<your-subscription-id>"

def tag_resource_group(subscription_id, resource_group_name, tags: dict):
    credential = DefaultAzureCredential()
    client = ResourceManagementClient(credential, subscription_id)
    client.resource_groups.update(resource_group_name, {"tags": tags})

for row in cost_matrix:
    rg_name = f"opp-{row['opportunity_id']}"   # adjust to your naming convention
    tag_resource_group(SUBSCRIPTION_ID, rg_name, row["azure_tags"])
```

### 6b. Cost allocation rule (Azure Cost Management REST API)

Once resources carry the `opportunity-id` tag, create a proportional cost allocation rule:

```http
PUT https://management.azure.com/providers/Microsoft.Billing/billingAccounts/{billingAccountId}/
    providers/Microsoft.CostManagement/costAllocationRules/{ruleName}?api-version=2023-11-01

{
  "properties": {
    "displayName": "Opportunity Cost Split",
    "status": "Active",
    "allocationPolicy": "Proportional",
    "targetResources": [
      {
        "resourceType": "Tag",
        "name": "opportunity-id",
        "values": ["<opportunity_id>"]
      }
    ]
  }
}
```

### 6c. Budget per opportunity

```python
from azure.mgmt.costmanagement import CostManagementClient
from azure.mgmt.costmanagement.models import Budget, BudgetTimePeriod, BudgetFilter

def create_opportunity_budget(row):
    client = CostManagementClient(DefaultAzureCredential())
    client.budgets.create_or_update(
        scope=f"/subscriptions/{SUBSCRIPTION_ID}",
        budget_name=f"budget-{row['opportunity_id']}",
        parameters=Budget(
            category="Cost",
            amount=row["amount"] or 0,
            time_grain="Monthly",
            time_period=BudgetTimePeriod(
                start_date=row["implementation_start"],
                end_date=row["billing_end"],
            ),
            filter=BudgetFilter(
                tags={"opportunity-id": [row["opportunity_id"]]}
            ),
        ),
    )
```

---

## 7. Accounting System Integration

### 7a. CSV export

```python
import csv, io

def matrix_to_csv(matrix) -> str:
    exclude = {"resources", "azure_tags"}
    fields = [k for k in matrix[0].keys() if k not in exclude]
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(matrix)
    return out.getvalue()

with open("cost_matrix.csv", "w") as f:
    f.write(matrix_to_csv(cost_matrix))
```

### 7b. Cost centre / journal field mapping

| Accounting field | CRM source | Notes |
|---|---|---|
| **Cost Centre** | `account.accountNumber` | Maps to your GL cost centre or chart of accounts code |
| **Project / Job code** | `opp.externalId` or `opp.id` | Match to ERP opportunity record |
| **Budget amount** | `opp.amount` | Full contract value |
| **Period start** | `implementationStartDate` | When cost accrual begins |
| **Period end** | `billingEndDate` | When billing and cost accrual close |
| **Department** | `opp.ownerId` → HR lookup | Requires owner-to-department mapping in your HR system |

### 7c. Incremental refresh

Run the pipeline on a schedule (e.g. nightly) using `updatedSince` to fetch only changed records:

```python
from datetime import datetime, timezone, timedelta

# Load last_run timestamp from your persistent store (database, file, etc.)
last_run = datetime.now(timezone.utc) - timedelta(days=1)

params = {
    "limit": 1000,
    "offset": 0,
    "includeInForecast": "all",
    "updatedSince": last_run.isoformat(),
    "expand": "account,resources",
}
```

---

## 8. Complete Orchestration Script

```python
import requests, json, csv, io
from azure.identity import DefaultAzureCredential
from azure.mgmt.resource import ResourceManagementClient
from azure.mgmt.costmanagement import CostManagementClient
from azure.mgmt.costmanagement.models import Budget, BudgetTimePeriod, BudgetFilter

BASE_URL        = "https://<crm-host>/api/v1/external"
HEADERS         = {"x-api-key": "<your-api-key>"}
SUBSCRIPTION_ID = "<your-azure-subscription-id>"

# Step 1: Pull all accounts
raw_accounts   = fetch_all_accounts()
accounts_by_id = {a["id"]: a for a in raw_accounts}

# Step 2: Pull all opportunities with inline account + resource data
opportunities = fetch_all_opportunities(
    expand="account,resources",
    include_forecast="all",
)

# Step 3: Build the matrix
cost_matrix = build_cost_matrix(opportunities, accounts_by_id)

# Step 4a: Write accounting CSV
with open("cost_matrix.csv", "w") as f:
    f.write(matrix_to_csv(cost_matrix))

# Step 4b: Apply Azure tags and budgets for open opportunities with dates
for row in cost_matrix:
    if row["status"] == "open" and row["implementation_start"] and row["billing_end"]:
        tag_resource_group(
            SUBSCRIPTION_ID,
            f"opp-{row['opportunity_id']}",
            row["azure_tags"],
        )
        create_opportunity_budget(row)

# Step 5: Write full matrix JSON for any other downstream consumer
with open("cost_matrix.json", "w") as f:
    json.dump(cost_matrix, f, indent=2, default=str)

print(f"Done — {len(cost_matrix)} opportunities processed.")
```

---

## 9. Error Handling

| Scenario | Recommended handling |
|---|---|
| HTTP 401 | Verify key validity and expiry in the CRM Admin Console |
| HTTP 429 | Exponential backoff; reduce `limit` per page |
| HTTP 404 on account | Log and skip; the opportunity may reference a deleted account |
| Null date fields | Guard before date arithmetic; Azure Budget requires non-null start and end |
| `amount` is null | Default to 0; flag the opportunity for manual review |
| Incomplete pagination | Always check `hasMore`; never assume a single page is the full result set |

---

## 10. Security Notes

- Store your CRM API key in **Azure Key Vault** (or equivalent secret manager) — never in source code or plain config files.
- The key is sent as a plain HTTP header; ensure your CRM host enforces **HTTPS**.
- Use **org-scoped keys** rather than system keys to minimise blast radius.
- The CRM supports multiple concurrent active keys, enabling zero-downtime key rotation.

---

## Key field notes

- **`externalId`** on both accounts and opportunities is the intended bridge to your ERP / accounting system. Populate it in the CRM for every record you want bidirectional linking on.
- **`billingEndDate`** (not `closeDate`) is the correct field for accounting period cutoffs and Azure budget end dates — it represents when billing stops, which is often months after the deal closes.
- The **resources array** (`userId`, `role`, `allocationPercentage`, `startDate`, `endDate`) lets you model per-person Azure cost splits if you tag individual resources by team member as well as by opportunity.
