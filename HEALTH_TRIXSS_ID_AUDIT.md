# Health Trixss Org-Scoped Canonical ID Audit (Task 207)

**Date:** 2026-08-17 · **Scope:** READ-ONLY. All queries preserved in
`scripts/canonical-id-audit-ht.ts` (SELECT-only; no INSERT/UPDATE/DELETE/DDL).
No data, schema, or code changed. No API key values are shown anywhere.

> **Headline finding:** there is **no organization named "Health Trixss" in any
> accessible database**. "Health Trixss" is the *product/tenant brand* (the API
> key prefix is `htcrm_` = "Health Trixss CRM"; `ACT-1000` is the account
> "Health Trixss LLC"). The MCP-style API key ("ChatGPT Sales Agent") is bound
> to the org **"Primary Organization"** in the development database — that org
> is the "Health Trixss organization" for the purposes of this audit.
> Furthermore, the audited prod DB (`NEON_DATABASE_URL`) has **no
> `organizations` table and no `organization_id` columns at all**, so no key
> can be org-scoped there. Finally, the MCP's 56-account view (including
> `ACT-2098`–`ACT-2103`) matches **neither** accessible database — the MCP is
> almost certainly pointed at a **third database** (the published deployment's
> `DATABASE_URL`). Org scoping alone does *not* fully explain the Task 204
> discrepancy; see §9.

---

## 1. Health Trixss Organization Identification

**Databases inspected (read-only):**

| DB | org scoping present? | api_keys.organization_id? |
|---|---|---|
| `NEON_DATABASE_URL` (prod, Task 204 scope) | **NO** — no `organizations` table | **NO** — column absent; all 3 keys are effectively system-wide |
| `DATABASE_URL` (dev) | YES | YES |

- `NEON_DATABASE_URL` api_keys (names only): "Test Forecasting App",
  "Test API Key jaNH95", "sdfsadf" — none can be org-scoped (no column).
- `DATABASE_URL` orgs: **Primary Organization**
  (`3e369484-0c88-401d-86e3-9c3361ee465e`), Lucentria Inc, and 13 transient
  `vitest-*` test orgs. No name matches "Health Trixss"/"Trixss"/"Health".
- The only active, non-test API key is **"ChatGPT Sales Agent"**, bound to
  Primary Organization with all six permission scopes. (Key value never
  displayed; only metadata queried.)

**MCP ORGANIZATION = Primary Organization / `3e369484-0c88-401d-86e3-9c3361ee465e`**
*(in the dev DB — no org binding is possible in the NEON prod DB)*

**HEALTH TRIXSS ORGANIZATION ID:** `3e369484-0c88-401d-86e3-9c3361ee465e`
("Primary Organization", dev `DATABASE_URL`; no equivalent exists in
`NEON_DATABASE_URL`).

## 2. Health Trixss Account Audit

**HT ACCOUNT COUNT: 50** (org-scoped, dev DB). ID range `ACT-1000` … `ACT-2096`.

**HT ACCOUNT PREFIX COUNTS:**

| Prefix | Count |
|---|---|
| `ACT-*` | **50** (100%) |
| `ACCT-*` | 0 |
| other | 0 |

10 most recent HT accounts: ACT-2096 Ellkay (2026-04-30), ACT-2092 AVM
Medical, ACT-2091 Care Compass, ACT-2090 ReferWell, ACT-2089 CVS / Aetna,
ACT-2088 EBG, ACT-2086 Netmark, ACT-2085 Molina, ACT-2084 Solis Health Plan,
ACT-1041 Providence Health Plan (2025-12-04).

**Specific MCP-reported records checked:**

| ID | Name (per MCP) | Present in HT org (dev DB)? | Present in NEON prod? |
|---|---|---|---|
| ACT-2103 | Cavulus | **NO** (no row, no name match) | NO |
| ACT-2102 | Integrated Psychiatric Consultants | **NO** | NO |
| ACT-2100 | Providence | **NO** (only ACT-1041 "Providence Health Plan") | NO |
| ACT-2099 | Humanizing Technologies | **NO** | NO |
| ACT-2098 | Care Oregon | **NO** | NO |
| ACT-2091 | Care Compass | **YES** ✅ | NO |

