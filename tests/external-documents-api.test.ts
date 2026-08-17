// Integration tests for the external document reference API (Phase D)
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";

let orgAKey: string;
let orgBKey: string;
let sysKey: string;
let noDocsKey: string;    // org A key WITHOUT documents.* scopes
let readOnlyDocsKey: string; // org A key with documents.read only
let orgAId: string;
let orgBId: string;
let keyIds: string[] = [];
let accountAId: string;
let accountBId: string;
let createdDocIds: string[] = [];

function headers(key: string) {
  return { "x-api-key": key, "Content-Type": "application/json" };
}

async function createDoc(body: any, key: string) {
  const res = await fetch(`${BASE}/documents`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify(body),
  });
  return res;
}

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(1);
  expect(orgs.length).toBeGreaterThan(0);
  orgAId = orgs[0].id;

  // Second org for isolation tests
  const [orgB] = await db.insert(schema.organizations).values({
    name: "Vitest Docs Org B",
    slug: `vitest-docs-org-b-${Date.now()}`,
  }).returning();
  orgBId = orgB.id;

  const users = await db.select().from(schema.users).limit(1);
  expect(users.length).toBeGreaterThan(0);
  const userId = users[0].id;

  const k1 = generateApiKey();
  const k2 = generateApiKey();
  const k3 = generateApiKey();
  const k4 = generateApiKey();
  const k5 = generateApiKey();
  orgAKey = k1.publicKey;
  orgBKey = k2.publicKey;
  sysKey = k3.publicKey;
  noDocsKey = k4.publicKey;
  readOnlyDocsKey = k5.publicKey;

  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: "vitest-docs-orgA-key", isActive: true, organizationId: orgAId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: "vitest-docs-orgB-key", isActive: true, organizationId: orgBId, createdBy: userId },
    { hashedKey: k3.hashedKey, name: "vitest-docs-system-key", isActive: true, organizationId: null, createdBy: userId },
    { hashedKey: k4.hashedKey, name: "vitest-docs-noscope-key", isActive: true, organizationId: orgAId, createdBy: userId, permissions: ["crm.read", "crm.write"] },
    { hashedKey: k5.hashedKey, name: "vitest-docs-readonly-key", isActive: true, organizationId: orgAId, createdBy: userId, permissions: ["documents.read"] },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);

  // One account per org for link tests
  const ts = Date.now();
  const [accA] = await db.insert(schema.accounts).values({
    id: `ACCT-VITEST-DOC-A-${ts}`, organizationId: orgAId, name: "Vitest Doc Account A",
  }).returning();
  accountAId = accA.id;
  const [accB] = await db.insert(schema.accounts).values({
    id: `ACCT-VITEST-DOC-B-${ts}`, organizationId: orgBId, name: "Vitest Doc Account B",
  }).returning();
  accountBId = accB.id;
});

afterAll(async () => {
  if (createdDocIds.length > 0) {
    await db.delete(schema.documents).where(inArray(schema.documents.id, createdDocIds));
  }
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, [accountAId, accountBId].filter(Boolean)));
  if (keyIds.length > 0) {
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  }
  if (orgBId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgBId));
  }
});

