// Integration tests for lead-gen candidate approval
// Verifies source, topic, and org stamping on the created CRM lead.
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import * as schema from "@shared/schema";
import { eq, inArray, and, sql } from "drizzle-orm";
import { researchDocuments } from "@shared/schema";

const BASE = "http://localhost:5000";

// ── helpers ────────────────────────────────────────────────────────────────

async function getCsrf(jar: Map<string, string>): Promise<string> {
  const res = await fetch(`${BASE}/api/csrf-token`, { credentials: "include" });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    for (const part of setCookie.split(",")) {
      const [kv] = part.trim().split(";");
      const [k, v] = kv.split("=");
      jar.set(k.trim(), v?.trim() ?? "");
    }
  }
  const { csrfToken } = await res.json() as { csrfToken: string };
  return csrfToken;
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function loginAdmin(jar: Map<string, string>, csrf: string) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: cookieHeader(jar),
    },
    body: JSON.stringify({ email: "admin@test.com", password: "admin123" }),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    for (const part of setCookie.split(",")) {
      const [kv] = part.trim().split(";");
      const [k, v] = kv.split("=");
      jar.set(k.trim(), v?.trim() ?? "");
    }
  }
  return res;
}

// ── test state ─────────────────────────────────────────────────────────────

const RUN_ID = "test-approval-149";
const ACCT_ID = "test-acct-149";
const CONT_ID = "test-cont-149";
const CAND_WITH_DOCS = "test-cand-149-docs";
const CAND_NO_DOCS = "test-cand-149-nodocs";
const ACCT_NO_DOCS = "test-acct-149-nd";
const RDOC_ID = "test-rdoc-149";

let orgId: string;
let approvedLeadIds: string[] = [];

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(1);
  expect(orgs.length).toBeGreaterThan(0);
  orgId = orgs[0].id;

  // Seed run + candidate records
  await db.insert(schema.leadGenerationRuns).values({
    id: RUN_ID, name: "Approval Test Run 149", organizationId: orgId, status: "complete",
  }).onConflictDoNothing();

  await db.insert(schema.candidateAccounts).values({
    id: ACCT_ID, runId: RUN_ID, name: "TestCo 149",
  }).onConflictDoNothing();

  await db.insert(schema.candidateContacts).values({
    id: CONT_ID, runId: RUN_ID, firstName: "Alex", lastName: "Test149",
    email: `alex.test149.${Date.now()}@example.com`,
  }).onConflictDoNothing();

  // Candidate with research doc
  await db.insert(schema.candidateLeads).values({
    id: CAND_WITH_DOCS, runId: RUN_ID,
    candidateAccountId: ACCT_ID, candidateContactId: CONT_ID,
    status: "pending_review",
  }).onConflictDoNothing();

  // Research doc for the account (company_overview)
  await db.insert(researchDocuments).values({
    id: RDOC_ID,
    entityType: "candidate_account",
    entityId: ACCT_ID,
    documentType: "company_overview",
    title: "TestCo Overview",
    content: "TestCo 149 is a cloud-native automation platform targeting mid-market enterprises. " +
      "Their flagship product integrates with 50+ SaaS tools. Raised $20M Series B in 2024.",
    runId: RUN_ID,
  }).onConflictDoNothing();

  // Candidate with NO research docs — uses a separate account so it doesn't inherit the doc above
  await db.insert(schema.candidateAccounts).values({
    id: ACCT_NO_DOCS, runId: RUN_ID, name: "NoDocs Corp 149",
  }).onConflictDoNothing();
  const contNoDocs = "test-cont-149-nd";
  await db.insert(schema.candidateContacts).values({
    id: contNoDocs, runId: RUN_ID, firstName: "Bob", lastName: "NoDocs149",
    email: `bob.nodocs149.${Date.now()}@example.com`,
  }).onConflictDoNothing();
  await db.insert(schema.candidateLeads).values({
    id: CAND_NO_DOCS, runId: RUN_ID,
    candidateAccountId: ACCT_NO_DOCS, candidateContactId: contNoDocs,
    status: "pending_review",
  }).onConflictDoNothing();
});

afterAll(async () => {
  // Delete in FK-safe order
  await db.delete(schema.activityAssociations)
    .where(sql`activity_id IN (SELECT activity_id FROM lg_crm_tasks WHERE run_id = ${RUN_ID})`);
  await db.execute(sql`DELETE FROM lg_crm_tasks WHERE run_id = ${RUN_ID}`);
  await db.execute(sql`DELETE FROM lg_crm_leads WHERE run_id = ${RUN_ID}`);
  await db.execute(sql`DELETE FROM review_decisions WHERE candidate_lead_id IN (${CAND_WITH_DOCS}, ${CAND_NO_DOCS})`);
  if (approvedLeadIds.length > 0) {
    await db.delete(schema.leads).where(inArray(schema.leads.id, approvedLeadIds));
  }
  await db.execute(sql`DELETE FROM research_documents WHERE id = ${RDOC_ID}`);
  await db.execute(sql`DELETE FROM candidate_leads WHERE run_id = ${RUN_ID}`);
  await db.execute(sql`DELETE FROM candidate_contacts WHERE run_id = ${RUN_ID}`);
  await db.execute(sql`DELETE FROM candidate_accounts WHERE id IN (${ACCT_ID}, ${ACCT_NO_DOCS})`);
  await db.execute(sql`DELETE FROM lg_audit_events WHERE run_id = ${RUN_ID}`);
  await db.execute(sql`DELETE FROM lead_generation_runs WHERE id = ${RUN_ID}`);
});

// ── tests ──────────────────────────────────────────────────────────────────

describe("Lead-gen candidate approval", () => {
  let jar: Map<string, string>;
  let csrf: string;

  beforeAll(async () => {
    jar = new Map();
    csrf = await getCsrf(jar);
    const loginRes = await loginAdmin(jar, csrf);
    expect(loginRes.status).toBe(200);
    // Refresh CSRF after login
    csrf = await getCsrf(jar);
  });

  async function approve(candidateId: string) {
    return fetch(`${BASE}/api/lead-gen/candidates/${candidateId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        Cookie: cookieHeader(jar),
      },
      body: JSON.stringify({}),
    });
  }

  it("sets source to lead_generation on approval", async () => {
    const res = await approve(CAND_WITH_DOCS);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    const leadId: string = body.crmLeadId;
    approvedLeadIds.push(leadId);

    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    expect(lead).toBeDefined();
    expect(lead.source).toBe("lead_generation");
  });

  it("populates topic from company_overview research doc", async () => {
    const leadId = approvedLeadIds[0];
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    expect(lead.topic).toBeTruthy();
    expect(lead.topic).toContain("TestCo 149");
  });

  it("stamps the correct org on the approved lead", async () => {
    const leadId = approvedLeadIds[0];
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    expect(lead.organizationId).toBe(orgId);
  });

  it("uses fallback topic when no research docs exist", async () => {
    const res = await approve(CAND_NO_DOCS);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    const leadId: string = body.crmLeadId;
    approvedLeadIds.push(leadId);

    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    expect(lead.source).toBe("lead_generation");
    expect(lead.topic).toBe("Approved from lead generation run.");
  });
});