Deleted-record check: `audit_logs` contains **zero** delete events for any
`ACT-2*` account ID — `ACT-2097`–`ACT-2103` were never created *and never
deleted* in this DB. The global Account counter's `last_issued` is
`ACT-2096`, consistent with the data.

**Does the org-scoped DB query now match the MCP results? — PARTIALLY.**
Org scoping raises the count from 41 (NEON, unscopable) to 50 and finds
`ACT-2091` Care Compass, but the MCP's 56-account set with
`ACT-2098`–`ACT-2103` still does not exist here. See §9.

## 3. API / Database Parity

**HT API/DB PARITY: FAIL (NOT VERIFIABLE with a live key)**

- No Health Trixss API key value exists in any environment variable or file
  in this workspace (searched env, `.env*`, repo — only `.env.example`
  placeholders). Raw keys cannot be recovered from the stored bcrypt hashes,
  and generating a new key would be a **write**, which this audit forbids.
- **Code-path equivalence (static, read-only):**
  `GET /api/v1/external/accounts` (`server/external-api-routes.ts:208-288`)
  resolves `orgId` from `req.apiKey.organizationId` and calls
  `storage.getAllAccounts(orgId, …)` — the exact org filter used by the Step 2
  DB query. `GET /accounts/:id` 404s on any cross-org record via
  `keyOrgOwns()`. So against *this* dev DB, the API would necessarily return
  the same 50 accounts as the direct query — parity holds **by construction**,
  but could not be exercised live.
- The parity failure that matters is environmental: the MCP's responses
  (56 accounts) cannot be reproduced from either accessible DB, i.e. the MCP's
  API server is not reading this database (§9).

## 4. Health Trixss Activity Audit

**HT activity total: 562** (org-scoped).

**HT ACTIVITY PREFIX COUNTS:**

| Prefix | Count |
|---|---|
| `ACV-*` | **562** (100%) |
| `ACT-*` | 0 |
| other | 0 |

Representative IDs: `ACV-2608-00106` … `ACV-2608-00102` (Aug 2026 E2E test
activities); population also contains earlier `ACV-2511-*` / `ACV-202511-*`
shapes. No activity uses the canonical `ACT-*` prefix, so there is **zero
Account/Activity ID collision today** — same accidental safety as Task 204
found in prod.

## 5. HT Effective ID Patterns

**HT EFFECTIVE ID PATTERNS** — `id_patterns` has **no org-specific rows for
the HT org** (`organization_id = 3e369484…` → 0 rows), so per
`generateId()` (`server/db.ts:910-951`) the **global rows are the effective
patterns** for Health Trixss:

| Entity | Effective pattern (global row) | Canonical target | MATCH |
|---|---|---|---|
| Account | `ACT-{SEQ:4}` (counter 1055, last `ACT-2096`) | `ACCT-{YYYY}-{SEQ:5}` | **NO** |
| Contact | `CONT-{SEQ:4}` (last `CONT-0013`) | `CONT-{YY}{MM}-{SEQ:5}` | **NO** |
| Lead | `LEAD-{SEQ:6}` (last `LEAD-000188`) | `LEAD-{SEQ:6}` | **YES** |
| Opportunity | `OPP-{SEQ:4}` (last `OPP-2177`) | `OPP-{YYYY}-{SEQ:6}` | **NO** |
| Activity | `ACV-{YY}{MM}-{SEQ:5}` (last `ACV-2608-00120`) | `ACT-{YY}{MM}-{SEQ:5}` | **NO** |
| Document | `DOC-{SEQ:6}` (last `DOC-000020`) | `DOC-{SEQ:6}` | **YES** |

(The NEON prod `id_patterns` rows are pattern-identical; only counters differ.)
4 of 6 entities diverge from the canonical contract; because the DB row always
overrides the code defaults, new HT Accounts continue to receive `ACT-*` IDs.

