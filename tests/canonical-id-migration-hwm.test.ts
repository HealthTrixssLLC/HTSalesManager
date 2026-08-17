// Unit tests for the Task 220 hardening of the canonical ID migration:
// multi-source counter high-water mark (deleted/previously-issued IDs are never
// reused) and checksum invalidation when id_patterns state or reference values
// change between dry-run and live.
import { describe, it, expect } from "vitest";
import {
  computeFinalCounter,
  computeAllocationBase,
  isCompatiblePattern,
  combineChecksumParts,
  idPatternRowRepr,
  assertExactlyOneGlobalRow,
  assertGlobalUpdateRowCount,
} from "../scripts/canonical-id-migration-hwm";
import { verifyDryRunReport, computeReportMac } from "../scripts/canonical-id-migration-gate";
import * as crypto from "crypto";

describe("computeFinalCounter (multi-source high-water mark)", () => {
  it("existing generator HWM beats a lower live MAX — a deleted historical ID is never reused", () => {
    // A canonical ID up to seq 120 was issued; the record holding 120 was deleted,
    // so the live table MAX is only 100 — but the generator counter remembers 120.
    expect(
      computeFinalCounter({ liveMax: 100, migrationMax: 90, existingGeneratorHighWater: 120, historicalCanonicalMax: 0 })
    ).toBe(120);
  });

  it("migration MAX beats an old generator counter when necessary", () => {
    expect(
      computeFinalCounter({ liveMax: 100, migrationMax: 150, existingGeneratorHighWater: 40, historicalCanonicalMax: 0 })
    ).toBe(150);
  });

  it("historical canonical MAX beats all lower values", () => {
    expect(
      computeFinalCounter({ liveMax: 10, migrationMax: 20, existingGeneratorHighWater: 30, historicalCanonicalMax: 999 })
    ).toBe(999);
  });

  it("plain live MAX wins when it is the highest (baseline behaviour preserved)", () => {
    expect(
      computeFinalCounter({ liveMax: 55, migrationMax: 55, existingGeneratorHighWater: 12, historicalCanonicalMax: 3 })
    ).toBe(55);
  });

  it("rejects negative or non-integer inputs", () => {
    expect(() =>
      computeFinalCounter({ liveMax: -1, migrationMax: 0, existingGeneratorHighWater: 0, historicalCanonicalMax: 0 })
    ).toThrow();
    expect(() =>
      computeFinalCounter({ liveMax: 1.5, migrationMax: 0, existingGeneratorHighWater: 0, historicalCanonicalMax: 0 })
    ).toThrow();
    expect(() =>
      computeFinalCounter({ liveMax: NaN, migrationMax: 0, existingGeneratorHighWater: 0, historicalCanonicalMax: 0 })
    ).toThrow();
  });
});

describe("computeAllocationBase (step (c) legacy_id_map numbering base)", () => {
  // Mirrors the migration's step (c) allocation:
  //   canonical seq = base + ROW_NUMBER() OVER (ORDER BY created_at, id)
  const allocate = (base: number, n: number) => Array.from({ length: n }, (_, i) => base + i + 1);

  it("generator HWM above live max: first migrated IDs are allocated ABOVE the deleted-ID range", () => {
    // Live canonical rows only reach 100, but the compatible generator counter
    // proves IDs through 120 were issued (some since deleted). Migrated rows
    // must start at 121 — never reusing 101..120.
    const base = computeAllocationBase({ liveMax: 100, existingGeneratorHighWater: 120, historicalCanonicalMax: 0 });
    expect(base).toBe(120);
    const seqs = allocate(base, 3);
    expect(seqs).toEqual([121, 122, 123]);
    expect(Math.min(...seqs)).toBeGreaterThan(120);
  });

  it("historical canonical max above live and generator: allocation starts above audit history", () => {
    const base = computeAllocationBase({ liveMax: 50, existingGeneratorHighWater: 60, historicalCanonicalMax: 200 });
    expect(base).toBe(200);
    expect(allocate(base, 2)).toEqual([201, 202]);
  });

  it("live max wins when highest (baseline allocation preserved)", () => {
    const base = computeAllocationBase({ liveMax: 300, existingGeneratorHighWater: 10, historicalCanonicalMax: 5 });
    expect(base).toBe(300);
    expect(allocate(base, 1)).toEqual([301]);
  });

  it("allocation base then feeds MIGRATION_MAX so FINAL_COUNTER covers all migrated IDs", () => {
    const base = computeAllocationBase({ liveMax: 100, existingGeneratorHighWater: 120, historicalCanonicalMax: 0 });
    const migrationMax = Math.max(...allocate(base, 5)); // 125
    expect(
      computeFinalCounter({ liveMax: 125, migrationMax, existingGeneratorHighWater: 120, historicalCanonicalMax: 0 })
    ).toBe(125);
  });
});

