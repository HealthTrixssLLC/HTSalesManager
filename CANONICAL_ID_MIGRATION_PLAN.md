# Production Canonical ID Migration Plan

**Date:** 2026-08-17 · **Status:** PLAN ONLY — nothing in this document has been executed.
**Database:** the *deployment's* `DATABASE_URL` (Replit-managed production PostgreSQL). All figures
below were captured 2026-08-17 from Replit's **read-only production replica**
(`executeSql(environment: "production")`) — live query results, not estimates. No production data,
patterns, or IDs were modified.

> ⚠️ **Execution environment.** The workspace `DATABASE_URL` is the development database and
> `NEON_DATABASE_URL` is a stale copy — **neither is production**. The migration SQL in this
> document must be executed from a shell that holds the production deployment's `DATABASE_URL`
> (the replica used for this analysis is read-only). Run
> `npx tsx scripts/canonical-id-audit-prod.ts` first: its audit gate (fingerprint accounts
> ACT-2103 Cavulus, ACT-2098 Care Oregon, …, HT count = 56) exits 1 unless connected to the real
> production database.

**Health Trixss (HT) organization:** `3e369484-0c88-401d-86e3-9c3361ee465e` ("Primary Organization").

---

## 0. Authoritative production baseline (live, 2026-08-17)

### 0.1 ID prefix census (HT org)

| Entity | Prefix | Count | ID range | Canonical? |
|---|---|---:|---|---|
| Account | `ACT-` | **56** | ACT-1000 … ACT-2103 | ❌ (target `ACCT-{YYYY}-{SEQ:5}`) |
| Contact | `CON-` | **69** | CON-202511-00001 … CON-202511-00075 (gaps) | ❌ (target `CONT-{YY}{MM}-{SEQ:5}`) |
| Contact | `CONT-` | 16 | CONT-0002 … CONT-0017 | prefix ✔ (shape `CONT-{SEQ:4}`, left as-is) |
| Lead | `LEAD-` | 59 | LEAD-000001 … LEAD-000153 | ✔ — no migration |
| Opportunity | `OPP-` | 85 | OPP-1000 … OPP-2137 | prefix ✔ (shape `OPP-{SEQ:4}`, left as-is) |
| Opportunity | `Opp-` | **2** | Opp-1024, Opp-1027 | ❌ (case) |
| Activity | `ACV-` | **530** | ACV-202511-00001 … ACV-2607-00075 | ❌ (target `ACT-{YY}{MM}-{SEQ:5}`) |
| Document | — | 0 | (table empty) | ✔ — no migration |

**Records to rename: 56 + 69 + 2 + 530 = 657.**

Rows outside the HT org (must be decided in §1.5): 3 accounts `ACT-2093/2094/2095`
(org `2f5e350e-5cb9-45a8-aef7-8ca8194c5081`, Lucentria), 4 opportunities `OPP-2116/2117/2118/2124`
(canonical prefix, untouched), 1 activity `ACV-2607-00076`, 4 leads, 0 contacts.

### 0.2 Live `id_patterns` rows (all global; no org-specific rows exist)

| entity | pattern | counter | start_value | last_issued |
|---|---|---:|---:|---|
| Account | `ACT-{SEQ:4}` | 1062 | 1042 | ACT-2103 |
| Activity | `ACV-{YY}{MM}-{SEQ:5}` | 76 | 1 | ACV-2607-00076 |
| Contact | `CONT-{SEQ:4}` | 17 | 1 | CONT-0017 |
| Document | `DOC-{SEQ:6}` | 0 | 1 | — |
| Lead | `LEAD-{SEQ:6}` | 120 | 35 | LEAD-000154 |
| Opportunity | `OPP-{SEQ:4}` | 1091 | 1047 | OPP-2137 |

Generator semantics (`server/db.ts:900-968`): next sequence number =
`start_value + (counter+1) - 1` = `start_value + counter` (the counter is incremented first, then
`SEQ = start_value + counter_after - 1`). The **global row always wins** over code defaults; this is
why production still issues legacy-shaped IDs.

---

## 1. Old→New ID mapping strategy & collision analysis

### 1.1 Accounts — 56 × `ACT-{N}` → `ACCT-{YYYY}-{SEQ:5}`

Rule: `YYYY` = the account's `created_at` year; `SEQ` = a fresh global sequence 1…56 assigned in
`ORDER BY created_at, id` (deterministic, chronological).

Live year split: **41 accounts created 2025** (all 2025-12-04, ACT-1000…ACT-1041) and
**15 created 2026** (ACT-2084…ACT-2103, 2026-02-18 → 2026-07-28). Therefore:

- ACT-1000 … ACT-1041 → `ACCT-2025-00001` … `ACCT-2025-00041`
- ACT-2084 … ACT-2103 → `ACCT-2026-00042` … `ACCT-2026-00056`

(sequence is global and monotonic across years, so the numeric tail alone stays unique).

**Collision check (live):** `SELECT COUNT(*) FROM accounts WHERE id LIKE 'ACCT-%'` → **0**.
No `ACCT-*` ID exists anywhere in production, so no proposed ID can collide. ✅

