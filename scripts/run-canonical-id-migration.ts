// Production canonical ID migration execution script — Task 216.
//
// Executes the single atomic transaction from CANONICAL_ID_MIGRATION_PLAN.md §4.2:
// renames 657 legacy-prefixed records (ACT-* accounts → ACCT-*, CON-* contacts → CONT-*,
// Opp-* opportunities → OPP-*, ACV-* activities → ACT-*), updates all live FK and soft
// references, sets id_patterns to their §5 target state, and runs every §8 validation
// query (V1–V9) BEFORE commit. Any failure → explicit ROLLBACK, exit non-zero.
//
// Usage:
//   npx tsx scripts/run-canonical-id-migration.ts --dry-run   # full run, then ROLLBACK (no state change)
//   npx tsx scripts/run-canonical-id-migration.ts --live      # full run, then COMMIT
//   (no flag → prints usage, exit 1)
//
// PRECONDITIONS (plan §4.1 — operator responsibility):
//   1. Verified restorable production backup / PITR mark taken.
//   2. Maintenance window: application writes stopped.
//   3. DATABASE_URL points at the real production database — the fingerprint gate
//      below (same as scripts/canonical-id-audit-prod.ts) fails fast otherwise.
//   4. Constraint names in DEFERRABLE_CONSTRAINTS must be verified with \d against
//      production before a --live run (drizzle names them
//      <table>_<column>_<reftable>_<refcolumn>_fk).
//
// SCOPE (plan §1.5): HT_ONLY = true (default) migrates HT-org rows only — 56 accounts,
// 69 contacts, 2 opportunities, 530 activities. Set HT_ONLY = false to also include the
// 3 Lucentria accounts (ACT-2093/2094/2095) and the 1 non-HT activity (ACV-2607-00076);
// under global scope the Account id_patterns counter becomes 59 and Activity 531
// (handled automatically below). The script does NOT decide scope — the operator must
// confirm the chosen scope before running --live.

import { Pool, PoolClient } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

// ---------------------------------------------------------------------------
// Scope switch (§1.5). Default: HT-org-only (matches the plan's primary counts).
// ---------------------------------------------------------------------------
const HT_ONLY = true;
const HT_ORG_ID = "3e369484-0c88-401d-86e3-9c3361ee465e";

