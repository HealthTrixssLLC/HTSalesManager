# Canonical ID Audit — ACT-* / ACCT-* Collision (Task 204)

**Date:** 2026-08-17 · **Scope:** READ-ONLY audit of the production database
(`NEON_DATABASE_URL`) plus code/documentation cross-check. No data, schema, or
code was modified. All queries are preserved in
`scripts/canonical-id-audit.ts`, `scripts/canonical-id-audit2.ts`,
`scripts/canonical-id-audit3.ts` (SELECT-only).

> **Headline finding:** the situation is *different* from the task premise.
> Production Accounts do use `ACT-*`, but production **Activities use `ACV-*`,
> not `ACT-*`** — so there is **zero cross-table ID collision today**. The real
> problem is that the production `id_patterns` rows (`ACT-{SEQ:4}` for Account,
> `ACV-{YY}{MM}-{SEQ:5}` for Activity) disagree with both the code defaults and
> the documented API contract (`ACCT-*` / `ACT-*`). Because `generateId()`
> always prefers the DB pattern row over the code default, **new Accounts
> created in production today still receive `ACT-*` IDs**, and new Activities
> receive `ACV-*` IDs. The namespace ambiguity for AI/MCP tools is therefore a
> *contract drift* problem, not (yet) a data-collision problem — but it becomes
> a collision problem the moment the Activity pattern row is "corrected" to
> `ACT-*` without first migrating Accounts.

---

## 1. Account ID Counts

| Metric | Value |
|---|---|
| Total accounts | **41** |
| Using `ACT-*` | **41** (100%) |
| Using `ACCT-*` | **0** |
| Any other pattern | **0** |

Representative `ACT-*` records:

| id | name | created_at |
|---|---|---|
| ACT-1000 | Health Trixss LLC | 2025-11-24 |
| ACT-1001 | Medecision | 2025-11-24 |
| ACT-1002 | Easy Health | 2025-11-24 |
| ACT-1003 | Multiplan | 2025-11-24 |
| ACT-1005 | TPL Claims | 2025-11-24 |

ID range: `ACT-1000` … `ACT-1041` (all rows imported 2025-11-24).

**Do newly-created Accounts receive `ACCT-*` today? — NO.**
`generateId()` (`server/db.ts:900–968`) resolves the *global `id_patterns`
row first* and only falls back to the code default (`ACCT-{YYYY}-{SEQ:5}`,
`server/db.ts:902`) when no row exists. The production row exists and is
`ACT-{SEQ:4}` (see §6), so a new production Account would be issued
`ACT-2085`-style ID (last issued: `ACT-2084`). The `ACCT-*` default only
applies in fresh databases.

Historical note: `audit_logs` contains `create` events for `ACCT-1043`…
`ACCT-1047` (2025-10-31) — `ACCT-*` accounts existed briefly and were deleted
before the 2025-11-24 import; none survive.

The task's reference records `ACT-2098` / `ACT-2103` (Cavulus) **do not exist**
in this production DB (no account row, no name match for "Cavulus", no audit
trace beyond `ACT-2084`). The MCP session that observed them was likely
pointed at a different environment or the records were since removed.

## 2. Activity ID Counts

| Metric | Value |
|---|---|
| Total activities | **457** |
| Using `ACV-*` | **457** (100%) |
| Using `ACT-*` | **0** |

Representative records: `ACV-202511-00001` … `ACV-202511-00005`
(note: `{YY}{MM}` rendered as `202511` — 4-digit year — because the pattern
was stored/expanded with `YYYY` semantics at import time; the pattern row says
`ACV-{YY}{MM}-{SEQ:5}` and `last_issued` = `ACV-2511-00013`, so both
`ACV-2511-*` and `ACV-202511-*` shapes exist in the population).

**Does Activity currently use `ACT-*`? — NO (in production).** The code
default (`server/db.ts:906`) is `ACT-{YY}{MM}-{SEQ:5}` as documented, but the
production `id_patterns` row overrides it with `ACV-*`. New production
Activities receive `ACV-*` IDs.

## 3. Cross-Table Collision Audit

```sql
SELECT a.id FROM accounts a JOIN activities act ON a.id = act.id;
```

**Result: 0 rows. No collisions.** Not CRITICAL — the `ACV-*` Activity prefix
in production accidentally prevents any overlap with `ACT-*` Accounts.
⚠️ Latent risk: if the Activity pattern row is ever aligned to the documented
`ACT-{YY}{MM}-{SEQ:5}` while Accounts remain `ACT-*`, future collisions become
possible in prefix-based routing/type inference (exact ID collision is still
unlikely due to differing shapes: `ACT-1234` vs `ACT-2608-00099`, but AI/MCP
prefix-to-entity mapping breaks immediately).

## 4. Dependent FK References

Counts of rows referencing an `ACT-*` vs `ACCT-*` Account ID:

