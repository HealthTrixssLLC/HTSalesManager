/**
 * One-off repair script: Re-home CRM leads/activities created by candidate approval
 * to the organization of the lead-generation run that produced them.
 *
 * BACKGROUND: The candidate approval flow previously inserted CRM leads and
 * playbook activities without an organizationId, so those records landed with
 * a NULL org (or were backfilled into the default org on server restart) and
 * never appeared in the correct organization's lists.
 *
 * WHAT IT DOES:
 *   1. For every lg_crm_leads link, resolves the run's organization_id
 *      (via the link's run_id, falling back to the candidate's run_id) and
 *      updates the linked CRM lead if its organization differs or is NULL.
 *   2. Does the same for activities linked via lg_crm_tasks.
 *
 * USAGE:
 *   npx tsx scripts/repair-approved-lead-orgs.ts
 *
 * SAFE TO RE-RUN: Idempotent — updates only rows whose org differs from the
 * run's org; subsequent runs are no-ops.
 */

import { Pool } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log("Repairing organization assignment on approval-created leads/activities...");

  // 1. Re-home CRM leads created from candidate approvals
  const leadResult = await pool.query(`
    UPDATE leads l
    SET organization_id = r.organization_id,
        updated_at = NOW()
    FROM lg_crm_leads lcl
    JOIN candidate_leads cl ON cl.id = lcl.candidate_lead_id
    JOIN lead_generation_runs r ON r.id = COALESCE(lcl.run_id, cl.run_id)
    WHERE l.id = lcl.crm_lead_id
      AND r.organization_id IS NOT NULL
      AND (l.organization_id IS DISTINCT FROM r.organization_id)
  `);
  console.log(`  Leads re-homed: ${leadResult.rowCount}`);

  // 2. Re-home activities created from playbook steps during approval
  const activityResult = await pool.query(`
    UPDATE activities a
    SET organization_id = r.organization_id,
        updated_at = NOW()
    FROM lg_crm_tasks lct
    JOIN candidate_leads cl ON cl.id = lct.candidate_lead_id
    JOIN lead_generation_runs r ON r.id = COALESCE(lct.run_id, cl.run_id)
    WHERE a.id = lct.activity_id
      AND r.organization_id IS NOT NULL
      AND (a.organization_id IS DISTINCT FROM r.organization_id)
  `);
  console.log(`  Activities re-homed: ${activityResult.rowCount}`);

  console.log("Repair complete. Safe to re-run; subsequent runs will be no-ops.");
  await pool.end();
}

main().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});