### 1.2 Activities — 530 × `ACV-*` → `ACT-{YY}{MM}-{SEQ:5}`

Rule: preserve the original year/month token, renumber into one fresh global sequence 1…530 in
`ORDER BY created_at, id`. Live YM distribution:

| Legacy YM token | Count | New YM token | New IDs |
|---|---:|---|---|
| `202511` (Nov 2025, mis-expanded 4-digit year) | 457 | `2511` | ACT-2511-00001 … ACT-2511-00457 |
| `2512` | 3 | `2512` | ACT-2512-00458 … 00460 |
| `2601` | 16 | `2601` | ACT-2601-00461 … 00476 |
| `2602` | 8 | `2602` | ACT-2602-00477 … 00484 |
| `2603` | 6 | `2603` | ACT-2603-00485 … 00490 |
| `2604` | 16 | `2604` | ACT-2604-00491 … 00506 |
| `2605` | 8 | `2605` | ACT-2605-00507 … 00514 |
| `2606` | 5 | `2606` | ACT-2606-00515 … 00519 |
| `2607` | 11 | `2607` | ACT-2607-00520 … 00530 |

Normalization bonus: the malformed `ACV-202511-*` batch becomes correctly-shaped `ACT-2511-*`.

**Collision checks (live):**
- `activities.id LIKE 'ACT-%'` → **0** (no activity already uses the target prefix). ✅
- Cross-table: post-migration no `accounts.id LIKE 'ACT-%'` remains (all renamed to `ACCT-` in the
  same transaction), so `ACT-` unambiguously means Activity. **Ordering constraint: accounts must
  be renamed in the same transaction as (or before) activities** — otherwise `ACT-2511-00001`
  coexists with account `ACT-1000` and prefix-based type inference is ambiguous. Exact-ID collision
  is impossible even transiently (account tails are 4 digits, activity IDs contain two hyphens),
  but the transaction does both anyway. ✅

### 1.3 Contacts — 69 × `CON-202511-*` → `CONT-{YY}{MM}-{SEQ:5}`

All 69 legacy contacts were created **2025-12-04** (`to_char(created_at,'YYMM')` = `2512` for every
row, verified live). Rule: `CONT-2512-{SEQ:5}` with a fresh sequence 1…69 in `ORDER BY id` (which
matches creation order):

- CON-202511-00001 … CON-202511-00075 (69 rows, gaps in tail) → `CONT-2512-00001` … `CONT-2512-00069`

**Collision check (live):** existing canonical-prefix contacts are `CONT-0002`…`CONT-0017`
(shape `CONT-{SEQ:4}`, one hyphen); the proposed IDs have two hyphens (`CONT-2512-#####`).
`SELECT COUNT(*) FROM contacts WHERE id ~ '^CONT-\d{4}-\d{5}$'` → **0**. No overlap possible. ✅
The 16 `CONT-00nn` contacts keep their IDs (prefix already canonical; task scope renames `CON-` only).

### 1.4 Opportunities — 2 × `Opp-*` → uppercase only

- `Opp-1024` → `OPP-1024`
- `Opp-1027` → `OPP-1027`

**Collision check (live):** `SELECT id FROM opportunities WHERE id IN ('OPP-1024','OPP-1027')` →
**0 rows**. The 85 existing `OPP-1000`…`OPP-2137` skip both values. ✅
(The existing `OPP-{SEQ:4}` shape differs from the documented `OPP-{YYYY}-{SEQ:6}`; per scope, only
the two case-variant IDs are migrated. New opportunities adopt the canonical shape via §5.)

### 1.5 Scope decision: non-HT rows

3 Lucentria accounts (`ACT-2093/2094/2095`) and 1 non-HT activity (`ACV-2607-00076`) also carry
legacy prefixes. **Recommendation: include them in the same rename** (extend the mapping CTEs by
dropping the `organization_id` filter) — otherwise `ACT-`/`ACV-` prefixes survive in production and
validation query V1 (§8) must be org-scoped forever. The mapping/collision logic is identical; it
adds 3 account rows (→ `ACCT-2026-00057…00059` by the same chronological rule) and 1 activity row
(→ `ACT-2607-00531`). All counts elsewhere in this plan are stated for the HT scope, with the
global option noted where it changes a number. The DBA must record which scope was chosen.

---

## 2. Reference inventory (live counts)

FK constraints in production carry **no `ON UPDATE CASCADE`** (`update_rule = NO ACTION` on every
FK, verified from `information_schema.referential_constraints`), so every referencing column must
be updated explicitly.

### 2.1 Account (56 renamed IDs)