// ---------------------------------------------------------------------------
// CLI parsing — exactly one of --dry-run / --live required.
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const live = args.includes("--live");
if (dryRun === live) {
  // neither or both
  console.error("Usage: npx tsx scripts/run-canonical-id-migration.ts (--dry-run | --live)");
  console.error("  --dry-run   run the full transaction and all validations, then ROLLBACK (no state change)");
  console.error("  --live      run the full transaction and all validations, then COMMIT");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Production fingerprint gate — identical logic to scripts/canonical-id-audit-prod.ts
// ---------------------------------------------------------------------------
const EXPECTED_LIVE_API_COUNT = 56;
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

function gateFail(msg: string): never {
  console.error("\nWRONG DATABASE / PRODUCTION FINGERPRINT FAILED");
  console.error(`Reason: ${msg}`);
  console.error("This DATABASE_URL is NOT the production database. Nothing was executed.");
  process.exitCode = 1;
  throw new Error("fingerprint gate failed");
}

async function fingerprintGate(): Promise<string> {
  const fingerprintIds = Object.keys(FINGERPRINTS);
  let found: any[];
  try {
    const r = await pool.query(
      `SELECT id, name, organization_id FROM accounts WHERE id = ANY($1::text[]) ORDER BY id`,
      [fingerprintIds]
    );
    found = r.rows;
  } catch (e: any) {
    gateFail(`fingerprint query failed: ${e.message}`);
  }
  const results = fingerprintIds.map((fid) => {
    const hit = found.find((r) => r.id === fid);
    const nameOk = !!hit && String(hit.name).toLowerCase().includes(FINGERPRINTS[fid].toLowerCase());
    return { id: fid, expected: FINGERPRINTS[fid], hit, ok: nameOk };
  });
  const missing = results.filter((f) => !f.ok);
  if (missing.length > 0) {
    gateFail(
      `missing/mismatched fingerprint accounts: ${missing
        .map((m) => `${m.id} (expected "${m.expected}", got ${m.hit ? `"${m.hit.name}"` : "no row"})`)
        .join("; ")}`
    );
  }
  const orgIds = Array.from(new Set(found.map((r) => r.organization_id)));
  if (orgIds.length !== 1) {
    gateFail(`fingerprint accounts span ${orgIds.length} organizations; expected exactly 1`);
  }
  const htOrgId = orgIds[0] as string;
  const { rows: cnt } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM accounts WHERE organization_id = $1`,
    [htOrgId]
  );
  if (Number(cnt[0].n) !== EXPECTED_LIVE_API_COUNT) {
    gateFail(`HT account count ${cnt[0].n} != expected live-API count ${EXPECTED_LIVE_API_COUNT}`);
  }
  return htOrgId;
}

// ---------------------------------------------------------------------------
// Constraint list (§4.2 b/i). Operator: verify names with \d before --live.
// ---------------------------------------------------------------------------
const DEFERRABLE_CONSTRAINTS: Array<[string, string]> = [
  ["opportunities", "opportunities_account_id_accounts_id_fk"],
  ["contacts", "contacts_account_id_accounts_id_fk"],
  ["leads", "leads_converted_account_id_accounts_id_fk"],
  ["candidate_accounts", "candidate_accounts_existing_account_id_accounts_id_fk"],
  ["activity_associations", "activity_associations_activity_id_activities_id_fk"],
  ["lg_crm_tasks", "lg_crm_tasks_activity_id_activities_id_fk"],
];

// Org-scope SQL fragments
const orgFilter = HT_ONLY ? `AND organization_id = '${HT_ORG_ID}'` : "";
const orgWhere = HT_ONLY ? `organization_id = '${HT_ORG_ID}' AND ` : "";

// §5 target counters (global scope: Account 59, Activity 531)
const ACCOUNT_COUNTER = HT_ONLY ? 56 : 59;
const ACTIVITY_COUNTER = HT_ONLY ? 530 : 531;

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

class ValidationError extends Error {}

async function expectZero(client: PoolClient, label: string, sql: string) {
  const r = await client.query(sql);
  const n = Number(r.rows[0]?.count ?? r.rowCount);
  // count-returning queries use COUNT(*); row-returning ones use rowCount
  const val = r.rows[0] && "count" in r.rows[0] ? Number(r.rows[0].count) : r.rows.length;
  if (val > 0) {
    throw new ValidationError(`VALIDATION FAILED ${label}: expected 0, got ${val}\nSQL: ${sql}`);
  }
  log("V", `${label} PASS (0)`);
  void n;
}

async function expectZeroRows(client: PoolClient, label: string, sql: string) {
  const r = await client.query(sql);
  if (r.rows.length > 0) {
    throw new ValidationError(`VALIDATION FAILED ${label}: expected 0 rows, got ${r.rows.length}\nSQL: ${sql}`);
  }
  log("V", `${label} PASS (0 rows)`);
}

(async () => {
  console.log("=".repeat(78));
  console.log("PRODUCTION CANONICAL ID MIGRATION");
  console.log(`MODE: ${live ? "LIVE (will COMMIT)" : "DRY-RUN (will ROLLBACK)"}`);
  console.log(`SCOPE: ${HT_ONLY ? "HT-org-only (§1.5 default)" : "GLOBAL (includes Lucentria + non-HT activity)"}`);
  console.log(`RUN AT: ${new Date().toISOString()}`);
  console.log("=".repeat(78));

  // ---------- Fingerprint gate (outside transaction; SELECT-only) ----------
  log("GATE", "running production fingerprint gate...");
  const htOrgId = await fingerprintGate();
  log("GATE", `PASS — production confirmed (HT org ${htOrgId})`);
  if (htOrgId !== HT_ORG_ID) {
    gateFail(`HT org id ${htOrgId} != expected ${HT_ORG_ID}`);
  }

  const client = await pool.connect();
  const t0 = Date.now();
  const summary: string[] = [];
  let inTx = false;

  try {
    // ---------- (a) BEGIN + freeze ID generation ----------
    await client.query("BEGIN");
    inTx = true;
    log("a", "BEGIN; locking id_patterns rows FOR UPDATE (freezes generateId)");
    await client.query(`SELECT id FROM id_patterns WHERE organization_id IS NULL FOR UPDATE`);

    // ---------- (b) Make FK constraints deferrable + defer ----------
    for (const [table, constraint] of DEFERRABLE_CONSTRAINTS) {
      await client.query(`ALTER TABLE ${table} ALTER CONSTRAINT ${constraint} DEFERRABLE`);
      log("b", `ALTER TABLE ${table} ALTER CONSTRAINT ${constraint} DEFERRABLE`);
    }
    await client.query(`SET CONSTRAINTS ALL DEFERRED`);
    log("b", "SET CONSTRAINTS ALL DEFERRED");

    // ---------- (c) Build legacy_id_map ----------
    await client.query(`
      CREATE TABLE IF NOT EXISTS legacy_id_map (
        entity       text NOT NULL,
        legacy_id    text NOT NULL,
        canonical_id text NOT NULL,
        migrated_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (entity, legacy_id),
        UNIQUE (entity, canonical_id)
      )`);
    log("c", "legacy_id_map table ready");

    const mapInserts: Array<[string, string]> = [
      [
        "Account",
        `INSERT INTO legacy_id_map (entity, legacy_id, canonical_id)
         SELECT 'Account', id,
                'ACCT-' || EXTRACT(YEAR FROM created_at)::int || '-' ||
                LPAD(ROW_NUMBER() OVER (ORDER BY created_at, id)::text, 5, '0')
         FROM accounts WHERE id LIKE 'ACT-%' ${orgFilter}`,
      ],
      [
        "Contact",
        `INSERT INTO legacy_id_map (entity, legacy_id, canonical_id)
         SELECT 'Contact', id,
                'CONT-' || to_char(created_at,'YYMM') || '-' ||
                LPAD(ROW_NUMBER() OVER (ORDER BY created_at, id)::text, 5, '0')
         FROM contacts WHERE id LIKE 'CON-%' AND id NOT LIKE 'CONT-%' ${orgFilter}`,
      ],
      [
        "Opportunity",
        `INSERT INTO legacy_id_map (entity, legacy_id, canonical_id)
         SELECT 'Opportunity', id, UPPER(id)
         FROM opportunities WHERE id LIKE 'Opp-%'`,
      ],
      [
        "Activity",
        `INSERT INTO legacy_id_map (entity, legacy_id, canonical_id)
         SELECT 'Activity', id,
                'ACT-' || CASE WHEN split_part(id,'-',2) ~ '^\\d{6}$'
                               THEN substring(split_part(id,'-',2) from 3)
                               ELSE split_part(id,'-',2) END || '-' ||
                LPAD(ROW_NUMBER() OVER (ORDER BY created_at, id)::text, 5, '0')
         FROM activities WHERE id LIKE 'ACV-%' ${orgFilter}`,
      ],
    ];
    const mapCounts: Record<string, number> = {};
    for (const [entity, sql] of mapInserts) {
      const r = await client.query(sql);
      mapCounts[entity] = r.rowCount ?? 0;
      log("c", `legacy_id_map ${entity}: ${r.rowCount} rows`);
    }

    // ---------- (c2) Collision guard ----------
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM legacy_id_map m JOIN accounts      a ON a.id = m.canonical_id WHERE m.entity='Account')
      OR EXISTS (SELECT 1 FROM legacy_id_map m JOIN contacts      c ON c.id = m.canonical_id WHERE m.entity='Contact')
      OR EXISTS (SELECT 1 FROM legacy_id_map m JOIN opportunities o ON o.id = m.canonical_id WHERE m.entity='Opportunity')
      OR EXISTS (SELECT 1 FROM legacy_id_map m JOIN activities    v ON v.id = m.canonical_id WHERE m.entity='Activity')
      THEN RAISE EXCEPTION 'canonical ID collision detected — aborting';
      END IF;
    END $$`);
    log("c2", "collision guard PASS — no proposed canonical ID already exists");

    // ---------- (d) Primary key updates ----------
    const pkUpdates: Array<[string, string]> = [
      ["accounts", `UPDATE accounts a SET id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account' AND a.id = m.legacy_id`],
      ["contacts", `UPDATE contacts c SET id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Contact' AND c.id = m.legacy_id`],
      ["opportunities", `UPDATE opportunities o SET id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Opportunity' AND o.id = m.legacy_id`],
      ["activities", `UPDATE activities v SET id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Activity' AND v.id = m.legacy_id`],
    ];
    const pkCounts: Record<string, number> = {};
    for (const [table, sql] of pkUpdates) {
      const r = await client.query(sql);
      pkCounts[table] = r.rowCount ?? 0;
      log("d", `PK update ${table}: ${r.rowCount} rows`);
    }

    // ---------- (e) FK reference columns ----------
    const fkUpdates: Array<[string, string]> = [
      ["opportunities.account_id", `UPDATE opportunities o SET account_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account' AND o.account_id = m.legacy_id`],
      ["contacts.account_id", `UPDATE contacts c SET account_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account' AND c.account_id = m.legacy_id`],
      ["activity_associations.activity_id", `UPDATE activity_associations aa SET activity_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Activity' AND aa.activity_id = m.legacy_id`],
    ];
    // ---------- (f) Soft text references ----------
    const softUpdates: Array<[string, string]> = [
      ["activity_associations.entity_id", `UPDATE activity_associations aa SET entity_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account' AND aa.entity_type='Account' AND aa.entity_id = m.legacy_id`],
      ["activities.related_id", `UPDATE activities v SET related_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account' AND v.related_type='Account' AND v.related_id = m.legacy_id`],
    ];
    const refCounts: Record<string, number> = {};
    for (const [label, sql] of fkUpdates) {
      const r = await client.query(sql);
      refCounts[label] = r.rowCount ?? 0;
      log("e", `FK update ${label}: ${r.rowCount} rows`);
    }
    for (const [label, sql] of softUpdates) {
      const r = await client.query(sql);
      refCounts[label] = r.rowCount ?? 0;
      log("f", `soft-ref update ${label}: ${r.rowCount} rows`);
    }

    // ---------- (g) id_patterns target state (§5) ----------
    const patternUpdates: Array<[string, string, number]> = [
      ["Account", "ACCT-{YYYY}-{SEQ:5}", ACCOUNT_COUNTER],
      ["Contact", "CONT-{YY}{MM}-{SEQ:5}", 69],
      ["Opportunity", "OPP-{YYYY}-{SEQ:6}", 2137],
      ["Activity", "ACT-{YY}{MM}-{SEQ:5}", ACTIVITY_COUNTER],
    ];
    for (const [entity, pattern, counter] of patternUpdates) {
      const r = await client.query(
        `UPDATE id_patterns SET pattern=$1, counter=$2, start_value=1, last_issued=NULL, updated_at=now()
         WHERE entity=$3 AND organization_id IS NULL`,
        [pattern, counter, entity]
      );
      log("g", `id_patterns ${entity}: pattern=${pattern} counter=${counter} start_value=1 (${r.rowCount} row)`);
    }

    // ---------- (h) §8 validation queries V1–V9 ----------
    log("h", "running §8 validation queries...");
    const V = HT_ONLY ? `organization_id='${HT_ORG_ID}' AND ` : "";

    // V1: pattern conformance
    await expectZero(client, "V1 accounts", `SELECT COUNT(*) FROM accounts WHERE ${V}id !~ '^ACCT-\\d{4}-\\d{5}$'`);
    await expectZero(client, "V1 contacts", `SELECT COUNT(*) FROM contacts WHERE ${V}id !~ '^CONT-(\\d{4}-\\d{5}|\\d{4})$'`);
    await expectZero(client, "V1 leads", `SELECT COUNT(*) FROM leads WHERE ${V}id !~ '^LEAD-\\d{6}$'`);
    await expectZero(client, "V1 opportunities", `SELECT COUNT(*) FROM opportunities WHERE ${V}id !~ '^OPP-'`);
    await expectZero(client, "V1 activities", `SELECT COUNT(*) FROM activities WHERE ${V}id !~ '^ACT-\\d{4}-\\d{5}$'`);

    // V2: no legacy prefixes remain (org-scoped under HT_ONLY — non-HT legacy rows are out of scope)
    await expectZero(client, "V2 accounts", `SELECT COUNT(*) FROM accounts WHERE ${V}id LIKE 'ACT-%'`);
    await expectZero(client, "V2 contacts", `SELECT COUNT(*) FROM contacts WHERE ${V}id LIKE 'CON-%' AND id NOT LIKE 'CONT-%'`);
    await expectZero(client, "V2 opportunities", `SELECT COUNT(*) FROM opportunities WHERE id LIKE 'Opp-%'`);
    await expectZero(client, "V2 activities", `SELECT COUNT(*) FROM activities WHERE ${V}id LIKE 'ACV-%'`);

    // V3: zero duplicates per table
    await expectZeroRows(client, "V3 accounts", `SELECT id FROM accounts GROUP BY id HAVING COUNT(*)>1`);
    await expectZeroRows(client, "V3 contacts", `SELECT id FROM contacts GROUP BY id HAVING COUNT(*)>1`);
    await expectZeroRows(client, "V3 opportunities", `SELECT id FROM opportunities GROUP BY id HAVING COUNT(*)>1`);
    await expectZeroRows(client, "V3 activities", `SELECT id FROM activities GROUP BY id HAVING COUNT(*)>1`);

    // V3b: zero Account/Activity cross-table ID overlap
    await expectZeroRows(client, "V3b account/activity overlap", `SELECT a.id FROM accounts a JOIN activities v ON v.id = a.id`);

    // V4: zero broken FKs
    await expectZero(client, "V4 opp→acct", `SELECT COUNT(*) FROM opportunities o LEFT JOIN accounts a ON a.id=o.account_id WHERE o.account_id IS NOT NULL AND a.id IS NULL`);
    await expectZero(client, "V4 con→acct", `SELECT COUNT(*) FROM contacts c LEFT JOIN accounts a ON a.id=c.account_id WHERE c.account_id IS NOT NULL AND a.id IS NULL`);
    await expectZero(client, "V4 lead→acct", `SELECT COUNT(*) FROM leads l LEFT JOIN accounts a ON a.id=l.converted_account_id WHERE l.converted_account_id IS NOT NULL AND a.id IS NULL`);
    await expectZero(client, "V4 lead→con", `SELECT COUNT(*) FROM leads l LEFT JOIN contacts c ON c.id=l.converted_contact_id WHERE l.converted_contact_id IS NOT NULL AND c.id IS NULL`);
    await expectZero(client, "V4 lead→opp", `SELECT COUNT(*) FROM leads l LEFT JOIN opportunities o ON o.id=l.converted_opportunity_id WHERE l.converted_opportunity_id IS NOT NULL AND o.id IS NULL`);
    await expectZero(client, "V4 aa→act", `SELECT COUNT(*) FROM activity_associations aa LEFT JOIN activities v ON v.id=aa.activity_id WHERE v.id IS NULL`);
    await expectZero(client, "V4 oc→con", `SELECT COUNT(*) FROM opportunity_contacts oc LEFT JOIN contacts c ON c.id=oc.contact_id WHERE c.id IS NULL`);
    await expectZero(client, "V4 oc→opp", `SELECT COUNT(*) FROM opportunity_contacts oc LEFT JOIN opportunities o ON o.id=oc.opportunity_id WHERE o.id IS NULL`);
    await expectZero(client, "V4 or→opp", `SELECT COUNT(*) FROM opportunity_resources orr LEFT JOIN opportunities o ON o.id=orr.opportunity_id WHERE o.id IS NULL`);

    // V5: zero active references to legacy IDs (audit_logs intentionally excluded)
    await expectZero(client, "V5 aa.entity_id ACT-", `SELECT COUNT(*) FROM activity_associations WHERE entity_id LIKE 'ACT-%' AND entity_type='Account'`);
    await expectZero(client, "V5 aa.entity_id other", `SELECT COUNT(*) FROM activity_associations WHERE entity_id ~ '^(CON-|Opp-|ACV-)'`);
    await expectZero(client, "V5 activities.related_id", `SELECT COUNT(*) FROM activities WHERE related_id ~ '^(CON-|Opp-|ACV-)' OR (related_type='Account' AND related_id LIKE 'ACT-%')`);
    await expectZero(client, "V5 entity_tags", `SELECT COUNT(*) FROM entity_tags WHERE entity_id ~ '^(CON-(?!T)|Opp-|ACV-)' OR (entity='Account' AND entity_id LIKE 'ACT-%')`);
    await expectZero(client, "V5 comments", `SELECT COUNT(*) FROM comments WHERE entity_id ~ '^(CON-(?!T)|Opp-|ACV-)' OR (entity IN ('Account','accounts') AND entity_id LIKE 'ACT-%')`);

    // V6: id_patterns equal canonical contract
    const v6 = await client.query(`SELECT entity, pattern, counter, start_value FROM id_patterns WHERE organization_id IS NULL ORDER BY entity`);
    const v6Expected: Record<string, [string, number, number]> = {
      Account: ["ACCT-{YYYY}-{SEQ:5}", ACCOUNT_COUNTER, 1],
      Activity: ["ACT-{YY}{MM}-{SEQ:5}", ACTIVITY_COUNTER, 1],
      Contact: ["CONT-{YY}{MM}-{SEQ:5}", 69, 1],
      Document: ["DOC-{SEQ:6}", 0, 1],
      Lead: ["LEAD-{SEQ:6}", 120, 35],
      Opportunity: ["OPP-{YYYY}-{SEQ:6}", 2137, 1],
    };
    for (const row of v6.rows) {
      const exp = v6Expected[row.entity];
      if (!exp) throw new ValidationError(`V6: unexpected id_patterns entity ${row.entity}`);
      if (row.pattern !== exp[0] || Number(row.counter) !== exp[1] || Number(row.start_value) !== exp[2]) {
        throw new ValidationError(
          `V6 FAILED for ${row.entity}: got pattern=${row.pattern} counter=${row.counter} start=${row.start_value}; expected ${exp[0]} ${exp[1]} ${exp[2]}`
        );
      }
    }
    if (v6.rows.length !== 6) throw new ValidationError(`V6 FAILED: expected 6 global id_patterns rows, got ${v6.rows.length}`);
    log("V", "V6 PASS — id_patterns match canonical contract");

    // V7: generator produces collision-free next ID
    await expectZero(client, "V7 Account", `SELECT COUNT(*) FROM accounts WHERE id = 'ACCT-' || EXTRACT(YEAR FROM now())::int || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Account' AND organization_id IS NULL)::text,5,'0')`);
    await expectZero(client, "V7 Contact", `SELECT COUNT(*) FROM contacts WHERE id = 'CONT-' || to_char(now(),'YYMM') || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Contact' AND organization_id IS NULL)::text,5,'0')`);
    await expectZero(client, "V7 Opportunity", `SELECT COUNT(*) FROM opportunities WHERE id = 'OPP-' || EXTRACT(YEAR FROM now())::int || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Opportunity' AND organization_id IS NULL)::text,6,'0')`);
    await expectZero(client, "V7 Activity", `SELECT COUNT(*) FROM activities WHERE id = 'ACT-' || to_char(now(),'YYMM') || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Activity' AND organization_id IS NULL)::text,5,'0')`);

    // V8: row counts unchanged (rename-only invariant)
    const v8 = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM accounts WHERE organization_id=$1) AS accounts,
              (SELECT COUNT(*)::int FROM contacts WHERE organization_id=$1) AS contacts,
              (SELECT COUNT(*)::int FROM leads WHERE organization_id=$1) AS leads,
              (SELECT COUNT(*)::int FROM opportunities WHERE organization_id=$1) AS opps,
              (SELECT COUNT(*)::int FROM activities WHERE organization_id=$1) AS acts`,
      [HT_ORG_ID]
    );
    const v8r = v8.rows[0];
    const v8Expected = { accounts: 56, contacts: 85, leads: 59, opps: 87, acts: 530 };
    for (const [k, exp] of Object.entries(v8Expected)) {
      if (Number(v8r[k]) !== exp) {
        throw new ValidationError(`V8 FAILED: ${k} count ${v8r[k]} != expected ${exp}`);
      }
    }
    log("V", `V8 PASS — HT row counts unchanged (${JSON.stringify(v8r)})`);

    // V9: legacy_id_map completeness
    const v9 = await client.query(`SELECT entity, COUNT(*)::int AS n FROM legacy_id_map GROUP BY entity ORDER BY entity`);
    const v9Expected: Record<string, number> = {
      Account: HT_ONLY ? 56 : 59,
      Contact: 69,
      Opportunity: 2,
      Activity: HT_ONLY ? 530 : 531,
    };
    for (const [entity, exp] of Object.entries(v9Expected)) {
      const row = v9.rows.find((r) => r.entity === entity);
      const n = row ? Number(row.n) : 0;
      if (n !== exp) throw new ValidationError(`V9 FAILED: legacy_id_map ${entity} count ${n} != expected ${exp}`);
    }
    log("V", `V9 PASS — legacy_id_map: ${v9.rows.map((r) => `${r.entity}=${r.n}`).join(", ")}`);

    // ---------- (i) Restore constraint timing ----------
    await client.query(`SET CONSTRAINTS ALL IMMEDIATE`); // re-checks all FKs; throws if broken
    log("i", "SET CONSTRAINTS ALL IMMEDIATE — all deferred FKs re-checked OK");
    for (const [table, constraint] of DEFERRABLE_CONSTRAINTS) {
      await client.query(`ALTER TABLE ${table} ALTER CONSTRAINT ${constraint} NOT DEFERRABLE`);
      log("i", `ALTER TABLE ${table} ALTER CONSTRAINT ${constraint} NOT DEFERRABLE`);
    }

    // ---------- First post-migration IDs (§5 arithmetic: SEQ = start_value + counter) ----------
    const nextIds = await client.query(`
      SELECT entity,
             CASE entity
               WHEN 'Account'     THEN 'ACCT-' || EXTRACT(YEAR FROM now())::int || '-' || LPAD((start_value+counter)::text,5,'0')
               WHEN 'Contact'     THEN 'CONT-' || to_char(now(),'YYMM') || '-' || LPAD((start_value+counter)::text,5,'0')
               WHEN 'Opportunity' THEN 'OPP-' || EXTRACT(YEAR FROM now())::int || '-' || LPAD((start_value+counter)::text,6,'0')
               WHEN 'Activity'    THEN 'ACT-' || to_char(now(),'YYMM') || '-' || LPAD((start_value+counter)::text,5,'0')
               WHEN 'Lead'        THEN 'LEAD-' || LPAD((start_value+counter)::text,6,'0')
               WHEN 'Document'    THEN 'DOC-' || LPAD((start_value+counter)::text,6,'0')
             END AS next_id
      FROM id_patterns WHERE organization_id IS NULL ORDER BY entity`);

    // ---------- COMMIT (live) or ROLLBACK (dry-run) ----------
    if (live) {
      await client.query("COMMIT");
      inTx = false;
      log("COMMIT", "transaction committed — migration is LIVE");
    } else {
      await client.query("ROLLBACK");
      inTx = false;
      log("ROLLBACK", "dry-run complete — transaction rolled back, zero production state change");
    }

    const elapsedMs = Date.now() - t0;

    // ---------- Summary ----------
    summary.push("");
    summary.push("=".repeat(78));
    summary.push(`MIGRATION SUMMARY (${live ? "COMMITTED" : "DRY-RUN / ROLLED BACK"})`);
    summary.push("=".repeat(78));
    summary.push("Rows renamed per entity:");
    summary.push(`  accounts       ${pkCounts["accounts"]}   (expected 56${HT_ONLY ? "" : " +3 global"})`);
    summary.push(`  contacts       ${pkCounts["contacts"]}   (expected 69)`);
    summary.push(`  opportunities  ${pkCounts["opportunities"]}    (expected 2)`);
    summary.push(`  activities     ${pkCounts["activities"]}  (expected 530${HT_ONLY ? "" : " +1 global"})`);
    summary.push("Reference rows updated per column:");
    summary.push(`  opportunities.account_id            ${refCounts["opportunities.account_id"]}  (expected 91)`);
    summary.push(`  contacts.account_id                 ${refCounts["contacts.account_id"]}  (expected 17)`);
    summary.push(`  activity_associations.activity_id   ${refCounts["activity_associations.activity_id"]}  (expected 46)`);
    summary.push(`  activity_associations.entity_id     ${refCounts["activity_associations.entity_id"]}   (expected 1)`);
    summary.push(`  activities.related_id               ${refCounts["activities.related_id"]}   (expected 1)`);
    summary.push("legacy_id_map row counts per entity:");
    for (const [entity, n] of Object.entries(mapCounts)) summary.push(`  ${entity.padEnd(12)} ${n}`);
    summary.push("First post-migration ID per entity (SEQ = start_value + counter):");
    for (const r of nextIds.rows) summary.push(`  ${String(r.entity).padEnd(12)} ${r.next_id}`);
    summary.push(`Total transaction wall-clock time: ${(elapsedMs / 1000).toFixed(2)}s`);
    summary.push("=".repeat(78));
    console.log(summary.join("\n"));

    await client.release();
    await pool.end();
  } catch (e: any) {
    // Any in-transaction failure (SQL error, collision guard, validation) → explicit ROLLBACK.
    if (inTx) {
      try {
        await client.query("ROLLBACK");
        console.error("\nROLLBACK issued — no production data was changed.");
      } catch (rbErr: any) {
        console.error(`ROLLBACK attempt failed: ${rbErr.message} (transaction was already aborted by the server)`);
      }
    }
    console.error(`\nMIGRATION FAILED: ${e.message}`);
    client.release();
    await pool.end().catch(() => {});
    process.exit(1);
  }
})().catch(async (e) => {
  await pool.end().catch(() => {});
  if (String(e.message) !== "fingerprint gate failed") console.error(e);
  process.exit(1);
});
