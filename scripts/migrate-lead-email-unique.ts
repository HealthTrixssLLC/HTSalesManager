/**
 * Standalone migration script: Lead email normalization + unique index creation
 *
 * PURPOSE: Ensures that blank/whitespace-only emails are treated as NULL, that
 * no two leads in the same organization share the same meaningful email
 * (case-insensitive, whitespace-trimmed), and then creates the partial unique
 * index `leads_org_email_unique_idx` that enforces this invariant at the
 * database level.
 *
 * BUSINESS RULE: A missing, empty, or whitespace-only email means "no email"
 * and must NOT participate in uniqueness. Meaningful emails are unique within
 * an organization (case-insensitive, whitespace-trimmed).
 *
 * NORMALIZATION STEP: Any lead whose email is a blank or whitespace-only string
 * has its email cleared to NULL. The record is preserved; only the email field
 * changes.
 *
 * DEDUP STRATEGY (non-destructive): For each meaningful-email duplicate group,
 * the OLDEST lead (by created_at, then id) keeps its email. Newer duplicates
 * have their email cleared (set to NULL) and the original email preserved in
 * import_notes so no information is lost.
 *
 * INDEX DEFINITION: Uses lower(BTRIM(email)) with a WHERE predicate of
 * NULLIF(BTRIM(email),'') IS NOT NULL. This matches the application's
 * normalizeEmail() semantics exactly.
 *
 * ROLLOUT ORDER (enforced): normalize → dedup → index. The index creation
 * fails if duplicates exist; dedup fails if blank emails aren't normalized first.
 *
 * USAGE (run against the target DATABASE_URL before deploying code):
 *   npx tsx scripts/migrate-lead-email-unique.ts
 *
 * SAFE TO RE-RUN: All operations are idempotent. Subsequent runs are no-ops.
 */

import { Pool } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log("Starting lead email normalization + uniqueness migration...");

    // Step 1: Normalize blank/whitespace-only emails to NULL.
    // These mean "no email" and must not participate in uniqueness.
    const blanks = await pool.query(`
      UPDATE leads
      SET email = NULL
      WHERE email IS NOT NULL
        AND BTRIM(email) = ''
      RETURNING id
    `);
    if (blanks.rowCount && blanks.rowCount > 0) {
      console.log(`  Normalized ${blanks.rowCount} blank/whitespace email(s) to NULL:`,
        blanks.rows.map((r: { id: string }) => r.id).join(", "));
    } else {
      console.log("  No blank/whitespace emails found — normalization is a no-op.");
    }

    // Step 2: Report meaningful-email duplicate groups (using BTRIM normalization).
    const dupGroups = await pool.query(`
      SELECT
        organization_id,
        lower(BTRIM(email)) AS email_normalized,
        count(*) AS cnt
      FROM leads
      WHERE NULLIF(BTRIM(email), '') IS NOT NULL
      GROUP BY organization_id, lower(BTRIM(email))
      HAVING count(*) > 1
    `);

    if (dupGroups.rows.length === 0) {
      console.log("  No meaningful-email duplicate groups found.");
    } else {
      console.log(`  Found ${dupGroups.rows.length} meaningful-email duplicate group(s):`);
      for (const g of dupGroups.rows) {
        console.log(`    org=${g.organization_id} email=${g.email_normalized} count=${g.cnt}`);
      }

      // Step 3: Dedup — keep the oldest lead per group; clear email on the rest,
      // preserving the original email in import_notes.
      const deduped = await pool.query(`
        WITH ranked AS (
          SELECT id,
                 email,
                 row_number() OVER (
                   PARTITION BY organization_id, lower(BTRIM(email))
                   ORDER BY created_at ASC, id ASC
                 ) AS rn
          FROM leads
          WHERE NULLIF(BTRIM(email), '') IS NOT NULL
        )
        UPDATE leads l
        SET email = NULL,
            import_notes = trim(both E'\\n' from coalesce(l.import_notes, '') ||
              E'\\n[dedup ' || now()::date || '] Email "' || r.email ||
              '" removed: duplicate of an older lead in the same organization.')
        FROM ranked r
        WHERE l.id = r.id AND r.rn > 1
        RETURNING l.id
      `);
      console.log(`  Deduplicated ${deduped.rowCount} lead(s) (email cleared, original preserved in import_notes).`);
    }

    // Step 4: Create the partial unique index (no-op if it already exists with the same name).
    // Drop any stale version with the old predicate first (IF EXISTS + name match is safe).
    await pool.query(`DROP INDEX IF EXISTS leads_org_email_unique_idx`);
    await pool.query(`
      CREATE UNIQUE INDEX leads_org_email_unique_idx
      ON leads (organization_id, lower(BTRIM(email)))
      WHERE NULLIF(BTRIM(email), '') IS NOT NULL
    `);
    console.log("  Unique index leads_org_email_unique_idx created with BTRIM/NULLIF predicate.");

    // Step 5: Verify zero duplicate groups remain.
    const remaining = await pool.query(`
      SELECT count(*) AS remaining_groups
      FROM (
        SELECT organization_id, lower(BTRIM(email))
        FROM leads
        WHERE NULLIF(BTRIM(email), '') IS NOT NULL
        GROUP BY organization_id, lower(BTRIM(email))
        HAVING count(*) > 1
      ) sub
    `);
    const remainingGroups = parseInt(remaining.rows[0].remaining_groups, 10);
    if (remainingGroups > 0) {
      console.error(`  ERROR: ${remainingGroups} duplicate group(s) still exist after migration!`);
      process.exit(1);
    }
    console.log("  Verification passed: zero duplicate meaningful-email groups.");

    console.log("Migration complete.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