| Table.column | Type | Rule | Rows referencing legacy `ACT-*` | Migrate? |
|---|---|---|---:|---|
| `opportunities.account_id` | FK | ON DELETE CASCADE | **91** (87 → HT accounts, 4 → the 3 Lucentria accounts) | YES |
| `contacts.account_id` | FK | ON DELETE SET NULL | **17** | YES |
| `leads.converted_account_id` | FK | NO ACTION | 0 | — |
| `candidate_accounts.existing_account_id` | FK | NO ACTION | 0 | — |
| `activity_associations.entity_id` (entity_type='Account') | soft (text) | — | **1** | YES |
| `activities.related_id` (related_type='Account') | soft (text) | — | **1** | YES |
| `entity_tags` / `comments` / `document_links` / `crm_documents` / `research_documents` (Account) | soft | — | 0 each | — |
| `audit_logs.resource_id` (resource='Account') | historical | — | 407 | **NO** (§3) |
| `audit_logs.before/after` JSONB containing `ACT-` | historical | — | 1,728 rows | **NO** (§3) |

Live refs to migrate: **110** (91 + 17 + 1 + 1). If HT-only scope is chosen, the 4 Lucentria-account
opportunity FKs stay pointing at un-renamed `ACT-209x` rows — another argument for global scope.

### 2.2 Contact (69 renamed IDs)

| Table.column | Type | Rows referencing legacy `CON-*` | Migrate? |
|---|---|---:|---|
| `leads.converted_contact_id` | FK | 0 | — |
| `opportunity_contacts.contact_id` | FK CASCADE | 0 | — |
| `activity_associations.entity_id` (Contact) | soft | 0 | — |
| `activities.related_id` (Contact) | soft | 0 | — |
| `entity_tags` / `comments` (Contact) | soft | 0 (the existing Contact tags/comments reference `CONT-*` rows) | — |
| `audit_logs.resource_id` (resource='Contact', `CON-*`) | historical | 1,142 | **NO** |

Live refs to migrate: **0**. The contact rename touches only `contacts.id`.

### 2.3 Opportunity (2 renamed IDs)

All referencing columns were checked for `Opp-*` values: `leads.converted_opportunity_id`,
`opportunity_contacts.opportunity_id`, `opportunity_resources.opportunity_id`,
`activity_associations.entity_id`, `activities.related_id`, `entity_tags`, `comments`,
`crm_documents`, `research_documents` — **all 0**. `audit_logs.resource_id` (`Opp-*`) = 12 →
historical, untouched. Live refs to migrate: **0**.

### 2.4 Activity (530 renamed IDs)

| Table.column | Type | Rows referencing `ACV-*` | Migrate? |
|---|---|---:|---|
| `activity_associations.activity_id` | FK ON DELETE CASCADE | **46** | YES |
| `lg_crm_tasks.activity_id` | FK NO ACTION | 0 (table empty) | — |
| `entity_tags` / `comments` (Activity) | soft | 0 | — |
| `audit_logs.resource_id` (resource='Activity', `ACV-*`) | historical | 3,405 | **NO** |

Live refs to migrate: **46**.

### 2.5 Other surfaces checked (all clean)

`saved_filters.filters` JSONB containing any legacy ID → **0**. `document_links`, `documents` →
empty tables. `research_documents` reference only `LEAD-*`/`OPP-*`/candidate UUIDs;
`crm_documents` reference only `OPP-*`. `lg_crm_leads` links UUIDs to `LEAD-*` ids (unchanged).

**Grand total of live reference updates: 156 rows** (110 Account + 0 Contact + 0 Opportunity +
46 Activity), plus the 657 primary-key rows themselves.

---

## 3. Audit log policy — DECISION: leave immutable

`audit_logs` rows are a point-in-time record: `resource_id`, `before`, and `after` capture the
identifier **as it existed when the event happened**. Rewriting them would falsify history and
provide no operational benefit (nothing joins audit rows to live entities by FK — `resource_id` is
plain text and the UI queries it verbatim).

**Untouched (historical):** `audit_logs.resource_id` — 407 Account (`ACT-*`), 1,142 Contact
(`CON-*`), 12 Opportunity (`Opp-*`), 3,405 Activity (`ACV-*`); `audit_logs.before/after` JSONB
(1,728 rows containing `ACT-`, plus equivalents for other prefixes).

**Migrated (live/active):** every FK column and soft text-reference column listed in §2
(`opportunities.account_id`, `contacts.account_id`, `activity_associations.entity_id` +
`.activity_id`, `activities.related_id`).

Consequence to document for users: searching audit history by a *new* canonical ID will not return
pre-migration events; the `legacy_id_map` table (§6) is the bridge (join legacy→canonical when a
full timeline is needed).

---

## 4. Migration transaction design

### 4.1 Preconditions

1. Full production snapshot/backup taken and verified restorable (§9.1).
2. Maintenance window: application writes stopped (scale the deployment down, or block API traffic).
   `generateId()` mutates `id_patterns` on every create — no creates may run during the window.
3. Audit gate passes: `npx tsx scripts/canonical-id-audit-prod.ts` exits 0 against the target DB.
4. FKs are `NOT DEFERRABLE` (drizzle default) and have no `ON UPDATE CASCADE`, so the transaction
   makes them deferrable first (Postgres allows `ALTER TABLE … ALTER CONSTRAINT … DEFERRABLE` on
   FK constraints; it takes a brief `ACCESS EXCLUSIVE` lock on each table — trivial at this size).

