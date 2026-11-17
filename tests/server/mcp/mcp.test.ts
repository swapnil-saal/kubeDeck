/**
 * MCP servers as plugins, against a small local MCP server that speaks the real protocol over HTTP
 * (initialize, tools/list, tools/call). The plugin manager, the tool registry and the request's
 * identity are the real ones; no model is called.
 */
import express from "express";
import { createServer, type IncomingHttpHeaders, type Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toolsForCall, type ToolsForCall } from "@server/ai/tools";
import { bindIdentity } from "@server/identity";
import { createPlugin, listPlugins, memoryStore, pluginState, removePlugin, startPlugins, stopPlugins, testPlugin, updatePlugin } from "@server/plugins";
import type { PluginInfo } from "@shared/plugins";
import { loadWebConfig, setWebConfig, type WebUser } from "@server/web-mode";
import { grafanaMcpStatus, mcpToolName } from "@server/mcp";

const ENV = { KUBEDECK_AUTH_SECRET: "x".repeat(40) };
const scope = { context: "kind", namespace: "app", threadId: "mcp-test", user: "alice@example.com" };

const TOOLS = [
  { name: "get_doc", description: "Read one document. By id.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "listDocs", description: "List documents.", inputSchema: { type: "object", properties: {} } },
  { name: "delete_doc", description: "Delete a document.", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
  { name: "summarize", description: "Summarize.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "update_dashboard", description: "Change a dashboard.", inputSchema: { type: "object", properties: {} } },
  { name: "list_datasources", description: "List the data sources.", inputSchema: { type: "object", properties: {} } },
];

/** An MCP server: legacy `initialize` handshake, `tools/list`, `tools/call`; remembers what it was sent. */
function startMcp(seen: { headers: IncomingHttpHeaders[]; calls: string[] }): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") return void res.writeHead(405).end();
    seen.headers.push(req.headers);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const msg = JSON.parse(Buffer.concat(chunks).toString());
    if (msg.id === undefined) return void res.writeHead(202).end(); // a notification
    const reply = (body: object) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...body }));
    if (msg.method === "initialize") return reply({ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "docs-test", version: "1" } } });
    if (msg.method === "tools/list") return reply({ result: { tools: TOOLS } });
    if (msg.method === "tools/call") {
      seen.calls.push(`${msg.params.name} ${JSON.stringify(msg.params.arguments ?? {})}`);
      return reply({ result: { content: [{ type: "text", text: `did ${msg.params.name}` }] } });
    }
    reply({ error: { code: -32601, message: `Method not found: ${msg.method}` } });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const seen = { headers: [] as IncomingHttpHeaders[], calls: [] as string[] };
let mcp: Server;
let url = "";
let deadUrl = "";

