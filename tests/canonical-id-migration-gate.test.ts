// Unit tests for the canonical ID migration --live dry-run evidence gate:
// forged, foreign, stale, tampered, and same-target-fabricated reports must all
// be rejected; only an HMAC-authenticated, fresh, same-target report passes.
import { describe, it, expect } from "vitest";
import { verifyDryRunReport, computeReportMac, DRYRUN_MAX_AGE_MS } from "../scripts/canonical-id-migration-gate";

const NOW = Date.parse("2026-08-17T12:00:00Z");
const SECRET = "test-signing-secret";
const current = {
  dbIdentity: { systemIdentifier: "7001234567890123456", database: "proddb", host: "10.0.0.5/32" },
  htOrgId: "3e369484-0c88-401d-86e3-9c3361ee465e",
  inputChecksum: "abc123def456",
};
const signed = (overrides: Record<string, unknown> = {}) => {
  const base: Record<string, unknown> = {
    result: "success",
    mode: "dry-run",
    runAt: new Date(NOW - 3600_000).toISOString(), // 1h old
    dbIdentity: { ...current.dbIdentity },
    htOrgId: current.htOrgId,
    inputChecksum: current.inputChecksum,
    ...overrides,
  };
  base.mac = computeReportMac(base, SECRET);
  return base as any;
};

describe("verifyDryRunReport", () => {
  it("accepts a valid, signed, fresh, same-target report", () => {
    expect(verifyDryRunReport(signed(), current, NOW, SECRET)).toEqual({ ok: true });
  });

  it("rejects a fabricated same-target report with no mac", () => {
    const forged = signed();
    delete forged.mac;
    const res = verifyDryRunReport(forged, current, NOW, SECRET);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no mac/);
  });

  it("rejects a same-target report signed with the wrong secret", () => {
    const base = signed();
    base.mac = computeReportMac(base, "attacker-guess");
    const res = verifyDryRunReport(base, current, NOW, SECRET);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/mac verification failed/);
  });

  it("rejects a validly-signed report that was modified afterwards", () => {
    const tampered = signed();
    tampered.runAt = new Date(NOW - 60_000).toISOString(); // freshen timestamp post-signing
    const res = verifyDryRunReport(tampered, current, NOW, SECRET);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/mac verification failed/);
  });

  it("rejects everything when no signing secret is available", () => {
    const res = verifyDryRunReport(signed(), current, NOW, "");
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no signing secret/);
  });

  it("rejects non-object and empty reports", () => {
    for (const bad of [null, undefined, "success", 42, []]) {
      expect(verifyDryRunReport(bad as any, current, NOW, SECRET).ok).toBe(false);
    }
  });

  it("rejects signed reports without result=success or mode=dry-run", () => {
    expect(verifyDryRunReport(signed({ result: "failed" }), current, NOW, SECRET).ok).toBe(false);
    expect(verifyDryRunReport(signed({ mode: "live" }), current, NOW, SECRET).ok).toBe(false);
  });

  it("rejects stale, future, and unparseable timestamps (even when signed)", () => {
    const stale = signed({ runAt: new Date(NOW - DRYRUN_MAX_AGE_MS - 1).toISOString() });
    expect(verifyDryRunReport(stale, current, NOW, SECRET).reason).toMatch(/stale/);
    const future = signed({ runAt: new Date(NOW + 60_000).toISOString() });
    expect(verifyDryRunReport(future, current, NOW, SECRET).reason).toMatch(/future/);
    expect(verifyDryRunReport(signed({ runAt: "not-a-date" }), current, NOW, SECRET).ok).toBe(false);
  });

  it("rejects a signed report from a different database (any identity component)", () => {
    for (const key of ["systemIdentifier", "database", "host"] as const) {
      const r = signed({ dbIdentity: { ...current.dbIdentity, [key]: "other-" + key } });
      const res = verifyDryRunReport(r, current, NOW, SECRET);
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(new RegExp(`dbIdentity\\.${key}`));
    }
  });

  it("rejects a signed fingerprint (HT org) mismatch", () => {
    const res = verifyDryRunReport(signed({ htOrgId: "00000000-0000-0000-0000-000000000000" }), current, NOW, SECRET);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/htOrgId/);
  });

  it("rejects a signed but changed migration-input checksum", () => {
    const res = verifyDryRunReport(signed({ inputChecksum: "deadbeef" }), current, NOW, SECRET);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/inputChecksum/);
  });
});