### 4.2 Single transaction — full script skeleton

One transaction is feasible and preferred: total workload is 657 PK updates + 156 reference
updates + 6 pattern updates — well under one second of actual row I/O.

```sql
BEGIN;

-- (a) Freeze ID generation: take row locks on all id_patterns rows.
--     Any straggler generateId() call blocks here until COMMIT.
SELECT id FROM id_patterns WHERE organization_id IS NULL FOR UPDATE;

-- (b) Make FK constraints deferrable, then defer them, so parent-PK and
--     child-FK updates need not be perfectly interleaved.
ALTER TABLE opportunities        ALTER CONSTRAINT opportunities_account_id_accounts_id_fk               DEFERRABLE;
ALTER TABLE contacts             ALTER CONSTRAINT contacts_account_id_accounts_id_fk                    DEFERRABLE;
ALTER TABLE leads                ALTER CONSTRAINT leads_converted_account_id_accounts_id_fk             DEFERRABLE;
ALTER TABLE candidate_accounts   ALTER CONSTRAINT candidate_accounts_existing_account_id_accounts_id_fk DEFERRABLE;
ALTER TABLE activity_associations ALTER CONSTRAINT activity_associations_activity_id_activities_id_fk   DEFERRABLE;
ALTER TABLE lg_crm_tasks         ALTER CONSTRAINT lg_crm_tasks_activity_id_activities_id_fk             DEFERRABLE;
-- (constraint names above must be confirmed with \d before execution;
--  drizzle names them <table>_<column>_<reftable>_<refcolumn>_fk)
SET CONSTRAINTS ALL DEFERRED;

-- (c) Build the mapping table (also the §6 legacy map, so build it permanent).
CREATE TABLE IF NOT EXISTS legacy_id_map (
  entity      text NOT NULL,
  legacy_id   text NOT NULL,
  canonical_id text NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, legacy_id),
  UNIQUE (entity, canonical_id)
);

INSERT INTO legacy_id_map (entity, legacy_id, canonical_id)
SELECT 'Account', id,
       'ACCT-' || EXTRACT(YEAR FROM created_at)::int || '-' ||
       LPAD(ROW_NUMBER() OVER (ORDER BY created_at, id)::text, 5, '0')
FROM accounts WHERE id LIKE 'ACT-%'
  AND organization_id = '3e369484-0c88-401d-86e3-9c3361ee465e';  -- drop filter for global scope

INSERT INTO legacy_id_map (entity, legacy_id, canonical_id)
SELECT 'Contact', id,
       'CONT-' || to_char(created_at,'YYMM') || '-' ||
       LPAD(ROW_NUMBER() OVER (ORDER BY created_at, id)::text, 5, '0')
FROM contacts WHERE id LIKE 'CON-%' AND id NOT LIKE 'CONT-%'
  AND organization_id = '3e369484-0c88-401d-86e3-9c3361ee465e';

INSERT INTO legacy_id_map (entity, legacy_id, canonical_id)
SELECT 'Opportunity', id, UPPER(id)
FROM opportunities WHERE id LIKE 'Opp-%';

INSERT INTO legacy_id_map (entity, legacy_id, canonical_id)
SELECT 'Activity', id,
       'ACT-' || CASE WHEN split_part(id,'-',2) ~ '^\d{6}$'          -- normalize 202511 → 2511
                      THEN substring(split_part(id,'-',2) from 3)
                      ELSE split_part(id,'-',2) END || '-' ||
       LPAD(ROW_NUMBER() OVER (ORDER BY created_at, id)::text, 5, '0')
FROM activities WHERE id LIKE 'ACV-%'
  AND organization_id = '3e369484-0c88-401d-86e3-9c3361ee465e';

-- (c2) In-transaction collision guard: abort if any proposed ID already exists.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM legacy_id_map m JOIN accounts      a ON a.id = m.canonical_id WHERE m.entity='Account')
  OR EXISTS (SELECT 1 FROM legacy_id_map m JOIN contacts      c ON c.id = m.canonical_id WHERE m.entity='Contact')
  OR EXISTS (SELECT 1 FROM legacy_id_map m JOIN opportunities o ON o.id = m.canonical_id WHERE m.entity='Opportunity')
  OR EXISTS (SELECT 1 FROM legacy_id_map m JOIN activities    v ON v.id = m.canonical_id WHERE m.entity='Activity')
  THEN RAISE EXCEPTION 'canonical ID collision detected — aborting';
  END IF;
END $$;

-- (d) Primary keys (constraints deferred, so order among these is free).
UPDATE accounts      a SET id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account'     AND a.id = m.legacy_id;  -- 56 rows
UPDATE contacts      c SET id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Contact'     AND c.id = m.legacy_id;  -- 69 rows
UPDATE opportunities o SET id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Opportunity' AND o.id = m.legacy_id;  -- 2 rows
UPDATE activities    v SET id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Activity'    AND v.id = m.legacy_id;  -- 530 rows

-- (e) FK reference columns.
UPDATE opportunities o SET account_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account' AND o.account_id = m.legacy_id;                -- 91 rows (87 HT-scope)
UPDATE contacts      c SET account_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account' AND c.account_id = m.legacy_id;                -- 17 rows
UPDATE activity_associations aa SET activity_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Activity' AND aa.activity_id = m.legacy_id;   -- 46 rows

-- (f) Soft text references.
UPDATE activity_associations aa SET entity_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account' AND aa.entity_type='Account' AND aa.entity_id = m.legacy_id;  -- 1 row
UPDATE activities v SET related_id = m.canonical_id FROM legacy_id_map m WHERE m.entity='Account' AND v.related_type='Account' AND v.related_id = m.legacy_id;             -- 1 row

-- (g) id_patterns target state (§5).
UPDATE id_patterns SET pattern='ACCT-{YYYY}-{SEQ:5}',    counter=56,   start_value=1, last_issued=NULL, updated_at=now() WHERE entity='Account'     AND organization_id IS NULL;
UPDATE id_patterns SET pattern='CONT-{YY}{MM}-{SEQ:5}',  counter=69,   start_value=1, last_issued=NULL, updated_at=now() WHERE entity='Contact'     AND organization_id IS NULL;
UPDATE id_patterns SET pattern='OPP-{YYYY}-{SEQ:6}',     counter=2137, start_value=1, last_issued=NULL, updated_at=now() WHERE entity='Opportunity' AND organization_id IS NULL;
UPDATE id_patterns SET pattern='ACT-{YY}{MM}-{SEQ:5}',   counter=530,  start_value=1, last_issued=NULL, updated_at=now() WHERE entity='Activity'    AND organization_id IS NULL;
-- Lead and Document rows are already canonical: not touched.

-- (h) Validation queries (§8) — run here, inside the transaction. Any failure → ROLLBACK.

-- (i) Restore constraint timing.
SET CONSTRAINTS ALL IMMEDIATE;   -- forces FK re-check now; fails loudly if anything is broken
ALTER TABLE opportunities        ALTER CONSTRAINT opportunities_account_id_accounts_id_fk               NOT DEFERRABLE;
ALTER TABLE contacts             ALTER CONSTRAINT contacts_account_id_accounts_id_fk                    NOT DEFERRABLE;
ALTER TABLE leads                ALTER CONSTRAINT leads_converted_account_id_accounts_id_fk             NOT DEFERRABLE;
ALTER TABLE candidate_accounts   ALTER CONSTRAINT candidate_accounts_existing_account_id_accounts_id_fk NOT DEFERRABLE;
ALTER TABLE activity_associations ALTER CONSTRAINT activity_associations_activity_id_activities_id_fk   NOT DEFERRABLE;
ALTER TABLE lg_crm_tasks         ALTER CONSTRAINT lg_crm_tasks_activity_id_activities_id_fk             NOT DEFERRABLE;

COMMIT;
```