| Table.column | `ACT-*` | `ACCT-*` | Notes |
|---|---|---|---|
| `contacts.account_id` | 0 | 0 | |
| `opportunities.account_id` | **48** | 0 | e.g. OPP-1000→ACT-1000, OPP-0002→ACT-1019 |
| `leads.converted_account_id` | 0 | 0 | |
| `activity_associations.entity_id` (entity_type='Account') | 0 | 0 | |
| `document_links.entity_id` (Account) | 0 | 0 | table empty |
| `crm_documents.entity_id` (Account) | n/a | n/a | **table does not exist in production** |
| `research_documents.entity_id` (Account) | n/a | n/a | **table does not exist in production** |
| `audit_logs.resource_id` (resource='Account') | **126** | **10** | not an FK; see §5 |
| `entity_tags.entity_id` (Account) | 0 | 0 | |
| `comments.entity_id` (Account) | 0 | 0 | |

The production schema is behind dev: it also lacks `organizations`,
`organization_id` columns, `crm_documents`, `research_documents`,
`opportunity_resources`, `saved_filters`, and the lead-generation module
tables. Any remediation migration must target the schema *actually present*
in production.

## 5. Non-FK / Text References

| Location | Count | Migration exposure |
|---|---|---|
| `activities.related_id` where `related_type='Account'` | 0 (`ACT-*`), 0 (`ACCT-*`) | none |
| `audit_logs.resource_id` (resource='Account', `ACT-*`) | 126 | NOT touched by FK cascade |
| `audit_logs.before/after` JSONB containing `ACT-` (resource='Account') | **671 rows** | NOT touched by FK cascade |
| `accounts.external_id LIKE 'ACT-%'` | 0 | none |

These 797 audit-log references would be stranded by any FK-only rename.
Recommendation: leave audit history immutable (it records what the ID *was*
at event time) — do not rewrite it.

## 6. Current ID Generators

Code (`server/db.ts`):
- `generateId("Account")` default: `ACCT-{YYYY}-{SEQ:5}` (`server/db.ts:902`, also `initializeIdPatterns` at `server/db.ts:848`).
- `generateId("Activity")` default: `ACT-{YY}{MM}-{SEQ:5}` (`server/db.ts:906`, `:852`).
- Resolution order (`server/db.ts:910–951`): global `id_patterns` row wins; code default is only used to seed a missing row. Counter increments on the global row; org-specific rows only override the format string.

Production `id_patterns` (read-only SELECT; no `organization_id` column exists in prod):

| entity | pattern | counter | start_value | last_issued |
|---|---|---|---|---|
| Account | **`ACT-{SEQ:4}`** | 1042 | 1042 | ACT-2084 |
| Activity | **`ACV-{YY}{MM}-{SEQ:5}`** | 1 | 1 | ACV-2511-00013 |
| Contact | `CONT-{SEQ:4}` | 1 | 1 | CONT-0002 |
| Lead | `LEAD-{SEQ:6}` | 35 | 35 | LEAD-000074 |
| Opportunity | `OPP-{SEQ:4}` | 2 | 1 | OPP-0002 |
| Document | `DOC-{SEQ:6}` | 0 | 1 | — |

**The production `id_patterns` table has NOT been updated to the canonical
patterns.** Account, Activity, Contact, and Opportunity all diverge from the
documented contract (`ACCT-{YYYY}-{SEQ:5}`, `ACT-{YY}{MM}-{SEQ:5}`,
`CONT-{YY}{MM}-{SEQ:5}`, `OPP-{YYYY}-{SEQ:6}`).

## 7. API / Documentation Alignment

- `docs/openapi.yaml:36–38` — declares "Account `ACCT-*` … Activity `ACT-*`". ✅ matches the canonical contract, ❌ contradicts production data.
- `docs/API_IMPLEMENTATION_GUIDE.md:84–93` — same table (`ACCT-2025-00001` example, Activity `ACT-2608-00099`). Same contradiction.
- **Runtime validation:** grep of `server/external-api-routes.ts` and `server/external-patch-config.ts` found **no `ACCT-` prefix assertion anywhere**. Account lookups pass `req.params.id` straight to `storage.getAccountById()` (`server/external-api-routes.ts:297–310`); PATCH allowlists (`server/external-patch-config.ts`) validate field names/types only, never ID shape. Legacy `ACT-*` Account IDs are **not rejected** by any runtime check.
- `GET /api/v1/external/accounts/ACT-2098` — **returns 404 today**, but only because no account row with that ID exists (max is `ACT-1041`; `ACT-2084` was created and later deleted). A request for an existing legacy ID such as `GET /accounts/ACT-1000` would return **200** — the route has no prefix filter. (Determined read-only from DB state + code path; no production writes or API keys were exercised.)

## 8. Recommended Remediation

