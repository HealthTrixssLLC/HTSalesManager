# Dynamics 365 Import Guide

## Overview

Health Trixss CRM supports direct import of **Accounts** and **Contacts** from Dynamics 365 exports. This guide explains how to prepare and import your data with automatic account linking for contacts.

## ⚠️ CRITICAL: Import Order

**You MUST import in this exact order:**

1. **Import Accounts FIRST**
2. **THEN Transform Contacts** (account lookup uses current database)
3. **Import Transformed Contacts**

If you transform contacts before importing accounts, the account lookup will fail and contacts won't link properly.

## Prerequisites

You need three files:
1. **Dynamics 365 Excel Export** - Your exported account data from Dynamics
2. **Mapping Configuration JSON** - Defines how Dynamics columns map to CRM fields
3. **Template CSV** - The target format for Health Trixss CRM

## Step-by-Step Import Process

### Step 1: Export Data from Dynamics 365

1. Log into your Dynamics 365 instance
2. Navigate to Accounts
3. Select "Export to Excel" (should include these columns):
   - (Do Not Modify) Account - GUID
   - Account Name
   - HT Account Number (or your external ID field)
   - Main Phone
   - Business Type (e.g., Customer, Prospect, Partner)
   - Category (e.g., Provider, Payer, Vendor)
   - Primary Contact
   - Email (Primary Contact)
   
### Step 2: Prepare Configuration Files

#### Create Mapping Configuration (`dynamics_accounts_mapping_config.json`)

```json
{
  "source_file": "Active Accounts 11-2-2025 10-03-45 AM.xlsx",
  "sheet_name": "Active Accounts",
  "target_template": "dynamics_accounts_template.csv",
  "column_mapping": {
    "(Do Not Modify) Account": "externalId",
    "Account Name": "name",
    "HT Account Number": "accountNumber",
    "Main Phone": "phone",
    "Business Type": "type",
    "Category": "category",
    "Primary Contact": "primaryContactName",
    "Email (Primary Contact) (Contact)": "primaryContactEmail"
  },
  "id_rules": {
    "internal_id_field": "id",
    "internal_id_pattern": "ACC-{{YYYY}}{{MM}}-{{00001}}",
    "external_id_fields": ["accountNumber", "externalId"],
    "preserve_external_format": true
  },
  "validation_rules": {
    "required_fields": ["name"],
    "email_fields": ["primaryContactEmail"],
    "phone_fields": ["phone"],
    "url_fields": ["website"]
  },
  "dedupe_rules": {
    "primary_key": ["name", "accountNumber"],
    "fuzzy_match_threshold": 90
  },
  "governance_fields": {
    "sourceSystem": "Dynamics 365 Export",
    "importStatus": "Imported"
  },
  "type_mapping": {
    "Customer": "customer",
    "Prospect": "prospect",
    "Partner": "partner",
    "Vendor": "customer"
  }
}
```

#### Get Template CSV (`dynamics_accounts_template.csv`)

This file is available in `attached_assets/dynamics_accounts_template.csv` and defines the target column structure:

```csv
id,name,accountNumber,type,category,industry,website,phone,primaryContactName,primaryContactEmail,billingAddress,shippingAddress,externalId,sourceSystem,sourceRecordId,importStatus,importNotes
```

### Step 3: Transform Dynamics Data

1. Log into Health Trixss CRM with Admin credentials
2. Navigate to **Admin Console** → **Dynamics Import** tab
3. Upload your three files:
   - **Excel File**: Your Dynamics 365 export
   - **Mapping Configuration**: Your `dynamics_accounts_mapping_config.json`
   - **Template CSV**: The `dynamics_accounts_template.csv` file
4. Click **"Transform & Download Aligned CSV"**
5. The system will:
   - Read your Dynamics Excel export
   - Map columns according to configuration
   - Generate or preserve Record IDs
   - Validate data (emails, phones, etc.)
   - Remove duplicates
   - Add governance metadata
   - Create a CRM-aligned CSV file

6. Download the transformed CSV file

### Step 4: Import into CRM

1. Navigate to **Data** → **Import Data** tab
2. Select **Accounts** as the import type
3. Upload the transformed CSV from Step 3
4. Click **"Import"**
5. Review import results

## Field Mappings

### Core Fields
- **Account Name** → `name` (required)
- **HT Account Number** → `accountNumber` (preserved from Dynamics)
- **Business Type** → `type` (mapped via type_mapping)
- **Category** → `category`
- **Main Phone** → `phone`

### Primary Contact Fields
- **Primary Contact** → `primaryContactName`
- **Email (Primary Contact)** → `primaryContactEmail`

### Metadata Fields (Auto-populated)
- **(Do Not Modify) Account** → `externalId` (Dynamics GUID)
- **sourceSystem**: "Dynamics 365 Export"
- **sourceRecordId**: Dynamics GUID or Account Number
- **importStatus**: "Imported" (or "Error" if validation failed)
- **importNotes**: Error messages if validation failed

## ID Generation Rules

