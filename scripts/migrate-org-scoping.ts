/**
 * Standalone pre-migration script: Org-scoping backfill
 *
 * PURPOSE: Ensures every CRM record has an organizationId before the NOT NULL
 * constraint is applied via `npm run db:push`. Run this script ONCE on any
 * existing pre-multi-tenant database, then run `npm run db:push` to apply
 * the schema constraint.
 *
 * USAGE:
 *   npx tsx scripts/migrate-org-scoping.ts
 *
 * SAFE TO RE-RUN: All updates are idempotent (only rows with null organizationId
 * are affected; subsequent runs are no-ops).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { isNull, eq } from "drizzle-orm";
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
    const result = await db.update(table).set({ organizationId: orgId }).where(isNull(col));
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

  console.log("\nMigration complete.");
  console.log("You can now safely run: npm run db:push");
  console.log("to apply the NOT NULL constraint on organizationId columns.");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
