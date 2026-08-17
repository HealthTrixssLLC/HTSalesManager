// Dry-run evidence gate for the canonical ID migration (--live safety).
//
// A --live run must present evidence that a successful --dry-run was executed
// against the SAME database on the SAME migration input, recently. The evidence
// is a JSON report written by the dry-run and AUTHENTICATED with an HMAC-SHA256
// over its canonical serialization, keyed by a protected deployment secret
// (SESSION_SECRET). A report fabricated or modified without the secret fails
// verification, so `--live` cannot be satisfied without actually completing a
// dry-run in an environment holding the secret.
//
// This module holds the pure logic so it can be unit-tested against forged,
// foreign, stale, tampered, and same-target-fabricated reports.

import * as crypto from "crypto";

export interface DbIdentity {
  systemIdentifier: string; // pg_control_system().system_identifier (or "unavailable")
  database: string; // current_database()
  host: string; // inet_server_addr() or "local"
}

export interface DryRunEvidence {
  result: string; // "success"
  mode: string; // "dry-run"
  runAt: string; // ISO timestamp
  dbIdentity: DbIdentity;
  htOrgId: string;
  inputChecksum: string; // sha256 checksum of migration input
  mac?: string; // HMAC-SHA256 over the canonical report (all fields except mac)
  [k: string]: unknown;
}

export interface CurrentTarget {
  dbIdentity: DbIdentity;
  htOrgId: string;
  inputChecksum: string;
}

export const DRYRUN_MAX_AGE_MS = 24 * 3600 * 1000;

export interface GateResult {
  ok: boolean;
  reason?: string;
}

// Deterministic serialization: object keys sorted recursively, arrays in order.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

// HMAC-SHA256 over the canonical report with the mac field removed.
export function computeReportMac(report: Record<string, unknown>, secret: string): string {
  const { mac: _drop, ...rest } = report;
  return crypto.createHmac("sha256", secret).update(stableStringify(rest)).digest("hex");
}

export function verifyDryRunReport(
  report: unknown,
  current: CurrentTarget,
  nowMs: number,
  secret: string,
  maxAgeMs: number = DRYRUN_MAX_AGE_MS
): GateResult {
  const fail = (reason: string): GateResult => ({ ok: false, reason });
  if (!secret || secret.length === 0) return fail("no signing secret available to verify the report (SESSION_SECRET must be set)");
  if (typeof report !== "object" || report === null || Array.isArray(report)) return fail("report is not an object");
  const r = report as Partial<DryRunEvidence>;

  // Authenticated provenance first: a report without a valid HMAC proves nothing.
  if (typeof r.mac !== "string" || r.mac.length === 0) return fail("report carries no mac — it was not produced by an authenticated dry-run");
  const expected = computeReportMac(r as Record<string, unknown>, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(r.mac, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return fail("report mac verification failed — the report was fabricated or modified after the dry-run");
  }

  if (r.result !== "success") return fail(`report result is "${r.result}", not "success"`);
  if (r.mode !== "dry-run") return fail(`report mode is "${r.mode}", not "dry-run"`);
  if (typeof r.runAt !== "string") return fail("report has no runAt timestamp");
  const t = Date.parse(r.runAt);
  if (Number.isNaN(t)) return fail(`report runAt "${r.runAt}" is not a valid timestamp`);
  const age = nowMs - t;
  if (age < 0) return fail(`report runAt "${r.runAt}" is in the future`);
  if (age >= maxAgeMs) return fail(`report is stale: ${(age / 3600000).toFixed(1)}h old (max ${(maxAgeMs / 3600000).toFixed(0)}h)`);
  const id = r.dbIdentity;
  if (!id || typeof id !== "object") return fail("report has no dbIdentity");
  for (const key of ["systemIdentifier", "database", "host"] as const) {
    if (id[key] !== current.dbIdentity[key]) {
      return fail(`dbIdentity.${key} mismatch: report "${id[key]}" != current "${current.dbIdentity[key]}" — the dry-run was NOT against this database`);
    }
  }
  if (r.htOrgId !== current.htOrgId) {
    return fail(`htOrgId mismatch: report "${r.htOrgId}" != current "${current.htOrgId}"`);
  }
  if (typeof r.inputChecksum !== "string" || r.inputChecksum.length === 0) {
    return fail("report has no inputChecksum");
  }
  if (r.inputChecksum !== current.inputChecksum) {
    return fail(
      `inputChecksum mismatch: report ${r.inputChecksum} != current ${current.inputChecksum} — the database content changed since the dry-run (or the dry-run ran elsewhere); run a fresh --dry-run against this target`
    );
  }
  return { ok: true };
}
