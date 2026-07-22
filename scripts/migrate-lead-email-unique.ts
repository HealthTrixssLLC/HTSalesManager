/**
 * Standalone migration script: Lead email deduplication + unique index creation
 *
 * PURPOSE: Guarantees that no two leads in the same organization share the same
 * email (case-insensitive), then creates the partial unique index
 * `leads_org_email_unique_idx` on (organization_id, lower(email)) WHERE email
 * IS NOT NULL. This makes duplicate lead creation impossible at the database
 * level, even for two requests arriving at the same instant.
 *
 * DEDUP STRATEGY (non-destructive): For each duplicate group, the OLDEST lead
 * (by created_at, then id) keeps its email. Newer duplicates have their email
 * cleared (set to NULL) and the original email preserved in import_notes so no
 * information is lost and the records remain reviewable.
 *
 * ROLLOUT ORDER (enforced by this script): dedup first, index second. The
 * index creation would fail if duplicates still existed.
 *
 * USAGE:
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
    console.log("Starting lead email uniqueness migration...");

    // Step 1: Report duplicate groups
    const dupGroups = await pool.query(`
      SELECT organization_id, lower(email) AS email_lower, count(*) AS cnt
      FROM leads
      WHERE email IS NOT NULL
      GROUP BY organization_id, lower(email)
      HAVING count(*) > 1
    `);

    if (dupGroups.rows.length === 0) {
      console.log("  No duplicate (organization, email) lead groups found.");
    } else {
      console.log(`  Found ${dupGroups.rows.length} duplicate group(s):`);
      for (const g of dupGroups.rows) {
        console.log(`    org=${g.organization_id} email=${g.email_lower} count=${g.cnt}`);
      }

      // Step 2: Dedup — keep the oldest lead per group; clear email on the rest,
      // preserving the original email in import_notes.
      const result = await pool.query(`
        WITH ranked AS (
          SELECT id,
                 email,
                 row_number() OVER (
                   PARTITION BY organization_id, lower(email)
                   ORDER BY created_at ASC, id ASC
                 ) AS rn
          FROM leads
          WHERE email IS NOT NULL
        )
        UPDATE leads l
        SET email = NULL,
            import_notes = trim(both E'\n' from coalesce(l.import_notes, '') ||
              E'\n[dedup ' || now()::date || '] Email "' || r.email ||
              '" removed: duplicate of an older lead in the same organization.')
        FROM ranked r
        WHERE l.id = r.id AND r.rn > 1
        RETURNING l.id
      `);
      console.log(`  Deduplicated ${result.rowCount} lead(s) (email cleared, original preserved in import_notes).`);
    }

    // Step 3: Create the partial unique index (no-op if it already exists)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS leads_org_email_unique_idx
      ON leads (organization_id, lower(email))
      WHERE email IS NOT NULL
    `);
    console.log("  Unique index leads_org_email_unique_idx is in place.");

    console.log("Migration complete.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
