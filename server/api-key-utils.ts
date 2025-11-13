// API Key generation and validation utilities
// For external integrations and forecasting app data sync

import crypto from "crypto";
import bcrypt from "bcryptjs";

const API_KEY_PREFIX = "htcrm_"; // Health Trixss CRM API key prefix
const API_KEY_LENGTH = 32; // 32 bytes = 256 bits
const SALT_ROUNDS = 12;

export interface GeneratedApiKey {
  publicKey: string; // The key to return to the user (only shown once)
  hashedKey: string; // The bcrypt hash to store in database
}

/**
 * Generate a new API key with a random value
 * Returns both the public key (to show user) and hashed key (to store)
 */
export function generateApiKey(): GeneratedApiKey {
  // Generate random bytes
  const randomBytes = crypto.randomBytes(API_KEY_LENGTH);
  
  // Convert to base64 URL-safe format
  const keyValue = randomBytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  // Add prefix to make it recognizable
  const publicKey = `${API_KEY_PREFIX}${keyValue}`;
  
  // Hash the key for storage (synchronous for simplicity in generation)
  const hashedKey = bcrypt.hashSync(publicKey, SALT_ROUNDS);
  
  return {
    publicKey,
    hashedKey,
  };
}

/**
 * Verify an API key against a stored hash
 */
export async function verifyApiKey(
  providedKey: string,
  hashedKey: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(providedKey, hashedKey);
  } catch (error) {
    return false;
  }
}

/**
 * Validate API key format
 */
export function validateApiKeyFormat(key: string): boolean {
  if (!key) return false;
  
  // Check prefix
  if (!key.startsWith(API_KEY_PREFIX)) return false;
  
  // Check length (prefix + base64 encoded 32 bytes ≈ 49 chars total)
  if (key.length < 40 || key.length > 60) return false;
  
  // Check characters (base64 URL-safe)
  const keyValue = key.slice(API_KEY_PREFIX.length);
  const validChars = /^[A-Za-z0-9_-]+$/;
  
  return validChars.test(keyValue);
}