## 6. HT Dependent References

**HT DEPENDENT REFERENCES** — rows referencing a Health-Trixss-org account ID:

| Reference | Count |
|---|---|
| `opportunities.account_id` | **128** |
| `contacts.account_id` | **12** |
| `leads.converted_account_id` | 0 |
| `activity_associations.entity_id` (entity_type='Account') | **57** |
| `document_links.entity_id` (Account) | 0 |
| `entity_tags.entity_id` (Account) | 0 |
| `comments.entity_id` (Account) | **1** |
| `audit_logs.resource_id` (resource='Account') | **388** (non-FK, historical) |
| `activities.related_id` (related_type='Account') | **57** (non-FK) |

Total live FK-style references to repoint in a rename: **198**
(128 + 12 + 57 + 1); plus 57 `activities.related_id` text references; 388
audit-log references should stay immutable. No IDs were changed.

## 7. Other-Org High-Level Summary

**OTHER-ORG HIGH-LEVEL SUMMARY** (aggregates only; no individual records):

| Org | Accounts | Account prefixes | Activities | Activity prefixes |
|---|---|---|---|---|
| Lucentria Inc | 4 | `ACCT-*` and `ACT-*` (mixed) | 2 | `ACV-*` |
| vitest-act-org-a-… | 1 | `ACCT-*` | 0 | — |
| vitest-oc-org-… | 1 | `ACCT-*` | 0 | — |
| 12 other vitest-* orgs | 0 | — | 0 | — |

**Conclusion: the canonical-ID problem is GLOBAL, not Health-Trixss-specific.**
The global `id_patterns` rows (which every org shares for counters, and for
format whenever no org-specific row exists) are non-canonical, so every org
without a custom pattern row inherits `ACT-*` accounts and `ACV-*` activities.
Lucentria's mix of `ACCT-*`/`ACT-*` shows both generations already coexist.

## 8. Reconciliation with the Previous Audit

**EXPLANATION OF PREVIOUS DISCREPANCY** (41 vs 56 accounts):

Proof points from read-only queries:

1. **Different databases.** Task 204 audited `NEON_DATABASE_URL`: 41 accounts
   (`ACT-1000`–`ACT-1041`, all imported 2025-11-24), Account counter last
   issued `ACT-2084`, frozen since Nov 2025, and **no org tables** — so "org
   scoping" cannot even be expressed there.
2. **The dev DB (`DATABASE_URL`) explains part of the gap.** The HT org has
   **50** accounts, `ACT-1000`–`ACT-2096`, including 9 created Feb–Apr 2026
   (Solis, Molina, Netmark, EBG, CVS/Aetna, ReferWell, Care Compass, AVM
   Medical, Ellkay) that post-date the NEON snapshot. `ACT-2091` Care Compass —
   which the MCP reported — exists **only** here. So 41 → 50 is **environment
   drift** (NEON is a stale copy), not org scoping.
3. **Neither DB explains the remaining 6.** `ACT-2097`–`ACT-2103` (Cavulus,
   IPC, Providence, Humanizing Technologies, Care Oregon) exist in neither DB,
   have no delete audit trace, and exceed the dev counter (`last_issued =
   ACT-2096`). They cannot have been created and deleted here.

**Conclusion:** org scoping does **NOT** fully explain the discrepancy. The
decisive factor is **multiple databases**: NEON (stale, 41), dev (current
workspace, 50), and a **third database — almost certainly the published
deployment's `DATABASE_URL` — serving the MCP (56, counter ≥ 2103)**. That
deployment DB shares lineage with the dev DB (same `ACT-2xxx` sequence,
Care Compass present) but has continued issuing IDs past `ACT-2096`. Any
future audit or migration must be run against *that* database to be
authoritative for the MCP's view.

## 9. Recommended Migration Plan

**RECOMMENDED MIGRATION PLAN** (design only — NOT executed):

