/**
 * normalizeEmail — canonical email normalization for Lead write paths.
 *
 * Business rule: a missing, empty, or whitespace-only email address means
 * "no email" and must NOT participate in email uniqueness. Meaningful emails
 * are trimmed of surrounding whitespace before storage; case is preserved
 * (the database index handles case-insensitive uniqueness via lower(BTRIM(email))).
 *
 * Apply this at EVERY lead write path (createLead, updateLead, direct inserts)
 * so the application and database agree on what constitutes a meaningful email.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (email == null) return null;
  const trimmed = email.trim();
  return trimmed === "" ? null : trimmed;
}
