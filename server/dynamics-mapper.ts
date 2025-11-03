// Dynamics 365 Account Normalization Service
// Transforms Excel exports into Health Trixss CRM-aligned CSV format

import * as XLSX from 'xlsx';

export interface DynamicsMappingConfig {
  source_file: string;
  sheet_name: string;
  target_template: string;
  column_mapping: Record<string, string>;
  id_rules: {
    internal_id_field: string;
    internal_id_pattern: string;
    external_id_fields: string[];
    preserve_external_format?: boolean;
  };
  validation_rules: {
    required_fields: string[];
    email_fields: string[];
    phone_fields: string[];
    url_fields: string[];
    state_fields?: string[];
    postal_fields?: string[];
    decimal_fields?: string[];
    date_fields?: string[];
  };
  dedupe_rules: {
    primary_key: string[];
    fuzzy_match_threshold: number;
  };
  governance_fields?: Record<string, string>;
  type_mapping?: Record<string, Record<string, string>>; // field -> { sourceValue -> targetValue }
  computed_fields?: Record<string, any>; // field -> computation rules
  account_lookup?: {
    enabled: boolean;
    source_column: string;
    target_field: string;
    lookup_strategy: string;
    fallback: string;
  };
}

export interface AccountRow {
  [key: string]: string;
}

export interface TransformResult {
  data: AccountRow[];
  stats: {
    total_rows: number;
    valid_rows: number;
    error_rows: number;
    duplicate_rows: number;
  };
}

export class DynamicsMapper {
  private config: DynamicsMappingConfig;
  private recordCounter = 0;

  constructor(config: DynamicsMappingConfig) {
    this.config = config;
  }

