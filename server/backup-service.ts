import { db } from "./db";
import * as schema from "@shared/schema";
import crypto from "crypto";
import zlib from "zlib";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import JSZip from "jszip";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DOCUMENT_UPLOAD_DIR = "uploads/documents";

export interface BackupData {
  version: string;
  timestamp: string;
  data: {
    users: any[];
    roles: any[];
    permissions: any[];
    userRoles: any[];
    rolePermissions: any[];
    accounts: any[];
    contacts: any[];
    leads: any[];
    opportunities: any[];
    activities: any[];
    auditLogs: any[];
    idPatterns: any[];
    apiKeys: any[];
    tags: any[];
    entityTags: any[];
    accountCategories: any[];
    opportunityResources: any[];
    activityAssociations: any[];
    savedFilters: any[];
    comments: any[];
    commentReactions: any[];
    commentAttachments: any[];
    commentSubscriptions: any[];
    // Multi-tenant organization tables (added in v2.1.0)
    organizations?: any[];
    userOrganizations?: any[];
    // Lead Generation Module tables (added in v2.0.0)
    icpProfiles?: any[];
    icpProfileVersions?: any[];
    offers?: any[];
    taskPlaybooks?: any[];
    taskPlaybookSteps?: any[];
    leadGenerationRuns?: any[];
    agentStepLogs?: any[];
    candidateAccounts?: any[];
    candidateContacts?: any[];
    candidateLeads?: any[];
    candidateScores?: any[];
    evidenceSources?: any[];
    reviewDecisions?: any[];
    lgCrmLeads?: any[];
    lgCrmTasks?: any[];
    lgAuditEvents?: any[];
    // Research & Config tables (added in v2.0.0)
    researchDocuments?: any[];
    llmConfigurations?: any[];
    aiConfigs?: any[];
    // CRM Document Attachments metadata
    // Note: Binary files stored in uploads/documents/ must be backed up separately
    crmDocuments?: any[];
  };
}

export class BackupService {
  private readonly ENCRYPTION_ALGORITHM = "aes-256-gcm";
  private readonly BACKUP_VERSION = "2.1.0";
  private readonly BATCH_SIZE = 50; // Insert records in batches to avoid PostgreSQL parameter limits

  /**
   * Helper function to insert records in batches to avoid PostgreSQL parameter limit issues.
   * PostgreSQL has issues with prepared statements that have too many parameters.
   * This splits large arrays into smaller chunks and inserts them sequentially.
   */
  private async batchInsert<T>(
    tx: typeof db,
    table: any,
    records: T[],
    tableName: string
  ): Promise<void> {
    if (!records || records.length === 0) return;
    
    console.log(`[Backup] Restoring ${records.length} ${tableName}...`);
    
    // Process in batches to avoid parameter limit issues
    for (let i = 0; i < records.length; i += this.BATCH_SIZE) {
      const batch = records.slice(i, i + this.BATCH_SIZE);
      await tx.insert(table).values(batch.map(r => this.convertDates(r)));
    }
  }

  /**
   * Helper function to normalize enum values to lowercase
   */
  private normalizeEnumValue(value: any): any {
    if (typeof value === 'string') {
      return value.toLowerCase();
    }
    return value;
  }

  /**
   * Helper function to convert ISO date strings back to Date objects
   * and normalize enum values to lowercase for Postgres strict enum matching
   * 
   * Uses pattern matching to automatically handle all timestamp fields:
   * - Any field ending in "At" (createdAt, updatedAt, lastUsedAt, etc.)
   * - Specific date fields (closeDate, actualCloseDate, estCloseDate)
   */
  private convertDates(obj: any): any {
    if (!obj) return obj;
    
    // Specific date field names (not ending in "At")
    const specificDateFields = [
      'closeDate', 'actualCloseDate', 'estCloseDate',
      'implementationStartDate', 'implementationEndDate',
      'billingEndDate',
      'startDate', 'endDate',
    ];
    
    const enumFields = [
      'status', 'priority', 'type', 'stage', 'rating', 'accountType'
    ];
    
    const converted = { ...obj };
    
    // Convert date strings to Date objects (pattern-based approach)
    for (const [key, value] of Object.entries(converted)) {
      // Check if this field is a timestamp (ends with "At" or is in specific list)
      const isTimestampField = key.endsWith('At') || specificDateFields.includes(key);
      
      if (isTimestampField && value) {
        // If already a Date object, keep it
        if (value instanceof Date) {
          continue;
        }
        // If it's a string, try to convert it
        if (typeof value === 'string') {
          const parsedDate = new Date(value);
          // Only assign if the date is valid
          if (!isNaN(parsedDate.getTime())) {
            converted[key] = parsedDate;
          } else {
            // Invalid date string - set to null
            converted[key] = null;
          }
        }
      }
    }
    
    // Normalize enum values to lowercase for Postgres
    for (const field of enumFields) {
      if (converted[field]) {
        converted[field] = this.normalizeEnumValue(converted[field]);
      }
    }
    
    return converted;
  }

