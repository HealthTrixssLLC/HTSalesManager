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

// An existing id_patterns row's counter only counts toward the high-water mark
// when its pattern is in the same prefix/format family as the target canonical
// pattern — i.e. its generated IDs share the target's prefix, so its counter
// tracks sequences of the same identity space. A counter for a differently
// prefixed legacy pattern (e.g. "ACT-..." for accounts) counts sequences of IDs
// that are being renamed away and must NOT inflate the new counter.
export function isCompatiblePattern(existingPattern: string | null | undefined, targetPattern: string): boolean {
  if (!existingPattern) return false;
  const prefixOf = (p: string) => p.split(/[-{]/, 1)[0];
  const target = prefixOf(targetPattern);
  return target.length > 0 && prefixOf(existingPattern) === target;
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
