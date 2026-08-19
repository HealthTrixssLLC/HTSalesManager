import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";
const suffix = Date.now();

let orgId: string;
let otherOrgId: string;
let userId: string;
let orgKey: string;
let sysKey: string;
let actKey: string;
let keyIds: string[] = [];
const ids = {
  account: `ACCT-CMT-${suffix}`,
  contact: `CONT-CMT-${suffix}`,
  lead: `LEAD-CMT-${suffix}`,
  opportunity: `OPP-CMT-${suffix}`,
  activity: `ACT-CMT-${suffix}`,
  foreignAccount: `ACCT-CMT-F-${suffix}`,
};
let commentIds: string[] = [];

function req(path: string, key: string, init?: { method?: string; body?: any }) {
  return fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

beforeAll(async () => {
  const users = await db.select().from(schema.users).limit(1);
  userId = users[0].id;
  const [org] = await db.insert(schema.organizations)
    .values({ name: `vitest-cmt-org-${suffix}`, slug: `vitest-cmt-org-${suffix}` }).returning();
  orgId = org.id;
  const [other] = await db.insert(schema.organizations)
    .values({ name: `vitest-cmt-other-${suffix}`, slug: `vitest-cmt-other-${suffix}` }).returning();
  otherOrgId = other.id;

  await db.insert(schema.accounts).values([
    { id: ids.account, name: "Comment Account", organizationId: orgId },
    { id: ids.foreignAccount, name: "Foreign Account", organizationId: otherOrgId },
  ]);
  await db.insert(schema.contacts).values({ id: ids.contact, firstName: "C", lastName: "M", organizationId: orgId, accountId: ids.account });
  await db.insert(schema.leads).values({ id: ids.lead, firstName: "L", lastName: "E", organizationId: orgId, status: "new" });
  await db.insert(schema.opportunities).values({
    id: ids.opportunity, name: "Opp", accountId: ids.account, organizationId: orgId,
    closeDate: new Date(), stage: "prospecting",
  });
  await db.insert(schema.activities).values({
    id: ids.activity, type: "note", subject: "Note", organizationId: orgId, status: "completed",
  });

  const k1 = generateApiKey();
  const k2 = generateApiKey();
  const k3 = generateApiKey();
  orgKey = k1.publicKey;
  sysKey = k2.publicKey;
  actKey = k3.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: `vitest-cmt-org-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: `vitest-cmt-sys-${suffix}`, isActive: true, organizationId: null, createdBy: userId },
    { hashedKey: k3.hashedKey, name: `vitest-cmt-act-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId, permissions: ["activities.read", "activities.write"] },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);
});

afterAll(async () => {
  if (commentIds.length) await db.delete(schema.comments).where(inArray(schema.comments.id, commentIds));
  await db.delete(schema.activities).where(eq(schema.activities.id, ids.activity));
  await db.delete(schema.opportunities).where(eq(schema.opportunities.id, ids.opportunity));
  await db.delete(schema.leads).where(eq(schema.leads.id, ids.lead));
  await db.delete(schema.contacts).where(eq(schema.contacts.id, ids.contact));
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, [ids.account, ids.foreignAccount]));
  if (keyIds.length) await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId, otherOrgId]));
});

describe("External comments API", () => {
  it("creates and lists comments on all five entity types", async () => {
    const paths: Array<[string, string]> = [
      ["accounts", ids.account],
      ["contacts", ids.contact],
      ["leads", ids.lead],
      ["opportunities", ids.opportunity],
      ["activities", ids.activity],
    ];
    for (const [entity, id] of paths) {
      const key = entity === "activities" ? actKey : orgKey;
      const post = await req(`/${entity}/${id}/comments`, key, { method: "POST", body: { body: `hello ${entity}` } });
      expect(post.status).toBe(201);
      const created = (await post.json()).data;
      expect(created.entity).toMatch(/^(Account|Contact|Lead|Opportunity|Activity)$/);
      commentIds.push(created.id);
      const list = await req(`/${entity}/${id}/comments`, key);
      expect(list.status).toBe(200);
      const listed = await list.json();
      expect(listed.data.some((c: any) => c.id === created.id)).toBe(true);
    }
  });

  it("rejects a system key", async () => {
    const res = await req(`/accounts/${ids.account}/comments`, sysKey, { method: "POST", body: { body: "nope" } });
    expect(res.status).toBe(403);
  });

  it("rejects a cross-org parent on create", async () => {
    const res = await req(`/accounts/${ids.foreignAccount}/comments`, orgKey, { method: "POST", body: { body: "nope" } });
    expect(res.status).toBe(404);
  });

  it("rejects posting a comment using a legacy-looking id that is not the canonical PK", async () => {
    const res = await req(`/accounts/ACT-NOT-CANONICAL-${suffix}/comments`, orgKey, { method: "POST", body: { body: "nope" } });
    expect(res.status).toBe(404);
  });

  it("supports first-class POST /comments with canonical entityId", async () => {
    const res = await req("/comments", orgKey, {
      method: "POST",
      body: { entityType: "account", entityId: ids.account, body: "first-class comment" },
    });
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    commentIds.push(created.id);
    const list = await req(`/comments?entityType=account&entityId=${ids.account}`, orgKey);
    expect(list.status).toBe(200);
    expect((await list.json()).data.some((c: any) => c.id === created.id)).toBe(true);
  });

  it("rejects first-class POST /comments with a non-canonical entityId", async () => {
    const res = await req("/comments", orgKey, {
      method: "POST",
      body: { entityType: "account", entityId: `ACT-NOT-CANONICAL-${suffix}`, body: "nope" },
    });
    expect(res.status).toBe(404);
  });
});