  /**
   * Builds the encrypted, compressed, checksum-prepended .htb buffer.
   * Internal helper shared by createBackup().
   */
  private async createHtbBuffer(encryptionKey: string): Promise<{
    htbBuffer: Buffer;
    checksum: string;
  }> {
    
    // Export all data from database in batches to avoid overwhelming Neon serverless
    // Batch 0: Organization tables (must be first - referenced by all CRM entities)
    const [organizations, userOrganizations] = await Promise.all([
      db.select().from(schema.organizations),
      db.select().from(schema.userOrganizations),
    ]);

    // Batch 1: Auth & RBAC (smaller tables)
    const [users, roles, permissions, userRoles, rolePermissions, idPatterns, apiKeys, accountCategories] = await Promise.all([
      db.select().from(schema.users),
      db.select().from(schema.roles),
      db.select().from(schema.permissions),
      db.select().from(schema.userRoles),
      db.select().from(schema.rolePermissions),
      db.select().from(schema.idPatterns),
      db.select().from(schema.apiKeys),
      db.select().from(schema.accountCategories),
    ]);
    
    // Batch 2: CRM entities (potentially larger tables)
    const [accounts, contacts, leads, opportunities] = await Promise.all([
      db.select().from(schema.accounts),
      db.select().from(schema.contacts),
      db.select().from(schema.leads),
      db.select().from(schema.opportunities),
    ]);
    
    // Batch 3: Activities, tags, and audit logs (potentially largest tables)
    const [activities, tags, entityTags, auditLogs] = await Promise.all([
      db.select().from(schema.activities),
      db.select().from(schema.tags),
      db.select().from(schema.entityTags),
      db.select().from(schema.auditLogs),
    ]);

    // Batch 4: Resource allocations, associations, saved filters, and comments
    const [opportunityResources, activityAssociations, savedFilters, comments] = await Promise.all([
      db.select().from(schema.opportunityResources),
      db.select().from(schema.activityAssociations),
      db.select().from(schema.savedFilters),
      db.select().from(schema.comments),
    ]);

    // Batch 5: Comment child tables
    const [commentReactions, commentAttachments, commentSubscriptions] = await Promise.all([
      db.select().from(schema.commentReactions),
      db.select().from(schema.commentAttachments),
      db.select().from(schema.commentSubscriptions),
    ]);

    // Batch 6: Lead Generation config tables (ICP profiles, offers, playbooks)
    const [icpProfiles, icpProfileVersions, offers, taskPlaybooks, taskPlaybookSteps] = await Promise.all([
      db.select().from(schema.icpProfiles),
      db.select().from(schema.icpProfileVersions),
      db.select().from(schema.offers),
      db.select().from(schema.taskPlaybooks),
      db.select().from(schema.taskPlaybookSteps),
    ]);

    // Batch 7: Lead Generation run tables
    const [leadGenerationRuns, agentStepLogs] = await Promise.all([
      db.select().from(schema.leadGenerationRuns),
      db.select().from(schema.agentStepLogs),
    ]);

    // Batch 8: Candidate tables
    const [candidateAccounts, candidateContacts, candidateLeads] = await Promise.all([
      db.select().from(schema.candidateAccounts),
      db.select().from(schema.candidateContacts),
      db.select().from(schema.candidateLeads),
    ]);

    // Batch 9: Candidate scoring, evidence, decisions, and linking tables
    const [candidateScores, evidenceSources, reviewDecisions, lgCrmLeads, lgCrmTasks, lgAuditEvents] = await Promise.all([
      db.select().from(schema.candidateScores),
      db.select().from(schema.evidenceSources),
      db.select().from(schema.reviewDecisions),
      db.select().from(schema.lgCrmLeads),
      db.select().from(schema.lgCrmTasks),
      db.select().from(schema.lgAuditEvents),
    ]);

    // Batch 10: Research documents and AI/LLM configuration
    // aiConfigs and crmDocuments are newer tables — guard against them not existing yet
    // in production databases that haven't had drizzle-kit push run against them.
    const [researchDocuments, llmConfigurations] = await Promise.all([
      db.select().from(schema.researchDocuments),
      db.select().from(schema.llmConfigurations),
    ]);

    let aiConfigs: any[] = [];
    try {
      aiConfigs = await db.select().from(schema.aiConfigs);
    } catch (e: any) {
      // 42P01 = undefined_table — table hasn't been created in this DB yet; safe to skip.
      // Any other error (permissions, syntax, connection) should propagate and fail the backup.
      if (e?.code === "42P01") {
        console.warn("[Backup] ai_configs table does not exist yet — skipping (will be empty in backup)");
      } else {
        throw e;
      }
    }

    // Batch 11: CRM Document Attachment metadata
    let crmDocuments: any[] = [];
    try {
      crmDocuments = await db.select().from(schema.crmDocuments);
    } catch (e: any) {
      // 42P01 = undefined_table — table hasn't been created in this DB yet; safe to skip.
      if (e?.code === "42P01") {
        console.warn("[Backup] crm_documents table does not exist yet — skipping (will be empty in backup)");
      } else {
        throw e;
      }
    }

    const backupData: BackupData = {
      version: this.BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      data: {
        // Multi-tenant organization tables (v2.1.0+)
        organizations,
        userOrganizations,
        users,
        roles,
        permissions,
        userRoles,
        rolePermissions,
        accounts,
        contacts,
        leads,
        opportunities,
        activities,
        auditLogs,
        idPatterns,
        apiKeys,
        tags,
        entityTags,
        accountCategories,
        opportunityResources,
        activityAssociations,
        savedFilters,
        comments,
        commentReactions,
        commentAttachments,
        commentSubscriptions,
        icpProfiles,
        icpProfileVersions,
        offers,
        taskPlaybooks,
        taskPlaybookSteps,
        leadGenerationRuns,
        agentStepLogs,
        candidateAccounts,
        candidateContacts,
        candidateLeads,
        candidateScores,
        evidenceSources,
        reviewDecisions,
        lgCrmLeads,
        lgCrmTasks,
        lgAuditEvents,
        researchDocuments,
        llmConfigurations,
        aiConfigs,
        crmDocuments,
      },
    };

    // Convert to JSON
    let jsonData = JSON.stringify(backupData, null, 2);
    let buffer = Buffer.from(jsonData, "utf-8");

    // Compress
    buffer = await gzip(buffer);

    // Encrypt with provided key
    buffer = this.encrypt(buffer, encryptionKey);

    // Calculate checksum of the data
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

    // Prepend checksum to the buffer (64 bytes for hex checksum + newline)
    const checksumBuffer = Buffer.from(checksum + "\n", "utf-8");
    const htbBuffer = Buffer.concat([checksumBuffer, buffer]);

    return { htbBuffer, checksum };
  }