### ⚠️ CRITICAL: Preserving Dynamics IDs for Downstream Integrations

**The system preserves your original Dynamics IDs** to ensure downstream systems and integrations continue to work without modifications.

#### How ID Preservation Works

1. **For Accounts**:
   - If "HT Account Number" exists in your Dynamics export (e.g., `ACT-1019`)
   - The transformation preserves it EXACTLY as-is in the `id` field
   - Result: CRM record id = `ACT-1019` (not a generated ID)

2. **For Opportunities**:
   - If "HT Opportunity Number" exists (e.g., `Opp-1024`)
   - The transformation preserves it EXACTLY as-is in the `id` field
   - Result: CRM record id = `Opp-1024` (not a generated ID)

3. **For Contacts & Leads**:
   - If Dynamics GUID exists in "(Do Not Modify) Contact" or "(Do Not Modify) Lead"
   - The transformation preserves it as the `id` field
   - Result: CRM record id = `{dynamics-guid}` (not a generated ID)

4. **Fallback (only if no external ID exists)**:
   - System generates new ID using pattern: `ACC-{{YYYY}}{{MM}}-{{00001}}`
   - Example: `ACC-202511-00001` for the first account in November 2025

#### Why This Matters

Your downstream systems (reporting tools, integrations, APIs) rely on these specific IDs. Preserving them means:
- ✅ No need to update external system references
- ✅ Historical data linkages remain intact
- ✅ Audit trails and reports continue to work
- ✅ API integrations don't break

#### Configuration Flag

This behavior is controlled by `preserve_external_format: true` in the mapping configuration:

```json
"id_rules": {
  "internal_id_field": "id",
  "external_id_fields": ["accountNumber", "externalId"],
  "preserve_external_format": true  // ← Preserves IDs exactly as-is
}
```

**All default mapping configs have this enabled**, so your Dynamics IDs are automatically preserved

## Type Mapping

Business Type values are mapped to CRM enum values:

| Dynamics Value | CRM Type   |
|---------------|------------|
| Customer      | customer   |
| Prospect      | prospect   |
| Partner       | partner    |
| Vendor        | customer   |

## Data Validation

The transform process validates:
- **Required fields**: Account Name must be present
- **Email format**: Primary Contact Email must be valid email format
- **Phone format**: Phone numbers must match standard formats
- **URL format**: Website URLs must be valid

Records with validation errors are flagged with `importStatus: "Error"` and detailed error messages in `importNotes`.

## Deduplication

Duplicates are detected based on:
- **Account Name** + **Account Number**
- Fuzzy matching threshold: 90%

Duplicate records are marked and excluded from the import.

## Viewing Imported Data

After import, you can view your accounts:

1. Navigate to **Accounts**
2. The list will show:
   - Account ID
   - Name
   - **Account Number** (from Dynamics)
   - Type
   - **Category** (from Dynamics)
   - Industry
   - Phone

3. Click any account to see full details including:
   - Primary Contact information
   - Import metadata (External ID, Source System, Import Status)

## Contacts Import with Account Lookup

### Overview

Contacts import supports **automatic account linking** by looking up company names in your existing accounts. This eliminates manual data entry.

### Prerequisites

**CRITICAL:** You MUST import accounts BEFORE transforming contacts! The account lookup queries your current database.

### Workflow

```
1. Import Accounts (see previous section)
2. Transform Contacts (with account lookup enabled)
3. Import Contacts
```

### Step 1: Export Contacts from Dynamics 365

Export contacts with these columns:
- Full Name (or First Name + Last Name)
- Company Name (CRITICAL for account lookup)
- Email Address
- Business Phone
- Job Title

### Step 2: Create Contacts Mapping Config

**File:** `dynamics_contacts_mapping_config.json`

```json
{
  "source_file": "contacts_export.xlsx",
  "sheet_name": "Contacts",
  "target_template": "dynamics_contacts_template.csv",
  "column_mapping": {
    "First Name": "firstName",
    "Last Name": "lastName",
    "Company Name": "companyName",
    "Email Address": "email",
    "Business Phone": "phone",
    "Job Title": "title"
  },
  "id_rules": {
    "internal_id_field": "id",
    "internal_id_pattern": "CON-{{YYYY}}{{MM}}-{{00001}}",
    "external_id_fields": []
  },
  "validation_rules": {
    "required_fields": ["firstName", "lastName"],
    "email_fields": ["email"],
    "phone_fields": ["phone"],
    "url_fields": []
  },
  "dedupe_rules": {
    "primary_key": ["firstName", "lastName", "email"],
    "fuzzy_match_threshold": 90
  },
  "governance_fields": {
    "sourceSystem": "Dynamics 365 Contacts Export",
    "importStatus": "Imported"
  },
  "account_lookup": {
    "enabled": true,
    "source_column": "Company Name",
    "target_field": "accountId",
    "lookup_strategy": "name_match",
    "fallback": "create_note"
  }
}
```