describe("isCompatiblePattern (generator counter eligibility)", () => {
  it("accepts exact canonical-pattern equality for all six entity patterns", () => {
    expect(isCompatiblePattern("ACCT-{YYYY}-{SEQ:5}", "ACCT-{YYYY}-{SEQ:5}")).toBe(true);
    expect(isCompatiblePattern("CONT-{YY}{MM}-{SEQ:5}", "CONT-{YY}{MM}-{SEQ:5}")).toBe(true);
    expect(isCompatiblePattern("OPP-{YYYY}-{SEQ:6}", "OPP-{YYYY}-{SEQ:6}")).toBe(true);
    expect(isCompatiblePattern("ACT-{YY}{MM}-{SEQ:5}", "ACT-{YY}{MM}-{SEQ:5}")).toBe(true);
    expect(isCompatiblePattern("LEAD-{SEQ:6}", "LEAD-{SEQ:6}")).toBe(true);
    expect(isCompatiblePattern("DOC-{SEQ:6}", "DOC-{SEQ:6}")).toBe(true);
  });

  it("rejects a same-prefix but different-format variant — NOT a proven compatible sequence namespace", () => {
    // ACCT-{YY}-{SEQ:4} uses a different date granularity and sequence width
    // from ACCT-{YYYY}-{SEQ:5}. Prefix match alone does not prove same namespace.
    expect(isCompatiblePattern("ACCT-{YY}-{SEQ:4}", "ACCT-{YYYY}-{SEQ:5}")).toBe(false);
    expect(isCompatiblePattern("CONT-{YY}-{SEQ:4}", "CONT-{YY}{MM}-{SEQ:5}")).toBe(false);
    expect(isCompatiblePattern("OPP-{YYYY}-{SEQ:4}", "OPP-{YYYY}-{SEQ:6}")).toBe(false);
    expect(isCompatiblePattern("ACT-{YYYY}-{SEQ:5}", "ACT-{YY}{MM}-{SEQ:5}")).toBe(false);
    expect(isCompatiblePattern("LEAD-{SEQ:5}", "LEAD-{SEQ:6}")).toBe(false);
  });

  it("rejects a different prefix family (legacy pattern counters must not carry over)", () => {
    expect(isCompatiblePattern("ACT-{SEQ:4}", "ACCT-{YYYY}-{SEQ:5}")).toBe(false); // legacy account prefix
    expect(isCompatiblePattern("CON-{SEQ:4}", "CONT-{YY}{MM}-{SEQ:5}")).toBe(false);
    expect(isCompatiblePattern("Opp-{SEQ:4}", "OPP-{YYYY}-{SEQ:6}")).toBe(false); // case-sensitive
  });

  it("rejects null/empty existing patterns", () => {
    expect(isCompatiblePattern(null, "ACCT-{YYYY}-{SEQ:5}")).toBe(false);
    expect(isCompatiblePattern(undefined, "ACCT-{YYYY}-{SEQ:5}")).toBe(false);
    expect(isCompatiblePattern("", "ACCT-{YYYY}-{SEQ:5}")).toBe(false);
  });
});

describe("assertExactlyOneGlobalRow (pre-migration id_patterns invariant)", () => {
  it("count === 1 — PASS (invariant satisfied)", () => {
    expect(() => assertExactlyOneGlobalRow("Account", 1)).not.toThrow();
    expect(() => assertExactlyOneGlobalRow("Lead", 1)).not.toThrow();
  });

  it("count === 0 (missing global row) — FAIL", () => {
    expect(() => assertExactlyOneGlobalRow("Account", 0)).toThrow(/0 global row/);
    expect(() => assertExactlyOneGlobalRow("Contact", 0)).toThrow(/Contact/);
  });

  it("count === 2 (duplicate global rows) — FAIL", () => {
    expect(() => assertExactlyOneGlobalRow("Opportunity", 2)).toThrow(/2 global row/);
    expect(() => assertExactlyOneGlobalRow("Activity", 3)).toThrow(/Activity/);
  });

  it("error message names the entity and the offending count", () => {
    const err = (() => {
      try { assertExactlyOneGlobalRow("Lead", 0); }
      catch (e: any) { return e.message; }
    })();
    expect(err).toMatch(/Lead/);
    expect(err).toMatch(/0/);
  });
});

describe("assertGlobalUpdateRowCount (per-UPDATE id_patterns invariant)", () => {
  it("rowCount === 1 — PASS", () => {
    expect(() => assertGlobalUpdateRowCount("Account", 1)).not.toThrow();
    expect(() => assertGlobalUpdateRowCount("Document", 1)).not.toThrow();
  });

  it("rowCount === 0 (missing row, UPDATE hit nothing) — FAIL", () => {
    expect(() => assertGlobalUpdateRowCount("Account", 0)).toThrow(/0/);
    expect(() => assertGlobalUpdateRowCount("Lead", 0)).toThrow(/Lead/);
  });

  it("rowCount === 2 (duplicate rows updated simultaneously) — FAIL", () => {
    expect(() => assertGlobalUpdateRowCount("Opportunity", 2)).toThrow(/2/);
  });

  it("error message names the entity and the actual rowCount", () => {
    const err = (() => {
      try { assertGlobalUpdateRowCount("Activity", 0); }
      catch (e: any) { return e.message; }
    })();
    expect(err).toMatch(/Activity/);
    expect(err).toMatch(/0/);
  });
});

