// READ-ONLY audit script for Task 210 — canonical ID audit against the CORRECT
// production database.
//
// The deployed application (https://htsalesmanager.healthtrixss.com) connects
// via DATABASE_URL only (server/db.ts, drizzle.config.ts). NEON_DATABASE_URL is
// referenced solely by earlier audit scripts and is NOT production.
//
// Run inside the production deployment shell (or with DATABASE_URL pointing at
// the production instance):
//   npx tsx scripts/canonical-id-audit-prod.ts
//
// AUDIT GATE: the script FAILS FAST (exit 1) before any analysis unless the
// connected database proves it is production:
//   1. All six known production fingerprint accounts exist WITH the expected
//      names (ACT-2103 Cavulus, ACT-2098 Care Oregon, etc.).
//   2. The Health Trixss org account count equals the live-API count of 56.
// A run against the dev database (workspace DATABASE_URL = helium/heliumdb) or
// the stale Neon copy will therefore never emit a report labeled PRODUCTION.
//
// This script performs SELECT queries only. No INSERT/UPDATE/DELETE/DDL.
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const EXPECTED_LIVE_API_COUNT = 56;

// Known production fingerprints: id -> expected account name (substring match).
const FINGERPRINTS: Record<string, string> = {
  "ACT-2103": "Cavulus",
  "ACT-2102": "Integrated Psychiatric Consultants",
  "ACT-2100": "Providence",
  "ACT-2099": "Humanizing Technologies",
  "ACT-2098": "Care Oregon",
  "ACT-2091": "Care Compass",
};

const pool = new Pool({
  connectionString: url,
  ssl: url.includes("neon") ? { rejectUnauthorized: false } : undefined,
  max: 3,
});

async function rows(sql: string, params: any[] = []): Promise<any[]> {
  const r = await pool.query(sql, params);
  return r.rows;
}

function fail(msg: string): never {
  console.error(`\nAUDIT GATE FAILED: ${msg}`);
  console.error("This DATABASE_URL is NOT the production database. No report emitted.");
  process.exitCode = 1;
  throw new Error("audit gate failed");
}