1. **First, pin the environment.** Identify the deployment database the MCP
   key actually reads (deployment env vars). Re-run
   `scripts/canonical-id-audit-ht.ts` against it as the pre-migration
   baseline. Migrating dev or NEON alone will not fix the MCP's namespace.
2. **Fix generation before data.** In one transaction, update the **global**
   `id_patterns` rows to canonical: Account `ACCT-{YYYY}-{SEQ:5}`, Contact
   `CONT-{YY}{MM}-{SEQ:5}`, Opportunity `OPP-{YYYY}-{SEQ:6}`, Activity
   `ACT-{YY}{MM}-{SEQ:5}` (Lead/Document already canonical). Carry counters
   forward unchanged so sequences never reuse. Order matters: **rename all
   `ACT-*` Accounts before (or in the same transaction as) switching the
   Activity pattern to `ACT-*`** — otherwise the prefix collision Task 204
   warned about becomes real.
3. **Rename existing IDs** (per org-bearing DB, single maintenance-window
   transaction, after backup): map `ACT-nnnn` → `ACCT-{YYYY}-{nnnnn}`
   (preserve numeric tail for recognizability), then update the ~198 live
   references found in §6 (`opportunities.account_id`, `contacts.account_id`,
   `activity_associations.entity_id`, `comments.entity_id`) plus
   `activities.related_id` (57). Repeat pattern for Contact/Opportunity/
   Activity renames. Leave `audit_logs` untouched (immutable history).
4. **`generateId()` hardening** (`server/db.ts:910-951`): the
   global-row-wins resolution is the drift's root cause — the code defaults
   are canonical but never apply once a row exists. Add a startup drift check
   (warn/fail when a global `id_patterns.pattern` ≠ code default), and keep
   the "global counter is authoritative; org rows only customize format"
   invariant. Consider seeding org-specific format rows only deliberately,
   never implicitly.
5. **Client transition:** publish the old→new ID mapping to MCP/forecasting
   consumers; optionally keep a one-release read-time alias
   (`accounts.legacy_id`) for old `ACT-*` lookups, then drop it.
6. **Post-checks (automated, before COMMIT):** zero `LIKE 'ACT-%'` account
   IDs remain; zero orphaned FKs; zero Account/Activity ID overlap;
   `id_patterns` equals code defaults; API list endpoints return only
   canonical prefixes.

---

## Summary

```
HEALTH TRIXSS ORGANIZATION ID: 3e369484-0c88-401d-86e3-9c3361ee465e ("Primary Organization", dev DB; no org exists named "Health Trixss"; NEON prod has no org scoping at all)
HT ACCOUNT COUNT: 50 (ACT-1000 … ACT-2096)
HT ACCOUNT PREFIX COUNTS: ACT-* = 50 (100%), ACCT-* = 0, other = 0
HT ACTIVITY PREFIX COUNTS: ACV-* = 562 (100%), ACT-* = 0, other = 0
HT API/DB PARITY: FAIL (not verifiable live — no HT key available in env; static code analysis shows the endpoint applies the identical org filter)
HT EFFECTIVE ID PATTERNS: global rows only (no HT org rows); MATCH — Account NO, Contact NO, Lead YES, Opportunity NO, Activity NO, Document YES
HT DEPENDENT REFERENCES: 198 live refs (opportunities 128, contacts 12, activity_associations 57, comments 1) + 57 activities.related_id + 388 immutable audit_logs
OTHER-ORG HIGH-LEVEL SUMMARY: problem is GLOBAL — shared global id_patterns give every org ACT-* accounts / ACV-* activities; Lucentria already mixes ACCT-*/ACT-*
EXPLANATION OF PREVIOUS DISCREPANCY: three databases — NEON (41, stale, unscopable), dev (50, current), and a third deployment DB serving the MCP (56, incl. ACT-2098–2103); org scoping alone does NOT explain it
RECOMMENDED MIGRATION PLAN: pin the MCP's real DB → fix global id_patterns to canonical (rename ACT-* accounts before Activity switches to ACT-*) → transactional ID rename + 198 ref updates → generateId() drift guard → client ID mapping + temporary alias
```
