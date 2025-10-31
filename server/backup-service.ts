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
  };
}

export class BackupService {
  private readonly ENCRYPTION_ALGORITHM = "aes-256-gcm";
  private readonly BACKUP_VERSION = "1.0.0";

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
    // Export all data from database
    const [
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
    ] = await Promise.all([
      db.select().from(schema.users),
      db.select().from(schema.roles),
      db.select().from(schema.permissions),
      db.select().from(schema.userRoles),
      db.select().from(schema.rolePermissions),
      db.select().from(schema.accounts),
      db.select().from(schema.contacts),
      db.select().from(schema.leads),
      db.select().from(schema.opportunities),
      db.select().from(schema.activities),
      db.select().from(schema.auditLogs),
      db.select().from(schema.idPatterns),
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
      
      await db.transaction(async (tx) => {
        // Clear ALL existing data (in reverse dependency order)
        await tx.delete(schema.auditLogs);
        await tx.delete(schema.activities);
        await tx.delete(schema.leads);
        await tx.delete(schema.opportunities);
        await tx.delete(schema.contacts);
        await tx.delete(schema.accounts);
        await tx.delete(schema.rolePermissions);
        await tx.delete(schema.userRoles);
        await tx.delete(schema.permissions);
        await tx.delete(schema.roles);
        await tx.delete(schema.users);
        await tx.delete(schema.idPatterns);

        // Restore data (in dependency order)
        // Restore auth/RBAC tables
        if (backupData.data.roles.length > 0) {
          await tx.insert(schema.roles).values(backupData.data.roles);
          recordsRestored += backupData.data.roles.length;
        }

        if (backupData.data.permissions.length > 0) {
          await tx.insert(schema.permissions).values(backupData.data.permissions);
          recordsRestored += backupData.data.permissions.length;
        }

        if (backupData.data.users.length > 0) {
          await tx.insert(schema.users).values(backupData.data.users);
          recordsRestored += backupData.data.users.length;
        }

        if (backupData.data.userRoles.length > 0) {
          await tx.insert(schema.userRoles).values(backupData.data.userRoles);
          recordsRestored += backupData.data.userRoles.length;
        }

        if (backupData.data.rolePermissions.length > 0) {
          await tx
            .insert(schema.rolePermissions)
            .values(backupData.data.rolePermissions);
          recordsRestored += backupData.data.rolePermissions.length;
        }

        // Restore CRM entities
        if (backupData.data.accounts.length > 0) {
          await tx.insert(schema.accounts).values(backupData.data.accounts);
          recordsRestored += backupData.data.accounts.length;
        }

        if (backupData.data.contacts.length > 0) {
          await tx.insert(schema.contacts).values(backupData.data.contacts);
          recordsRestored += backupData.data.contacts.length;
        }

        if (backupData.data.leads.length > 0) {
          await tx.insert(schema.leads).values(backupData.data.leads);
          recordsRestored += backupData.data.leads.length;
        }

        if (backupData.data.opportunities.length > 0) {
          await tx.insert(schema.opportunities).values(backupData.data.opportunities);
          recordsRestored += backupData.data.opportunities.length;
        }

        if (backupData.data.activities.length > 0) {
          await tx.insert(schema.activities).values(backupData.data.activities);
          recordsRestored += backupData.data.activities.length;
        }

        // Restore ID patterns
        if (backupData.data.idPatterns.length > 0) {
          await tx.insert(schema.idPatterns).values(backupData.data.idPatterns);
          recordsRestored += backupData.data.idPatterns.length;
        }

        // Restore audit logs
        if (backupData.data.auditLogs.length > 0) {
          await tx.insert(schema.auditLogs).values(backupData.data.auditLogs);
          recordsRestored += backupData.data.auditLogs.length;
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