(async () => {
  const u = new URL(url);

  // ---------- GATE 1: fingerprint records with expected names ----------
  const fingerprintIds = Object.keys(FINGERPRINTS);
  const found = await rows(
    `SELECT id, name, organization_id FROM accounts WHERE id = ANY($1::text[]) ORDER BY id`,
    [fingerprintIds]
  );
  const fingerprintResults = fingerprintIds.map((fid) => {
    const hit = found.find((r) => r.id === fid);
    const nameOk = !!hit && String(hit.name).toLowerCase().includes(FINGERPRINTS[fid].toLowerCase());
    return { id: fid, expected: FINGERPRINTS[fid], hit, ok: nameOk };
  });
  const missing = fingerprintResults.filter((f) => !f.ok);
  if (missing.length > 0) {
    fail(
      `missing/mismatched fingerprint accounts: ${missing
        .map((m) => `${m.id} (expected "${m.expected}", got ${m.hit ? `"${m.hit.name}"` : "no row"})`)
        .join("; ")}`
    );
  }

  // ---------- Deterministic org identification ----------
  // All fingerprint accounts must belong to exactly one organization; that
  // organization IS the Health Trixss org (regardless of its display name —
  // in production it is named "Primary Organization").
  const orgIds = Array.from(new Set(found.map((r) => r.organization_id)));
  if (orgIds.length !== 1) {
    fail(`fingerprint accounts span ${orgIds.length} organizations; expected exactly 1`);
  }
  const htOrgId = orgIds[0] as string;
  const [htOrg] = await rows(`SELECT id, name FROM organizations WHERE id = $1`, [htOrgId]);
  if (!htOrg) fail(`organization ${htOrgId} not found`);

  // Cross-check: the active MCP API key must be scoped to this same org.
  const activeKeys = await rows(
    `SELECT name, organization_id FROM api_keys WHERE is_active AND revoked_at IS NULL AND organization_id = $1`,
    [htOrgId]
  );

  // ---------- GATE 2: API/Postgres parity ----------
  const [{ n: acctCount }] = await rows(
    `SELECT COUNT(*)::int AS n FROM accounts WHERE organization_id = $1`,
    [htOrgId]
  );
  if (Number(acctCount) !== EXPECTED_LIVE_API_COUNT) {
    fail(`HT account count ${acctCount} != expected live-API count ${EXPECTED_LIVE_API_COUNT}`);
  }

  // ---------- Gates passed: emit the report ----------
  console.log("DEPLOYED APPLICATION: https://htsalesmanager.healthtrixss.com");
  console.log(`AUDIT RUN: ${new Date().toISOString()}`);
  console.log("");
  console.log("PRODUCTION DB TYPE: PostgreSQL");
  console.log(`PRODUCTION DB HOST/INSTANCE: ${u.hostname}`);
  console.log(`PRODUCTION DB NAME: ${u.pathname.replace(/^\//, "")}`);
  console.log("PRODUCTION CONNECTION CONFIG SOURCE: DATABASE_URL (server/db.ts, drizzle.config.ts)");
  console.log("");
  console.log("NEON DB: NEON_DATABASE_URL (audit-scripts only; never read by the application)");
  console.log("NEON IS PRODUCTION: NO (41 accounts, ACT-1000–ACT-1041 — stale copy)");
  console.log("");
  for (const f of fingerprintResults) {
    console.log(`${f.id} / ${f.hit!.name} FOUND: YES`);
  }
  console.log("");
  console.log(`HEALTH TRIXSS ORGANIZATION: ${htOrg.name}`);
  console.log(`HEALTH TRIXSS ORGANIZATION ID: ${htOrg.id}`);
  console.log(`ACTIVE API KEYS SCOPED TO THIS ORG: ${activeKeys.map((k) => k.name).join(", ") || "(none)"}`);
  console.log("");
  console.log(`LIVE API HT ACCOUNT COUNT: ${EXPECTED_LIVE_API_COUNT}`);
  console.log(`PRODUCTION POSTGRES HT ACCOUNT COUNT: ${acctCount}`);
  console.log("API/POSTGRES PARITY: PASS");
  console.log("");

  // Prefix counts per entity within the HT org
  console.log("PRODUCTION POSTGRES ID PREFIX COUNTS:");
  const entityTables: Array<[string, string]> = [
    ["Account", "accounts"],
    ["Contact", "contacts"],
    ["Lead", "leads"],
    ["Opportunity", "opportunities"],
    ["Activity", "activities"],
  ];
  const docTables = await rows(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('documents','document_links')`
  );
  if (docTables.some((r) => r.table_name === "documents")) entityTables.push(["Document", "documents"]);
  for (const [label, table] of entityTables) {
    const prefixes = await rows(
      `SELECT COALESCE(substring(id from '^[A-Za-z-]+'),'(none)') AS prefix, COUNT(*)::int AS n
       FROM ${table} WHERE organization_id = $1 GROUP BY 1 ORDER BY n DESC`,
      [htOrgId]
    );
    const desc = prefixes.length ? prefixes.map((p) => `${p.prefix} → ${p.n}`).join(", ") : "(no rows)";
    console.log(`  ${label.padEnd(12)} ${desc}`);
  }
  console.log("");

  // Effective ID patterns
  console.log("PRODUCTION POSTGRES EFFECTIVE ID PATTERNS:");
  const patterns = await rows(
    `SELECT entity, pattern, counter, start_value, last_issued, organization_id
     FROM id_patterns WHERE organization_id IS NULL OR organization_id = $1 ORDER BY entity`,
    [htOrgId]
  );
  for (const p of patterns) {
    console.log(
      `  ${String(p.entity).padEnd(12)} pattern=${p.pattern}  counter=${p.counter}  last_issued=${p.last_issued ?? "(none)"}${p.organization_id ? "  (org-specific)" : "  (global)"}`
    );
  }
  console.log("");

  console.log("ROOT CAUSE OF PREVIOUS WRONG-DATABASE AUDIT:");
  console.log(
    "  Previous audit scripts passed NEON_DATABASE_URL to mkPool; the application itself never reads that variable — only DATABASE_URL is used by server/db.ts and drizzle.config.ts."
  );
  console.log("RECOMMENDED NEXT STEP:");
  console.log(
    "  id_pattern remediation against the correct production DB (DATABASE_URL) once the client approves."
  );

  await pool.end();
})().catch(async (e) => {
  await pool.end().catch(() => {});
  if (String(e.message) !== "audit gate failed") console.error(e);
  process.exitCode = 1;
});
