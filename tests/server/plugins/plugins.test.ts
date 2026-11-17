import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import os from "os";
import path from "path";
import fs from "fs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type Database } from "@server/db";
import { on, settled, type PluginChanged } from "@server/events";
import { decrypt, encrypt, secretKey } from "@server/secrets";
import {
  createPlugin, databaseStore, definePlugin, definePluginKind, listPlugins, pluginState, registerPluginRoutes, removePlugin,
  startPlugins, stopPlugins, testPlugin, updatePlugin,
} from "@server/plugins";

const ENV = { KUBEDECK_AUTH_SECRET: "x".repeat(40) };
const calls: string[] = [];

// a plugin shaped like the real ones: a URL, a token, pinned by the environment when it is set
definePlugin({
  id: "test-traces",
  name: "Test traces",
  description: "for tests",
  category: "observability",
  kind: "builtin",
  fields: [{ key: "url", label: "URL", kind: "url", required: true }, { key: "token", label: "Token", kind: "secret" }],
  fromEnv: (env) => ({ url: env.TEST_TRACES_URL ?? "" }),
  defaultEnabled: (v) => !!v.url,
  validate: (v) => (v.url ? [] : ["Set the URL."]),
  start(ctx) {
    calls.push(`start ${ctx.values.url}`);
    if (ctx.values.url === "http://broken") throw new Error("refused");
    return { stop: () => { calls.push("stop"); }, status: () => ({ state: "ok", detail: "3 clusters" }) };
  },
});
definePluginKind("mcp", ({ id, name }) => ({
  id, name, description: "an MCP server", category: "mcp", kind: "mcp",
  fields: [{ key: "url", label: "URL", kind: "url", required: true }],
  start: (ctx) => ({ status: () => ({ state: "ok", detail: `${ctx.values.url}` }) }),
}));

let d: Database;
beforeEach(async () => {
  calls.length = 0;
  d = await openDatabase({ type: "sqlite", target: ":memory:" });
  await migrate(d);
});
afterEach(async () => {
  await stopPlugins();
  await d.close();
});

describe("plugin settings", () => {
  it("is off until configured, and on by default when the environment configures it", async () => {
    await startPlugins(databaseStore(d), ENV);
    expect(pluginState("test-traces")).toEqual({ enabled: false, values: {} });
    await stopPlugins();
    await startPlugins(databaseStore(d), { ...ENV, TEST_TRACES_URL: "http://tempo" });
    expect(pluginState("test-traces")).toEqual({ enabled: true, values: { url: "http://tempo" } });
    const [p] = (await listPlugins(true)).filter((x) => x.id === "test-traces");
    expect(p).toMatchObject({ enabled: true, envPinned: ["url"], status: { state: "ok", detail: "3 clusters" } });
  });

  it("restarts with new settings, keeps secrets encrypted at rest and never sends them back", async () => {
    await startPlugins(databaseStore(d), ENV);
    const p = await updatePlugin("test-traces", { enabled: true, values: { url: "http://a", token: "s3cret" } }, "admin@example.com");
    expect(p).toMatchObject({ enabled: true, values: { url: "http://a", token: "" }, secretsSet: ["token"] });
    const row = await d.db.selectFrom("plugin_state").selectAll().where("id", "=", "test-traces").executeTakeFirstOrThrow();
    expect(row.values).not.toContain("s3cret");
    expect(pluginState("test-traces").values.token).toBe("s3cret");
    // an empty secret keeps the stored one; a new URL restarts it
    await updatePlugin("test-traces", { values: { url: "http://b", token: "" } }, "admin@example.com");
    expect(pluginState("test-traces").values).toEqual({ url: "http://b", token: "s3cret" });
    expect(calls).toEqual(["start http://a", "stop", "start http://b"]);
    // non-managers see no settings
    expect((await listPlugins(false)).find((x) => x.id === "test-traces")).toMatchObject({ values: {}, secretsSet: [] });
  });

  it("keeps what the environment pins, reports missing settings and failed starts", async () => {
    await startPlugins(databaseStore(d), { ...ENV, TEST_TRACES_URL: "http://env" });
    await updatePlugin("test-traces", { values: { url: "http://mine" } }, "a");
    expect(pluginState("test-traces").values.url).toBe("http://env");
    await stopPlugins();
    await startPlugins(databaseStore(d), ENV);
    await updatePlugin("test-traces", { enabled: true, values: { url: "" } }, "a");
    expect(await testPlugin("test-traces")).toEqual({ state: "unconfigured", message: "Set the URL." });
    expect(pluginState("test-traces").enabled).toBe(false);
    await updatePlugin("test-traces", { values: { url: "http://broken" } }, "a");
    expect(await testPlugin("test-traces")).toMatchObject({ state: "error", message: "Could not start: refused" });
  });

  it("refuses unknown settings and switching off an always-on plugin", async () => {
    await startPlugins(databaseStore(d), ENV);
    await expect(updatePlugin("test-traces", { values: { nope: "1" } }, "a")).rejects.toThrow(/no setting nope/);
    await expect(updatePlugin("kubernetes", { enabled: false }, "a")).rejects.toThrow(/always on/);
  });

  it("adds, keeps across a restart, and removes an MCP server; tells listeners each time", async () => {
    const seen: PluginChanged[] = [];
    const off = on("plugin.changed", (e) => { seen.push(e); });
    await startPlugins(databaseStore(d), ENV);
    const added = await createPlugin("mcp", "GitHub MCP", { url: "http://gh" }, "a");
    expect(added).toMatchObject({ id: "mcp-github-mcp", kind: "mcp", removable: true, enabled: true, status: { state: "ok", detail: "http://gh" } });
    expect((await createPlugin("mcp", "GitHub MCP", { url: "http://gh2" }, "a")).id).toBe("mcp-github-mcp-2");
    await stopPlugins();
    await startPlugins(databaseStore(d), ENV);
    expect(pluginState("mcp-github-mcp")).toEqual({ enabled: true, values: { url: "http://gh" } });
    await removePlugin("mcp-github-mcp", "a");
    expect(pluginState("mcp-github-mcp").enabled).toBe(false);
    await expect(removePlugin("kubernetes", "a")).rejects.toThrow(/built in/);
    await settled();
    expect(seen.map((e) => `${e.id} ${e.change}`)).toEqual(["mcp-github-mcp added", "mcp-github-mcp-2 added", "mcp-github-mcp removed"]);
    off();
  });
});

