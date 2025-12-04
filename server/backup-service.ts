import { db } from "./db";
import * as schema from "@shared/schema";
import crypto from "crypto";
import zlib from "zlib";
import { promisify } from "util";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

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
  };
}

export class BackupService {
  private readonly ENCRYPTION_ALGORITHM = "aes-256-gcm";
  private readonly BACKUP_VERSION = "1.0.0";
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
      'closeDate', 'actualCloseDate', 'estCloseDate'
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
   * Creates a full backup of all CRM data with embedded checksum
   * File format: [checksum (64 bytes hex)][data]
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
    
    // Export all data from database in batches to avoid overwhelming Neon serverless
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

    const backupData: BackupData = {
      version: this.BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      data: {
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
    const finalBuffer = Buffer.concat([checksumBuffer, buffer]);

    return {
      data: finalBuffer,
      checksum,
      size: finalBuffer.length,
    };
  }

  /**
   * Restores data from a backup (extracts embedded checksum and verifies)
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

    try {
      // Extract embedded checksum (first 65 bytes: 64 hex chars + newline)
      const checksumLine = backupBuffer.subarray(0, 65).toString("utf-8");
      const embeddedChecksum = checksumLine.trim();
      const dataBuffer = backupBuffer.subarray(65);

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

      // Validate version
      if (backupData.version !== this.BACKUP_VERSION) {
        errors.push(
          `Backup version mismatch: ${backupData.version} vs ${this.BACKUP_VERSION}`
        );
      }

      // Use transaction for atomic restore
      let recordsRestored = 0;
      
      await db.transaction(async (tx: typeof db) => {
        // Clear ALL existing data (in reverse dependency order - child tables before parent tables)
        try {
          console.log("[Backup] Deleting existing data...");
          // Comments reference users, accounts, contacts, leads, opportunities
          await tx.delete(schema.commentReactions);
          await tx.delete(schema.commentAttachments);
          await tx.delete(schema.commentSubscriptions);
          await tx.delete(schema.comments);
          // Audit logs reference various entities
          await tx.delete(schema.auditLogs);
          // Entity tags reference tags and users
          await tx.delete(schema.entityTags);
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
          // Users are independent (but must be deleted AFTER api_keys and tags)
          await tx.delete(schema.users);
          // ID patterns are independent
          await tx.delete(schema.idPatterns);
          console.log("[Backup] All existing data deleted successfully");
        } catch (deleteError) {
          console.error("[Backup] Error during deletion:", deleteError);
          throw new Error(`Failed to clear existing data: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`);
        }

        // Restore data (in dependency order) using batched inserts
        console.log("[Backup] Starting data restoration...");
        
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

        // Restore account categories (before accounts that reference them)
        try {
          await this.batchInsert(tx, schema.accountCategories, backupData.data.accountCategories || [], "account categories");
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
        try {
          await this.batchInsert(tx, schema.accounts, backupData.data.accounts, "accounts");
          recordsRestored += backupData.data.accounts.length;
        } catch (error) {
          throw new Error(`Failed to restore accounts: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.contacts, backupData.data.contacts, "contacts");
          recordsRestored += backupData.data.contacts.length;
        } catch (error) {
          throw new Error(`Failed to restore contacts: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.leads, backupData.data.leads, "leads");
          recordsRestored += backupData.data.leads.length;
        } catch (error) {
          throw new Error(`Failed to restore leads: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          await this.batchInsert(tx, schema.opportunities, backupData.data.opportunities, "opportunities");
          recordsRestored += backupData.data.opportunities.length;
        } catch (error) {
          throw new Error(`Failed to restore opportunities: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Activities need special handling for default values
        try {
          if (backupData.data.activities.length > 0) {
            console.log(`[Backup] Restoring ${backupData.data.activities.length} activities...`);
            const activitiesWithDefaults = backupData.data.activities.map((activity: any) => {
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

        // Restore ID patterns
        try {
          await this.batchInsert(tx, schema.idPatterns, backupData.data.idPatterns, "ID patterns");
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

        // Restore entity tags (after all entities and tags are restored)
        try {
          await this.batchInsert(tx, schema.entityTags, backupData.data.entityTags || [], "entity tags");
          recordsRestored += (backupData.data.entityTags || []).length;
        } catch (error) {
          throw new Error(`Failed to restore entity tags: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

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
