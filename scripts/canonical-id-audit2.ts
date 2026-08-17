// READ-ONLY follow-up queries for Task 204 (prod schema lacks organization_id etc.)
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL!, ssl: { rejectUnauthorized: false }, max: 3 });
async function q(name: string, sql: string) {
  try { console.log(`### ${name}\n` + JSON.stringify((await pool.query(sql)).rows, null, 1)); }
  catch (e: any) { console.log(`### ${name} ERROR: ${e.message}`); }
}
(async () => {
  await q("tables", `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
  await q("id_patterns_columns", `SELECT column_name FROM information_schema.columns WHERE table_name='id_patterns' ORDER BY ordinal_position`);
  await q("id_patterns_all", `SELECT * FROM id_patterns ORDER BY entity`);
  await q("accounts_columns", `SELECT column_name FROM information_schema.columns WHERE table_name='accounts' ORDER BY ordinal_position`);
  await q("specific_accounts", `SELECT id, name, created_at FROM accounts WHERE id IN ('ACT-2098','ACT-2103') ORDER BY id`);
  await q("account_id_minmax", `SELECT min(id) AS min, max(id) AS max FROM accounts`);
  await q("account_all_ids", `SELECT id, name FROM accounts ORDER BY id`);
  await pool.end();
})();