### 4.3 Locking, row counts, and window estimate

| Statement group | Rows | Lock scope |
|---|---:|---|
| `id_patterns … FOR UPDATE` | 6 | row locks, held to COMMIT (this *is* the ID-generation freeze) |
| `ALTER CONSTRAINT` (×6, both directions) | DDL | brief ACCESS EXCLUSIVE per table; instant on tables this size |
| PK updates | 657 | row locks |
| FK/soft reference updates | 156 | row locks |
| `id_patterns` updates | 4 | already locked |

Total mutated rows < 1,500; expected transaction wall-time **well under 10 seconds**. Maintenance
window estimate: **30–45 minutes** end-to-end (backup verification 10–15 min, script run ~1 min,
in-transaction validation ~1 min, app restart + smoke tests 10–15 min, buffer). Checkpoints/batching
are unnecessary at this volume; the all-or-nothing single transaction is strictly safer.

---

## 5. `id_patterns` target state

Generator arithmetic (from `server/db.ts`): next issued `SEQ = start_value + counter` (counter is
pre-incremented, then `SEQ = start_value + counter_after − 1`). Choose `start_value = 1` and set
`counter` = highest sequence number already consumed, so the next ID is strictly greater than every
existing ID:

| Entity | New pattern | counter | start_value | First post-migration ID (issued in month of creation) | Why safe |
|---|---|---:|---:|---|---|
| Account | `ACCT-{YYYY}-{SEQ:5}` | **56** | 1 | `ACCT-2026-00057` | migration consumed seq 1–56; no other `ACCT-*` exists (live check = 0) |
| Contact | `CONT-{YY}{MM}-{SEQ:5}` | **69** | 1 | `CONT-2608-00070` | migration consumed 1–69; legacy-canonical `CONT-0002…0017` have max tail 17 < 70 and a different shape |
| Opportunity | `OPP-{YYYY}-{SEQ:6}` | **2137** | 1 | `OPP-2026-002138` | live max numeric tail across all opportunities = 2137 (`OPP-2137`); 2138 clears every existing tail, and the 6-digit/`{YYYY}` shape cannot equal any `OPP-{4}` ID anyway |
| Activity | `ACT-{YY}{MM}-{SEQ:5}` | **530** | 1 | `ACT-2608-00531` | migration consumed 1–530 (531 if global scope: set counter=531); zero pre-existing `ACT-*` activities |
| Lead | `LEAD-{SEQ:6}` (unchanged) | 120 (keep) | 35 (keep) | `LEAD-000155` | already canonical; live max tail 153 < next 155 (LEAD-000154 was issued to a since-deleted row) |
| Document | `DOC-{SEQ:6}` (unchanged) | 0 (keep) | 1 (keep) | `DOC-000001` | table empty |