  /**
   * Creates a full backup as a ZIP archive.
   * The ZIP contains:
   *   backup.htb  — encrypted/compressed/checksummed database JSON (legacy format inside)
   *   documents/  — all uploaded CRM document files from uploads/documents/
   *
   * @throws Error if encryptionKey is not provided
   */
  async createBackup(encryptionKey: string): Promise<{
    data: Buffer;
    checksum: string;
    size: number;
  }> {
    if (!encryptionKey) {
      throw new Error("BACKUP_ENCRYPTION_KEY is required for secure backups");
    }

    // Build the encrypted DB snapshot (.htb)
    const { htbBuffer, checksum } = await this.createHtbBuffer(encryptionKey);

    // Pack into a ZIP
    const zip = new JSZip();
    zip.file("backup.htb", htbBuffer);

    // Include all uploaded document files
    if (fs.existsSync(DOCUMENT_UPLOAD_DIR)) {
      const files = fs.readdirSync(DOCUMENT_UPLOAD_DIR);
      let docCount = 0;
      for (const filename of files) {
        const fullPath = path.join(DOCUMENT_UPLOAD_DIR, filename);
        if (fs.statSync(fullPath).isFile()) {
          const fileData = fs.readFileSync(fullPath);
          zip.file(`documents/${filename}`, fileData);
          docCount++;
        }
      }
      console.log(`[Backup] Added ${docCount} document file(s) to ZIP`);
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "STORE", // htb is already compressed; docs benefit little
    });

