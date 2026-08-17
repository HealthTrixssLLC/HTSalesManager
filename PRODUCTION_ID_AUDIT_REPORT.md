# Production DB Canonical ID Audit — Task 210 (Correct Database)

Read-only audit of the **real** production database behind the deployed application.
Data below was captured 2026-08-17 from Replit's read-only **production database replica**
(the production `DATABASE_URL` is bound only inside the deployment and is not exposed to the
workspace; the workspace `DATABASE_URL` is the development instance `helium/heliumdb`, which the
audit gate in `scripts/canonical-id-audit-prod.ts` correctly rejects). No data was modified —
SELECT queries only.

```
DEPLOYED APPLICATION: https://htsalesmanager.healthtrixss.com
DEPLOYED REVISION: workspace HEAD at audit time = 7f68c2eafbc3efbebde378aa01bff1a8cf82a328
  (2026-08-17T18:31:54Z; exact deployed build SHA is recorded by the Replit deployment,
   not queryable from the database — production schema/data match current schema.ts)

PRODUCTION DB TYPE: PostgreSQL
PRODUCTION DB HOST/INSTANCE: Replit-managed production PostgreSQL (read via production replica;
  host identifier withheld — only visible inside the deployment)
PRODUCTION DB NAME: (managed by Replit deployment binding of DATABASE_URL)
PRODUCTION CONNECTION CONFIG SOURCE: DATABASE_URL (server/db.ts lines 36–80, drizzle.config.ts)

NEON DB: NEON_DATABASE_URL (referenced only by old audit scripts scripts/canonical-id-audit-ht.ts
  and scripts/canonical-id-audit3.ts; never read by the application)
NEON IS PRODUCTION: NO (stale copy: 41 accounts, ACT-1000–ACT-1041)

HEALTH TRIXSS ORGANIZATION: Primary Organization
HEALTH TRIXSS ORGANIZATION ID: 3e369484-0c88-401d-86e3-9c3361ee465e
  (identified deterministically: all six fingerprint accounts belong to this single org, and the
   active MCP API key "GROK BOT - MCP - HTI" is scoped to it)

ACT-2103 / Cavulus FOUND: YES
ACT-2102 / Integrated Psychiatric Consultants, P.A (IPC) FOUND: YES
ACT-2100 / Providence FOUND: YES
ACT-2099 / Humanizing Technologies FOUND: YES
ACT-2098 / Care Oregon FOUND: YES
ACT-2091 / Care Compass FOUND: YES

LIVE API HT ACCOUNT COUNT: 56
PRODUCTION POSTGRES HT ACCOUNT COUNT: 56
API/POSTGRES PARITY: PASS

PRODUCTION POSTGRES ID PREFIX COUNTS (org 3e369484-0c88-401d-86e3-9c3361ee465e):
  Account:     ACT-  → 56
  Contact:     CON-  → 69, CONT- → 16
  Lead:        LEAD- → 59
  Opportunity: OPP-  → 85, Opp- → 2
  Activity:    ACV-  → 530
  Document:    (0 rows; documents table exists and is empty)

PRODUCTION POSTGRES EFFECTIVE ID PATTERNS (global rows; no org-specific overrides):
  Account:     ACT-{SEQ:4}          counter=1062  start=1042  last_issued=ACT-2103
  Activity:    ACV-{YY}{MM}-{SEQ:5} counter=76    start=1     last_issued=ACV-2607-00076
  Contact:     CONT-{SEQ:4}         counter=17    start=1     last_issued=CONT-0017
  Document:    DOC-{SEQ:6}          counter=0     start=1     last_issued=(none)
  Lead:        LEAD-{SEQ:6}         counter=120   start=35    last_issued=LEAD-000154
  Opportunity: OPP-{SEQ:4}          counter=1091  start=1047  last_issued=OPP-2137

ROOT CAUSE OF PREVIOUS WRONG-DATABASE AUDIT:
  Previous audit scripts passed NEON_DATABASE_URL to mkPool; the application itself never reads
  that variable — only DATABASE_URL is used by server/db.ts and drizzle.config.ts. Additionally,
  the workspace DATABASE_URL points at the development instance, not production; the production
  DATABASE_URL exists only inside the deployment.

RECOMMENDED NEXT STEP:
  id_pattern remediation against the correct production DB (via the deployment's DATABASE_URL)
  once the client approves — notably the Contact pattern (CONT-{SEQ:4}, counter=17) coexisting
  with 69 legacy CON- contacts, and the mixed OPP-/Opp- opportunity prefixes.
```

## Verification of the audit gate

Running `npx tsx scripts/canonical-id-audit-prod.ts` in the workspace (dev `DATABASE_URL`) exits 1
with `AUDIT GATE FAILED` because the fingerprint accounts are absent there (dev has only 50 HT
accounts and no ACT-2098/2099/2100/2102/2103). The script emits a PRODUCTION-labeled report only
when all six fingerprints match by ID **and** name and the HT account count equals 56.