If the §1.5 **global scope** is chosen: Account counter = **59**, Activity counter = **531**.

The exact UPDATE statements are step (g) in §4.2 — to be reviewed, not executed, as part of this plan.

---

## 6. Temporary legacy mapping table — RECOMMEND: **YES, keep for one release**

Rationale: the MCP integration ("GROK BOT - MCP - HTI" API key), ChatGPT sales-agent sessions, and
forecasting tools hold cached `ACT-*`/`CON-*`/`ACV-*` IDs in conversation history, saved reports,
and bookmarks. With 657 renames, a resolvable mapping converts hard 404s into a self-service lookup,
and it is also the §9 rollback vehicle and the §3 audit-history bridge. Cost is negligible (657 rows).

- **Schema:** as created in §4.2(c): `legacy_id_map(entity, legacy_id PK, canonical_id UNIQUE-per-entity, migrated_at)`.
- **Population:** inside the migration transaction (it *drives* the migration, so it is guaranteed complete and consistent).
- **Exposure (optional, post-migration code change — out of scope here):** a read-only lookup
  endpoint or a 404 body hint (`{"error":"not found","canonical_id":"ACCT-2025-00001"}`). Do **not**
  transparently alias old IDs on the main GET routes — that would institutionalize the dual namespace.
- **Lifetime policy:** keep for **one release cycle / 90 days**, announce the drop date with the
  migration notice, then `DROP TABLE legacy_id_map` (export a CSV copy to the repo/docs first for
  permanent reference).

---

## 7. External API & MCP impact analysis

- **URL paths embedding IDs:** `GET/PATCH /api/v1/external/{accounts|contacts|activities|opportunities}/:id`
  return **404 for legacy IDs** after migration (routes have no prefix validation — legacy IDs are
  passed through verbatim today, so old bookmarks/scripts break). Breaking change; publish the
  mapping (§6).
- **Prefix contract:** the documented contract (`docs/openapi.yaml`: Account `ACCT-*`, Contact
  `CONT-*`, Lead `LEAD-*`, Opportunity `OPP-*`, Activity `ACT-*`, Document `DOC-*`) is **unchanged
  by this migration and becomes true for the first time**. Post-migration, every ID the API and MCP
  return matches the documented prefix. Confirmed correct: no code change to the contract is needed.
- **Critical semantic flip for AI/MCP consumers:** today `ACT-*` means *Account* in production data;
  after migration `ACT-*` means *Activity*. Any MCP session or client cache holding pre-migration
  IDs must be flushed/restarted at cutover — an old `ACT-2103` will no longer resolve as an account
  and must never be interpreted as an activity (shape differs: no `ACT-{4}` activity will ever exist,
  since activity IDs are always `ACT-{YYMM}-{SEQ:5}`).
- **List endpoints / counts:** unaffected — row counts per entity are identical before and after
  (rename only). Live-API HT account count stays 56 (V7, §8).
- **Forecasting tools & saved reports:** any stored entity IDs must be re-resolved via
  `legacy_id_map`. `saved_filters` in the DB contain no IDs (live check = 0), so only *external*
  caches are affected.
- **Webhooks/exports:** CSV exports produced before migration contain legacy IDs — same mapping applies.

---

## 8. Pre-commit validation queries

Run inside the transaction (§4.2 step h), after step (g). **Any non-passing result → ROLLBACK.**
Scope filter `organization_id = '3e369484-0c88-401d-86e3-9c3361ee465e'` shown; drop it under global scope.