// ---------------------------------------------------------------------------
// Checksum invalidation: simulate the checksum input parts exactly as the
// migration script builds them and verify that a change to a reference-column
// value or an id_patterns row produces a different checksum, which the --live
// gate then rejects as an inputChecksum mismatch.
// ---------------------------------------------------------------------------
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function buildParts(opts: { fkValues: string[]; patternRows: Parameters<typeof idPatternRowRepr>[0][] }): string[] {
  const parts: string[] = ["Account:somehash:3:canonhash:55"]; // per-entity part (constant here)
  const patRepr = opts.patternRows.map(idPatternRowRepr).join(";");
  parts.push(`id_patterns:${sha(patRepr)}:${opts.patternRows.length}`);
  const sorted = [...opts.fkValues].sort();
  parts.push(`fk:activities.account_id:${sha(sorted.join(","))}:${sorted.length}`);
  return parts;
}

const basePatternRows = [
  { entity: "Account", pattern: "ACCT-{YYYY}-{SEQ:5}", counter: 55, start_value: 1, last_issued: null, organization_id: null },
  { entity: "Lead", pattern: "LEAD-{SEQ:6}", counter: 9, start_value: 1, last_issued: null, organization_id: null },
];

describe("checksum invalidation between dry-run and live", () => {
  const NOW = Date.parse("2026-08-17T12:00:00Z");
  const SECRET = "test-signing-secret";
  const dbIdentity = { systemIdentifier: "7001", database: "proddb", host: "10.0.0.5/32" };
  const htOrgId = "3e369484-0c88-401d-86e3-9c3361ee465e";

  const gateRejects = (dryRunChecksum: string, liveChecksum: string) => {
    const report: Record<string, unknown> = {
      result: "success",
      mode: "dry-run",
      runAt: new Date(NOW - 3600_000).toISOString(),
      dbIdentity,
      htOrgId,
      inputChecksum: dryRunChecksum,
    };
    report.mac = computeReportMac(report, SECRET);
    return verifyDryRunReport(report, { dbIdentity, htOrgId, inputChecksum: liveChecksum }, NOW, SECRET);
  };

  it("a reference-column value change produces a different checksum and the gate rejects the report", () => {
    const dryRun = combineChecksumParts(buildParts({ fkValues: ["ACT-2091", "ACT-2098"], patternRows: basePatternRows }));
    const live = combineChecksumParts(buildParts({ fkValues: ["ACT-2091", "ACT-2103"], patternRows: basePatternRows }));
    expect(live).not.toBe(dryRun);
    const res = gateRejects(dryRun, live);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/inputChecksum/);
  });

  it("an id_patterns row change (counter bump) produces a different checksum and the gate rejects the report", () => {
    const dryRun = combineChecksumParts(buildParts({ fkValues: ["ACT-2091"], patternRows: basePatternRows }));
    const bumped = basePatternRows.map((r) => (r.entity === "Lead" ? { ...r, counter: 10 } : r));
    const live = combineChecksumParts(buildParts({ fkValues: ["ACT-2091"], patternRows: bumped }));
    expect(live).not.toBe(dryRun);
    const res = gateRejects(dryRun, live);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/inputChecksum/);
  });

  it("an id_patterns pattern or last_issued change also changes the checksum", () => {
    const base = combineChecksumParts(buildParts({ fkValues: [], patternRows: basePatternRows }));
    const patternChanged = basePatternRows.map((r) =>
      r.entity === "Account" ? { ...r, pattern: "ACCT-{SEQ:5}" } : r
    );
    const lastIssuedChanged = basePatternRows.map((r) =>
      r.entity === "Account" ? { ...r, last_issued: "ACCT-2026-00055" } : r
    );
    expect(combineChecksumParts(buildParts({ fkValues: [], patternRows: patternChanged }))).not.toBe(base);
    expect(combineChecksumParts(buildParts({ fkValues: [], patternRows: lastIssuedChanged }))).not.toBe(base);
  });

  it("identical inputs produce an identical checksum and the gate accepts", () => {
    const dryRun = combineChecksumParts(buildParts({ fkValues: ["ACT-2091"], patternRows: basePatternRows }));
    const live = combineChecksumParts(buildParts({ fkValues: ["ACT-2091"], patternRows: basePatternRows }));
    expect(live).toBe(dryRun);
    expect(gateRejects(dryRun, live)).toEqual({ ok: true });
  });
});
