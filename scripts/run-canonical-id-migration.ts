// Production canonical ID migration execution script — Task 216, revised per the
// owner's 11-correction document (Task 218).
//
// Executes a single atomic transaction: renames EVERY record (all organisations,
// global scope) whose ID does not match its entity's canonical pattern, updates all
// live FK references (dynamically discovered from pg_constraint) plus every known
// soft/text reference column, recomputes id_patterns counters dynamically from the
// migrated data, and runs every validation query (V1–V9) BEFORE commit. Any failure
// → explicit ROLLBACK, exit non-zero.
//
// Canonical patterns (Correction 9 — ZERO exceptions):
//   Account      ^ACCT-\d{4}-\d{5}$
//   Contact      ^CONT-\d{4}-\d{5}$
//   Opportunity  ^OPP-\d{4}-\d{6}$
//   Activity     ^ACT-\d{4}-\d{5}$
//   Lead         ^LEAD-\d{6}$
//   Document     ^DOC-\d{6}$
//
// Usage:
//   npx tsx scripts/run-canonical-id-migration.ts --dry-run   # full run, then ROLLBACK (no state change)
//   CONFIRM_LIVE=yes npx tsx scripts/run-canonical-id-migration.ts --live   # full run, then COMMIT
//   (no flag → prints usage, exit 1; --live without CONFIRM_LIVE=yes → checklist, exit 1)
//
// DO NOT run --live from CI or any automated context.

import { Pool, PoolClient } from "pg";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { verifyDryRunReport, computeReportMac, DbIdentity } from "./canonical-id-migration-gate";

const DRYRUN_REPORT_PATH = path.resolve(process.cwd(), "scripts/canonical-id-migration-dryrun-report.json");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

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
  console.error("              (--live additionally requires CONFIRM_LIVE=yes in the environment)");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Live-run safety gate (Correction 11). Accidental --live runs are impossible:
// CONFIRM_LIVE=yes must be set explicitly by the operator.
// ---------------------------------------------------------------------------
// Each precondition is ENFORCED, not merely printed: manual ones require their own
// explicit attestation env var; machine-checkable ones are verified by the script
// itself (fingerprint gate, CI detection, dry-run report file, single-connection
// check, dynamic FK inventory).
const LIVE_PRECONDITIONS: Array<{ text: string; enforcement: string; ok: () => boolean }> = [
  {
    text: "1. A verified-restorable production backup / PITR mark has been taken.",
    enforcement: "requires CONFIRM_BACKUP_TAKEN=yes",
    ok: () => process.env.CONFIRM_BACKUP_TAKEN === "yes",
  },
  {
    text: "2. Maintenance window: ALL application writes are stopped (generateId() mutates id_patterns on every create).",
    enforcement: "requires CONFIRM_WRITES_STOPPED=yes AND the script verifies no other active connections to the database before COMMIT",
    ok: () => process.env.CONFIRM_WRITES_STOPPED === "yes",
  },
  {
    text: "3. The audit gate passes against the target DB.",
    enforcement: "verified in-process: the production fingerprint gate below must pass",
    ok: () => true, // enforced at runtime by fingerprintGate()
  },
  {
    text: "4. DATABASE_URL points at the REAL production database.",
    enforcement: "verified in-process: fingerprint gate (HT org UUID + 56-account count + 6 named accounts)",
    ok: () => true, // enforced at runtime by fingerprintGate()
  },
  {
    text: "5. The complete FK reference inventory has been reviewed.",
    enforcement: "verified in-process: FKs are discovered from pg_constraint; a live run HARD-FAILS on any discovered FK this script cannot handle",
    ok: () => true, // enforced at runtime after FK discovery
  },
  {
    text: "6. A --dry-run against the SAME database has completed successfully within the last 24h and its report has been reviewed by the owner.",
    enforcement: `requires CONFIRM_DRYRUN_REVIEWED=yes AND a fresh matching report at ${DRYRUN_REPORT_PATH}`,
    ok: () => process.env.CONFIRM_DRYRUN_REVIEWED === "yes",
  },
  {
    text: "7. This command is being run manually by an operator — NOT from CI or any automated context.",
    enforcement: "verified in-process: refuses to run when CI/CONTINUOUS_INTEGRATION/GITHUB_ACTIONS is set",
    ok: () => !process.env.CI && !process.env.CONTINUOUS_INTEGRATION && !process.env.GITHUB_ACTIONS,
  },
  {
    text: "8. The operator deliberately confirms this single invocation.",
    enforcement: "requires CONFIRM_LIVE=yes",
    ok: () => process.env.CONFIRM_LIVE === "yes",
  },
];
if (live) {
  const failed = LIVE_PRECONDITIONS.filter((p) => !p.ok());
  if (failed.length > 0) {
    console.error("REFUSING --live: one or more preconditions are not satisfied.\n");
    console.error("ALL eight preconditions must hold (each is enforced, not informational):\n");
    for (const p of LIVE_PRECONDITIONS) {
      const status = p.ok() ? "SATISFIED " : "UNSATISFIED";
      console.error(`  [${status}] ${p.text}`);
      console.error(`               enforcement: ${p.enforcement}`);
    }
    console.error("\nSet the missing attestation variables ONLY after the corresponding manual step is truly done.");
    process.exit(1);
  }
  // Precondition 6 (dry-run evidence): the report file must exist and parse here;
  // it is verified against the LIVE connection's database identity, fingerprint,
  // and migration-input checksum after connecting (see the gate check below) —
  // a report produced against a clone or another database is rejected there.
  if (!fs.existsSync(DRYRUN_REPORT_PATH)) {
    console.error(`REFUSING --live: no dry-run report at ${DRYRUN_REPORT_PATH}. Run --dry-run against this database first and review its report.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Production fingerprint gate — identical logic to scripts/canonical-id-audit-prod.ts
// (preserved unchanged: HT org UUID + 56-account count + 6 named accounts).
// ---------------------------------------------------------------------------
const HT_ORG_ID = "3e369484-0c88-401d-86e3-9c3361ee465e";
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
// Entity definitions (Corrections 2–5, 9): strict canonical regexes; the mapping
// population is "everything that does NOT match" — this catches CON-*, CONT-0002,
// OPP-{SEQ:4}, Opp-*, ACT-*, ACV-*, and any other malformed shape with no
// enumeration of legacy prefixes.
// ---------------------------------------------------------------------------
interface EntityDef {
  entity: string; // legacy_id_map.entity value
  table: string;
  prefix: string;
  canonicalRegex: string; // Postgres regex (single-escaped)
  dateExpr: string; // SQL expr producing the middle date segment from created_at
  seqWidth: number;
}
const ENTITIES: EntityDef[] = [
  { entity: "Account", table: "accounts", prefix: "ACCT", canonicalRegex: "^ACCT-\\d{4}-\\d{5}$", dateExpr: "to_char(created_at,'YYYY')", seqWidth: 5 },
  { entity: "Contact", table: "contacts", prefix: "CONT", canonicalRegex: "^CONT-\\d{4}-\\d{5}$", dateExpr: "to_char(created_at,'YYMM')", seqWidth: 5 },
  { entity: "Opportunity", table: "opportunities", prefix: "OPP", canonicalRegex: "^OPP-\\d{4}-\\d{6}$", dateExpr: "to_char(created_at,'YYYY')", seqWidth: 6 },
  { entity: "Activity", table: "activities", prefix: "ACT", canonicalRegex: "^ACT-\\d{4}-\\d{5}$", dateExpr: "to_char(created_at,'YYMM')", seqWidth: 5 },
];

// Soft/text reference columns (Correction 6). Polymorphic columns carry a type
// column whose value selects the entity; fixed columns reference one entity.
// Tables that do not exist in the target DB are skipped with a logged warning
// (production schema is known to lag dev).
const TYPE_VARIANTS: Record<string, string[]> = {
  Account: ["Account", "account", "accounts"],
  Contact: ["Contact", "contact", "contacts"],
  Opportunity: ["Opportunity", "opportunity", "opportunities"],
  Activity: ["Activity", "activity", "activities"],
};
interface SoftRef {
  table: string;
  column: string;
  typeColumn?: string; // polymorphic discriminator column, when present
  entity?: string; // fixed target entity, when no typeColumn
}
const SOFT_REFS: SoftRef[] = [
  { table: "activity_associations", column: "entity_id", typeColumn: "entity_type" },
  { table: "activities", column: "related_id", typeColumn: "related_type" },
  { table: "document_links", column: "entity_id", typeColumn: "entity_type" },
  { table: "entity_tags", column: "entity_id", typeColumn: "entity" },
  { table: "comments", column: "entity_id", typeColumn: "entity" },
  { table: "crm_documents", column: "entity_id", typeColumn: "entity_type" },
  { table: "research_documents", column: "entity_id", typeColumn: "entity_type" },
  { table: "leads", column: "converted_account_id", entity: "Account" },
  { table: "leads", column: "converted_contact_id", entity: "Contact" },
  { table: "leads", column: "converted_opportunity_id", entity: "Opportunity" },
  { table: "opportunity_contacts", column: "contact_id", entity: "Contact" },
  { table: "opportunity_contacts", column: "opportunity_id", entity: "Opportunity" },
  { table: "opportunity_resources", column: "opportunity_id", entity: "Opportunity" },
];

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Target identity + deterministic migration-input checksum (binds the dry-run
// evidence to this exact database and this exact input state).
// ---------------------------------------------------------------------------
async function getDbIdentity(): Promise<DbIdentity> {
  const base = await pool.query(
    `SELECT current_database() AS database, COALESCE(inet_server_addr()::text, 'local') AS host`
  );
  let systemIdentifier = "unavailable";
  try {
    const r = await pool.query(`SELECT system_identifier::text AS sid FROM pg_control_system()`);
    systemIdentifier = r.rows[0].sid;
  } catch {
    // pg_control_system() may be restricted; database+host still must match.
  }
  return { systemIdentifier, database: base.rows[0].database, host: base.rows[0].host };
}

async function computeInputChecksum(): Promise<string> {
  // sha256 over ALL mapping determinants: for non-canonical rows, (id, created_at)
  // in the deterministic mapping order — created_at drives both the canonical date
  // segment and the (created_at, id) ordering; for canonical rows, the full sorted
  // ID list plus the max sequence (the counter input). Any change to any of these
  // between dry-run and live invalidates the evidence.
  const parts: string[] = [];
  for (const e of ENTITIES) {
    const ids = await pool.query(
      `SELECT COALESCE(encode(sha256(convert_to(string_agg(id || '@' || created_at::text, ',' ORDER BY created_at, id), 'UTF8')), 'hex'), 'empty') AS h,
              COUNT(*)::int AS n
       FROM ${e.table} WHERE id !~ '${e.canonicalRegex}'`
    );
    const canon = await pool.query(
      `SELECT COALESCE(encode(sha256(convert_to(string_agg(id, ',' ORDER BY id), 'UTF8')), 'hex'), 'empty') AS h,
              COALESCE(MAX(CAST(split_part(id,'-',3) AS int)), 0) AS mx
       FROM ${e.table} WHERE id ~ '${e.canonicalRegex}'`
    );
    parts.push(`${e.entity}:${ids.rows[0].h}:${ids.rows[0].n}:${canon.rows[0].h}:${canon.rows[0].mx}`);
  }
  // Leads and Documents are never renamed by this migration, but their canonical
  // ID sets and max sequences ARE inputs (they drive the Lead/Document counter
  // computation and the V7 next-ID collision proofs), so both are hashed in full.
  const leadC = await pool.query(
    `SELECT COALESCE(encode(sha256(convert_to(string_agg(id, ',' ORDER BY id), 'UTF8')), 'hex'), 'empty') AS h,
            COALESCE(MAX(CAST(split_part(id,'-',2) AS int)), 0) AS mx
     FROM leads WHERE id ~ '^LEAD-\\d{6}$'`
  );
  parts.push(`Lead:${leadC.rows[0].h}:${leadC.rows[0].mx}`);
  const docsExist = await pool.query(`SELECT to_regclass('public.documents') IS NOT NULL AS ok`);
  if (docsExist.rows[0].ok) {
    const docC = await pool.query(
      `SELECT COALESCE(encode(sha256(convert_to(string_agg(id, ',' ORDER BY id), 'UTF8')), 'hex'), 'empty') AS h,
              COALESCE(MAX(CAST(split_part(id,'-',2) AS int)), 0) AS mx
       FROM documents WHERE id ~ '^DOC-\\d{6}$'`
    );
    parts.push(`Document:${docC.rows[0].h}:${docC.rows[0].mx}`);
  } else {
    parts.push(`Document:absent`);
  }
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

class ValidationError extends Error {}

async function expectZero(client: PoolClient, label: string, sql: string) {
  const r = await client.query(sql);
  const val = r.rows[0] && "count" in r.rows[0] ? Number(r.rows[0].count) : r.rows.length;
  if (val > 0) {
    throw new ValidationError(`VALIDATION FAILED ${label}: expected 0, got ${val}\nSQL: ${sql}`);
  }
  log("V", `${label} PASS (0)`);
}

async function expectZeroRows(client: PoolClient, label: string, sql: string) {
  const r = await client.query(sql);
  if (r.rows.length > 0) {
    throw new ValidationError(`VALIDATION FAILED ${label}: expected 0 rows, got ${r.rows.length}\nSQL: ${sql}`);
  }
  log("V", `${label} PASS (0 rows)`);
}

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const r = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!r.rows[0]?.ok;
}

async function columnExists(client: PoolClient, table: string, column: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]
  );
  return r.rows.length > 0;
}

(async () => {
  console.log("=".repeat(78));
  console.log("PRODUCTION CANONICAL ID MIGRATION (global scope — all organisations)");
  console.log(`MODE: ${live ? "LIVE (will COMMIT)" : "DRY-RUN (will ROLLBACK)"}`);
  console.log(`RUN AT: ${new Date().toISOString()}`);
  console.log("=".repeat(78));

  // ---------- Fingerprint gate (outside transaction; SELECT-only) ----------
  log("GATE", "running production fingerprint gate...");
  const htOrgId = await fingerprintGate();
  log("GATE", `PASS — production confirmed (HT org ${htOrgId})`);
  if (htOrgId !== HT_ORG_ID) {
    gateFail(`HT org id ${htOrgId} != expected ${HT_ORG_ID}`);
  }

  // ---------- Target identity + input checksum (outside transaction; SELECT-only) ----------
  const dbIdentity = await getDbIdentity();
  const inputChecksum = await computeInputChecksum();
  log("GATE", `target identity: system=${dbIdentity.systemIdentifier} db=${dbIdentity.database} host=${dbIdentity.host}`);
  log("GATE", `migration-input checksum: ${inputChecksum}`);

  // ---------- Live-only: verify the dry-run evidence is bound to THIS database ----------
  if (live) {
    let report: unknown;
    try {
      report = JSON.parse(fs.readFileSync(DRYRUN_REPORT_PATH, "utf8"));
    } catch (e: any) {
      console.error(`REFUSING --live: dry-run report at ${DRYRUN_REPORT_PATH} is unreadable (${e.message}).`);
      await pool.end().catch(() => {});
      process.exit(1);
    }
    const gate = verifyDryRunReport(report, { dbIdentity, htOrgId, inputChecksum }, Date.now(), process.env.SESSION_SECRET ?? "");
    if (!gate.ok) {
      console.error(`REFUSING --live: dry-run evidence check failed — ${gate.reason}`);
      console.error("Run a fresh --dry-run against THIS database, review its report, then retry --live.");
      await pool.end().catch(() => {});
      process.exit(1);
    }
    log("GATE", "dry-run evidence verified: same database identity, fingerprint, and migration input");
  }

  const client = await pool.connect();
  const t0 = Date.now();
  const summary: string[] = [];
  let inTx = false;

  try {
    // ---------- (a) BEGIN + freeze ID generation + pre-counts (for V8) ----------
    await client.query("BEGIN");
    inTx = true;
    log("a", "BEGIN; locking id_patterns rows FOR UPDATE (freezes generateId)");
    await client.query(`SELECT id FROM id_patterns WHERE organization_id IS NULL FOR UPDATE`);

    const preCounts: Record<string, number> = {};
    for (const e of ENTITIES) {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${e.table}`);
      preCounts[e.table] = Number(r.rows[0].n);
    }
    log("a", `pre-migration row counts: ${JSON.stringify(preCounts)}`);

    // ---------- (b) Dynamic FK discovery (Correction 6) + make deferrable ----------
    const fkRows = (
      await client.query(
        `SELECT con.conname AS constraint_name,
                src.relname  AS src_table,
                srcatt.attname AS src_column,
                tgt.relname  AS ref_table,
                tgtatt.attname AS ref_column,
                con.condeferrable
         FROM pg_constraint con
         JOIN pg_class src ON src.oid = con.conrelid
         JOIN pg_class tgt ON tgt.oid = con.confrelid
         JOIN pg_namespace ns ON ns.oid = src.relnamespace AND ns.nspname = 'public'
         JOIN LATERAL unnest(con.conkey)  WITH ORDINALITY k(attnum, ord) ON true
         JOIN LATERAL unnest(con.confkey) WITH ORDINALITY fk(attnum, ord) ON fk.ord = k.ord
         JOIN pg_attribute srcatt ON srcatt.attrelid = con.conrelid  AND srcatt.attnum = k.attnum
         JOIN pg_attribute tgtatt ON tgtatt.attrelid = con.confrelid AND tgtatt.attnum = fk.attnum
         WHERE con.contype = 'f'
           AND tgt.relname IN ('accounts','contacts','opportunities','activities')
         ORDER BY src.relname, con.conname`
      )
    ).rows as Array<{
      constraint_name: string;
      src_table: string;
      src_column: string;
      ref_table: string;
      ref_column: string;
      condeferrable: boolean;
    }>;
    log("b", `discovered ${fkRows.length} FK reference(s) into the four entity tables:`);
    for (const fk of fkRows) {
      log("b", `  ${fk.src_table}.${fk.src_column} -> ${fk.ref_table}.${fk.ref_column} (${fk.constraint_name})`);
      if (fk.ref_column !== "id") {
        log("WARN", `  discovered FK ${fk.constraint_name} references ${fk.ref_table}.${fk.ref_column} (not id) — NOT handled by this script; review manually`);
      }
    }
    // Precondition 5 enforcement: a live run must not proceed with any discovered
    // FK the script cannot handle.
    const unhandledFks = fkRows.filter((fk) => fk.ref_column !== "id");
    if (live && unhandledFks.length > 0) {
      throw new ValidationError(
        `LIVE run refused: ${unhandledFks.length} discovered FK(s) reference a non-id column and are not handled: ` +
          unhandledFks.map((f) => f.constraint_name).join(", ")
      );
    }
    // Deferrable list is built dynamically from the catalog (replaces hardcoded list).
    const madeDeferrable: Array<[string, string]> = [];
    for (const fk of fkRows) {
      if (fk.ref_column !== "id") continue;
      await client.query(`ALTER TABLE ${fk.src_table} ALTER CONSTRAINT ${fk.constraint_name} DEFERRABLE`);
      madeDeferrable.push([fk.src_table, fk.constraint_name]);
      log("b", `ALTER TABLE ${fk.src_table} ALTER CONSTRAINT ${fk.constraint_name} DEFERRABLE`);
    }
    await client.query(`SET CONSTRAINTS ALL DEFERRED`);
    log("b", "SET CONSTRAINTS ALL DEFERRED");

    // ---------- (c) Build legacy_id_map (Corrections 2–5, 7) ----------
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

    const mapCounts: Record<string, number> = {};
    for (const e of ENTITIES) {
      // Base = highest sequence already in use by canonical-format rows in this
      // table; new sequence numbers start above it, so a newly generated
      // canonical ID can never collide with a live canonical PK.
      const baseR = await client.query(
        `SELECT COALESCE(MAX(CAST(split_part(id,'-',3) AS int)), 0) AS mx
         FROM ${e.table} WHERE id ~ '${e.canonicalRegex}'`
      );
      const base = Number(baseR.rows[0].mx);
      // Deterministic global ordering by (created_at, id) — Correction 7.
      const r = await client.query(
        `INSERT INTO legacy_id_map (entity, legacy_id, canonical_id)
         SELECT '${e.entity}', id,
                '${e.prefix}-' || ${e.dateExpr} || '-' ||
                LPAD((${base} + ROW_NUMBER() OVER (ORDER BY created_at, id))::text, ${e.seqWidth}, '0')
         FROM ${e.table}
         WHERE id !~ '${e.canonicalRegex}'`
      );
      mapCounts[e.entity] = r.rowCount ?? 0;
      log("c", `legacy_id_map ${e.entity}: ${r.rowCount} rows (seq base ${base})`);
    }

    // ---------- (c2) Pre-PK assertions (Correction 7) ----------
    // A1: canonical IDs unique within their entity.
    await expectZeroRows(
      client,
      "A1 canonical unique per entity",
      `SELECT entity, canonical_id FROM legacy_id_map GROUP BY entity, canonical_id HAVING COUNT(*) > 1`
    );
    // A2: no proposed canonical ID already exists as a live PK.
    for (const e of ENTITIES) {
      await expectZeroRows(
        client,
        `A2 no live-PK collision (${e.entity})`,
        `SELECT m.canonical_id FROM legacy_id_map m JOIN ${e.table} t ON t.id = m.canonical_id WHERE m.entity = '${e.entity}'`
      );
    }
    // A3: no two legacy IDs map to the same canonical ID.
    await expectZeroRows(
      client,
      "A3 no shared canonical target",
      `SELECT entity, canonical_id, COUNT(DISTINCT legacy_id) AS n
       FROM legacy_id_map GROUP BY entity, canonical_id HAVING COUNT(DISTINCT legacy_id) > 1`
    );
    // A4: every legacy (non-canonical) row has exactly one mapping entry.
    for (const e of ENTITIES) {
      await expectZero(
        client,
        `A4 unmapped legacy rows (${e.entity})`,
        `SELECT COUNT(*) FROM ${e.table} t
         WHERE t.id !~ '${e.canonicalRegex}'
           AND NOT EXISTS (SELECT 1 FROM legacy_id_map m WHERE m.entity = '${e.entity}' AND m.legacy_id = t.id)`
      );
      const nonCanon = await client.query(`SELECT COUNT(*)::int AS n FROM ${e.table} WHERE id !~ '${e.canonicalRegex}'`);
      if (Number(nonCanon.rows[0].n) !== mapCounts[e.entity]) {
        throw new ValidationError(
          `A4 FAILED ${e.entity}: ${nonCanon.rows[0].n} non-canonical rows but ${mapCounts[e.entity]} mapping rows`
        );
      }
    }
    // A5: every reference that will be migrated must resolve to exactly one mapping.
    // Join-based (not prefix heuristics): any FK or soft-ref value that appears in
    // legacy_id_map must be updatable by the statements in steps (e)/(f); a mapped
    // legacy value sitting under an unrecognised polymorphic discriminator would be
    // silently skipped there — so it is a hard failure here.
    const allVariants = Object.values(TYPE_VARIANTS).flat().map((v) => `'${v}'`).join(",");
    for (const ref of SOFT_REFS) {
      if (!(await tableExists(client, ref.table)) || !(await columnExists(client, ref.table, ref.column))) continue;
      if (ref.typeColumn) {
        // (i) unknown discriminator holding a mapped legacy ID → cannot be migrated
        await expectZeroRows(
          client,
          `A5 ${ref.table}.${ref.column} unsupported discriminator on mapped legacy ID`,
          `SELECT t.${ref.typeColumn}::text AS discriminator, t.${ref.column} AS legacy_ref, COUNT(*) AS n
           FROM ${ref.table} t JOIN legacy_id_map m ON m.legacy_id = t.${ref.column}
           WHERE t.${ref.typeColumn}::text NOT IN (${allVariants})
           GROUP BY 1, 2`
        );
        // (ii) discriminator/entity mismatch: value maps under a different entity than declared
        for (const e of ENTITIES) {
          const variants = TYPE_VARIANTS[e.entity].map((v) => `'${v}'`).join(",");
          await expectZero(
            client,
            `A5 ${ref.table}.${ref.column} [${e.entity}] mapped-but-unresolvable`,
            `SELECT COUNT(*) FROM ${ref.table} t
             WHERE t.${ref.typeColumn}::text IN (${variants})
               AND t.${ref.column} IN (SELECT legacy_id FROM legacy_id_map)
               AND NOT EXISTS (SELECT 1 FROM legacy_id_map m WHERE m.entity = '${e.entity}' AND m.legacy_id = t.${ref.column})`
          );
        }
      } else {
        await expectZero(
          client,
          `A5 ${ref.table}.${ref.column} mapped-but-unresolvable`,
          `SELECT COUNT(*) FROM ${ref.table} t
           WHERE t.${ref.column} IN (SELECT legacy_id FROM legacy_id_map)
             AND NOT EXISTS (SELECT 1 FROM legacy_id_map m WHERE m.entity = '${ref.entity}' AND m.legacy_id = t.${ref.column})`
        );
      }
    }
    for (const fk of fkRows) {
      if (fk.ref_column !== "id") continue;
      const entity: string = ({ accounts: "Account", contacts: "Contact", opportunities: "Opportunity", activities: "Activity" } as Record<string, string>)[fk.ref_table];
      await expectZero(
        client,
        `A5 FK ${fk.src_table}.${fk.src_column} mapped-but-unresolvable`,
        `SELECT COUNT(*) FROM ${fk.src_table} t
         WHERE t.${fk.src_column} IN (SELECT legacy_id FROM legacy_id_map)
           AND NOT EXISTS (SELECT 1 FROM legacy_id_map m WHERE m.entity = '${entity}' AND m.legacy_id = t.${fk.src_column})`
      );
    }
    log("c2", "pre-PK assertions A1–A5 PASS");

    // ---------- (d) Primary key updates ----------
    const pkCounts: Record<string, number> = {};
    for (const e of ENTITIES) {
      const r = await client.query(
        `UPDATE ${e.table} t SET id = m.canonical_id FROM legacy_id_map m WHERE m.entity = '${e.entity}' AND t.id = m.legacy_id`
      );
      pkCounts[e.entity] = r.rowCount ?? 0;
      log("d", `PK update ${e.table}: ${r.rowCount} rows`);
    }

    // ---------- (e) FK reference columns — driven by the discovered catalog list ----------
    const TABLE_TO_ENTITY: Record<string, string> = {
      accounts: "Account",
      contacts: "Contact",
      opportunities: "Opportunity",
      activities: "Activity",
    };
    const refCounts: Record<string, number> = {};
    const handledCols = new Set<string>();
    for (const fk of fkRows) {
      if (fk.ref_column !== "id") continue; // warned above
      const entity = TABLE_TO_ENTITY[fk.ref_table];
      const label = `${fk.src_table}.${fk.src_column}`;
      const r = await client.query(
        `UPDATE ${fk.src_table} t SET ${fk.src_column} = m.canonical_id
         FROM legacy_id_map m WHERE m.entity = '${entity}' AND t.${fk.src_column} = m.legacy_id`
      );
      refCounts[label] = (refCounts[label] ?? 0) + (r.rowCount ?? 0);
      handledCols.add(label);
      log("e", `FK update ${label} (${entity}): ${r.rowCount} rows`);
    }

    // ---------- (f) Soft text references (Correction 6 explicit list) ----------
    for (const ref of SOFT_REFS) {
      const label = `${ref.table}.${ref.column}`;
      if (handledCols.has(label)) {
        log("f", `soft-ref ${label}: already updated via discovered FK — skipped`);
        continue;
      }
      if (!(await tableExists(client, ref.table)) || !(await columnExists(client, ref.table, ref.column))) {
        log("WARN", `soft-ref ${label}: table/column not present in this database — skipped`);
        continue;
      }
      if (ref.typeColumn) {
        for (const e of ENTITIES) {
          const variants = TYPE_VARIANTS[e.entity].map((v) => `'${v}'`).join(",");
          const r = await client.query(
            `UPDATE ${ref.table} t SET ${ref.column} = m.canonical_id
             FROM legacy_id_map m
             WHERE m.entity = '${e.entity}'
               AND t.${ref.typeColumn}::text IN (${variants})
               AND t.${ref.column} = m.legacy_id`
          );
          refCounts[`${label} [${e.entity}]`] = r.rowCount ?? 0;
          if ((r.rowCount ?? 0) > 0) log("f", `soft-ref update ${label} [${e.entity}]: ${r.rowCount} rows`);
        }
        log("f", `soft-ref ${label}: done (all entity types)`);
      } else {
        const r = await client.query(
          `UPDATE ${ref.table} t SET ${ref.column} = m.canonical_id
           FROM legacy_id_map m WHERE m.entity = '${ref.entity}' AND t.${ref.column} = m.legacy_id`
        );
        refCounts[label] = r.rowCount ?? 0;
        log("f", `soft-ref update ${label}: ${r.rowCount} rows`);
      }
    }

    // ---------- (g) id_patterns target state — counters computed dynamically (Correction 8) ----------
    const PATTERNS: Record<string, string> = {
      Account: "ACCT-{YYYY}-{SEQ:5}",
      Contact: "CONT-{YY}{MM}-{SEQ:5}",
      Opportunity: "OPP-{YYYY}-{SEQ:6}",
      Activity: "ACT-{YY}{MM}-{SEQ:5}",
    };
    const counters: Record<string, number> = {};
    for (const e of ENTITIES) {
      // After the PK updates every row in the table is canonical; the required
      // counter is the highest sequence in live IDs (next ID = start_value + counter,
      // start_value = 1, so next SEQ = max + 1 — provably collision-free, see V7).
      const r = await client.query(
        `SELECT COALESCE(MAX(CAST(split_part(id,'-',3) AS int)), 0) AS mx FROM ${e.table} WHERE id ~ '${e.canonicalRegex}'`
      );
      counters[e.entity] = Number(r.rows[0].mx);
      const u = await client.query(
        `UPDATE id_patterns SET pattern=$1, counter=$2, start_value=1, last_issued=NULL, updated_at=now()
         WHERE entity=$3 AND organization_id IS NULL`,
        [PATTERNS[e.entity], counters[e.entity], e.entity]
      );
      log("g", `id_patterns ${e.entity}: pattern=${PATTERNS[e.entity]} counter=${counters[e.entity]} (computed via MAX) start_value=1 (${u.rowCount} row)`);
    }
    // Lead and Document counters are computed the same way (Correction 8 covers
    // every final pattern, not just the four renamed entities). Their IDs carry
    // the sequence in segment 2 (LEAD-nnnnnn / DOC-nnnnnn).
    const SEQ2_ENTITIES: Array<{ entity: string; table: string; regex: string; pattern: string }> = [
      { entity: "Lead", table: "leads", regex: "^LEAD-\\d{6}$", pattern: "LEAD-{SEQ:6}" },
      { entity: "Document", table: "documents", regex: "^DOC-\\d{6}$", pattern: "DOC-{SEQ:6}" },
    ];
    for (const s of SEQ2_ENTITIES) {
      if (!(await tableExists(client, s.table))) {
        if (live) {
          throw new ValidationError(
            `LIVE run refused: ${s.table} table not present — cannot compute the ${s.entity} counter or prove next-ID safety`
          );
        }
        log("WARN", `id_patterns ${s.entity}: ${s.table} table not present — counter not reconciled (a live run will refuse)`);
        continue;
      }
      const r = await client.query(
        `SELECT COALESCE(MAX(CAST(split_part(id,'-',2) AS int)), 0) AS mx FROM ${s.table} WHERE id ~ '${s.regex}'`
      );
      counters[s.entity] = Number(r.rows[0].mx);
      const u = await client.query(
        `UPDATE id_patterns SET pattern=$1, counter=$2, start_value=1, last_issued=NULL, updated_at=now()
         WHERE entity=$3 AND organization_id IS NULL`,
        [s.pattern, counters[s.entity], s.entity]
      );
      log("g", `id_patterns ${s.entity}: pattern=${s.pattern} counter=${counters[s.entity]} (computed via MAX) start_value=1 (${u.rowCount} row)`);
    }
    // Per-organisation id_patterns overrides: generateId() always uses the GLOBAL
    // counter but prefers an org-specific row's FORMAT string. A per-org row with a
    // legacy/custom format would keep generating non-canonical IDs after this
    // migration, so every org-specific row for these entities is normalised to the
    // canonical pattern here (its counter is irrelevant — never used by generateId).
    const ALL_PATTERNS: Record<string, string> = { ...PATTERNS, Lead: "LEAD-{SEQ:6}", Document: "DOC-{SEQ:6}" };
    const orgRows = await client.query(
      `SELECT id, entity, pattern, organization_id FROM id_patterns
       WHERE organization_id IS NOT NULL AND entity = ANY($1::text[])`,
      [Object.keys(ALL_PATTERNS)]
    );
    for (const row of orgRows.rows) {
      const target = ALL_PATTERNS[row.entity];
      if (row.pattern !== target) {
        await client.query(`UPDATE id_patterns SET pattern=$1, updated_at=now() WHERE id=$2`, [target, row.id]);
        log("g", `id_patterns org-override normalised: entity=${row.entity} org=${row.organization_id} "${row.pattern}" -> "${target}"`);
      } else {
        log("g", `id_patterns org-override already canonical: entity=${row.entity} org=${row.organization_id}`);
      }
    }

    // ---------- (h) Validation queries V1–V9 (global scope) ----------
    log("h", "running validation queries...");

    // V1: strict pattern conformance — ZERO exceptions (Correction 9).
    for (const e of ENTITIES) {
      await expectZero(client, `V1 ${e.table}`, `SELECT COUNT(*) FROM ${e.table} WHERE id !~ '${e.canonicalRegex}'`);
    }
    await expectZero(client, "V1 leads", `SELECT COUNT(*) FROM leads WHERE id !~ '^LEAD-\\d{6}$'`);
    if (await tableExists(client, "documents")) {
      await expectZero(client, "V1 documents", `SELECT COUNT(*) FROM documents WHERE id !~ '^DOC-\\d{6}$'`);
    } else {
      log("WARN", "V1 documents: documents table not present in this database — skipped");
    }

    // V2: no legacy prefixes remain anywhere (global).
    await expectZero(client, "V2 accounts", `SELECT COUNT(*) FROM accounts WHERE id LIKE 'ACT-%'`);
    await expectZero(client, "V2 contacts", `SELECT COUNT(*) FROM contacts WHERE id LIKE 'CON-%' AND id NOT LIKE 'CONT-%'`);
    await expectZero(client, "V2 opportunities", `SELECT COUNT(*) FROM opportunities WHERE id LIKE 'Opp-%'`);
    await expectZero(client, "V2 activities", `SELECT COUNT(*) FROM activities WHERE id LIKE 'ACV-%'`);

    // V3: zero duplicates per table
    for (const e of ENTITIES) {
      await expectZeroRows(client, `V3 ${e.table}`, `SELECT id FROM ${e.table} GROUP BY id HAVING COUNT(*)>1`);
    }

    // V3b: zero Account/Activity cross-table ID overlap
    await expectZeroRows(client, "V3b account/activity overlap", `SELECT a.id FROM accounts a JOIN activities v ON v.id = a.id`);

    // V4: zero broken FKs — one check per dynamically discovered FK.
    for (const fk of fkRows) {
      if (fk.ref_column !== "id") continue;
      await expectZero(
        client,
        `V4 ${fk.src_table}.${fk.src_column}→${fk.ref_table}`,
        `SELECT COUNT(*) FROM ${fk.src_table} t LEFT JOIN ${fk.ref_table} p ON p.id = t.${fk.src_column}
         WHERE t.${fk.src_column} IS NOT NULL AND p.id IS NULL`
      );
    }

    // V5: zero active references to legacy IDs in soft columns (audit_logs intentionally excluded)
    const LEGACY_ID_RX = "^(CON-(?!T)|Opp-|ACV-)";
    for (const ref of SOFT_REFS) {
      if (!ref.typeColumn) continue; // fixed FK-backed columns covered by V4
      const label = `V5 ${ref.table}.${ref.column}`;
      if (!(await tableExists(client, ref.table)) || !(await columnExists(client, ref.table, ref.column))) continue;
      const acctVariants = TYPE_VARIANTS["Account"].map((v) => `'${v}'`).join(",");
      await expectZero(
        client,
        label,
        `SELECT COUNT(*) FROM ${ref.table}
         WHERE ${ref.column} ~ '${LEGACY_ID_RX}'
            OR (${ref.typeColumn}::text IN (${acctVariants}) AND ${ref.column} LIKE 'ACT-%')`
      );
    }

    // V5b: join-based completeness proof — after all updates, NO reference column
    // (discovered FK or declared soft-ref) may still hold ANY legacy ID present in
    // legacy_id_map, regardless of prefix shape or discriminator value. This catches
    // arbitrary malformed legacy IDs and rows skipped by unrecognised discriminators.
    for (const fk of fkRows) {
      if (fk.ref_column !== "id") continue;
      await expectZero(
        client,
        `V5b FK ${fk.src_table}.${fk.src_column} residual legacy refs`,
        `SELECT COUNT(*) FROM ${fk.src_table} WHERE ${fk.src_column} IN (SELECT legacy_id FROM legacy_id_map)`
      );
    }
    for (const ref of SOFT_REFS) {
      if (!(await tableExists(client, ref.table)) || !(await columnExists(client, ref.table, ref.column))) continue;
      await expectZero(
        client,
        `V5b ${ref.table}.${ref.column} residual legacy refs`,
        `SELECT COUNT(*) FROM ${ref.table} WHERE ${ref.column} IN (SELECT legacy_id FROM legacy_id_map)`
      );
    }

    // V6: id_patterns match canonical contract; counters are the dynamically computed values.
    const v6 = await client.query(`SELECT entity, pattern, counter, start_value FROM id_patterns WHERE organization_id IS NULL ORDER BY entity`);
    const v6Patterns: Record<string, string> = {
      ...PATTERNS,
      Document: "DOC-{SEQ:6}",
      Lead: "LEAD-{SEQ:6}",
    };
    for (const row of v6.rows) {
      const expPattern = v6Patterns[row.entity];
      if (!expPattern) throw new ValidationError(`V6: unexpected id_patterns entity ${row.entity}`);
      if (row.pattern !== expPattern) {
        throw new ValidationError(`V6 FAILED for ${row.entity}: pattern ${row.pattern} != expected ${expPattern}`);
      }
      if (row.entity in counters) {
        if (Number(row.counter) !== counters[row.entity] || Number(row.start_value) !== 1) {
          throw new ValidationError(
            `V6 FAILED for ${row.entity}: counter=${row.counter} start=${row.start_value}; expected counter=${counters[row.entity]} start=1`
          );
        }
      }
    }
    if (v6.rows.length !== 6) throw new ValidationError(`V6 FAILED: expected 6 global id_patterns rows, got ${v6.rows.length}`);
    log("V", `V6 PASS — id_patterns match canonical contract (counters: ${JSON.stringify(counters)})`);

    // V6b: NO org-specific override may carry a non-canonical format — generateId()
    // prefers the org row's format string, so a stray override would keep emitting
    // non-canonical IDs after this migration.
    const v6b = await client.query(
      `SELECT entity, pattern, organization_id FROM id_patterns
       WHERE organization_id IS NOT NULL AND entity = ANY($1::text[])`,
      [Object.keys(v6Patterns)]
    );
    for (const row of v6b.rows) {
      if (row.pattern !== v6Patterns[row.entity]) {
        throw new ValidationError(
          `V6b FAILED: org-specific id_patterns override (entity=${row.entity} org=${row.organization_id}) has non-canonical pattern "${row.pattern}"`
        );
      }
    }
    log("V", `V6b PASS — ${v6b.rows.length} org-specific id_patterns override(s), all canonical`);

    // V7: generator produces collision-free next ID.
    // generateId() (server/db.ts) post-increments the GLOBAL counter and emits
    //   sequenceNumber = start_value + (counter_after_increment - 1)
    //                  = start_value + counter_stored
    // so with the stored counter set to MAX(live seq) and start_value=1, the next
    // emitted sequence is exactly `start_value + counter` as probed below — the
    // real next generated ID, proven absent from the live tables.
    await expectZero(client, "V7 Account", `SELECT COUNT(*) FROM accounts WHERE id = 'ACCT-' || EXTRACT(YEAR FROM now())::int || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Account' AND organization_id IS NULL)::text,5,'0')`);
    await expectZero(client, "V7 Contact", `SELECT COUNT(*) FROM contacts WHERE id = 'CONT-' || to_char(now(),'YYMM') || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Contact' AND organization_id IS NULL)::text,5,'0')`);
    await expectZero(client, "V7 Opportunity", `SELECT COUNT(*) FROM opportunities WHERE id = 'OPP-' || EXTRACT(YEAR FROM now())::int || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Opportunity' AND organization_id IS NULL)::text,6,'0')`);
    await expectZero(client, "V7 Activity", `SELECT COUNT(*) FROM activities WHERE id = 'ACT-' || to_char(now(),'YYMM') || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Activity' AND organization_id IS NULL)::text,5,'0')`);
    await expectZero(client, "V7 Lead", `SELECT COUNT(*) FROM leads WHERE id = 'LEAD-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Lead' AND organization_id IS NULL)::text,6,'0')`);
    if (await tableExists(client, "documents")) {
      await expectZero(client, "V7 Document", `SELECT COUNT(*) FROM documents WHERE id = 'DOC-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Document' AND organization_id IS NULL)::text,6,'0')`);
    }
    // Stronger proof: the pattern counter is >= the max live sequence per entity,
    // so no future generated SEQ can repeat an existing one.
    for (const e of ENTITIES) {
      await expectZero(
        client,
        `V7b ${e.entity} counter >= max live seq`,
        `SELECT COUNT(*) FROM ${e.table}
         WHERE CAST(split_part(id,'-',3) AS int) >
               (SELECT counter FROM id_patterns WHERE entity='${e.entity}' AND organization_id IS NULL)`
      );
    }
    await expectZero(
      client,
      "V7b Lead counter >= max live seq",
      `SELECT COUNT(*) FROM leads
       WHERE id ~ '^LEAD-\\d{6}$' AND CAST(split_part(id,'-',2) AS int) >
             (SELECT counter FROM id_patterns WHERE entity='Lead' AND organization_id IS NULL)`
    );
    if (await tableExists(client, "documents")) {
      await expectZero(
        client,
        "V7b Document counter >= max live seq",
        `SELECT COUNT(*) FROM documents
         WHERE id ~ '^DOC-\\d{6}$' AND CAST(split_part(id,'-',2) AS int) >
               (SELECT counter FROM id_patterns WHERE entity='Document' AND organization_id IS NULL)`
      );
    }

    // V8: row counts unchanged (rename-only invariant) — compared to pre-transaction snapshot.
    for (const e of ENTITIES) {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${e.table}`);
      if (Number(r.rows[0].n) !== preCounts[e.table]) {
        throw new ValidationError(`V8 FAILED: ${e.table} count ${r.rows[0].n} != pre-migration ${preCounts[e.table]}`);
      }
    }
    log("V", `V8 PASS — row counts unchanged (${JSON.stringify(preCounts)})`);

    // V9: legacy_id_map completeness — mapping rows must equal the actual PK-update
    // row counts captured in step (d) (Correction 10; no hardcoded expectations).
    const v9 = await client.query(`SELECT entity, COUNT(*)::int AS n FROM legacy_id_map GROUP BY entity ORDER BY entity`);
    for (const e of ENTITIES) {
      const row = v9.rows.find((r) => r.entity === e.entity);
      const n = row ? Number(row.n) : 0;
      if (n !== pkCounts[e.entity]) {
        throw new ValidationError(`V9 FAILED: legacy_id_map ${e.entity} count ${n} != PK-update rowCount ${pkCounts[e.entity]}`);
      }
    }
    log("V", `V9 PASS — legacy_id_map counts equal PK-update counts (${v9.rows.map((r) => `${r.entity}=${r.n}`).join(", ")})`);

    // ---------- (i) Restore constraint timing ----------
    await client.query(`SET CONSTRAINTS ALL IMMEDIATE`); // re-checks all FKs; throws if broken
    log("i", "SET CONSTRAINTS ALL IMMEDIATE — all deferred FKs re-checked OK");
    for (const [table, constraint] of madeDeferrable) {
      await client.query(`ALTER TABLE ${table} ALTER CONSTRAINT ${constraint} NOT DEFERRABLE`);
      log("i", `ALTER TABLE ${table} ALTER CONSTRAINT ${constraint} NOT DEFERRABLE`);
    }

    // ---------- First post-migration IDs (SEQ = start_value + counter) ----------
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
      // Precondition 2 enforcement: verify no other connections are active on this
      // database immediately before COMMIT (application writes must be stopped).
      const act = await client.query(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'`
      );
      if (Number(act.rows[0].n) > 0) {
        throw new ValidationError(
          `LIVE run refused at COMMIT: ${act.rows[0].n} other active connection(s) on this database — application writes are not stopped`
        );
      }
      log("PRE-COMMIT", "no other active connections — maintenance window confirmed");
      await client.query("COMMIT");
      inTx = false;
      log("COMMIT", "transaction committed — migration is LIVE");
    } else {
      await client.query("ROLLBACK");
      inTx = false;
      log("ROLLBACK", "dry-run complete — transaction rolled back, zero production state change");
    }

    const elapsedMs = Date.now() - t0;

    // ---------- Summary (self-describing; counts come from the actual run) ----------
    summary.push("");
    summary.push("=".repeat(78));
    summary.push(`MIGRATION SUMMARY (${live ? "COMMITTED" : "DRY-RUN / ROLLED BACK"}) — GLOBAL SCOPE`);
    summary.push("=".repeat(78));
    summary.push("Rows renamed per entity:");
    for (const e of ENTITIES) {
      summary.push(`  ${e.table.padEnd(15)} ${String(pkCounts[e.entity]).padStart(5)}   (${mapCounts[e.entity]} mapped)`);
    }
    summary.push("Reference rows updated per column (FK + soft):");
    for (const [label, n] of Object.entries(refCounts)) {
      if (n > 0) summary.push(`  ${label.padEnd(45)} ${n}`);
    }
    summary.push("Computed id_patterns counters (MAX of live canonical sequences):");
    for (const [entity, n] of Object.entries(counters)) summary.push(`  ${entity.padEnd(12)} ${n}`);
    summary.push("legacy_id_map row counts per entity:");
    for (const [entity, n] of Object.entries(mapCounts)) summary.push(`  ${entity.padEnd(12)} ${n}`);
    summary.push("First post-migration ID per entity (SEQ = start_value + counter):");
    for (const r of nextIds.rows) summary.push(`  ${String(r.entity).padEnd(12)} ${r.next_id}`);
    summary.push(`Total transaction wall-clock time: ${(elapsedMs / 1000).toFixed(2)}s`);
    summary.push("=".repeat(78));
    console.log(summary.join("\n"));

    // ---------- Persist run report (dry-run evidence for the --live gate) ----------
    if (!live) {
      if (!process.env.SESSION_SECRET) {
        log("WARN", "SESSION_SECRET not set — the dry-run report cannot be signed and a --live run will not accept it");
      }
      const report: Record<string, unknown> = {
        result: "success",
        mode: "dry-run",
        runAt: new Date().toISOString(),
        dbIdentity,
        inputChecksum,
        htOrgId,
        fkInventory: fkRows,
        mapCounts,
        pkCounts,
        refCounts,
        counters,
        preCounts,
        nextIds: nextIds.rows,
        elapsedMs,
      };
      if (process.env.SESSION_SECRET) {
        report.mac = computeReportMac(report, process.env.SESSION_SECRET);
      }
      fs.writeFileSync(DRYRUN_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
      log("REPORT", `dry-run report written to ${DRYRUN_REPORT_PATH} (required evidence for a --live run)`);
    }

    client.release();
    await pool.end();
  } catch (e: any) {
    // Any in-transaction failure (SQL error, assertion, validation) → explicit ROLLBACK.
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
