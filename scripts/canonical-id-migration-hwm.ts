// Pure high-water-mark and checksum-combination logic for the canonical ID
// migration (Task 220). Extracted from scripts/run-canonical-id-migration.ts so
// the counter guarantee and checksum invalidation behaviour are unit-testable
// without a database.

import * as crypto from "crypto";

export interface HighWaterInputs {
  liveMax: number; // MAX(sequence) from post-rename live canonical rows
  migrationMax: number; // MAX(sequence) across canonical IDs written by this migration
  existingGeneratorHighWater: number; // current id_patterns.counter (0 if pattern incompatible)
  historicalCanonicalMax: number; // MAX(sequence) found in audit/history tables
}

export interface HighWaterRow extends HighWaterInputs {
  finalCounter: number;
}

// FINAL_COUNTER = MAX of all four sources. Every source is a lower bound on
// sequences that were ever (or could ever have been) issued, so taking the MAX
// guarantees the next generated ID cannot collide with any live, migrated,
// previously-issued (including deleted), or historically recorded ID.
export function computeFinalCounter(i: HighWaterInputs): number {
  for (const [k, v] of Object.entries(i)) {
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      throw new Error(`high-water input ${k} must be a non-negative integer, got ${v}`);
    }
  }
  return Math.max(i.liveMax, i.migrationMax, i.existingGeneratorHighWater, i.historicalCanonicalMax);
}

// Allocation base for step (c) legacy_id_map numbering: new canonical sequences
// must start ABOVE every sequence ever issued — live canonical rows, a
// compatible generator counter (covers IDs issued to since-deleted records),
// and canonical IDs recorded in audit history. MIGRATION_MAX then naturally
// extends this base, so no migrated ID can reuse a previously issued one.
export function computeAllocationBase(i: {
  liveMax: number;
  existingGeneratorHighWater: number;
  historicalCanonicalMax: number;
}): number {
  return computeFinalCounter({ ...i, migrationMax: 0 });
}

// An existing id_patterns row's counter contributes to the high-water mark ONLY
// when its pattern is exactly equal to the canonical target pattern — i.e. the
// generator was already producing IDs in the same format as the target and its
// counter directly tracks sequences in the same namespace.
//
// A different-format variant of the same prefix (e.g. ACCT-{YY}-{SEQ:4} vs
// ACCT-{YYYY}-{SEQ:5}) uses a different date segment and/or sequence width and
// is NOT assumed to share the target's monotonically increasing sequence
// namespace.  A historical pattern may be added to an explicit whitelist only
// when it has been proven — not inferred — to share that namespace.
//
// Currently no historical patterns are whitelisted.
export function isCompatiblePattern(existingPattern: string | null | undefined, targetPattern: string): boolean {
  if (!existingPattern) return false;
  // Exact pattern equality is the only guaranteed-compatible relationship.
  if (existingPattern === targetPattern) return true;
  // Explicit whitelist of historically proven same-namespace patterns.
  // (None at this time — do not add entries here without proof.)
  const WHITELIST: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  const targets = WHITELIST.get(targetPattern);
  return targets !== undefined && targets.has(existingPattern);
}

// ---------------------------------------------------------------------------
// Invariant assertion helpers — used by the migration script's pre-migration
// validation and per-UPDATE checks. Both throw on violation; any thrown error
// inside the migration's transaction triggers an explicit ROLLBACK.
// ---------------------------------------------------------------------------

/**
 * Assert that the given count of global id_patterns rows for `entity` is
 * exactly 1.  Called before the migration begins — hard-fails on missing
 * (count 0) or duplicate (count > 1) global rows.  The migration must not
 * manufacture a missing row or choose between duplicates.
 */
export function assertExactlyOneGlobalRow(entity: string, count: number): void {
  if (count !== 1) {
    throw new Error(
      `PRE-MIGRATION INVARIANT VIOLATED: id_patterns has ${count} global row(s) ` +
      `(organization_id IS NULL) for entity "${entity}" (expected exactly 1). ` +
      `The migration must not manufacture a missing row or choose between ` +
      `duplicates. Resolve this manually before running the migration.`
    );
  }
}

/**
 * Assert that a global id_patterns UPDATE affected exactly 1 row.
 * rowCount 0 means the global row is missing; rowCount > 1 means duplicates
 * exist — both are hard failures that must trigger ROLLBACK.
 */
export function assertGlobalUpdateRowCount(entity: string, rowCount: number): void {
  if (rowCount !== 1) {
    throw new Error(
      `id_patterns global UPDATE invariant violated for entity "${entity}": ` +
      `expected rowCount 1, got ${rowCount}. ` +
      `rowCount 0 = missing global row; rowCount > 1 = duplicate global rows. ` +
      `Both are hard failures — transaction must be rolled back.`
    );
  }
}

// Deterministic combination of checksum input parts into the final SHA-256.
// Any change to any part (per-entity ID sets, id_patterns state, FK reference
// values, soft-reference values) changes the digest, invalidating stale
// dry-run evidence at the --live gate.
export function combineChecksumParts(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

// Canonical single-line representation of an id_patterns row for hashing.
export function idPatternRowRepr(row: {
  entity: string;
  pattern: string | null;
  counter: number | string | null;
  start_value: number | string | null;
  last_issued: string | null;
  organization_id: string | null;
}): string {
  return [
    row.organization_id ?? "GLOBAL",
    row.entity,
    row.pattern ?? "",
    String(row.counter ?? ""),
    String(row.start_value ?? ""),
    row.last_issued ?? "",
  ].join("~");
}
