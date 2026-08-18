// Smoke test: spawn the MCP server over stdio and exercise the five tag tools
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, like, inArray } from "drizzle-orm";

const suffix = Date.now();
const TAG = `mcpsmoke-${suffix}`;

let exitCode = 1;
async function main() {
  const [org] = await db.select().from(schema.organizations).limit(1);
  const [user] = await db.select().from(schema.users).limit(1);
  const key = generateApiKey();
  const [inserted] = await db.insert(schema.apiKeys).values({
    hashedKey: key.hashedKey, name: `mcpsmoke-${suffix}`, isActive: true,
    organizationId: org.id, createdBy: user.id,
  }).returning({ id: schema.apiKeys.id });
  const accountId = `ACCT-MCPSMOKE-${suffix}`;
  await db.insert(schema.accounts).values({ id: accountId, organizationId: org.id, name: `MCP Smoke ${suffix}` });

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "/home/runner/workspace/mcp-server/index.ts"],
    env: { ...process.env as any, CRM_BASE_URL: "http://localhost:5000", CRM_API_KEY: key.publicKey },
  });
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(transport);

  const results: string[] = [];
  const call = (name: string, args: any) => client.callTool({ name, arguments: args }) as Promise<any>;
  const text = (r: any) => r.content?.[0]?.text ?? "";

  try {
    // Tool list contains the five tools; no CRM record tool gained tag fields
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    for (const t of ["crm_list_tags","crm_create_tag","crm_get_entity_tags","crm_add_tag","crm_remove_tag"])
      if (!names.includes(t)) throw new Error(`missing tool ${t}`);
    for (const t of tools.tools) {
      if (t.name.startsWith("crm_")) continue;
      const props = Object.keys((t.inputSchema as any).properties ?? {});
      if (props.some(p => /^(tags?|tagId|tagName)$/i.test(p))) throw new Error(`tool ${t.name} exposes tag field`);
    }
    results.push("tool inventory OK");

    // add_tag with non-existent name -> error, no creation
    const missing = await call("crm_add_tag", { entityType: "account", entityId: accountId, tagName: `${TAG}-ghost` });
    if (!missing.isError || !/never created implicitly/i.test(text(missing))) throw new Error("expected structured not-found error: " + text(missing));
    const listGhost = await call("crm_list_tags", { search: `${TAG}-ghost` });
    if (JSON.parse(text(listGhost)).data.length !== 0) throw new Error("ghost tag was created!");
    results.push("no silent creation OK");

    // create -> duplicate 409 message -> add by name -> get -> remove (idempotent)
    const created = await call("crm_create_tag", { name: TAG });
    if (created.isError) throw new Error("create failed: " + text(created));
    const tagId = JSON.parse(text(created)).data.id;
    const dup = await call("crm_create_tag", { name: TAG.toUpperCase() });
    if (!dup.isError || !/already exists/.test(text(dup))) throw new Error("dup handling: " + text(dup));
    const added = await call("crm_add_tag", { entityType: "account", entityId: accountId, tagName: TAG });
    if (added.isError) throw new Error("add failed: " + text(added));
    const got = await call("crm_get_entity_tags", { entityType: "account", entityId: accountId });
    if (!JSON.parse(text(got)).data.some((t: any) => t.id === tagId)) throw new Error("tag not attached");
    const removed = await call("crm_remove_tag", { entityType: "account", entityId: accountId, tagId });
    if (removed.isError) throw new Error("remove failed: " + text(removed));
    const removedAgain = await call("crm_remove_tag", { entityType: "account", entityId: accountId, tagId });
    if (removedAgain.isError) throw new Error("remove not idempotent: " + text(removedAgain));
    results.push("create/dup/add/get/remove OK");

    // invalid entity type + both/neither arg validation
    const badType = await call("crm_add_tag", { entityType: "widget", entityId: accountId, tagId });
    if (!badType.isError || !/Invalid entityType/.test(text(badType))) throw new Error("entityType validation");
    const both = await call("crm_add_tag", { entityType: "account", entityId: accountId, tagId, tagName: TAG });
    if (!both.isError || !/exactly one/.test(text(both))) throw new Error("both-args validation");
    results.push("validation OK");

    console.log("SMOKE PASS:", results.join("; "));
    exitCode = 0;
  } catch (e: any) {
    console.error("SMOKE FAIL:", e?.message ?? e);
  } finally {
    await client.close().catch(() => {});
    await db.delete(schema.entityTags).where(eq(schema.entityTags.entityId, accountId));
    await db.delete(schema.tags).where(like(schema.tags.name, `mcpsmoke-%`));
    await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId));
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, [inserted.id]));
    process.exit(exitCode);
  }
}
main().catch(e => { console.error("SMOKE FAIL:", e.message); process.exit(1); });
