# Dynamics 365 Account Import Guide

## Overview

The Health Trixss CRM now supports direct import of account data from Dynamics 365 exports. This guide explains how to prepare and import your Dynamics 365 account data.

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

#### Create Mapping Configuration (`dynamics_mapping_config.json`)

```json
{
  "source_file": "Active Accounts 11-2-2025 10-03-45 AM.xlsx",
  "sheet_name": "Active Accounts",
  "target_template": "accounts-template.csv",
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
    "external_id_fields": ["accountNumber", "externalId"]
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

#### Get Template CSV (`accounts-template.csv`)

This file is available in `attached_assets/accounts-template.csv` and defines the target column structure:

```csv
id,name,accountNumber,type,category,industry,website,phone,primaryContactName,primaryContactEmail,billingAddress,shippingAddress,externalId,sourceSystem,sourceRecordId,importStatus,importNotes
```

### Step 3: Transform Dynamics Data

1. Log into Health Trixss CRM with Admin credentials
2. Navigate to **Admin Console** → **Dynamics Import** tab
3. Upload your three files:
   - **Excel File**: Your Dynamics 365 export
   - **Mapping Configuration**: Your `dynamics_mapping_config.json`
   - **Template CSV**: The `accounts-template.csv` file
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

The system uses smart ID generation:

1. **If HT Account Number exists**: Uses the existing account number as the ID
2. **If Dynamics GUID exists but no Account Number**: Generates new ID using pattern
3. **Pattern**: `ACC-{{YYYY}}{{MM}}-{{00001}}`
   - Example: `ACC-202511-00001` for the first account in November 2025

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