**Recommendation: Option A (transactional migration to `ACCT-*`), extended to
fix `id_patterns` as the root cause — executed as a single maintenance-window
transaction.** Dataset size makes this low-risk: 41 accounts, 48 opportunity
FKs, zero other live references.

- **Option A — Transactional migration (RECOMMENDED)**
  1. Snapshot/backup production DB.
  2. In one transaction: build mapping `ACT-{n}` → `ACCT-{YYYY}-{SEQ:5}` (or minimally `ACCT-` + same numeric tail to preserve recognizability); update `accounts.id`; update `opportunities.account_id` (48 rows); update `id_patterns` rows for Account (`ACCT-{YYYY}-{SEQ:5}`, counter carried forward), Activity (`ACT-{YY}{MM}-{SEQ:5}`), Contact, Opportunity to the canonical contract.
  3. Leave `audit_logs` untouched (historical record; 797 text references intentionally stranded — document this).
  4. Publish the old→new ID mapping to MCP/forecasting clients; optionally keep a temporary alias lookup (see Option C) for one release.
  - **Risks:** FK repointing (only 1 table affected — prod has no `ON UPDATE CASCADE`, so explicit updates in dependency order or deferred constraints are needed); MCP/external clients holding stale `ACT-*` Account IDs get 404s post-migration; audit-log text references become historical-only.
  - **Why now:** small data volume, single FK table, zero contacts/tags/comments references — this is the cheapest this migration will ever be. It fully resolves the namespace ambiguity: after migration, `ACT-*` unambiguously means Activity (once the Activity pattern is corrected too).

- **Option B — Dual-alias support (NOT recommended):** accept `ACT-*` or `ACCT-*` on account lookup in API/MCP layers indefinitely. Cheap to ship, but it *institutionalizes* the ambiguity: once Activity IDs also start with `ACT-` (per the contract), `ACT-2084` could name either entity and prefix-based type inference for AI tools is permanently broken. Ongoing cost: every new endpoint/tool must implement the alias rule; docs must explain a two-prefix contract forever.

- **Option C — Shadow alias column / read-time remap (fallback):** add `accounts.legacy_id`, migrate `id` to `ACCT-*`, and have lookups fall back to `legacy_id` (optionally returning `301`-style redirect info). Safest for external clients but adds permanent schema + lookup complexity for a 41-row problem. Reasonable as a *transitional* addition to Option A (keep for one release, then drop), not as the endpoint state.

## 9. Migration Risk Summary

| Option | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A | FK update misses a referencing row | Low (only `opportunities.account_id` holds live refs; verified by this audit) | High (orphaned FK) | Run inside one transaction; re-run this audit's queries as post-checks before COMMIT |
| A | External/MCP clients break on old IDs | Medium | Medium | Publish ID mapping; optional temporary alias lookup (Option C transitional); 404 messaging pointing at new ID |
| A | Audit-log text refs stranded | Certain (by design) | Low | Documented as historical; no rewrite |
| A | New ID issued mid-migration | Low | Medium | Maintenance window; lock `id_patterns` rows first |
| B | Permanent prefix ambiguity for AI tools | Certain | High | None — inherent to the option |
| B | Alias logic missed in a future endpoint | High over time | Medium | Central helper + tests, forever |
| C | Schema complexity persists | Certain | Low–Medium | Time-box the alias column; drop after one release |

## 10. Proposed Validation Tests (pre-merge gate for remediation)

1. **Account prefix invariant:** every ID returned by `GET /api/v1/external/accounts` (all pages) matches `^ACCT-\d{4}-\d{5}$`.
2. **Activity prefix invariant:** every ID from `GET /activities` matches `^ACT-\d{4}-\d{5}$` (after Activity pattern correction) and none matches an Account ID.
3. **Cross-table uniqueness:** `SELECT COUNT(*) FROM accounts a JOIN activities act ON a.id = act.id` returns 0 (automated post-migration check).
4. **FK integrity:** zero `opportunities.account_id` (and every other §4 column) values without a matching `accounts.id`; zero remaining `LIKE 'ACT-%'` values in FK columns.
5. **Generator behavior:** unit test that `generateId("Account")` against the migrated `id_patterns` row emits `ACCT-{YYYY}-{SEQ:5}` and continues the counter without reuse; same for Activity → `ACT-{YY}{MM}-{SEQ:5}`.
6. **Legacy ID behavior (per chosen option):** `GET /accounts/ACT-1000` returns 404 (Option A pure) or 200/redirect via alias (Option A+C transitional / Option B) — test asserts the *chosen* contract explicitly.
7. **Docs conformance:** contract test that `docs/openapi.yaml` examples and `id_patterns` rows agree on prefixes for all six entities.
8. **id_patterns alignment:** automated check that production `id_patterns.pattern` values equal the code defaults in `server/db.ts` (guards against future drift, the root cause found here).
