// LLM API key encryption utilities
// Uses AES-256-GCM authenticated encryption to store API keys at rest.
// The encryption key is derived from the LLM_KEY_SECRET environment variable.
// If neither LLM_KEY_SECRET nor BACKUP_ENCRYPTION_KEY is set, encrypt/decrypt
// will throw to prevent silently storing credentials with a known-default key.

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM

function deriveEncryptionKey(): Buffer {
  const secret = process.env.LLM_KEY_SECRET || process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "LLM API key encryption requires LLM_KEY_SECRET or BACKUP_ENCRYPTION_KEY environment variable to be set. " +
      "Please configure this secret before saving LLM credentials."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext API key.
 * Returns a base64-encoded string with format: iv:authTag:ciphertext
 * Throws if the required encryption secret env var is not configured.
 */
export function encryptApiKey(plaintext: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a stored (encrypted) API key.
 * Expects the format produced by encryptApiKey: iv:authTag:ciphertext
 * Throws if the required encryption secret env var is not configured.
 */
export function decryptApiKey(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted key format");
  }
  const [ivB64, authTagB64, cipherB64] = parts;

  const key = deriveEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(cipherB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

/**
 * Returns true if the given string looks like an AES-GCM envelope (iv:tag:cipher).
 */
export function isEncryptedKey(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 3;
}