```sql
-- V1: pattern conformance — each must return 0
SELECT COUNT(*) FROM accounts      WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e' AND id !~ '^ACCT-\d{4}-\d{5}$';
SELECT COUNT(*) FROM contacts      WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e' AND id !~ '^CONT-(\d{4}-\d{5}|\d{4})$';  -- allows legacy-canonical CONT-00nn
SELECT COUNT(*) FROM leads         WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e' AND id !~ '^LEAD-\d{6}$';
SELECT COUNT(*) FROM opportunities WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e' AND id !~ '^OPP-';
SELECT COUNT(*) FROM activities    WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e' AND id !~ '^ACT-\d{4}-\d{5}$';

-- V2: no legacy prefixes remain — each must return 0
SELECT COUNT(*) FROM accounts WHERE id LIKE 'ACT-%';
SELECT COUNT(*) FROM contacts WHERE id LIKE 'CON-%' AND id NOT LIKE 'CONT-%';
SELECT COUNT(*) FROM opportunities WHERE id LIKE 'Opp-%';
SELECT COUNT(*) FROM activities WHERE id LIKE 'ACV-%';

-- V3: zero duplicates per table (PK guarantees this; belt-and-braces) — each 0 rows
SELECT id FROM accounts GROUP BY id HAVING COUNT(*)>1;
SELECT id FROM contacts GROUP BY id HAVING COUNT(*)>1;
SELECT id FROM opportunities GROUP BY id HAVING COUNT(*)>1;
SELECT id FROM activities GROUP BY id HAVING COUNT(*)>1;

-- V3b: zero Account/Activity cross-table ID overlap — 0 rows
SELECT a.id FROM accounts a JOIN activities v ON v.id = a.id;

-- V4: zero broken FKs — each must return 0
SELECT COUNT(*) FROM opportunities o LEFT JOIN accounts a ON a.id=o.account_id WHERE o.account_id IS NOT NULL AND a.id IS NULL;
SELECT COUNT(*) FROM contacts c LEFT JOIN accounts a ON a.id=c.account_id WHERE c.account_id IS NOT NULL AND a.id IS NULL;
SELECT COUNT(*) FROM leads l LEFT JOIN accounts a ON a.id=l.converted_account_id WHERE l.converted_account_id IS NOT NULL AND a.id IS NULL;
SELECT COUNT(*) FROM leads l LEFT JOIN contacts c ON c.id=l.converted_contact_id WHERE l.converted_contact_id IS NOT NULL AND c.id IS NULL;
SELECT COUNT(*) FROM leads l LEFT JOIN opportunities o ON o.id=l.converted_opportunity_id WHERE l.converted_opportunity_id IS NOT NULL AND o.id IS NULL;
SELECT COUNT(*) FROM activity_associations aa LEFT JOIN activities v ON v.id=aa.activity_id WHERE v.id IS NULL;
SELECT COUNT(*) FROM opportunity_contacts oc LEFT JOIN contacts c ON c.id=oc.contact_id WHERE c.id IS NULL;
SELECT COUNT(*) FROM opportunity_contacts oc LEFT JOIN opportunities o ON o.id=oc.opportunity_id WHERE o.id IS NULL;
SELECT COUNT(*) FROM opportunity_resources orr LEFT JOIN opportunities o ON o.id=orr.opportunity_id WHERE o.id IS NULL;

-- V5: zero *active* references to legacy IDs (audit_logs intentionally excluded) — each 0
SELECT COUNT(*) FROM activity_associations WHERE entity_id LIKE 'ACT-%' AND entity_type='Account';
SELECT COUNT(*) FROM activity_associations WHERE entity_id ~ '^(CON-|Opp-|ACV-)';
SELECT COUNT(*) FROM activities WHERE related_id ~ '^(CON-|Opp-|ACV-)' OR (related_type='Account' AND related_id LIKE 'ACT-%');
SELECT COUNT(*) FROM entity_tags WHERE entity_id ~ '^(CON-(?!T)|Opp-|ACV-)' OR (entity='Account' AND entity_id LIKE 'ACT-%');
SELECT COUNT(*) FROM comments WHERE entity_id ~ '^(CON-(?!T)|Opp-|ACV-)' OR (entity IN ('Account','accounts') AND entity_id LIKE 'ACT-%');

-- V6: id_patterns equal canonical contract — must return exactly these 6 rows
SELECT entity, pattern, counter, start_value FROM id_patterns WHERE organization_id IS NULL ORDER BY entity;
-- expect: Account ACCT-{YYYY}-{SEQ:5} 56 1 · Activity ACT-{YY}{MM}-{SEQ:5} 530 1 ·
--         Contact CONT-{YY}{MM}-{SEQ:5} 69 1 · Document DOC-{SEQ:6} 0 1 ·
--         Lead LEAD-{SEQ:6} 120 35 · Opportunity OPP-{SEQ:4→ set to OPP-{YYYY}-{SEQ:6}} 2137 1

-- V7: generator produces a collision-free next ID (simulate SEQ = start_value + counter) — each 0
SELECT COUNT(*) FROM accounts      WHERE id = 'ACCT-' || EXTRACT(YEAR FROM now())::int || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Account' AND organization_id IS NULL)::text,5,'0');
SELECT COUNT(*) FROM contacts      WHERE id = 'CONT-' || to_char(now(),'YYMM') || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Contact' AND organization_id IS NULL)::text,5,'0');
SELECT COUNT(*) FROM opportunities WHERE id = 'OPP-' || EXTRACT(YEAR FROM now())::int || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Opportunity' AND organization_id IS NULL)::text,6,'0');
SELECT COUNT(*) FROM activities    WHERE id = 'ACT-' || to_char(now(),'YYMM') || '-' || LPAD((SELECT start_value+counter FROM id_patterns WHERE entity='Activity' AND organization_id IS NULL)::text,5,'0');

-- V8: row counts unchanged (rename-only invariant) — compare to §0 baseline
SELECT (SELECT COUNT(*) FROM accounts WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e') AS accounts_56,
       (SELECT COUNT(*) FROM contacts WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e') AS contacts_85,
       (SELECT COUNT(*) FROM leads WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e') AS leads_59,
       (SELECT COUNT(*) FROM opportunities WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e') AS opps_87,
       (SELECT COUNT(*) FROM activities WHERE organization_id='3e369484-0c88-401d-86e3-9c3361ee465e') AS acts_530;
-- expect 56 / 85 / 59 / 87 / 530

-- V9: legacy_id_map completeness — expect Account 56, Contact 69, Opportunity 2, Activity 530
SELECT entity, COUNT(*) FROM legacy_id_map GROUP BY entity ORDER BY entity;
```

