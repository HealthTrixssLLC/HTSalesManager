// READ-ONLY audit script for Task 204 — ACT-*/ACCT-* canonical ID collision.
// Connects to the production database (NEON_DATABASE_URL) and runs only SELECTs.
import { Pool } from "pg";

const url = process.env.NEON_DATABASE_URL;
if (!url) throw new Error("NEON_DATABASE_URL not set");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3 });

async function q(name: string, sql: string) {
  try {
    const r = await pool.query(sql);
    console.log(`### ${name}`);
    console.log(JSON.stringify(r.rows, null, 1));
  } catch (e: any) {
    console.log(`### ${name} ERROR: ${e.message}`);
  }
}

(async () => {
  // 1. Account ID distribution
  await q("account_prefix_counts", `
    SELECT COALESCE(substring(id from '^[A-Za-z]+'), '(none)') AS prefix, COUNT(*)::int AS n
    FROM accounts GROUP BY 1 ORDER BY n DESC`);
  await q("account_samples_ACT", `SELECT id, name, created_at FROM accounts WHERE id LIKE 'ACT-%' ORDER BY id LIMIT 5`);
  await q("account_samples_ACCT", `SELECT id, name, created_at FROM accounts WHERE id LIKE 'ACCT-%' ORDER BY id LIMIT 5`);
  await q("account_samples_other", `SELECT id, name, created_at FROM accounts WHERE id NOT LIKE 'ACT-%' AND id NOT LIKE 'ACCT-%' ORDER BY id LIMIT 5`);
  await q("account_total", `SELECT COUNT(*)::int AS total FROM accounts`);

  // 2. Activity ID distribution
  await q("activity_prefix_counts", `
    SELECT COALESCE(substring(id from '^[A-Za-z]+'), '(none)') AS prefix, COUNT(*)::int AS n
    FROM activities GROUP BY 1 ORDER BY n DESC`);
  await q("activity_samples", `SELECT id, subject, created_at FROM activities ORDER BY id LIMIT 5`);
  await q("activity_total", `SELECT COUNT(*)::int AS total FROM activities`);

  // 3. Cross-table collisions
  await q("collision_count", `SELECT COUNT(*)::int AS n FROM accounts a JOIN activities act ON a.id = act.id`);
  await q("collision_list", `SELECT a.id FROM accounts a JOIN activities act ON a.id = act.id ORDER BY a.id LIMIT 100`);

  // 4. FK reference counts (rows referencing ACT-* vs ACCT-* Account IDs)
  const fkChecks: Array<[string, string]> = [
    ["contacts.account_id", `SELECT COUNT(*) FILTER (WHERE account_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE account_id LIKE 'ACCT-%')::int AS acct FROM contacts`],
    ["opportunities.account_id", `SELECT COUNT(*) FILTER (WHERE account_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE account_id LIKE 'ACCT-%')::int AS acct FROM opportunities`],
    ["leads.converted_account_id", `SELECT COUNT(*) FILTER (WHERE converted_account_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE converted_account_id LIKE 'ACCT-%')::int AS acct FROM leads`],
    ["activity_associations(Account)", `SELECT COUNT(*) FILTER (WHERE entity_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE entity_id LIKE 'ACCT-%')::int AS acct FROM activity_associations WHERE entity_type = 'Account'`],
    ["document_links(account)", `SELECT COUNT(*) FILTER (WHERE entity_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE entity_id LIKE 'ACCT-%')::int AS acct FROM document_links WHERE entity_type IN ('Account','account')`],
    ["crm_documents(Account)", `SELECT COUNT(*) FILTER (WHERE entity_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE entity_id LIKE 'ACCT-%')::int AS acct FROM crm_documents WHERE entity_type IN ('Account','account')`],
    ["research_documents(account)", `SELECT COUNT(*) FILTER (WHERE entity_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE entity_id LIKE 'ACCT-%')::int AS acct FROM research_documents WHERE entity_type::text IN ('account','Account')`],
    ["audit_logs(Account resource)", `SELECT COUNT(*) FILTER (WHERE resource_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE resource_id LIKE 'ACCT-%')::int AS acct FROM audit_logs WHERE resource = 'Account'`],
    ["entity_tags(Account)", `SELECT COUNT(*) FILTER (WHERE entity_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE entity_id LIKE 'ACCT-%')::int AS acct FROM entity_tags WHERE entity = 'Account'`],
    ["comments(Account)", `SELECT COUNT(*) FILTER (WHERE entity_id LIKE 'ACT-%')::int AS act, COUNT(*) FILTER (WHERE entity_id LIKE 'ACCT-%')::int AS acct FROM comments WHERE entity = 'Account'`],
  ];
  for (const [name, sql] of fkChecks) await q(`fk ${name}`, sql);

  // 5. Non-FK / text references
  await q("activities.related_id(Account)", `
    SELECT COUNT(*) FILTER (WHERE related_id LIKE 'ACT-%')::int AS act,
           COUNT(*) FILTER (WHERE related_id LIKE 'ACCT-%')::int AS acct
    FROM activities WHERE related_type = 'Account'`);
  await q("audit_logs jsonb before/after containing ACT- account ids", `
    SELECT COUNT(*)::int AS n FROM audit_logs
    WHERE resource = 'Account' AND (before::text LIKE '%ACT-%' OR after::text LIKE '%ACT-%')`);
  await q("accounts.external_id ACT refs", `
    SELECT COUNT(*)::int AS n FROM accounts WHERE external_id LIKE 'ACT-%'`);

  // 6. id_patterns
  await q("id_patterns_global", `SELECT entity, pattern, counter, start_value, last_issued, organization_id FROM id_patterns WHERE organization_id IS NULL ORDER BY entity`);
  await q("id_patterns_org", `SELECT entity, pattern, counter, organization_id FROM id_patterns WHERE organization_id IS NOT NULL ORDER BY entity`);

  // 7. does ACT-2098 / ACT-2103 exist as accounts?
  await q("specific_accounts", `SELECT id, name, organization_id, created_at FROM accounts WHERE id IN ('ACT-2098','ACT-2103') ORDER BY id`);

  await pool.end();
})();
