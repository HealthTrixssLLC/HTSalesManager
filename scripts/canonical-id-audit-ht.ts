// READ-ONLY audit script for Task 207 — Health Trixss org-scoped canonical ID audit.
// Runs ONLY SELECT queries. No INSERT/UPDATE/DELETE/DDL anywhere.
//
// Context: the "Health Trixss" MCP API key is expected to be org-scoped. This
// script audits BOTH databases:
//   - NEON_DATABASE_URL (the prod DB audited in Task 204) — which turns out to
//     have NO organizations / organization_id columns at all, and
//   - DATABASE_URL (dev DB) — which has org scoping and the API keys table with
//     organization_id, where the MCP key actually lives.
import { Pool } from "pg";

function mkPool(url: string | undefined, label: string): Pool {
  if (!url) throw new Error(`${label} not set`);
  return new Pool({ connectionString: url, ssl: url.includes("neon") ? { rejectUnauthorized: false } : undefined, max: 3 });
}

async function q(pool: Pool, name: string, sql: string, params: any[] = []) {
  try {
    const r = await pool.query(sql, params);
    console.log(`### ${name}`);
    console.log(JSON.stringify(r.rows, null, 1));
    return r.rows;
  } catch (e: any) {
    console.log(`### ${name} ERROR: ${e.message}`);
    return [];
  }
}

