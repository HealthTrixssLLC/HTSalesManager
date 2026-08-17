import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL!, ssl: { rejectUnauthorized: false }, max: 3 });
async function q(n: string, s: string){ try{ console.log(`### ${n}\n`+JSON.stringify((await pool.query(s)).rows)); }catch(e:any){ console.log(`### ${n} ERROR: ${e.message}`);} }
(async()=>{
  await q("id_patterns_lead_opp", `SELECT entity, pattern, counter, start_value, last_issued FROM id_patterns WHERE entity IN ('Lead','Opportunity')`);
  await q("cavulus", `SELECT id, name FROM accounts WHERE name ILIKE '%cavulus%'`);
  await q("audit_ACT_sample", `SELECT resource_id, action, created_at FROM audit_logs WHERE resource='Account' AND resource_id LIKE 'ACT-%' ORDER BY created_at DESC LIMIT 3`);
  await q("audit_ACCT_sample", `SELECT resource_id, action, created_at FROM audit_logs WHERE resource='Account' AND resource_id LIKE 'ACCT-%' ORDER BY created_at DESC LIMIT 5`);
  await q("audit_deleted_high_ACT", `SELECT DISTINCT resource_id FROM audit_logs WHERE resource='Account' AND resource_id LIKE 'ACT-2%' ORDER BY resource_id LIMIT 30`);
  await q("doc_links_types", `SELECT entity_type, COUNT(*)::int FROM document_links GROUP BY 1`);
  await q("opps_sample", `SELECT id, account_id FROM opportunities ORDER BY id LIMIT 3`);
  await pool.end();
})();
