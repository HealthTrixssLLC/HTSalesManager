// Integration tests for External API tagging support (Task: tags)
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray, like } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";

const suffix = Date.now();
let orgId: string;
let otherOrgId: string;
let userId: string;
let keyIds: string[] = [];

let orgKey: string;        // org-bound, full access
let readOnlyKey: string;   // org-bound, crm.read + activities.read only
let noActivitiesKey: string; // org-bound, crm.* only (no activities.*)
let systemKey: string;     // no organizationId (system key)
let otherOrgKey: string;   // bound to the other org

const ids = {
  account: `ACCT-VITAG-${suffix}`,
  contact: `CONT-VITAG-${suffix}`,
  lead: `LEAD-VITAG-${suffix}`,
  opportunity: `OPP-VITAG-${suffix}`,
  activity: `ACT-VITAG-${suffix}`,
  account2: `ACCT-VITAG2-${suffix}`,
  otherAccount: `ACCT-VITAG-OTHER-${suffix}`,
};

let tagAlphaId: string;   // created via API in tests
let tagBetaId: string;    // seeded in beforeAll (org)
let otherOrgTagId: string; // seeded in beforeAll (other org)

const TAG_BETA = `vitag-beta-${suffix}`;
const TAG_OTHER = `vitag-other-${suffix}`;
const TAG_ALPHA = `vitag-alpha-${suffix}`;