  /**
   * Read Excel file and return as array of objects
   */
  readExcelFile(buffer: Buffer): AccountRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = this.config.sheet_name || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found in Excel file`);
    }

    // Convert to JSON, treating all values as strings
    const data = XLSX.utils.sheet_to_json(worksheet, { 
      raw: false,
      defval: '' 
    }) as AccountRow[];

    return data;
  }

  /**
   * Read CSV template to get column order
   */
  getTemplateColumns(templateCsv: string): string[] {
    const lines = templateCsv.split('\n');
    if (lines.length === 0) return [];
    
    // Parse CSV header (handle quoted fields)
    const header = lines[0];
    const columns: string[] = [];
    let currentCol = '';
    let inQuotes = false;
    
    for (let i = 0; i < header.length; i++) {
      const char = header[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        columns.push(currentCol.trim());
        currentCol = '';
      } else {
        currentCol += char;
      }
    }
    if (currentCol) {
      columns.push(currentCol.trim());
    }

    return columns;
  }

  /**
   * Apply column mapping from source to target names
   */
  applyColumnMapping(data: AccountRow[]): AccountRow[] {
    return data.map(row => {
      const mapped: AccountRow = {};
      
      // Apply explicit mappings
      for (const [sourceCol, targetCol] of Object.entries(this.config.column_mapping)) {
        if (row[sourceCol] !== undefined) {
          mapped[targetCol] = row[sourceCol];
        }
      }
      
      return mapped;
    });
  }

  /**
   * Generate Record ID using pattern or external ID
   */
  generateRecordId(row: AccountRow, index: number): string {
    // Try to use external ID fields first
    for (const field of this.config.id_rules.external_id_fields) {
      const externalId = row[field];
      if (externalId && externalId.trim()) {
        // If preserve_external_format is true, keep the ID as-is
        if (this.config.id_rules.preserve_external_format) {
          return externalId.trim();
        }
        // Otherwise normalize: remove non-alphanumeric characters
        return externalId.replace(/\W+/g, '');
      }
    }

    // Generate internal ID using pattern
    const pattern = this.config.id_rules.internal_id_pattern;
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    
    let id = pattern
      .replace(/\{\{YYYY\}\}/g, year)
      .replace(/\{\{MM\}\}/g, month);
    
    // Handle counter pattern like {{00001}}, {{000001}}, etc.
    // Match one or more zeros followed by a 1, e.g., {{00001}}
    const counterMatch = pattern.match(/\{\{(0+1)\}\}/);
    if (counterMatch) {
      const placeholder = counterMatch[1]; // e.g., "00001"
      const width = placeholder.length; // e.g., 5
      const counter = (index + 1).toString().padStart(width, '0');
      // Replace all occurrences of the pattern
      id = id.replace(/\{\{0+1\}\}/g, counter);
    }
    
    return id;
  }

  /**
   * Validate email format
   */
  validateEmail(email: string): boolean {
    if (!email || !email.trim()) return true; // Empty is OK
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Validate phone format (basic check for digits)
   */
  validatePhone(phone: string): boolean {
    if (!phone || !phone.trim()) return true; // Empty is OK
    // Allow digits, spaces, dashes, parentheses, plus sign
    const phoneRegex = /^[\d\s\-\(\)\+]+$/;
    return phoneRegex.test(phone.trim());
  }

  /**
   * Validate URL format
   */
  validateUrl(url: string): boolean {
    if (!url || !url.trim()) return true; // Empty is OK
    try {
      new URL(url.trim());
      return true;
    } catch {
      // Also accept domain-only URLs
      const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
      return domainRegex.test(url.trim());
    }
  }

  /**
   * Validate state/province (2-letter code)
   */
  validateState(state: string): boolean {
    if (!state || !state.trim()) return true; // Empty is OK
    const stateRegex = /^[A-Z]{2}$/;
    return stateRegex.test(state.trim().toUpperCase());
  }

  /**
   * Validate postal code (5 or 9 digits for US, flexible for international)
   */
  validatePostalCode(postal: string): boolean {
    if (!postal || !postal.trim()) return true; // Empty is OK
    // Accept various formats: 12345, 12345-6789, A1A 1A1, etc.
    const postalRegex = /^[\dA-Z\s\-]+$/i;
    return postalRegex.test(postal.trim());
  }

  /**
   * Validate a row and return error messages
   */
  validateRow(row: AccountRow): string[] {
    const errors: string[] = [];

    // Check required fields
    for (const field of this.config.validation_rules.required_fields) {
      if (!row[field] || !row[field].trim()) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate email fields
    for (const field of this.config.validation_rules.email_fields) {
      if (row[field] && !this.validateEmail(row[field])) {
        errors.push(`Invalid email format in ${field}: ${row[field]}`);
      }
    }

    // Validate phone fields
    for (const field of this.config.validation_rules.phone_fields) {
      if (row[field] && !this.validatePhone(row[field])) {
        errors.push(`Invalid phone format in ${field}: ${row[field]}`);
      }
    }

    // Validate URL fields
    for (const field of this.config.validation_rules.url_fields) {
      if (row[field] && !this.validateUrl(row[field])) {
        errors.push(`Invalid URL format in ${field}: ${row[field]}`);
      }
    }

    // Validate state fields
    if (this.config.validation_rules.state_fields) {
      for (const field of this.config.validation_rules.state_fields) {
        if (row[field] && !this.validateState(row[field])) {
          errors.push(`Invalid state/province in ${field}: ${row[field]} (must be 2-letter code)`);
        }
      }
    }

    // Validate postal fields
    if (this.config.validation_rules.postal_fields) {
      for (const field of this.config.validation_rules.postal_fields) {
        if (row[field] && !this.validatePostalCode(row[field])) {
          errors.push(`Invalid postal code format in ${field}: ${row[field]}`);
        }
      }
    }

    return errors;
  }

  /**
   * Create a dedupe key from primary key fields
   */
  createDedupeKey(row: AccountRow): string {
    return this.config.dedupe_rules.primary_key
      .map(field => (row[field] || '').toString().trim().toLowerCase())
      .join('|');
  }

  /**
   * Deduplicate rows based on primary key
   */
  deduplicateRows(rows: AccountRow[]): AccountRow[] {
    const seen = new Set<string>();
    const deduplicated: AccountRow[] = [];

    for (const row of rows) {
      const key = this.createDedupeKey(row);
      
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(row);
      } else {
        // Mark as duplicate
        row['Import Status'] = 'Duplicate';
        row['Import Notes'] = row['Import Notes'] 
          ? `${row['Import Notes']}; Duplicate record skipped`
          : 'Duplicate record skipped';
      }
    }

    return deduplicated;
  }

  /**
   * Add governance fields to each row
   */
  addGovernanceFields(row: AccountRow, index: number): AccountRow {
    // Set governance fields from config
    if (this.config.governance_fields) {
      const sourceSystem = this.config.governance_fields.sourceSystem || 'Dynamics 365 Export';
      const importStatus = this.config.governance_fields.importStatus || 'Imported';
      
      row['sourceSystem'] = sourceSystem;
      row['importStatus'] = importStatus;
    }

    // Set Source Record ID from externalId (Dynamics GUID) if available
    if (!row['sourceRecordId'] && row['externalId'] && row['externalId'].trim()) {
      row['sourceRecordId'] = row['externalId'];
    }

    // If still no sourceRecordId, try external ID fields
    if (!row['sourceRecordId']) {
      for (const field of this.config.id_rules.external_id_fields) {
        if (row[field] && row[field].trim()) {
          row['sourceRecordId'] = row[field];
          break;
        }
      }
    }

    return row;
  }

  /**
   * Convert Excel date serial number to ISO date string
   */
  excelDateToISO(serial: number): string {
    // Excel date serial: days since 1900-01-01 (with leap year bug)
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    const date = new Date(utc_value * 1000);
    return date.toISOString().split('T')[0];
  }

  /**
   * Apply type mapping to convert source values to target enum values
   * Supports per-field mappings: { "status": { "New": "new", "Contacted": "contacted" } }
   */
  applyTypeMapping(row: AccountRow): AccountRow {
    if (!this.config.type_mapping) return row;

    // Apply type mapping for each configured field
    for (const [fieldName, mappings] of Object.entries(this.config.type_mapping)) {
      const sourceValue = row[fieldName];
      if (sourceValue && mappings[sourceValue]) {
        row[fieldName] = mappings[sourceValue];
      }
    }

    return row;
  }

  /**
   * Apply computed fields logic (coalesce, conditional, etc.)
   */
  applyComputedFields(row: AccountRow): AccountRow {
    if (!this.config.computed_fields) return row;

    for (const [fieldName, computation] of Object.entries(this.config.computed_fields)) {
      const logic = computation.logic;

      if (logic === 'use_status_mapping') {
        // Map status field to stage using type_mapping
        // This handles Dynamics status → CRM stage conversion
        const statusValue = row['status'];
        const defaultValue = computation.default || 'prospecting';
        
        // If we have a status value and it's already been type-mapped, use it
        if (statusValue && statusValue.trim() !== '') {
          row[fieldName] = statusValue;
        } else {
          row[fieldName] = defaultValue;
        }
      }
      else if (logic === 'coalesce') {
        // Take first non-empty value from sources
        const sources = computation.sources || [];
        let value = computation.default || '';
        
        for (const source of sources) {
          const sourceValue = row[source];
          if (sourceValue !== undefined && sourceValue !== null && sourceValue !== '') {
            // Handle Excel date serial numbers
            if (computation.is_date && !isNaN(Number(sourceValue))) {
              value = this.excelDateToISO(Number(sourceValue));
            } else {
              value = sourceValue;
            }
            break;
          }
        }
        
        row[fieldName] = value;
      }
      else if (logic === 'conditional') {
        // Apply if-then rules
        const rules = computation.rules || [];
        let value = computation.default || '';
        
        for (const rule of rules) {
          const condition = rule.if;
          
          // Parse simple conditions like "status == 'Won'" or "rating == 'Hot'"
          const match = condition.match(/(\w+)\s*==\s*['"](.+)['"]/);
          if (match) {
            const [, condField, condValue] = match;
            if (row[condField] === condValue) {
              value = rule.then;
              break;
            }
          }
        }
        
        row[fieldName] = value.toString();
      }
      else if (logic === 'use_status_mapping') {
        // Use type_mapping for status -> stage conversion
        if (this.config.type_mapping && this.config.type_mapping['status']) {
          const statusValue = row['status'];
          row[fieldName] = this.config.type_mapping['status'][statusValue] || computation.default || '';
        }
      }
    }

    return row;
  }

  /**
   * Perform account lookup by name
   */
  lookupAccountByName(companyName: string, existingAccounts: any[]): string | null {
    if (!companyName || !companyName.trim()) return null;
    
    const normalizedName = companyName.trim().toLowerCase();
    
    // First try exact match
    const exactMatch = existingAccounts.find(
      acc => acc.name.toLowerCase() === normalizedName
    );
    if (exactMatch) return exactMatch.id;
    
    // Try fuzzy match (contains)
    const fuzzyMatch = existingAccounts.find(
      acc => acc.name.toLowerCase().includes(normalizedName) ||
             normalizedName.includes(acc.name.toLowerCase())
    );
    if (fuzzyMatch) return fuzzyMatch.id;
    
    return null;
  }

  /**
   * Apply account lookup to map company names to account IDs
   */
  applyAccountLookup(data: AccountRow[], sourceData: AccountRow[], existingAccounts: any[]): AccountRow[] {
    if (!this.config.account_lookup?.enabled) return data;
    
    const { source_column, target_field, fallback } = this.config.account_lookup;
    
    return data.map((row, index) => {
      const sourceRow = sourceData[index];
      const companyName = sourceRow?.[source_column];
      
      if (companyName && companyName.trim()) {
        const accountId = this.lookupAccountByName(companyName, existingAccounts);
        
        if (accountId) {
          row[target_field] = accountId;
        } else if (fallback === 'create_note') {
          const note = `Company: ${companyName}`;
          row['importNotes'] = row['importNotes'] 
            ? `${row['importNotes']}; ${note}` 
            : note;
        }
      }
      
      return row;
    });
  }

  /**
   * Transform Excel data to aligned CSV format
   */
  transform(excelBuffer: Buffer, templateCsv: string, existingAccounts: any[] = []): TransformResult {
    // Step 1: Read Excel
    const sourceData = this.readExcelFile(excelBuffer);
    const totalRows = sourceData.length;

    // Step 2: Apply column mapping
    let data = this.applyColumnMapping(sourceData);

    // Step 3: Apply type mapping (e.g., "Customer" -> "customer")
    data = data.map(row => this.applyTypeMapping(row));

    // Step 3.5: Apply computed fields (coalesce, conditional, etc.)
    data = data.map(row => this.applyComputedFields(row));

    // Step 4: Get template columns
    const templateColumns = this.getTemplateColumns(templateCsv);

    // Step 5: Ensure all template columns exist
    data = data.map(row => {
      const complete: AccountRow = {};
      for (const col of templateColumns) {
        complete[col] = row[col] || '';
      }
      return complete;
    });

    // Step 5.5: Apply account lookup (if enabled)
    data = this.applyAccountLookup(data, sourceData, existingAccounts);

    // Step 6: Generate Record IDs
    data = data.map((row, index) => {
      row[this.config.id_rules.internal_id_field] = this.generateRecordId(row, index);
      return row;
    });

    // Step 7: Add governance fields
    data = data.map((row, index) => this.addGovernanceFields(row, index));

    // Step 8: Validate each row
    data = data.map(row => {
      const errors = this.validateRow(row);
      if (errors.length > 0) {
        row['importStatus'] = 'Error';
        row['importNotes'] = errors.join('; ');
      }
      return row;
    });

    // Step 9: Deduplicate
    const beforeDedupe = data.length;
    const deduplicated = this.deduplicateRows(data);
    const duplicateCount = beforeDedupe - deduplicated.length;

    // Step 10: Reorder columns to match template
    const aligned = deduplicated.map(row => {
      const ordered: AccountRow = {};
      for (const col of templateColumns) {
        ordered[col] = row[col] || '';
      }
      return ordered;
    });

    // Calculate stats
    const errorRows = aligned.filter(row => row['importStatus'] === 'Error').length;
    const validRows = aligned.filter(row => row['importStatus'] !== 'Error').length;

    return {
      data: aligned,
      stats: {
        total_rows: totalRows,
        valid_rows: validRows,
        error_rows: errorRows,
        duplicate_rows: duplicateCount
      }
    };
  }

  /**
   * Convert aligned data to CSV string
   */
  toCSV(data: AccountRow[]): string {
    if (data.length === 0) return '';

    const columns = Object.keys(data[0]);
    const header = columns.map(col => this.escapeCSV(col)).join(',');
    
    const rows = data.map(row => 
      columns.map(col => this.escapeCSV(row[col] || '')).join(',')
    );

    return [header, ...rows].join('\n');
  }

  /**
   * Escape CSV field (handle commas, quotes, newlines)
   */
  private escapeCSV(value: string): string {
    if (!value) return '';
    
    const stringValue = value.toString();
    
    // If field contains comma, quote, or newline, wrap in quotes and escape quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }
}
