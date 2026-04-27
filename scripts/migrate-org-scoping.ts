/**
 * Standalone pre-migration script: Org-scoping backfill + constraint application
 *
 * PURPOSE: Ensures every CRM record has an organizationId, then directly applies
 * NOT NULL + FK constraints that drizzle-kit push does not generate for existing
 * nullable columns.
 *
 * USAGE:
 *   npx tsx scripts/migrate-org-scoping.ts
 *
 * SAFE TO RE-RUN: All operations are idempotent. Subsequent runs are no-ops.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { isNull } from "drizzle-orm";
import * as schema from "../shared/schema";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log("Starting org-scoping migration...");

  // Step 1: Ensure a default organization exists
  const existingOrgs = await db.select().from(schema.organizations).limit(1);
  let orgId: string;

  if (existingOrgs.length === 0) {
    console.log("No organizations found — creating default org...");
    const orgIdValue = "ORG-001";
    await db.insert(schema.organizations).values({
      id: orgIdValue,
      name: "Health Trixss",
      slug: "health-trixss",
    });
    orgId = orgIdValue;
    console.log(`Created default organization: ${orgId}`);
  } else {
    orgId = existingOrgs[0].id;
    console.log(`Using existing primary organization: ${orgId}`);
  }

  // Step 2: Backfill core CRM tables (these will have NOT NULL constraint)
  const crmTables: { name: string; table: any; col: any }[] = [
    { name: "accounts",      table: schema.accounts,      col: schema.accounts.organizationId },
    { name: "contacts",      table: schema.contacts,      col: schema.contacts.organizationId },
    { name: "leads",         table: schema.leads,         col: schema.leads.organizationId },
    { name: "opportunities", table: schema.opportunities, col: schema.opportunities.organizationId },
    { name: "activities",    table: schema.activities,    col: schema.activities.organizationId },
  ];

  for (const { name, table, col } of crmTables) {
    await db.update(table).set({ organizationId: orgId }).where(isNull(col));
    console.log(`  Backfilled ${name}`);
  }

  // Step 3: Backfill lead-gen and admin tables (nullable orgId, but should be stamped)
  const extraTables: { name: string; table: any; col: any }[] = [
    { name: "icpProfiles",        table: schema.icpProfiles,        col: schema.icpProfiles.organizationId },
    { name: "taskPlaybooks",      table: schema.taskPlaybooks,      col: schema.taskPlaybooks.organizationId },
    { name: "leadGenerationRuns", table: schema.leadGenerationRuns, col: schema.leadGenerationRuns.organizationId },
  ];

  for (const { name, table, col } of extraTables) {
    await db.update(table).set({ organizationId: orgId }).where(isNull(col));
    console.log(`  Backfilled ${name}`);
  }

  // llmConfigurations and apiKeys may not exist (optional tables)
  try {
    await db.update(schema.llmConfigurations).set({ organizationId: orgId }).where(isNull(schema.llmConfigurations.organizationId));
    console.log("  Backfilled llmConfigurations");
  } catch { /* table may not exist in all environments */ }

  try {
    await db.update(schema.apiKeys).set({ organizationId: orgId }).where(isNull(schema.apiKeys.organizationId));
    console.log("  Backfilled apiKeys");
  } catch { /* table may not exist in all environments */ }

  // Step 4: Apply NOT NULL + FK constraints directly (drizzle-kit push does not
  // generate ALTER TABLE statements for nullability changes on existing columns).
  // Each statement is wrapped in a DO block so it is idempotent on re-runs.
  console.log("\nApplying NOT NULL + FK constraints...");

  // Tables that require NOT NULL on organization_id per the Drizzle schema
  const notNullTables = [
    "accounts",
    "contacts",
    "leads",
    "opportunities",
    "activities",
    "icp_profiles",
    "task_playbooks",
    "lead_generation_runs",
  ];

  for (const tbl of notNullTables) {
    // Apply NOT NULL idempotently
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name   = '${tbl}'
            AND column_name  = 'organization_id'
            AND is_nullable  = 'YES'
        ) THEN
          ALTER TABLE ${tbl} ALTER COLUMN organization_id SET NOT NULL;
          RAISE NOTICE 'Applied NOT NULL to ${tbl}.organization_id';
        ELSE
          RAISE NOTICE 'NOT NULL already set on ${tbl}.organization_id (no-op)';
        END IF;
      END $$;
    `);

    // Add FK constraint idempotently using a deterministic constraint name
    const fkName = `${tbl}_organization_id_fk`;
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name        = '${tbl}'
            AND constraint_name   = '${fkName}'
            AND constraint_type   = 'FOREIGN KEY'
        ) THEN
          ALTER TABLE ${tbl}
            ADD CONSTRAINT ${fkName}
            FOREIGN KEY (organization_id)
            REFERENCES organizations(id)
            ON DELETE CASCADE;
          RAISE NOTICE 'Added FK constraint ${fkName}';
        ELSE
          RAISE NOTICE 'FK constraint ${fkName} already exists (no-op)';
        END IF;
      END $$;
    `);

    console.log(`  Constraints applied: ${tbl}`);
  }

  console.log("\nMigration complete.");
  console.log("All NOT NULL + FK constraints are now enforced.");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