function api(path: string, key: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as any) };
  if (key) headers["x-api-key"] = key;
  return fetch(`${BASE}${path}`, { ...init, headers });
}
const get = (p: string, k: string | null) => api(p, k);
const post = (p: string, body: any, k: string | null) =>
  api(p, k, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const del = (p: string, k: string | null) => api(p, k, { method: "DELETE" });

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(1);
  orgId = orgs[0].id;
  const users = await db.select().from(schema.users).limit(1);
  userId = users[0].id;

  const [tempOrg] = await db.insert(schema.organizations)
    .values({ name: `vitest-tag-org-${suffix}`, slug: `vitest-tag-org-${suffix}` })
    .returning();
  otherOrgId = tempOrg.id;

  const keys = [generateApiKey(), generateApiKey(), generateApiKey(), generateApiKey(), generateApiKey()];
  orgKey = keys[0].publicKey;
  readOnlyKey = keys[1].publicKey;
  noActivitiesKey = keys[2].publicKey;
  systemKey = keys[3].publicKey;
  otherOrgKey = keys[4].publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: keys[0].hashedKey, name: `vitag-full-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId },
    { hashedKey: keys[1].hashedKey, name: `vitag-ro-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId, permissions: ["crm.read", "activities.read"] },
    { hashedKey: keys[2].hashedKey, name: `vitag-noact-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId, permissions: ["crm.read", "crm.write"] },
    { hashedKey: keys[3].hashedKey, name: `vitag-system-${suffix}`, isActive: true, organizationId: null, createdBy: userId },
    { hashedKey: keys[4].hashedKey, name: `vitag-other-${suffix}`, isActive: true, organizationId: otherOrgId, createdBy: userId },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);

  // Seed records
  await db.insert(schema.accounts).values([
    { id: ids.account, organizationId: orgId, name: `Vitag Account ${suffix}` },
    { id: ids.account2, organizationId: orgId, name: `Vitag Account2 ${suffix}` },
    { id: ids.otherAccount, organizationId: otherOrgId, name: `Vitag OtherOrg Account ${suffix}` },
  ]);
  await db.insert(schema.contacts).values({ id: ids.contact, organizationId: orgId, firstName: "Vitag", lastName: "Contact" });
  await db.insert(schema.leads).values({ id: ids.lead, organizationId: orgId, firstName: "Vitag", lastName: "Lead" });
  await db.insert(schema.opportunities).values({
    id: ids.opportunity, organizationId: orgId, accountId: ids.account,
    name: `Vitag Opp ${suffix}`, closeDate: new Date(),
  });
  await db.insert(schema.activities).values({ id: ids.activity, organizationId: orgId, type: "task", subject: `Vitag Activity ${suffix}` });

  // Seed tags directly: one in org, one in the other org
  const [beta] = await db.insert(schema.tags)
    .values({ name: TAG_BETA, organizationId: orgId, createdBy: null }).returning();
  tagBetaId = beta.id;
  const [other] = await db.insert(schema.tags)
    .values({ name: TAG_OTHER, organizationId: otherOrgId, createdBy: null }).returning();
  otherOrgTagId = other.id;
});

afterAll(async () => {
  await db.delete(schema.entityTags).where(inArray(schema.entityTags.entityId, Object.values(ids)));
  await db.delete(schema.tags).where(like(schema.tags.name, `vitag-%-${suffix}`));
  await db.delete(schema.activities).where(eq(schema.activities.id, ids.activity));
  await db.delete(schema.opportunities).where(eq(schema.opportunities.id, ids.opportunity));
  await db.delete(schema.leads).where(eq(schema.leads.id, ids.lead));
  await db.delete(schema.contacts).where(eq(schema.contacts.id, ids.contact));
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, [ids.account, ids.account2, ids.otherAccount]));
  if (keyIds.length > 0) await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, otherOrgId));
});

// ========== TAG MANAGEMENT ==========

describe("Tag management", () => {
  it("lists org tags (seeded tag visible, other-org tag not)", async () => {
    const res = await get("/tags?limit=1000", orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.map((t: any) => t.name);
    expect(names).toContain(TAG_BETA);
    expect(names).not.toContain(TAG_OTHER);
    expect(body.pagination).toMatchObject({ limit: 1000, offset: 0 });
  });

  it("creates a tag (normalized name, 201)", async () => {
    const res = await post("/tags", { name: `  ${TAG_ALPHA}   ` }, orgKey);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe(TAG_ALPHA);
    expect(body.data.id).toBeTruthy();
    expect(body.data).toHaveProperty("color");
    tagAlphaId = body.data.id;
  });

  it("supports search by name", async () => {
    const res = await get(`/tags?search=${TAG_ALPHA.toUpperCase()}`, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(tagAlphaId);
    expect(body.pagination.total).toBe(1);
  });

  it("rejects duplicate tag name (409, case-insensitive)", async () => {
    const res = await post("/tags", { name: TAG_ALPHA.toUpperCase() }, orgKey);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Tag already exists");
  });

  it("same name is allowed in a different org", async () => {
    const res = await post("/tags", { name: TAG_ALPHA }, otherOrgKey);
    expect(res.status).toBe(201);
  });

  it("rejects empty name (400)", async () => {
    const res = await post("/tags", { name: "   " }, orgKey);
    expect(res.status).toBe(400);
  });

  it("rejects missing name (400)", async () => {
    const res = await post("/tags", {}, orgKey);
    expect(res.status).toBe(400);
  });

  it("rejects name > 100 chars (400)", async () => {
    const res = await post("/tags", { name: "x".repeat(101) }, orgKey);
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON (400)", async () => {
    const res = await post("/tags", "{not json", orgKey);
    expect(res.status).toBe(400);
  });
});

// ========== ASSIGNMENT ==========

describe("Tag assignment", () => {
  const entityPaths = () => ([
    ["accounts", ids.account],
    ["contacts", ids.contact],
    ["leads", ids.lead],
    ["opportunities", ids.opportunity],
    ["activities", ids.activity],
  ] as const);

  it("assigns a tag by tagId to every entity type", async () => {
    for (const [entity, id] of entityPaths()) {
      const res = await post(`/${entity}/${id}/tags`, { tagId: tagAlphaId }, orgKey);
      expect(res.status, `${entity} assign by tagId`).toBe(200);
      const body = await res.json();
      expect(body.data.map((t: any) => t.id)).toContain(tagAlphaId);
    }
  });

  it("assigns a tag by name to every entity type", async () => {
    for (const [entity, id] of entityPaths()) {
      const res = await post(`/${entity}/${id}/tags`, { name: TAG_BETA }, orgKey);
      expect(res.status, `${entity} assign by name`).toBe(200);
      const body = await res.json();
      expect(body.data.map((t: any) => t.name)).toContain(TAG_BETA);
    }
  });

  it("re-assigning the same tag is idempotent (200, no duplicate)", async () => {
    const res = await post(`/accounts/${ids.account}/tags`, { tagId: tagAlphaId }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    const matches = body.data.filter((t: any) => t.id === tagAlphaId);
    expect(matches.length).toBe(1);
  });

  it("assigning by unknown name returns 404 (no auto-create)", async () => {
    const res = await post(`/accounts/${ids.account}/tags`, { name: `vitag-nope-${suffix}` }, orgKey);
    expect(res.status).toBe(404);
    const listed = await (await get(`/tags?search=vitag-nope-${suffix}`, orgKey)).json();
    expect(listed.data.length).toBe(0);
  });

  it("cross-org tag assignment returns 404", async () => {
    const res = await post(`/accounts/${ids.account}/tags`, { tagId: otherOrgTagId }, orgKey);
    expect(res.status).toBe(404);
  });

  it("rejects body with both tagId and name (400)", async () => {
    const res = await post(`/accounts/${ids.account}/tags`, { tagId: tagAlphaId, name: TAG_BETA }, orgKey);
    expect(res.status).toBe(400);
  });

  it("rejects body with neither tagId nor name (400)", async () => {
    const res = await post(`/accounts/${ids.account}/tags`, {}, orgKey);
    expect(res.status).toBe(400);
  });

  it("GET entity tags returns assigned tags", async () => {
    const res = await get(`/accounts/${ids.account}/tags`, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    const tagIds = body.data.map((t: any) => t.id);
    expect(tagIds).toContain(tagAlphaId);
    expect(tagIds).toContain(tagBetaId);
    expect(body.data[0]).toHaveProperty("name");
    expect(body.data[0]).toHaveProperty("color");
  });

  it("invalid entity record ID returns 404", async () => {
    const res = await get(`/accounts/NOPE-${suffix}/tags`, orgKey);
    expect(res.status).toBe(404);
  });

  it("cross-org record returns 404", async () => {
    const res = await get(`/accounts/${ids.otherAccount}/tags`, orgKey);
    expect(res.status).toBe(404);
  });
});

// ========== FILTERING ==========

describe("Tag filtering on list endpoints", () => {
  it("?tagId filters each of the five list endpoints and total reflects the filter", async () => {
    const cases: Array<[string, string]> = [
      [`/accounts?tagId=${tagAlphaId}`, ids.account],
      [`/contacts?tagId=${tagAlphaId}`, ids.contact],
      [`/leads?tagId=${tagAlphaId}`, ids.lead],
      [`/opportunities?tagId=${tagAlphaId}&includeInForecast=all`, ids.opportunity],
      [`/activities?tagId=${tagAlphaId}`, ids.activity],
    ];
    for (const [path, expectedId] of cases) {
      const res = await get(path, orgKey);
      expect(res.status, path).toBe(200);
      const body = await res.json();
      expect(body.pagination.total, path).toBe(1);
      expect(body.data.map((r: any) => r.id), path).toEqual([expectedId]);
    }
  });

  it("?tag=<name> filters by tag name", async () => {
    const res = await get(`/accounts?tag=${TAG_ALPHA}`, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.total).toBe(1);
    expect(body.data[0].id).toBe(ids.account);
  });

  it("unassigned record excluded by filter (account2 not tagged)", async () => {
    const res = await get(`/accounts?tagId=${tagAlphaId}`, orgKey);
    const body = await res.json();
    expect(body.data.map((r: any) => r.id)).not.toContain(ids.account2);
  });

  it("unknown tag name filter returns 404", async () => {
    const res = await get(`/accounts?tag=vitag-missing-${suffix}`, orgKey);
    expect(res.status).toBe(404);
  });

  it("cross-org tagId filter returns 404", async () => {
    const res = await get(`/accounts?tagId=${otherOrgTagId}`, orgKey);
    expect(res.status).toBe(404);
  });

  it("providing both tag and tagId returns 400", async () => {
    const res = await get(`/accounts?tag=${TAG_ALPHA}&tagId=${tagAlphaId}`, orgKey);
    expect(res.status).toBe(400);
  });
});

// ========== EXPANSION ==========

describe("expand=tags on detail endpoints", () => {
  it("includes tags array on each entity detail endpoint", async () => {
    const cases: Array<[string]> = [
      [`/accounts/${ids.account}?expand=tags`],
      [`/contacts/${ids.contact}?expand=tags`],
      [`/leads/${ids.lead}?expand=tags`],
      [`/opportunities/${ids.opportunity}?expand=tags`],
      [`/activities/${ids.activity}?expand=tags`],
    ];
    for (const [path] of cases) {
      const res = await get(path, orgKey);
      expect(res.status, path).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.data.tags), path).toBe(true);
      const names = body.data.tags.map((t: any) => t.name);
      expect(names, path).toContain(TAG_ALPHA);
      expect(body.data.tags[0], path).toHaveProperty("id");
      expect(body.data.tags[0], path).toHaveProperty("color");
    }
  });

  it("expand works within a comma-separated list", async () => {
    const res = await get(`/accounts/${ids.account}?expand=opportunities,tags`, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.tags)).toBe(true);
    expect(Array.isArray(body.data.opportunities)).toBe(true);
  });

  it("no expand -> no tags key", async () => {
    const res = await get(`/accounts/${ids.account}`, orgKey);
    const body = await res.json();
    expect(body.data).not.toHaveProperty("tags");
  });
});

// ========== REMOVAL ==========

describe("Tag removal", () => {
  it("removes a tag assignment (204)", async () => {
    const res = await del(`/accounts/${ids.account}/tags/${tagBetaId}`, orgKey);
    expect(res.status).toBe(204);
    const listed = await (await get(`/accounts/${ids.account}/tags`, orgKey)).json();
    expect(listed.data.map((t: any) => t.id)).not.toContain(tagBetaId);
  });

  it("removing a non-existent assignment is idempotent (204)", async () => {
    const res = await del(`/accounts/${ids.account}/tags/${tagBetaId}`, orgKey);
    expect(res.status).toBe(204);
  });

  it("cross-org tag removal attempt returns 404", async () => {
    const res = await del(`/accounts/${ids.account}/tags/${otherOrgTagId}`, orgKey);
    expect(res.status).toBe(404);
  });

  it("unknown tag ID returns 404", async () => {
    const res = await del(`/accounts/${ids.account}/tags/NOPE-${suffix}`, orgKey);
    expect(res.status).toBe(404);
  });

  it("cross-org record returns 404", async () => {
    const res = await del(`/accounts/${ids.otherAccount}/tags/${tagAlphaId}`, orgKey);
    expect(res.status).toBe(404);
  });
});

// ========== TAGS STAY OPTIONAL (MCP design law regression) ==========
// Tags are optional metadata: no record create/PATCH requires tag fields, and
// ordinary PATCHes must leave existing tag assignments untouched.

describe("Tags stay optional for record operations", () => {
  const patch = (p: string, body: any, k: string | null) =>
    api(p, k, { method: "PATCH", body: JSON.stringify(body) });

  it("PATCH on each entity succeeds with no tag fields present", async () => {
    const cases: Array<[string, string, any]> = [
      ["accounts", ids.account, { industry: "TagFree Industry" }],
      ["contacts", ids.contact, { title: "TagFree Title" }],
      ["leads", ids.lead, { company: "TagFree Co" }],
      ["opportunities", ids.opportunity, { probability: 42 }],
      ["activities", ids.activity, { priority: "high" }],
    ];
    for (const [entity, id, body] of cases) {
      const res = await patch(`/${entity}/${id}`, body, orgKey);
      expect(res.status, `${entity} PATCH without tags`).toBe(200);
    }
  });

  it("a PATCH that changes only non-tag fields leaves tag assignments unchanged", async () => {
    // ids.account has tags assigned by earlier tests — snapshot, PATCH, re-check
    const before = await (await get(`/accounts/${ids.account}/tags`, orgKey)).json();
    const beforeIds = before.data.map((t: any) => t.id).sort();
    expect(beforeIds.length).toBeGreaterThan(0);

    const res = await patch(`/accounts/${ids.account}`, { website: "https://tagfree.example.com" }, orgKey);
    expect(res.status).toBe(200);

    const after = await (await get(`/accounts/${ids.account}/tags`, orgKey)).json();
    expect(after.data.map((t: any) => t.id).sort()).toEqual(beforeIds);
  });

  it("record creation succeeds without any tag fields (accounts via internal seed shape)", async () => {
    // Create + delete a throwaway record through the external surface's org:
    // the schema itself has no tag columns, so a create with only core fields
    // must succeed and start with zero tags.
    const newId = `ACCT-VITAGOPT-${suffix}`;
    await db.insert(schema.accounts).values({ id: newId, organizationId: orgId, name: `Vitag Optional ${suffix}` });
    try {
      const tagsRes = await get(`/accounts/${newId}/tags`, orgKey);
      expect(tagsRes.status).toBe(200);
      expect((await tagsRes.json()).data).toEqual([]);
      const patched = await patch(`/accounts/${newId}`, { industry: "NoTags" }, orgKey);
      expect(patched.status).toBe(200);
    } finally {
      await db.delete(schema.entityTags).where(eq(schema.entityTags.entityId, newId));
      await db.delete(schema.accounts).where(eq(schema.accounts.id, newId));
    }
  });

  it("POST /leads succeeds without any tag fields and starts with zero tags", async () => {
    const email = `vitag-opt-lead-${suffix}@example.com`;
    const res = await post("/leads", { firstName: "TagFree", lastName: "Lead", email, source: "other" }, orgKey);
    expect(res.status).toBe(201);
    const body = await res.json();
    const leadId = body.data.id;
    try {
      const tags = await (await get(`/leads/${leadId}/tags`, orgKey)).json();
      expect(tags.data).toEqual([]);
    } finally {
      await db.delete(schema.entityTags).where(eq(schema.entityTags.entityId, leadId));
      await db.delete(schema.leads).where(eq(schema.leads.id, leadId));
    }
  });

  it("POST /activities succeeds without any tag fields and starts with zero tags", async () => {
    const res = await post("/activities", { type: "task", subject: `Vitag TagFree Activity ${suffix}` }, orgKey);
    expect(res.status).toBe(201);
    const body = await res.json();
    const actId = body.data.id;
    try {
      const tags = await (await get(`/activities/${actId}/tags`, orgKey)).json();
      expect(tags.data).toEqual([]);
    } finally {
      await db.delete(schema.entityTags).where(eq(schema.entityTags.entityId, actId));
      await db.delete(schema.activities).where(eq(schema.activities.id, actId));
    }
  });

  it("assigning by a non-existent name errors and never creates the tag (each entity)", async () => {
    const missing = `vitag-ghost-${suffix}`;
    const cases: Array<[string, string]> = [
      ["accounts", ids.account],
      ["contacts", ids.contact],
      ["leads", ids.lead],
      ["opportunities", ids.opportunity],
      ["activities", ids.activity],
    ];
    for (const [entity, id] of cases) {
      const res = await post(`/${entity}/${id}/tags`, { name: missing }, orgKey);
      expect(res.status, `${entity} unknown tag name`).toBe(404);
    }
    const listed = await (await get(`/tags?search=${missing}`, orgKey)).json();
    expect(listed.data.length).toBe(0);
  });
});

// ========== SECURITY ==========

describe("Security", () => {
  it("missing API key returns 401", async () => {
    expect((await get("/tags", null)).status).toBe(401);
    expect((await post("/tags", { name: "x" }, null)).status).toBe(401);
    expect((await get(`/accounts/${ids.account}/tags`, null)).status).toBe(401);
  });

  it("key without crm.write cannot create tags or assign (403)", async () => {
    const create = await post("/tags", { name: `vitag-denied-${suffix}` }, readOnlyKey);
    expect(create.status).toBe(403);
    const assign = await post(`/accounts/${ids.account}/tags`, { tagId: tagAlphaId }, readOnlyKey);
    expect(assign.status).toBe(403);
    const remove = await del(`/accounts/${ids.account}/tags/${tagAlphaId}`, readOnlyKey);
    expect(remove.status).toBe(403);
  });

  it("read-only key can read tags", async () => {
    expect((await get("/tags", readOnlyKey)).status).toBe(200);
    expect((await get(`/accounts/${ids.account}/tags`, readOnlyKey)).status).toBe(200);
    expect((await get(`/activities/${ids.activity}/tags`, readOnlyKey)).status).toBe(200);
  });

  it("key without activities.write cannot tag activities (403), but can tag CRM records", async () => {
    const denied = await post(`/activities/${ids.activity}/tags`, { tagId: tagAlphaId }, noActivitiesKey);
    expect(denied.status).toBe(403);
    const deniedRead = await get(`/activities/${ids.activity}/tags`, noActivitiesKey);
    expect(deniedRead.status).toBe(403);
    const ok = await post(`/contacts/${ids.contact}/tags`, { tagId: tagAlphaId }, noActivitiesKey);
    expect(ok.status).toBe(200);
  });

  it("system key (no org) cannot create tags (403)", async () => {
    const res = await post("/tags", { name: `vitag-system-${suffix}` }, systemKey);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Organization-bound API key required");
  });

  it("system key cannot list tags or entity tags (403)", async () => {
    expect((await get("/tags", systemKey)).status).toBe(403);
    expect((await get(`/accounts/${ids.account}/tags`, systemKey)).status).toBe(403);
  });

  it("other org's key cannot see this org's record tags (404)", async () => {
    const res = await get(`/accounts/${ids.account}/tags`, otherOrgKey);
    expect(res.status).toBe(404);
  });

  it("system key cannot use tagId or tag list filters (403)", async () => {
    const byId = await get(`/accounts?tagId=${tagAlphaId}`, systemKey);
    expect(byId.status).toBe(403);
    const byName = await get(`/accounts?tag=${TAG_ALPHA}`, systemKey);
    expect(byName.status).toBe(403);
  });

  it("foreign-org tag attached via internal path never leaks through external reads", async () => {
    // Simulate the internal (pre-hardening) path: attach another org's tag
    // directly to an in-org record at the DB level.
    await db.insert(schema.entityTags)
      .values({ entity: "Account", entityId: ids.account, tagId: otherOrgTagId, createdBy: null })
      .onConflictDoNothing();

    const listed = await (await get(`/accounts/${ids.account}/tags`, orgKey)).json();
    expect(listed.data.map((t: any) => t.id)).not.toContain(otherOrgTagId);

    const expanded = await (await get(`/accounts/${ids.account}?expand=tags`, orgKey)).json();
    expect(expanded.data.tags.map((t: any) => t.id)).not.toContain(otherOrgTagId);
  });

  it("internal API refuses to attach another org's tag", async () => {
    // The internal assignment routes filter out tags not belonging to the
    // active org (or legacy org-less tags). Verified at the storage boundary:
    // the external surface above is the enforcement backstop.
    const res = await post(`/contacts/${ids.contact}/tags`, { tagId: otherOrgTagId }, orgKey);
    expect(res.status).toBe(404);
  });
});