Post-COMMIT (application-level): `GET /api/v1/external/accounts` returns 56 rows, all matching
`^ACCT-\d{4}-\d{5}$`; a create of each entity type succeeds and yields the §5 "first post-migration
ID"; `GET /accounts/ACT-1000` returns 404.

---

## 9. Rollback plan

1. **Snapshot before anything.** A full database backup (Replit checkpoint/PITR mark plus an
   explicit `pg_dump`) is a **hard precondition** — no statement from §4 runs without a verified,
   restorable backup and a recorded restore point timestamp.
2. **Mid-transaction failure:** everything in §4.2 is one transaction; any error (including the
   collision guard and constraint re-checks at `SET CONSTRAINTS ALL IMMEDIATE`) aborts and
   PostgreSQL rolls back **all** changes atomically, including the `ALTER CONSTRAINT` DDL and the
   `legacy_id_map` creation. The database is untouched; investigate and reschedule.
3. **Validation failure inside the transaction (§8):** issue `ROLLBACK` explicitly. Same outcome as (2).
4. **Post-COMMIT reversal (before new writes):** `legacy_id_map` makes the migration fully
   invertible — run the §4.2 script with `legacy_id`/`canonical_id` swapped in every UPDATE and
   restore the §0.2 `id_patterns` values (`ACT-{SEQ:4}` counter=1062 start=1042, `ACV-…` counter=76,
   `CONT-{SEQ:4}` counter=17, `OPP-{SEQ:4}` counter=1091 start=1047). Verify with §8 V2 inverted
   (all IDs match *old* prefixes again).
5. **Post-COMMIT reversal (after new writes have occurred):** mapped reversal still works for the
   657 renamed rows (new canonical-only rows are unaffected and keep their IDs — they collide with
   nothing in the legacy namespace), but prefer this only if the application is functionally broken;
   otherwise fix forward.
6. **Smoke-test failure after deploy:** if the app misbehaves at cutover, first roll back the
   *application* (redeploy previous build) — the data migration is app-version-agnostic (the code's
   canonical defaults already match the new patterns, and no code change is required by this
   migration). If the data itself is at fault, execute (4). Last resort: restore the step-1 snapshot
   (accepting loss of any writes made after the window opened — which is why writes stay stopped
   until smoke tests pass).
7. **Escalation criteria:** restore-from-snapshot only if both mapped reversal and forward-fix fail;
   record the decision and timings in the migration log.

---

## 10. Final report summary

| Item | Value |
|---|---|
| Records renamed | **657** — Accounts 56, Contacts 69, Opportunities 2, Activities 530 (+4 if global scope: 3 accounts, 1 activity) |
| Live references updated | **156** — opportunities.account_id 91, contacts.account_id 17, activity_associations.activity_id 46, activity_associations.entity_id 1, activities.related_id 1 |
| Audit rows intentionally untouched | 4,966 `resource_id` refs (407 + 1,142 + 12 + 3,405) + JSONB payloads |
| `id_patterns` rows updated | 4 (Account, Contact, Opportunity, Activity); Lead & Document unchanged |
| Entities needing no record migration | Leads (59, canonical), Documents (0 rows) |
| Transaction | Single atomic transaction; < 1,500 mutated rows; seconds of runtime |
| Downtime estimate | **30–45 min maintenance window** (writes stopped); actual script runtime < 1 min |
| Data volume risk | **Low** — small tables, full pre-verified backup, all-or-nothing transaction, in-transaction validation gates |
| Highest residual risks | (1) executing against the wrong database — mitigated by the audit gate script; (2) external/MCP clients holding legacy IDs — mitigated by `legacy_id_map` + published mapping + cache flush at cutover; (3) `ACT-` prefix semantic flip (Account→Activity) for AI tools — mitigated by same-transaction rename ordering and client restart |
| Rollback | Fully invertible via `legacy_id_map`; snapshot restore as last resort |
| Follow-up (separate tasks, out of scope) | startup drift-check for `id_patterns` vs code defaults (Task 209 territory); decision & comms on the `legacy_id_map` drop date; optional global-scope inclusion of the 3 Lucentria `ACT-*` accounts |

**This document is self-contained:** a DBA needs only production `DATABASE_URL` access, the audit
gate script (`scripts/canonical-id-audit-prod.ts`), and the SQL in §4 and §8 to execute and verify
the migration.