    return {
      data: zipBuffer,
      checksum,
      size: zipBuffer.length,
    };
  }

  /**
   * Detects whether a buffer is a ZIP archive by checking for the PK magic bytes.
   */
  private isZipBuffer(buf: Buffer): boolean {
    return buf.length >= 4 &&
      buf[0] === 0x50 && buf[1] === 0x4B &&
      (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
      (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08);
  }

  /**
   * Restores data from a backup.
   * Accepts:
   *   - New format: ZIP containing backup.htb + documents/ (created by createBackup())
   *   - Legacy format: raw .htb file (checksum + encrypted + gzipped JSON)
   * Missing tables in older backups default to empty.
   * @throws Error if encryptionKey is not provided
   */
  async restoreBackup(
    backupBuffer: Buffer,
    encryptionKey: string
  ): Promise<{
    success: boolean;
    recordsRestored: number;
    errors: string[];
  }> {
    if (!encryptionKey) {
      throw new Error("BACKUP_ENCRYPTION_KEY is required to restore backups");
    }

    const errors: string[] = [];

    // --- Format detection: ZIP (new) vs .htb (legacy) ---
    let htbBuffer = backupBuffer;
    let documentsFromZip: { filename: string; data: Buffer }[] = [];

    if (this.isZipBuffer(backupBuffer)) {
      console.log("[Backup] Detected ZIP format — extracting backup.htb and documents...");
      try {
        const zip = await JSZip.loadAsync(backupBuffer);

        // Extract backup.htb
        const htbFile = zip.file("backup.htb");
        if (!htbFile) {
          throw new Error("ZIP does not contain backup.htb");
        }
        htbBuffer = await htbFile.async("nodebuffer");
        console.log("[Backup] Extracted backup.htb from ZIP");

        // Extract document files
        zip.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir && relativePath.startsWith("documents/")) {
            documentsFromZip.push({ filename: path.basename(relativePath), data: null as any });
          }
        });
        // Load the actual file data
        for (const entry of documentsFromZip) {
          const zipEntry = zip.file(`documents/${entry.filename}`);
          if (zipEntry) {
            entry.data = await zipEntry.async("nodebuffer");
          }
        }
        console.log(`[Backup] Found ${documentsFromZip.length} document file(s) in ZIP`);
      } catch (zipError) {
        const msg = zipError instanceof Error ? zipError.message : String(zipError);
        throw new Error(`Failed to read ZIP backup: ${msg}`);
      }
    } else {
      console.log("[Backup] Detected legacy .htb format — restoring database only");
    }

    try {
      // Extract embedded checksum (first 65 bytes: 64 hex chars + newline)
      const checksumLine = htbBuffer.subarray(0, 65).toString("utf-8");
      const embeddedChecksum = checksumLine.trim();
      const dataBuffer = htbBuffer.subarray(65);

      // Verify checksum
      const actualChecksum = crypto
        .createHash("sha256")
        .update(dataBuffer)
        .digest("hex");

      if (actualChecksum !== embeddedChecksum) {
        throw new Error("Checksum verification failed - backup may be corrupted");
      }

      // Decrypt with provided key
      let buffer = this.decrypt(dataBuffer, encryptionKey);

      // Decompress
      buffer = await gunzip(buffer);

      // Parse JSON
      const jsonData = buffer.toString("utf-8");
      const backupData: BackupData = JSON.parse(jsonData);

      // Validate version - accept v1.x and v2.x (including v2.0.0 and v2.1.0)
      const backupVersion = backupData.version || "1.0.0";
      const backupMajor = parseInt(backupVersion.split(".")[0], 10);
      const currentMajor = parseInt(this.BACKUP_VERSION.split(".")[0], 10);
      const SUPPORTED_MAJORS = [1, 2];
      if (!SUPPORTED_MAJORS.includes(backupMajor)) {
        throw new Error(
          `Unsupported backup version v${backupData.version}. Only v1.x and v2.x backups are supported.`
        );
      }
      if (backupMajor !== currentMajor) {
        const msg = `Cross-version restore: backup is v${backupData.version}, current is v${this.BACKUP_VERSION}. Missing tables will be skipped.`;
        console.warn(`[Backup] WARNING: ${msg}`);
        errors.push(msg);
      } else if (backupData.version !== this.BACKUP_VERSION) {
        // Minor/patch version mismatch within same major — backwards compatible
        console.log(`[Backup] Restoring from v${backupData.version} backup (current: v${this.BACKUP_VERSION}). Any missing tables will be skipped.`);
      }

      // Use transaction for atomic restore
      let recordsRestored = 0;
      
      await db.transaction(async (tx: typeof db) => {
        // Clear ALL existing data (in reverse dependency order - child tables before parent tables)
        try {
          console.log("[Backup] Deleting existing data...");

          // Lead Generation linking tables (most dependent)
          await tx.delete(schema.lgCrmTasks);
          await tx.delete(schema.lgCrmLeads);
          await tx.delete(schema.lgAuditEvents);

          // Lead Generation review/scoring/evidence (depend on candidateLeads)
          await tx.delete(schema.reviewDecisions);
          await tx.delete(schema.candidateScores);
          await tx.delete(schema.evidenceSources);

          // Candidate tables (depend on runs and accounts)
          await tx.delete(schema.candidateLeads);
          await tx.delete(schema.candidateContacts);
          await tx.delete(schema.candidateAccounts);

          // Agent step logs (depend on runs)
          await tx.delete(schema.agentStepLogs);

          // Lead generation runs (depend on ICP profiles)
          await tx.delete(schema.leadGenerationRuns);

          // CRM document attachments (reference users and CRM entities)
          await tx.delete(schema.crmDocuments);

          // Research documents (independent, but reference users/runs)
          await tx.delete(schema.researchDocuments);

          // Task playbook steps (depend on playbooks)
          await tx.delete(schema.taskPlaybookSteps);

          // Task playbooks (depend on ICP profiles)
          await tx.delete(schema.taskPlaybooks);

          // Offers (depend on ICP profiles)
          await tx.delete(schema.offers);

          // ICP profile versions (depend on ICP profiles)
          await tx.delete(schema.icpProfileVersions);

          // ICP profiles (independent)
          await tx.delete(schema.icpProfiles);

          // AI/LLM config (independent)
          await tx.delete(schema.aiConfigs);
          await tx.delete(schema.llmConfigurations);

          // Comments reference users, accounts, contacts, leads, opportunities
          await tx.delete(schema.commentReactions);
          await tx.delete(schema.commentAttachments);
          await tx.delete(schema.commentSubscriptions);
          await tx.delete(schema.comments);
          // Audit logs reference various entities
          await tx.delete(schema.auditLogs);
          // Entity tags reference tags and users
          await tx.delete(schema.entityTags);
          // Opportunity resources reference opportunities and users
          await tx.delete(schema.opportunityResources);
          // Activity associations reference activities
          await tx.delete(schema.activityAssociations);
          // Saved filters reference users
          await tx.delete(schema.savedFilters);
          // Activities reference accounts, contacts, leads, opportunities
          await tx.delete(schema.activities);
          // Backup jobs are independent
          await tx.delete(schema.backupJobs);
          // Leads are independent
          await tx.delete(schema.leads);
          // Opportunities reference accounts
          await tx.delete(schema.opportunities);
          // Contacts reference accounts
          await tx.delete(schema.contacts);
          // Accounts reference accountCategories, so delete accounts BEFORE categories
          await tx.delete(schema.accounts);
          // Now safe to delete accountCategories
          await tx.delete(schema.accountCategories);
          // Role permissions reference roles and permissions
          await tx.delete(schema.rolePermissions);
          // User roles reference users and roles
          await tx.delete(schema.userRoles);
          // API keys reference users (created_by foreign key)
          await tx.delete(schema.apiKeys);
          // Tags reference users (created_by foreign key)
          await tx.delete(schema.tags);
          // Permissions are independent
          await tx.delete(schema.permissions);
          // Roles are independent  
          await tx.delete(schema.roles);
          // userOrganizations references both users and organizations — delete before both
          await tx.delete(schema.userOrganizations);
          // Users are independent (but must be deleted AFTER api_keys, tags, and userOrganizations)
          await tx.delete(schema.users);
          // ID patterns reference organizations — must be deleted before organizations
          await tx.delete(schema.idPatterns);
          // Organizations — deleted last, after all tables that reference it
          await tx.delete(schema.organizations);
          console.log("[Backup] All existing data deleted successfully");
        } catch (deleteError) {
          console.error("[Backup] Error during deletion:", deleteError);
          throw new Error(`Failed to clear existing data: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`);
        }

        // Restore data (in dependency order) using batched inserts
        console.log("[Backup] Starting data restoration...");

        // Detect whether this backup includes org data (v2.1.0+).
        // Old backups (v1.x, v2.0.0) don't have organizations — for backwards compat
        // we strip organizationId from CRM records so FK constraints don't fail.
        // Server startup will re-create the default org and backfill all records.
        const hasOrgData = (backupData.data.organizations || []).length > 0;
        const stripOrgId = (records: any[]): any[] => {
          if (hasOrgData) return records; // New backup — keep organizationId intact
          return records.map((r: any) => {
            const copy = { ...r };
            delete copy.organizationId;
            return copy;
          });
        };

        // Restore auth/RBAC tables
        try {
          await this.batchInsert(tx, schema.roles, backupData.data.roles, "roles");
          recordsRestored += backupData.data.roles.length;
        } catch (error) {
          throw new Error(`Failed to restore roles: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.permissions, backupData.data.permissions, "permissions");
          recordsRestored += backupData.data.permissions.length;
        } catch (error) {
          throw new Error(`Failed to restore permissions: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.users, backupData.data.users, "users");
          recordsRestored += backupData.data.users.length;
        } catch (error) {
          throw new Error(`Failed to restore users: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore API keys (depends on users)
        try {
          await this.batchInsert(tx, schema.apiKeys, backupData.data.apiKeys || [], "API keys");
          recordsRestored += (backupData.data.apiKeys || []).length;
        } catch (error) {
          throw new Error(`Failed to restore API keys: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.userRoles, backupData.data.userRoles, "user roles");
          recordsRestored += backupData.data.userRoles.length;
        } catch (error) {
          throw new Error(`Failed to restore user roles: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.rolePermissions, backupData.data.rolePermissions, "role permissions");
          recordsRestored += backupData.data.rolePermissions.length;
        } catch (error) {
          throw new Error(`Failed to restore role permissions: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore organizations (v2.1.0+) — must come before accounts/contacts/leads/etc.
        // Old backups will have no org data here; server startup will re-create the default org.
        try {
          const orgs = backupData.data.organizations || [];
          await this.batchInsert(tx, schema.organizations, orgs, "organizations");
          recordsRestored += orgs.length;
          if (!hasOrgData) {
            console.log("[Backup] No org data in backup (pre-v2.1.0 format) — server startup will recreate default org");
          }
        } catch (error) {
          throw new Error(`Failed to restore organizations: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore userOrganizations (v2.1.0+) — after users and organizations
        try {
          const userOrgs = backupData.data.userOrganizations || [];
          await this.batchInsert(tx, schema.userOrganizations, userOrgs, "user-organization memberships");
          recordsRestored += userOrgs.length;
        } catch (error) {
          throw new Error(`Failed to restore user-organization memberships: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore account categories (before accounts that reference them)
        try {
          await this.batchInsert(tx, schema.accountCategories, stripOrgId(backupData.data.accountCategories || []), "account categories");
          recordsRestored += (backupData.data.accountCategories || []).length;
        } catch (error) {
          throw new Error(`Failed to restore account categories: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore tags (after users, before entity_tags)
        try {
          await this.batchInsert(tx, schema.tags, backupData.data.tags || [], "tags");
          recordsRestored += (backupData.data.tags || []).length;
        } catch (error) {
          throw new Error(`Failed to restore tags: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore CRM entities using batched inserts
        // stripOrgId() handles backwards compat: strips organizationId from old backups
        // so FK constraints don't fail when no org data is present.
        try {
          await this.batchInsert(tx, schema.accounts, stripOrgId(backupData.data.accounts), "accounts");
          recordsRestored += backupData.data.accounts.length;
        } catch (error) {
          throw new Error(`Failed to restore accounts: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.contacts, stripOrgId(backupData.data.contacts), "contacts");
          recordsRestored += backupData.data.contacts.length;
        } catch (error) {
          throw new Error(`Failed to restore contacts: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.leads, stripOrgId(backupData.data.leads), "leads");
          recordsRestored += backupData.data.leads.length;
        } catch (error) {
          throw new Error(`Failed to restore leads: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.opportunities, stripOrgId(backupData.data.opportunities), "opportunities");
          recordsRestored += backupData.data.opportunities.length;
        } catch (error) {
          throw new Error(`Failed to restore opportunities: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Activities need special handling for default values
        try {
          if (backupData.data.activities.length > 0) {
            console.log(`[Backup] Restoring ${backupData.data.activities.length} activities...`);
            const activitiesWithDefaults = stripOrgId(backupData.data.activities).map((activity: any) => {
              const withDates = this.convertDates(activity);
              return {
                ...withDates,
                status: activity.status || "pending",
                priority: activity.priority || "medium",
              };
            });
            // Batch insert activities
            for (let i = 0; i < activitiesWithDefaults.length; i += this.BATCH_SIZE) {
              const batch = activitiesWithDefaults.slice(i, i + this.BATCH_SIZE);
              await tx.insert(schema.activities).values(batch);
            }
            recordsRestored += backupData.data.activities.length;
          }
        } catch (error) {
          throw new Error(`Failed to restore activities: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore ID patterns (stripOrgId for backwards compat — org FK on idPatterns)
        try {
          await this.batchInsert(tx, schema.idPatterns, stripOrgId(backupData.data.idPatterns), "ID patterns");
          recordsRestored += backupData.data.idPatterns.length;
        } catch (error) {
          throw new Error(`Failed to restore ID patterns: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore audit logs
        try {
          await this.batchInsert(tx, schema.auditLogs, backupData.data.auditLogs, "audit logs");
          recordsRestored += backupData.data.auditLogs.length;
        } catch (error) {
          throw new Error(`Failed to restore audit logs: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore activity associations (after activities)
        try {
          await this.batchInsert(tx, schema.activityAssociations, backupData.data.activityAssociations || [], "activity associations");
          recordsRestored += (backupData.data.activityAssociations || []).length;
        } catch (error) {
          throw new Error(`Failed to restore activity associations: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore opportunity resources (after opportunities and users)
        try {
          await this.batchInsert(tx, schema.opportunityResources, backupData.data.opportunityResources || [], "opportunity resources");
          recordsRestored += (backupData.data.opportunityResources || []).length;
        } catch (error) {
          throw new Error(`Failed to restore opportunity resources: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore saved filters (after users)
        try {
          await this.batchInsert(tx, schema.savedFilters, backupData.data.savedFilters || [], "saved filters");
          recordsRestored += (backupData.data.savedFilters || []).length;
        } catch (error) {
          throw new Error(`Failed to restore saved filters: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore entity tags (after all entities and tags are restored)
        try {
          await this.batchInsert(tx, schema.entityTags, backupData.data.entityTags || [], "entity tags");
          recordsRestored += (backupData.data.entityTags || []).length;
        } catch (error) {
          throw new Error(`Failed to restore entity tags: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore comments (after users and all entity tables)
        // Sort by depth ASC to ensure parent comments are inserted before children (self-referential FK)
        try {
          const sortedComments = [...(backupData.data.comments || [])].sort(
            (a: any, b: any) => (a.depth ?? 0) - (b.depth ?? 0)
          );
          await this.batchInsert(tx, schema.comments, sortedComments, "comments");
          recordsRestored += sortedComments.length;
        } catch (error) {
          throw new Error(`Failed to restore comments: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore comment reactions (after comments and users)
        try {
          await this.batchInsert(tx, schema.commentReactions, backupData.data.commentReactions || [], "comment reactions");
          recordsRestored += (backupData.data.commentReactions || []).length;
        } catch (error) {
          throw new Error(`Failed to restore comment reactions: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore comment attachments (after comments and users)
        try {
          await this.batchInsert(tx, schema.commentAttachments, backupData.data.commentAttachments || [], "comment attachments");
          recordsRestored += (backupData.data.commentAttachments || []).length;
        } catch (error) {
          throw new Error(`Failed to restore comment attachments: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore comment subscriptions (after comments and users)
        try {
          await this.batchInsert(tx, schema.commentSubscriptions, backupData.data.commentSubscriptions || [], "comment subscriptions");
          recordsRestored += (backupData.data.commentSubscriptions || []).length;
        } catch (error) {
          throw new Error(`Failed to restore comment subscriptions: ${error instanceof Error ? error.message : String(error)}`);
        }

        // ====== LEAD GENERATION MODULE RESTORE (v2.0.0+) ======
        // All new fields use || [] to be backwards-compatible with v1.x backups

        // Restore LLM configurations and AI configs (independent)
        try {
          await this.batchInsert(tx, schema.llmConfigurations, backupData.data.llmConfigurations || [], "LLM configurations");
          recordsRestored += (backupData.data.llmConfigurations || []).length;
        } catch (error) {
          throw new Error(`Failed to restore LLM configurations: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.aiConfigs, backupData.data.aiConfigs || [], "AI configs");
          recordsRestored += (backupData.data.aiConfigs || []).length;
        } catch (error) {
          throw new Error(`Failed to restore AI configs: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore ICP profiles (independent - no other tables depend on them at this point)
        try {
          await this.batchInsert(tx, schema.icpProfiles, backupData.data.icpProfiles || [], "ICP profiles");
          recordsRestored += (backupData.data.icpProfiles || []).length;
        } catch (error) {
          throw new Error(`Failed to restore ICP profiles: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore ICP profile versions (depend on ICP profiles)
        try {
          await this.batchInsert(tx, schema.icpProfileVersions, backupData.data.icpProfileVersions || [], "ICP profile versions");
          recordsRestored += (backupData.data.icpProfileVersions || []).length;
        } catch (error) {
          throw new Error(`Failed to restore ICP profile versions: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore offers (depend on ICP profiles)
        try {
          await this.batchInsert(tx, schema.offers, backupData.data.offers || [], "offers");
          recordsRestored += (backupData.data.offers || []).length;
        } catch (error) {
          throw new Error(`Failed to restore offers: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore task playbooks (may reference ICP profiles)
        try {
          await this.batchInsert(tx, schema.taskPlaybooks, backupData.data.taskPlaybooks || [], "task playbooks");
          recordsRestored += (backupData.data.taskPlaybooks || []).length;
        } catch (error) {
          throw new Error(`Failed to restore task playbooks: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore task playbook steps (depend on playbooks)
        try {
          await this.batchInsert(tx, schema.taskPlaybookSteps, backupData.data.taskPlaybookSteps || [], "task playbook steps");
          recordsRestored += (backupData.data.taskPlaybookSteps || []).length;
        } catch (error) {
          throw new Error(`Failed to restore task playbook steps: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore lead generation runs (depend on ICP profiles/versions, users, and organizations)
        try {
          await this.batchInsert(tx, schema.leadGenerationRuns, stripOrgId(backupData.data.leadGenerationRuns || []), "lead generation runs");
          recordsRestored += (backupData.data.leadGenerationRuns || []).length;
        } catch (error) {
          throw new Error(`Failed to restore lead generation runs: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore agent step logs (depend on runs)
        try {
          await this.batchInsert(tx, schema.agentStepLogs, backupData.data.agentStepLogs || [], "agent step logs");
          recordsRestored += (backupData.data.agentStepLogs || []).length;
        } catch (error) {
          throw new Error(`Failed to restore agent step logs: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore candidate accounts (depend on runs and CRM accounts)
        try {
          await this.batchInsert(tx, schema.candidateAccounts, backupData.data.candidateAccounts || [], "candidate accounts");
          recordsRestored += (backupData.data.candidateAccounts || []).length;
        } catch (error) {
          throw new Error(`Failed to restore candidate accounts: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore candidate contacts (depend on candidate accounts and runs)
        try {
          await this.batchInsert(tx, schema.candidateContacts, backupData.data.candidateContacts || [], "candidate contacts");
          recordsRestored += (backupData.data.candidateContacts || []).length;
        } catch (error) {
          throw new Error(`Failed to restore candidate contacts: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore candidate leads (depend on runs, candidate accounts, candidate contacts, playbooks)
        try {
          await this.batchInsert(tx, schema.candidateLeads, backupData.data.candidateLeads || [], "candidate leads");
          recordsRestored += (backupData.data.candidateLeads || []).length;
        } catch (error) {
          throw new Error(`Failed to restore candidate leads: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore candidate scores (depend on candidate leads)
        try {
          await this.batchInsert(tx, schema.candidateScores, backupData.data.candidateScores || [], "candidate scores");
          recordsRestored += (backupData.data.candidateScores || []).length;
        } catch (error) {
          throw new Error(`Failed to restore candidate scores: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore evidence sources (depend on candidate leads and candidate accounts)
        try {
          await this.batchInsert(tx, schema.evidenceSources, backupData.data.evidenceSources || [], "evidence sources");
          recordsRestored += (backupData.data.evidenceSources || []).length;
        } catch (error) {
          throw new Error(`Failed to restore evidence sources: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore review decisions (depend on candidate leads and users)
        try {
          await this.batchInsert(tx, schema.reviewDecisions, backupData.data.reviewDecisions || [], "review decisions");
          recordsRestored += (backupData.data.reviewDecisions || []).length;
        } catch (error) {
          throw new Error(`Failed to restore review decisions: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore LG CRM leads (depend on candidate leads and CRM leads)
        try {
          await this.batchInsert(tx, schema.lgCrmLeads, backupData.data.lgCrmLeads || [], "LG CRM leads");
          recordsRestored += (backupData.data.lgCrmLeads || []).length;
        } catch (error) {
          throw new Error(`Failed to restore LG CRM leads: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore LG CRM tasks (depend on candidate leads, activities, playbook steps, runs)
        try {
          await this.batchInsert(tx, schema.lgCrmTasks, backupData.data.lgCrmTasks || [], "LG CRM tasks");
          recordsRestored += (backupData.data.lgCrmTasks || []).length;
        } catch (error) {
          throw new Error(`Failed to restore LG CRM tasks: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore LG audit events (depend on users and runs)
        try {
          await this.batchInsert(tx, schema.lgAuditEvents, backupData.data.lgAuditEvents || [], "LG audit events");
          recordsRestored += (backupData.data.lgAuditEvents || []).length;
        } catch (error) {
          throw new Error(`Failed to restore LG audit events: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore research documents (depend on users; may reference runs)
        try {
          await this.batchInsert(tx, schema.researchDocuments, backupData.data.researchDocuments || [], "research documents");
          recordsRestored += (backupData.data.researchDocuments || []).length;
        } catch (error) {
          throw new Error(`Failed to restore research documents: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Restore CRM document attachment metadata (depend on users and CRM entities)
        // Binary files are restored from the ZIP after this transaction completes.
        try {
          await this.batchInsert(tx, schema.crmDocuments, backupData.data.crmDocuments || [], "CRM document metadata");
          recordsRestored += (backupData.data.crmDocuments || []).length;
        } catch (error) {
          throw new Error(`Failed to restore CRM document metadata: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      // Restore document files from ZIP (after DB transaction so it's only run on success)
      if (documentsFromZip.length > 0) {
        fs.mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });
        let filesWritten = 0;
        for (const { filename, data } of documentsFromZip) {
          if (data) {
            const destPath = path.join(DOCUMENT_UPLOAD_DIR, filename);
            fs.writeFileSync(destPath, data);
            filesWritten++;
          }
        }
        console.log(`[Backup] Restored ${filesWritten} document file(s) to ${DOCUMENT_UPLOAD_DIR}`);
      }

      return {
        success: true,
        recordsRestored,
        errors,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unknown error");
      return {
        success: false,
        recordsRestored: 0,
        errors,
      };
    }
  }

  /**
   * Encrypts data using AES-256-GCM
   */
  private encrypt(buffer: Buffer, key: string): Buffer {
    // Derive 32-byte key from passphrase
    const cryptoKey = crypto.scryptSync(key, "salt", 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, cryptoKey, iv);

    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: [iv (16 bytes)][authTag (16 bytes)][encrypted data]
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Decrypts data using AES-256-GCM
   */
  private decrypt(buffer: Buffer, key: string): Buffer {
    // Derive 32-byte key from passphrase
    const cryptoKey = crypto.scryptSync(key, "salt", 32);

    // Extract iv, authTag, and encrypted data
    const iv = buffer.subarray(0, 16);
    const authTag = buffer.subarray(16, 32);
    const encrypted = buffer.subarray(32);

    const decipher = crypto.createDecipheriv(
      this.ENCRYPTION_ALGORITHM,
      cryptoKey,
      iv
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}

export const backupService = new BackupService();