**Key Fields:**
- `account_lookup.enabled`: Set to `true` to enable automatic linking
- `source_column`: The column containing company names ("Company Name")
- `target_field`: Set to "accountId" (the foreign key field)
- `lookup_strategy`: "name_match" (exact + fuzzy matching)
- `fallback`: "create_note" (adds company name to importNotes if no match)

### Step 3: Transform Contacts with Account Lookup

1. Navigate to **Admin Console** → **Dynamics Import**
2. **Select "Contacts"** from the Entity Type dropdown
3. Upload files:
   - Excel: Your Dynamics contacts export
   - Mapping: `dynamics_contacts_mapping_config.json`
   - Template: `dynamics_contacts_template.csv`
4. Click **Transform & Download Aligned CSV**

**What Happens:**
- System queries your current database for all accounts
- For each contact's "Company Name":
  - **Exact match** (case-insensitive): "Acme Corp" = "acme corp" ✓
  - **Fuzzy match** (contains): "Acme" matches "Acme Corporation" ✓
- If match found: Sets `accountId` to the account's ID
- If no match: Adds "Company: XYZ Corp" to `importNotes` for manual linking

### Step 4: Import Contacts

1. Navigate to **CSV Import** page
2. Select **Contacts** as entity type
3. Upload the transformed CSV
4. Click **Import**
5. Review results:
   - **Success:** Contacts with matching accounts linked automatically
   - **Failed:** Check for validation errors (missing required fields, etc.)

### Account Lookup Matching Rules

**Exact Match (Highest Priority):**
```
Contact Company: "Microsoft Corporation"
Account Name:    "Microsoft Corporation"
→ MATCH ✓
```

**Fuzzy Match (Fallback):**
```
Contact Company: "Microsoft"
Account Name:    "Microsoft Corporation"
→ MATCH ✓ (contains)
```

**No Match:**
```
Contact Company: "Unknown Company LLC"
(No account with similar name exists)
→ Sets accountId = null
→ Adds "Company: Unknown Company LLC" to importNotes
```

### Troubleshooting Contacts Import

**Problem:** 51 out of 69 contacts failed to import

**Causes:**
1. ❌ **Transformed contacts BEFORE importing accounts**
   - Solution: Import accounts first, THEN transform contacts
   
2. ❌ **Database was reset after transformation**
   - Solution: Re-transform contacts after importing accounts
   
3. ❌ **Account names don't match between systems**
   - Solution: Review importNotes for company names that didn't match
   - Manually link contacts after import, or update account names for better matching

**Problem:** All contacts have null accountId

**Causes:**
1. ❌ `account_lookup.enabled` is `false` in mapping config
   - Solution: Set to `true`
   
2. ❌ No accounts in database
   - Solution: Import accounts first
   
3. ❌ Company name column mapping is wrong
   - Solution: Verify `source_column` matches your Excel column name exactly

## Troubleshooting

### Common Issues

**Issue**: Transform fails with "Sheet not found"
- **Solution**: Check the `sheet_name` in your mapping config matches the Excel sheet name exactly

**Issue**: Some fields are blank after import
- **Solution**: Verify column names in your Dynamics export match the `column_mapping` exactly (case-sensitive)

**Issue**: Accounts have generic IDs instead of Account Numbers
- **Solution**: Ensure "HT Account Number" column exists in Dynamics export and is listed in `external_id_fields`

**Issue**: Import fails with validation errors
- **Solution**: Check the transformed CSV for error rows (importStatus: "Error") and review importNotes for specific issues

### Getting Help

If you encounter issues:
1. Check the **Import Notes** field on failed records
2. Review the transformation statistics shown after transform
3. Verify your mapping configuration JSON is valid
4. Ensure all required Dynamics columns are included in the export

## Best Practices

1. **Test with a small subset first**: Export 5-10 accounts from Dynamics and test the full flow
2. **Review transformed CSV**: Open the aligned CSV in Excel to verify data before importing
3. **Backup existing data**: Use the Backup feature in Admin Console before large imports
4. **Monitor import results**: Check the success/failed counts and review any errors
5. **Preserve Account Numbers**: Always include the Account Number field to maintain referential integrity with downstream systems

## Advanced Configuration

### Custom ID Patterns

You can customize the ID generation pattern:

```json
"id_rules": {
  "internal_id_pattern": "ACCT-{{YYYY}}-{{00001}}"
}
```

Supported tokens:
- `{{YYYY}}`: 4-digit year
- `{{MM}}`: 2-digit month
- `{{00001}}`: Zero-padded counter (width = number of zeros + 1)

### Additional Validation Rules

Add state/postal code validation if your Dynamics export includes addresses:

```json
"validation_rules": {
  "state_fields": ["billingState", "shippingState"],
  "postal_fields": ["billingPostalCode", "shippingPostalCode"]
}
```

### Custom Fuzzy Match Threshold

Adjust deduplication sensitivity (0-100):

```json
"dedupe_rules": {
  "fuzzy_match_threshold": 85
}
```

Lower values detect more duplicates (more aggressive), higher values require closer matches (more conservative).