describe("External Documents API", () => {
  let docId: string;

  it("creates a document reference with DOC- prefixed ID", async () => {
    const res = await createDoc({
      title: "Master Services Agreement",
      documentType: "contract",
      sourceSystem: "SharePoint",
      canonicalUrl: "https://contoso.sharepoint.com/sites/legal/msa.docx",
      version: "1.2",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      externalId: "sp-guid-123",
    }, orgAKey);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toMatch(/^DOC-/);
    expect(body.data.organizationId).toBe(orgAId);
    expect(body.data.title).toBe("Master Services Agreement");
    expect(body.data.status).toBe("active");
    expect(body.data.canonicalUrl).toBe("https://contoso.sharepoint.com/sites/legal/msa.docx");
    docId = body.data.id;
    createdDocIds.push(docId);
  });

  it("rejects missing required fields", async () => {
    const res = await createDoc({ documentType: "contract" }, orgAKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    const fields = body.details.map((d: any) => d.field);
    expect(fields).toContain("title");
    expect(fields).toContain("canonicalUrl");
  });

  it("rejects Azure SAS-style signed URLs", async () => {
    const res = await createDoc({
      title: "Bad URL",
      canonicalUrl: "https://acct.blob.core.windows.net/c/f.pdf?sv=2022&se=2026&sp=r&sig=abc123",
    }, orgAKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid canonicalUrl");
  });

  it("rejects AWS presigned URLs", async () => {
    const res = await createDoc({
      title: "Bad URL",
      canonicalUrl: "https://bucket.s3.amazonaws.com/f.pdf?X-Amz-Signature=deadbeef&X-Amz-Credential=x",
    }, orgAKey);
    expect(res.status).toBe(400);
  });

  it("rejects URLs with access tokens or embedded credentials", async () => {
    const res1 = await createDoc({
      title: "Bad URL",
      canonicalUrl: "https://example.com/doc?access_token=secret",
    }, orgAKey);
    expect(res1.status).toBe(400);
    const res2 = await createDoc({
      title: "Bad URL",
      canonicalUrl: "https://user:pass@example.com/doc.pdf",
    }, orgAKey);
    expect(res2.status).toBe(400);
    const res3 = await createDoc({
      title: "Bad URL",
      canonicalUrl: "not a url",
    }, orgAKey);
    expect(res3.status).toBe(400);
  });

  it("rejects OAuth implicit-flow tokens carried in the URL fragment", async () => {
    const res = await createDoc({
      title: "Bad URL",
      canonicalUrl: "https://example.com/doc#access_token=eyJhbGciOi&token_type=Bearer",
    }, orgAKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid canonicalUrl");
    const res2 = await createDoc({
      title: "Bad URL",
      canonicalUrl: "https://example.com/doc#id_token=abc",
    }, orgAKey);
    expect(res2.status).toBe(400);
  });

  it("rejects credential parameter spelling variants", async () => {
    const badUrls = [
      "https://example.com/doc?api_key=abc",
      "https://example.com/doc?apikey=abc",
      "https://example.com/doc?ApiKey=abc",
      "https://example.com/doc?X-Api-Key=abc",
      "https://example.com/doc?client_secret=abc",
      "https://example.com/doc?id_token=abc",
      "https://example.com/doc?authorization=Bearer%20abc",
      "https://example.com/doc?session_key=abc",
      "https://example.com/doc?AWSAccessKeyId=abc&Signature=def&Expires=123",
      "https://example.com/doc?X-Goog-Signature=abc",
      "https://example.com/doc?key=abc",
    ];
    for (const canonicalUrl of badUrls) {
      const res = await createDoc({ title: "Bad URL", canonicalUrl }, orgAKey);
      expect(res.status, `expected rejection for ${canonicalUrl}`).toBe(400);
    }
  });

  it("accepts stable non-credential URLs with benign query params and fragments", async () => {
    const okUrls = [
      "https://github.com/org/repo/blob/main/README.md#usage",
      "https://contoso.sharepoint.com/sites/x/doc.docx?web=1&version=3",
    ];
    for (const canonicalUrl of okUrls) {
      const res = await createDoc({ title: "Good URL", canonicalUrl }, orgAKey);
      expect(res.status, `expected acceptance for ${canonicalUrl}`).toBe(201);
      const body = await res.json();
      createdDocIds.push(body.data.id);
    }
  });

  it("requires an org-bound key for document creation", async () => {
    const res = await createDoc({
      title: "Sys Doc",
      canonicalUrl: "https://example.com/doc.pdf",
    }, sysKey);
    expect(res.status).toBe(403);
  });

  it("retrieves a single document with links array", async () => {
    const res = await fetch(`${BASE}/documents/${docId}`, { headers: headers(orgAKey) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(docId);
    expect(body.data.links).toEqual([]);
  });

  it("enforces org isolation on detail (other org gets 404)", async () => {
    const res = await fetch(`${BASE}/documents/${docId}`, { headers: headers(orgBKey) });
    expect(res.status).toBe(404);
  });

  it("links a document to an account in the same org", async () => {
    const res = await fetch(`${BASE}/documents/${docId}/links`, {
      method: "POST",
      headers: headers(orgAKey),
      body: JSON.stringify({ entityType: "account", entityId: accountAId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.data.entityType).toBe("account");
    expect(body.data.entityId).toBe(accountAId);
  });

  it("is idempotent when linking twice", async () => {
    const res = await fetch(`${BASE}/documents/${docId}/links`, {
      method: "POST",
      headers: headers(orgAKey),
      body: JSON.stringify({ entityType: "account", entityId: accountAId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(false);
  });

  it("rejects invalid entity types", async () => {
    const res = await fetch(`${BASE}/documents/${docId}/links`, {
      method: "POST",
      headers: headers(orgAKey),
      body: JSON.stringify({ entityType: "invoice", entityId: "X-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects links to entities in a different org", async () => {
    const res = await fetch(`${BASE}/documents/${docId}/links`, {
      method: "POST",
      headers: headers(orgAKey),
      body: JSON.stringify({ entityType: "account", entityId: accountBId }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects links to nonexistent entities", async () => {
    const res = await fetch(`${BASE}/documents/${docId}/links`, {
      method: "POST",
      headers: headers(orgAKey),
      body: JSON.stringify({ entityType: "lead", entityId: "LEAD-DOES-NOT-EXIST" }),
    });
    expect(res.status).toBe(404);
  });

  it("lists documents with entityType/entityId filters", async () => {
    // A second, unlinked document
    const res2 = await createDoc({
      title: "Unlinked Proposal",
      canonicalUrl: "https://contoso.sharepoint.com/sites/sales/proposal.pdf",
    }, orgAKey);
    const doc2 = (await res2.json()).data;
    createdDocIds.push(doc2.id);

    const all = await fetch(`${BASE}/documents`, { headers: headers(orgAKey) });
    const allBody = await all.json();
    const allIds = allBody.data.map((d: any) => d.id);
    expect(allIds).toContain(docId);
    expect(allIds).toContain(doc2.id);
    expect(allBody.pagination.total).toBeGreaterThanOrEqual(2);

    const filtered = await fetch(
      `${BASE}/documents?entityType=account&entityId=${encodeURIComponent(accountAId)}`,
      { headers: headers(orgAKey) }
    );
    const filteredBody = await filtered.json();
    const filteredIds = filteredBody.data.map((d: any) => d.id);
    expect(filteredIds).toContain(docId);
    expect(filteredIds).not.toContain(doc2.id);
  });

  it("supports updatedSince, limit and offset", async () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const none = await fetch(`${BASE}/documents?updatedSince=${encodeURIComponent(future)}`, { headers: headers(orgAKey) });
    const noneBody = await none.json();
    expect(noneBody.data.length).toBe(0);

    const bad = await fetch(`${BASE}/documents?updatedSince=not-a-date`, { headers: headers(orgAKey) });
    expect(bad.status).toBe(400);

    const limited = await fetch(`${BASE}/documents?limit=1&offset=0`, { headers: headers(orgAKey) });
    const limitedBody = await limited.json();
    expect(limitedBody.data.length).toBe(1);
    expect(limitedBody.pagination.limit).toBe(1);
    expect(limitedBody.pagination.hasMore).toBe(true);
  });

  it("rejects an invalid entityType filter on list", async () => {
    const res = await fetch(`${BASE}/documents?entityType=invoice`, { headers: headers(orgAKey) });
    expect(res.status).toBe(400);
  });

  it("enforces org isolation on list", async () => {
    const res = await fetch(`${BASE}/documents`, { headers: headers(orgBKey) });
    const body = await res.json();
    const ids = body.data.map((d: any) => d.id);
    expect(ids).not.toContain(docId);
  });

  it("prevents cross-org link removal and document access", async () => {
    const res = await fetch(
      `${BASE}/documents/${docId}/links/account/${encodeURIComponent(accountAId)}`,
      { method: "DELETE", headers: headers(orgBKey) }
    );
    expect(res.status).toBe(404);
  });

  it("removes a link and returns 404 when removing again", async () => {
    const res = await fetch(
      `${BASE}/documents/${docId}/links/account/${encodeURIComponent(accountAId)}`,
      { method: "DELETE", headers: headers(orgAKey) }
    );
    expect(res.status).toBe(204);

    const again = await fetch(
      `${BASE}/documents/${docId}/links/account/${encodeURIComponent(accountAId)}`,
      { method: "DELETE", headers: headers(orgAKey) }
    );
    expect(again.status).toBe(404);

    // Detail no longer shows the link
    const detail = await fetch(`${BASE}/documents/${docId}`, { headers: headers(orgAKey) });
    const body = await detail.json();
    expect(body.data.links).toEqual([]);
  });

  it("denies all document endpoints to keys without documents scopes", async () => {
    const create = await createDoc({ title: "X", canonicalUrl: "https://example.com/x.pdf" }, noDocsKey);
    expect(create.status).toBe(403);
    const list = await fetch(`${BASE}/documents`, { headers: headers(noDocsKey) });
    expect(list.status).toBe(403);
    const detail = await fetch(`${BASE}/documents/${docId}`, { headers: headers(noDocsKey) });
    expect(detail.status).toBe(403);
    const link = await fetch(`${BASE}/documents/${docId}/links`, {
      method: "POST", headers: headers(noDocsKey),
      body: JSON.stringify({ entityType: "account", entityId: accountAId }),
    });
    expect(link.status).toBe(403);
    const unlink = await fetch(`${BASE}/documents/${docId}/links/account/${encodeURIComponent(accountAId)}`, {
      method: "DELETE", headers: headers(noDocsKey),
    });
    expect(unlink.status).toBe(403);
  });

  it("allows reads but denies writes for a documents.read-only key", async () => {
    const list = await fetch(`${BASE}/documents`, { headers: headers(readOnlyDocsKey) });
    expect(list.status).toBe(200);
    const detail = await fetch(`${BASE}/documents/${docId}`, { headers: headers(readOnlyDocsKey) });
    expect(detail.status).toBe(200);
    const create = await createDoc({ title: "X", canonicalUrl: "https://example.com/x.pdf" }, readOnlyDocsKey);
    expect(create.status).toBe(403);
    const link = await fetch(`${BASE}/documents/${docId}/links`, {
      method: "POST", headers: headers(readOnlyDocsKey),
      body: JSON.stringify({ entityType: "account", entityId: accountAId }),
    });
    expect(link.status).toBe(403);
  });

  it("rejects an invalid entityType on unlink", async () => {
    const res = await fetch(
      `${BASE}/documents/${docId}/links/invoice/X-1`,
      { method: "DELETE", headers: headers(orgAKey) }
    );
    expect(res.status).toBe(400);
  });
});