describe("secrets", () => {
  it("round-trips, and a desktop key file is made once with owner-only access", () => {
    const k = secretKey(ENV);
    expect(decrypt(encrypt("token-1", k), k)).toBe("token-1");
    expect(decrypt("plain", k)).toBe("plain");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-key-"));
    const a = secretKey({}, dir);
    expect(secretKey({}, dir).equals(a)).toBe(true);
    expect(fs.statSync(path.join(dir, "plugins.key")).mode & 0o777).toBe(0o600);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("plugin routes", () => {
  let server: Server;
  let base = "";
  let role: "admin" | "user" = "admin";
  beforeEach(async () => {
    await startPlugins(databaseStore(d), ENV);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.kubedeckUser = { name: "a", email: "a@example.com", groups: [], role }; next(); });
    registerPluginRoutes(app);
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server?.close());
  afterEach(() => { server.close(); role = "admin"; });

  const send = (method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async (r) => ({ status: r.status, body: await r.json() }));

  it("lists for everyone, changes only for admins", async () => {
    const list = await send("GET", "/api/plugins");
    expect(list.body).toMatchObject({ canManage: true, addable: ["mcp"] });
    expect(list.body.plugins.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["kubernetes", "test-traces"]));
    expect((await send("PUT", "/api/plugins/test-traces", { enabled: true, values: { url: "http://x" } })).body).toMatchObject({ enabled: true });
    expect((await send("POST", "/api/plugins/test-traces/test")).body).toMatchObject({ state: "ok" });
    expect((await send("POST", "/api/plugins", { kind: "mcp", name: "Docs", values: { url: "http://docs" } })).status).toBe(201);
    expect((await send("DELETE", "/api/plugins/mcp-docs")).status).toBe(200);
    expect((await send("PUT", "/api/plugins/nope", { enabled: true })).status).toBe(404);
    role = "user";
    expect((await send("GET", "/api/plugins")).body).toMatchObject({ canManage: false, addable: [] });
    expect((await send("PUT", "/api/plugins/test-traces", { enabled: false })).status).toBe(403);
  });
});