beforeAll(async () => {
  mcp = await startMcp(seen);
  url = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;
  const closed = await startMcp({ headers: [], calls: [] });
  deadUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/mcp`;
  await new Promise<void>((r) => closed.close(() => r()));
});
afterAll(() => new Promise<void>((r) => mcp.close(() => r())));

beforeEach(async () => {
  seen.headers.length = 0;
  seen.calls.length = 0;
  await startPlugins(memoryStore(), ENV);
});
afterEach(async () => {
  await stopPlugins();
  setWebConfig(loadWebConfig({}));
});

/** Run `fn` as a signed-in person, the way the server binds every request. */
function as<T>(user: WebUser, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    bindIdentity({ kubedeckUser: user } as express.Request, {} as express.Response, () => { fn().then(resolve, reject); });
  });
}

async function run(call: ToolsForCall, name: string, input: object): Promise<string> {
  const execute = call.tools[name].execute as (input: object, o: object) => Promise<string>;
  return execute(input, { toolCallId: "t1", messages: [], context: scope });
}

const webMode = (env: Record<string, string> = {}) => setWebConfig(loadWebConfig({ KUBEDECK_MODE: "web", ...env }));

describe("an added MCP server", () => {
  it("gets one mcp_<name> tool listing only its read tools, sends the token and headers, and goes away when removed", async () => {
    const added = await createPlugin("mcp", "Docs Server", { url, token: "s3cret", headers: { "X-Team": "sre" } }, "admin");
    expect(added).toMatchObject({ status: { state: "ok", detail: "4 tools" }, provides: { tools: ["mcp_docs_server"] } });
    expect(mcpToolName(added.id)).toBe("mcp_docs_server");
    expect(["mcp-docs-server", "mcp:docs-server", "mcp-Docs--2"].map(mcpToolName)).toEqual(["mcp_docs_server", "mcp_docs_server", "mcp_docs_2"]);
    expect(seen.headers.at(-1)).toMatchObject({ authorization: "Bearer s3cret", "x-team": "sre" });

    const call = await toolsForCall({ scope });
    expect(call.activeTools).toContain("mcp_docs_server");
    expect(call.toolApproval.mcp_docs_server).toBeUndefined();
    const description = call.tools.mcp_docs_server.description ?? "";
    expect(description).toContain("- get_doc(id*: string): Read one document.");
    expect(description).toContain("- summarize(): Summarize.");
    expect(description).not.toContain("delete_doc");
    expect(call.promptSections.join("\n")).toContain("## Docs Server (MCP)");

    expect(await run(call, "mcp_docs_server", { tool: "get_doc", arguments: { id: "7" } })).toBe("did get_doc");
    expect(await run(call, "mcp_docs_server", { tool: "delete_doc", arguments: { id: "7" } })).toMatch(/^Blocked: "delete_doc" is not one of the Docs Server tools KubeDeck may use \(read-only\)/);
    expect(seen.calls).toEqual(['get_doc {"id":"7"}']);

    await removePlugin(added.id, "admin");
    const after = await toolsForCall({ scope });
    expect(Object.keys(after.tools)).not.toContain("mcp_docs_server");
  });

  it("starts from its fields' defaults (HTTP, no changes), which the page gets filled in and a save overrides", async () => {
    const added = await createPlugin("mcp", "Docs", { url }, "admin");
    expect(added.values).toMatchObject({ url, transport: "http", allowChanges: false });
    expect(added.fields.find((f) => f.key === "transport")).toMatchObject({ default: "http" });
    expect(pluginState(added.id).values).toMatchObject({ transport: "http", allowChanges: false });
    expect(added.values).not.toHaveProperty("token"); // a secret has no default
    const changed = await updatePlugin(added.id, { values: { transport: "sse" } }, "admin");
    expect(changed.values.transport).toBe("sse");
  });

  it("lists its tools with their access for the settings page, to everyone, without asking the server again", async () => {
    const added = await createPlugin("mcp", "Docs", { url }, "admin");
    const access = (catalog: PluginInfo["catalog"]) => Object.fromEntries((catalog ?? []).map((t) => [t.name, t.access]));
    expect(access(added.catalog)).toEqual({
      delete_doc: "hidden", get_doc: "read", list_datasources: "read", listDocs: "read", summarize: "read", update_dashboard: "hidden",
    });
    expect(added.catalog?.map((t) => t.name)).toEqual(["delete_doc", "get_doc", "list_datasources", "listDocs", "summarize", "update_dashboard"]);
    expect(added.catalog?.find((t) => t.name === "get_doc")).toEqual({ name: "get_doc", description: "Read one document.", access: "read" });
    expect(added.catalog?.find((t) => t.name === "delete_doc")).toMatchObject({ access: "hidden", reason: "It may change things, and Allow changes is off." });

    // someone who may not manage plugins sees the tools too, but no settings
    const asked = seen.headers.length;
    const [forUser] = (await listPlugins(false)).filter((p) => p.id === added.id);
    expect(forUser.values).toEqual({});
    expect(access(forUser.catalog)).toEqual(access(added.catalog));
    expect(seen.headers.length).toBe(asked); // the catalog comes from the cache

    const open = await updatePlugin(added.id, { values: { allowChanges: true, tools: ["get_doc", "delete_doc"] } }, "admin");
    expect(access(open.catalog)).toMatchObject({ get_doc: "read", delete_doc: "approval", listDocs: "hidden" });
    expect(open.catalog?.find((t) => t.name === "listDocs")?.reason).toBe("Not in this server's “Only these tools” list.");

    webMode({ KUBEDECK_READ_ONLY: "true" });
    const ro = await updatePlugin(added.id, { values: { tools: [] } }, "admin");
    expect(ro.catalog?.find((t) => t.name === "delete_doc")).toMatchObject({ access: "hidden", reason: "It may change things, and this KubeDeck is read-only." });

    const off = await updatePlugin(added.id, { enabled: false }, "admin");
    expect(off.catalog).toBeUndefined();
  });

  it("has no catalog before the server ever answered", async () => {
    const added = await createPlugin("mcp", "Gone", { url: deadUrl }, "admin");
    expect(added.catalog).toBeUndefined();
  });

  it("keeps to the tools allowlist", async () => {
    await createPlugin("mcp", "Docs", { url, tools: ["get_doc", "delete_doc"] }, "admin");
    const call = await toolsForCall({ scope });
    expect(call.tools.mcp_docs.description).toContain("get_doc");
    expect(call.tools.mcp_docs.description).not.toContain("listDocs");
    expect(call.tools.mcp_docs.description).not.toContain("delete_doc"); // allowed by name, but it changes things
  });

  it("with Allow changes, offers the other tools behind the person's approval", async () => {
    const added = await createPlugin("mcp", "Docs", { url, allowChanges: true }, "admin");
    expect(added.status).toEqual({ state: "ok", detail: "6 tools (2 need approval)" });
    const call = await toolsForCall({ scope });
    expect(call.tools.mcp_docs.description).toMatch(/These may change things; each call waits for the user's approval:\n- delete_doc/);
    const approve = call.toolApproval.mcp_docs;
    expect(approve({ tool: "get_doc" })).toBeUndefined();
    expect(approve({ tool: "delete_doc" })).toBe("user-approval");
    expect(approve({ tool: "drop_everything" })).toMatchObject({ type: "denied" });
    // once approved, it runs
    expect(await run(call, "mcp_docs", { tool: "delete_doc", arguments: { id: "1" } })).toBe("did delete_doc");

    // a read-only shared KubeDeck changes nothing, whatever the plugin allows
    webMode({ KUBEDECK_READ_ONLY: "true" });
    await updatePlugin(added.id, { values: { allowChanges: true } }, "admin");
    const ro = await toolsForCall({ scope });
    expect(ro.toolApproval.mcp_docs).toBeUndefined();
    expect(ro.tools.mcp_docs.description).not.toContain("delete_doc");
  });

  it("is only for people in its groups on a shared KubeDeck", async () => {
    webMode();
    await createPlugin("mcp", "Docs", { url, groups: ["sre"] }, "admin");
    const sre: WebUser = { name: "a", email: "a@example.com", groups: ["dev", "sre"] };
    const dev: WebUser = { name: "b", email: "b@example.com", groups: ["dev"] };
    expect((await as(sre, () => toolsForCall({ scope }))).activeTools).toContain("mcp_docs");
    expect((await as(dev, () => toolsForCall({ scope }))).activeTools).not.toContain("mcp_docs");
    expect((await toolsForCall({ scope })).activeTools).not.toContain("mcp_docs"); // outside a request: nobody
    const call = await as(sre, () => toolsForCall({ scope }));
    expect(await as(dev, () => run(call, "mcp_docs", { tool: "get_doc", arguments: { id: "1" } }))).toBe("Blocked: Docs is not available to this user.");

    // the desktop has one person and no groups
    setWebConfig(loadWebConfig({}));
    expect((await toolsForCall({ scope })).activeTools).toContain("mcp_docs");
  });

  it("knows the person in a real request, across awaits, as the agent does", async () => {
    webMode();
    await createPlugin("mcp", "Docs", { url, groups: ["sre"] }, "admin");
    const app = express();
    app.use((req, _res, next) => { req.kubedeckUser = { name: "a", email: "a@example.com", groups: String(req.headers["x-groups"] ?? "").split(",") }; next(); });
    app.use(express.json());
    app.use(bindIdentity);
    app.post("/call", async (_req, res) => {
      await new Promise((r) => setTimeout(r, 5));
      res.json((await toolsForCall({ scope })).activeTools);
    });
    const server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ask = (groups: string) => fetch(`${base}/call`, { method: "POST", headers: { "x-groups": groups, "content-type": "application/json" }, body: "{}" }).then((r) => r.json());
    try {
      expect(await ask("sre")).toContain("mcp_docs");
      expect(await ask("dev")).not.toContain("mcp_docs");
    } finally {
      server.close();
    }
  });

  it("reports an unreachable server and hides its tool, saying why in the prompt", async () => {
    const added = await createPlugin("mcp", "Gone", { url: deadUrl }, "admin");
    expect(added.status).toMatchObject({ state: "error", message: expect.stringContaining(`Cannot reach the MCP server "Gone" at ${deadUrl}`) });
    const call = await toolsForCall({ scope });
    expect(Object.keys(call.tools)).toContain("mcp_gone");
    expect(call.activeTools).not.toContain("mcp_gone");
    expect(call.promptSections.join("\n")).toMatch(/## Gone \(MCP\)\nThe MCP server "Gone" is configured but unreachable right now/);
    expect(await testPlugin(added.id)).toMatchObject({ state: "error" });
  });

  it("is unconfigured without a usable URL", async () => {
    const added = await createPlugin("mcp", "Local", { url: "stdio:///usr/bin/thing" }, "admin");
    expect(added.status).toMatchObject({ state: "unconfigured" });
    expect(Object.keys((await toolsForCall({ scope })).tools)).not.toContain("mcp_local");
  });
});

describe("the Grafana plugin", () => {
  it("is off and toolless until configured", async () => {
    expect(pluginState("grafana").enabled).toBe(false);
    expect(Object.keys((await toolsForCall({ scope })).tools)).not.toContain("grafana");
    expect(await grafanaMcpStatus()).toEqual({ configured: false, ok: false, tools: [] });
  });

  it("is on when the environment sets its URL, which wins over saved settings; offers Grafana's read tools only", async () => {
    await stopPlugins();
    await startPlugins(memoryStore(), { ...ENV, KUBEDECK_GRAFANA_MCP_URL: url, KUBEDECK_GRAFANA_MCP_TOKEN: "g-token" });
    expect(pluginState("grafana")).toEqual({ enabled: true, values: { url, token: "g-token" } });
    const [info] = (await listPlugins(true)).filter((p) => p.id === "grafana");
    expect(info).toMatchObject({ enabled: true, envPinned: ["url", "token"], values: { url, token: "" }, secretsSet: ["token"], status: { state: "ok" } });
    await updatePlugin("grafana", { values: { url: "http://elsewhere" } }, "admin");
    expect(pluginState("grafana").values.url).toBe(url);

    const call = await toolsForCall({ scope });
    expect(call.activeTools).toContain("grafana");
    expect(call.toolApproval.grafana).toBeUndefined();
    expect(call.tools.grafana.description).toContain("- list_datasources(): List the data sources.");
    expect(call.tools.grafana.description).not.toContain("update_dashboard");
    expect(seen.headers.at(-1)).toMatchObject({ authorization: "Bearer g-token" });
    expect(await grafanaMcpStatus()).toMatchObject({ configured: true, ok: true, tools: expect.arrayContaining(["list_datasources", "get_doc"]) });
    expect(await run(call, "grafana", { tool: "update_dashboard" })).toMatch(/^Blocked: "update_dashboard" is not one of the Grafana tools KubeDeck may use \(read-only\)/);
  });

  it("lists Grafana's tools as read or hidden, never approval", async () => {
    await stopPlugins();
    await startPlugins(memoryStore(), { ...ENV, KUBEDECK_GRAFANA_MCP_URL: url });
    const [info] = (await listPlugins(false)).filter((p) => p.id === "grafana");
    expect(new Set(info.catalog?.map((t) => t.access))).toEqual(new Set(["read", "hidden"]));
    expect(info.catalog?.find((t) => t.name === "list_datasources")).toMatchObject({ access: "read" });
    expect(info.catalog?.find((t) => t.name === "update_dashboard")).toMatchObject({ access: "hidden", reason: "It may change things, and KubeDeck only reads Grafana." });
  });

  it("switched off, drops its tool", async () => {
    await stopPlugins();
    await startPlugins(memoryStore(), { ...ENV, KUBEDECK_GRAFANA_MCP_URL: url });
    expect(Object.keys((await toolsForCall({ scope })).tools)).toContain("grafana");
    await updatePlugin("grafana", { enabled: false }, "admin");
    expect(Object.keys((await toolsForCall({ scope })).tools)).not.toContain("grafana");
    expect(await grafanaMcpStatus()).toMatchObject({ configured: false });
  });
});