(async () => {
  // ---------- Part A: NEON prod DB (scope check) ----------
  const neon = mkPool(process.env.NEON_DATABASE_URL, "NEON_DATABASE_URL");
  console.log("\n===== NEON_DATABASE_URL (prod) =====");
  await q(neon, "neon_org_tables", `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('organizations','api_keys') ORDER BY 1`);
  await q(neon, "neon_api_keys_has_org_col", `SELECT column_name FROM information_schema.columns WHERE table_name='api_keys' AND column_name='organization_id'`);
  await q(neon, "neon_accounts_has_org_col", `SELECT column_name FROM information_schema.columns WHERE table_name='accounts' AND column_name='organization_id'`);
  await q(neon, "neon_api_keys", `SELECT id, name, description, is_active, revoked_at, last_used_at, created_at FROM api_keys ORDER BY created_at`);
  await q(neon, "neon_account_total", `SELECT COUNT(*)::int AS total FROM accounts`);
  await q(neon, "neon_account_prefixes", `SELECT COALESCE(substring(id from '^[A-Za-z]+'),'(none)') AS prefix, COUNT(*)::int AS n FROM accounts GROUP BY 1 ORDER BY n DESC`);
  await q(neon, "neon_specific_accounts", `SELECT id, name FROM accounts WHERE id IN ('ACT-2103','ACT-2102','ACT-2100','ACT-2099','ACT-2098','ACT-2091') ORDER BY id`);
  await q(neon, "neon_activity_prefixes", `SELECT COALESCE(substring(id from '^[A-Za-z]+'),'(none)') AS prefix, COUNT(*)::int AS n FROM activities GROUP BY 1 ORDER BY n DESC`);
  await q(neon, "neon_id_patterns", `SELECT entity, pattern, counter, start_value, last_issued FROM id_patterns ORDER BY entity`);
  await neon.end();

  // ---------- Part B: DATABASE_URL (dev DB with org scoping) ----------
  const dev = mkPool(process.env.DATABASE_URL, "DATABASE_URL");
  console.log("\n===== DATABASE_URL (dev, org-scoped) =====");

  // Step 1: identify the org the MCP key is bound to
  await q(dev, "orgs", `SELECT id, name, slug, created_at FROM organizations ORDER BY created_at`);
  await q(dev, "org_name_search", `SELECT id, name FROM organizations WHERE name ILIKE '%trixss%' OR name ILIKE '%health%'`);
  const keys = await q(dev, "api_keys", `SELECT id, name, description, organization_id, is_active, revoked_at, permissions, last_used_at, created_at FROM api_keys ORDER BY created_at`);
  const mcpKey = keys.find((k: any) => k.is_active && !k.revoked_at && !String(k.name).startsWith("vitest"));
  const htOrg = mcpKey?.organization_id as string;
  console.log(`### mcp_key_selected\n${JSON.stringify({ name: mcpKey?.name, organization_id: htOrg })}`);

  // Step 2: HT account audit
  await q(dev, "ht_account_total", `SELECT COUNT(*)::int AS total FROM accounts WHERE organization_id = $1`, [htOrg]);
  await q(dev, "ht_account_prefixes", `SELECT COALESCE(substring(id from '^[A-Za-z]+'),'(none)') AS prefix, COUNT(*)::int AS n FROM accounts WHERE organization_id = $1 GROUP BY 1 ORDER BY n DESC`, [htOrg]);
  await q(dev, "ht_account_recent10", `SELECT id, name, created_at FROM accounts WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT 10`, [htOrg]);
  await q(dev, "ht_account_id_minmax", `SELECT min(id), max(id) FROM accounts WHERE organization_id = $1`, [htOrg]);
  await q(dev, "ht_specific_accounts", `SELECT id, name, organization_id, created_at FROM accounts WHERE id IN ('ACT-2103','ACT-2102','ACT-2100','ACT-2099','ACT-2098','ACT-2091') ORDER BY id`);
  await q(dev, "ht_name_search", `SELECT id, name FROM accounts WHERE organization_id = $1 AND (name ILIKE '%cavulus%' OR name ILIKE '%providence%' OR name ILIKE '%care oregon%' OR name ILIKE '%humanizing%' OR name ILIKE '%psychiatric%' OR name ILIKE '%care compass%')`, [htOrg]);
  await q(dev, "ht_deleted_account_audit", `SELECT DISTINCT resource_id FROM audit_logs WHERE resource='Account' AND action ILIKE '%delete%' AND resource_id LIKE 'ACT-2%' ORDER BY resource_id`);
  await q(dev, "ht_account_all_ids", `SELECT id FROM accounts WHERE organization_id = $1 ORDER BY id`, [htOrg]);

  // Step 4: HT activity audit
  await q(dev, "ht_activity_total", `SELECT COUNT(*)::int AS total FROM activities WHERE organization_id = $1`, [htOrg]);
  await q(dev, "ht_activity_prefixes", `SELECT COALESCE(substring(id from '^[A-Za-z]+'),'(none)') AS prefix, COUNT(*)::int AS n FROM activities WHERE organization_id = $1 GROUP BY 1 ORDER BY n DESC`, [htOrg]);
  await q(dev, "ht_activity_samples", `SELECT id, subject, created_at FROM activities WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 5`, [htOrg]);

  // Step 5: ID patterns (global + org-specific)
  await q(dev, "id_patterns_global", `SELECT entity, pattern, counter, start_value, last_issued FROM id_patterns WHERE organization_id IS NULL ORDER BY entity`);
  await q(dev, "id_patterns_ht_org", `SELECT entity, pattern, counter, last_issued FROM id_patterns WHERE organization_id = $1 ORDER BY entity`, [htOrg]);

  // Step 6: dependent references for HT accounts
  const refChecks: Array<[string, string]> = [
    ["opportunities.account_id", `SELECT COUNT(*)::int AS n FROM opportunities o JOIN accounts a ON o.account_id = a.id WHERE a.organization_id = $1`],
    ["contacts.account_id", `SELECT COUNT(*)::int AS n FROM contacts c JOIN accounts a ON c.account_id = a.id WHERE a.organization_id = $1`],
    ["leads.converted_account_id", `SELECT COUNT(*)::int AS n FROM leads l JOIN accounts a ON l.converted_account_id = a.id WHERE a.organization_id = $1`],
    ["activity_associations(Account)", `SELECT COUNT(*)::int AS n FROM activity_associations aa JOIN accounts a ON aa.entity_id = a.id WHERE aa.entity_type = 'Account' AND a.organization_id = $1`],
    ["document_links(Account)", `SELECT COUNT(*)::int AS n FROM document_links dl JOIN accounts a ON dl.entity_id = a.id WHERE dl.entity_type IN ('Account','account') AND a.organization_id = $1`],
    ["entity_tags(Account)", `SELECT COUNT(*)::int AS n FROM entity_tags et JOIN accounts a ON et.entity_id = a.id WHERE a.organization_id = $1`],
    ["comments(Account)", `SELECT COUNT(*)::int AS n FROM comments c JOIN accounts a ON c.entity_id = a.id WHERE a.organization_id = $1`],
    ["audit_logs(resource=Account)", `SELECT COUNT(*)::int AS n FROM audit_logs al JOIN accounts a ON al.resource_id = a.id WHERE al.resource = 'Account' AND a.organization_id = $1`],
    ["activities.related_id(Account)", `SELECT COUNT(*)::int AS n FROM activities act JOIN accounts a ON act.related_id = a.id WHERE act.related_type = 'Account' AND a.organization_id = $1`],
  ];
  for (const [name, sql] of refChecks) await q(dev, `ref ${name}`, sql, [htOrg]);

  // Step 7: other-org aggregate summary (no individual record names/IDs)
  await q(dev, "other_org_summary", `
    SELECT o.name AS org_name,
           COUNT(a.id)::int AS account_count,
           array_agg(DISTINCT substring(a.id from '^[A-Za-z]+')) FILTER (WHERE a.id IS NOT NULL) AS account_prefixes
    FROM organizations o LEFT JOIN accounts a ON a.organization_id = o.id
    WHERE o.id <> $1 GROUP BY o.name ORDER BY account_count DESC`, [htOrg]);
  await q(dev, "other_org_activity_summary", `
    SELECT o.name AS org_name,
           COUNT(act.id)::int AS activity_count,
           array_agg(DISTINCT substring(act.id from '^[A-Za-z]+')) FILTER (WHERE act.id IS NOT NULL) AS activity_prefixes
    FROM organizations o LEFT JOIN activities act ON act.organization_id = o.id
    WHERE o.id <> $1 GROUP BY o.name ORDER BY activity_count DESC`, [htOrg]);

  await dev.end();
})();
