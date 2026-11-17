/**
 * The Tempo and Loki plugins, the settings they put in effect, and the one-time move of the desktop's
 * old Observability settings. Real code throughout: an in-memory database, a temporary home folder,
 * and small local HTTP servers that answer like Tempo and Loki.
 */
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV = { KUBEDECK_AUTH_SECRET: "x".repeat(40) };
const realHome = process.env.HOME;
const realProfile = process.env.USERPROFILE;

// settings.ts reads the home folder when it loads, so every test loads the modules afresh
type Mods = {
  obs: typeof import("@server/observability");
  plugins: typeof import("@server/plugins");
  settings: typeof import("@server/settings");
  db: typeof import("@server/db");
};
let m: Mods;
let home: string;
let d: Awaited<ReturnType<Mods["db"]["openDatabase"]>>;

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kd-obs-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  vi.resetModules();
  m = { obs: await import("@server/observability"), plugins: await import("@server/plugins"), settings: await import("@server/settings"), db: await import("@server/db") };
  d = await m.db.openDatabase({ type: "sqlite", target: ":memory:" });
  await m.db.migrate(d);
});

afterEach(async () => {
  await m.plugins.stopPlugins();
  await d.close();
  process.env.HOME = realHome;
  process.env.USERPROFILE = realProfile;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const start = (env: NodeJS.ProcessEnv = {}) => m.plugins.startPlugins(m.plugins.databaseStore(d), { ...ENV, ...env });
const info = async (id: string) => (await m.plugins.listPlugins(true)).find((p) => p.id === id)!;

/** The Grafana MCP plugin is defined elsewhere (the MCP plugins); a stand-in with the same fields. */
const defineGrafana = () =>
  m.plugins.definePlugin({
    id: "grafana", name: "Grafana", description: "stand-in", category: "observability", kind: "builtin",
    fields: [{ key: "url", label: "URL", kind: "url", required: true }, { key: "token", label: "Token", kind: "secret" }],
    defaultEnabled: (v) => !!v.url,
    start: () => ({}),
  });

describe("the Tempo and Loki plugins", () => {
  it("are listed with what they provide, off until configured", async () => {
    await start();
    const tempo = await info("tempo");
    expect(tempo).toMatchObject({
      name: "Tempo traces", category: "observability", kind: "builtin", enabled: false, envPinned: [], status: { state: "off" },
      provides: { tools: ["traces_stats", "traces_search", "trace_get"], features: ["Traces tab", "Overview → Traces"] },
    });
    expect(tempo.fields.map((f) => `${f.key}:${f.kind}`)).toEqual(["url:url", "token:secret", "tenant:text", "clusters:map", "grafanaUrl:url", "grafanaTempoDatasource:text"]);
    expect(await info("loki")).toMatchObject({ name: "Loki logs", enabled: false, provides: { tools: ["logs_search"], features: ["Log lines next to traces"] } });
  });

  it("take their settings from the environment, pinned, and are on when it sets a URL", async () => {
    await start({
      KUBEDECK_TEMPO_URL: " https://tempo.example.com ", KUBEDECK_TEMPO_TOKEN: "tt", KUBEDECK_TEMPO_CLUSTERS: "prod-admin=shared,dev=dev",
      KUBEDECK_GRAFANA_URL: "https://grafana.example.com", KUBEDECK_GRAFANA_TEMPO_DATASOURCE: "tempo-uid",
      KUBEDECK_LOKI_URL: "https://loki.example.com", KUBEDECK_LOKI_TENANT: "acme",
    });
    expect(m.plugins.pluginState("tempo")).toEqual({
      enabled: true,
      values: { url: "https://tempo.example.com", token: "tt", clusters: { "prod-admin": "shared", dev: "dev" }, grafanaUrl: "https://grafana.example.com", grafanaTempoDatasource: "tempo-uid" },
    });
    // an unset variable pins nothing, so tenant stays editable
    expect((await info("tempo")).envPinned).toEqual(["url", "token", "clusters", "grafanaUrl", "grafanaTempoDatasource"]);
    await m.plugins.updatePlugin("tempo", { values: { url: "https://mine.example.com", tenant: "t1" } }, "a");
    expect(m.plugins.pluginState("tempo").values).toMatchObject({ url: "https://tempo.example.com", tenant: "t1" });
    expect(m.plugins.pluginState("loki")).toEqual({ enabled: true, values: { url: "https://loki.example.com", tenant: "acme" } });
  });

  it("will not run without an http(s) URL", async () => {
    await start();
    await m.plugins.updatePlugin("tempo", { enabled: true }, "a");
    expect(await m.plugins.testPlugin("tempo")).toEqual({ state: "unconfigured", message: "Set the URL." });
    await m.plugins.updatePlugin("tempo", { values: { url: "file:///etc/passwd", grafanaUrl: "grafana" } }, "a");
    expect(await m.plugins.testPlugin("tempo")).toEqual({ state: "unconfigured", message: '"file:///etc/passwd" is not an http(s) URL. "grafana" is not an http(s) URL.' });
    expect(m.plugins.pluginState("tempo").enabled).toBe(false);
    await m.plugins.updatePlugin("loki", { enabled: true, values: { url: "loki:3100" } }, "a");
    expect(m.plugins.pluginState("loki").enabled).toBe(false);
  });
});

describe("getObservability", () => {
  it("is what the plugins that are on hold; a plugin that is off reads as not set up", async () => {
    defineGrafana();
    await start({ KUBEDECK_TEMPO_URL: "https://tempo.example.com", KUBEDECK_TEMPO_CLUSTERS: "a=x" });
    expect(m.obs.getObservability()).toEqual({
      tempoUrl: "https://tempo.example.com", tempoToken: "", tempoTenant: "", clusters: { a: "x" }, grafanaUrl: "", grafanaTempoDatasource: "",
      lokiUrl: "", lokiToken: "", lokiTenant: "", mcpUrl: "", mcpToken: "",
    });
    await m.plugins.updatePlugin("loki", { enabled: true, values: { url: "https://loki.example.com", token: "lt" } }, "a");
    await m.plugins.updatePlugin("grafana", { enabled: true, values: { url: "https://mcp.example.com/mcp", token: "gt" } }, "a");
    expect(m.obs.getObservability()).toMatchObject({ lokiUrl: "https://loki.example.com", lokiToken: "lt", mcpUrl: "https://mcp.example.com/mcp", mcpToken: "gt" });
    await m.plugins.updatePlugin("tempo", { enabled: false }, "a");
    await m.plugins.updatePlugin("grafana", { enabled: false }, "a");
    expect(m.obs.getObservability()).toMatchObject({ tempoUrl: "", clusters: {}, mcpUrl: "", lokiUrl: "https://loki.example.com" });
    // the old import path still works for callers that have not moved
    expect(m.settings.getObservability()).toEqual(m.obs.getObservability());
  });

  it("reads as nothing set up before the plugins start", () => {
    expect(m.obs.getObservability()).toMatchObject({ tempoUrl: "", lokiUrl: "", mcpUrl: "" });
  });
});

describe("plugin status against a server that answers like Tempo / Loki", () => {
  let server: http.Server;
  let base = "";
  const seen: { path: string; auth?: string; tenant?: string }[] = [];

  beforeEach(async () => {
    seen.length = 0;
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      seen.push({ path: url.pathname, auth: req.headers.authorization, tenant: req.headers["x-scope-orgid"] as string | undefined });
      if (req.headers.authorization !== "Bearer good") { res.writeHead(401).end("no org id"); return; }
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/api/v2/search/tag/resource.k8s.cluster.name/values") res.end(JSON.stringify({ tagValues: [{ type: "string", value: "dev" }, { type: "string", value: "prod" }] }));
      else if (url.pathname === "/loki/api/v1/labels") res.end(JSON.stringify({ status: "success", data: ["cluster", "namespace", "pod"] }));
      else res.writeHead(404).end("not found");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("Tempo: reachable, with how many clusters it has traces from", async () => {
    await start();
    const p = await m.plugins.updatePlugin("tempo", { enabled: true, values: { url: base, token: "good", tenant: "acme" } }, "a");
    expect(p.status).toEqual({ state: "ok", detail: "2 clusters" });
    expect(seen.at(-1)).toEqual({ path: "/api/v2/search/tag/resource.k8s.cluster.name/values", auth: "Bearer good", tenant: "acme" });
    await m.plugins.updatePlugin("tempo", { values: { token: "bad" } }, "a");
    expect(await m.plugins.testPlugin("tempo")).toEqual({ state: "error", message: "Tempo answered 401: no org id" });
  });

  it("Loki: a cheap labels call with the token and tenant", async () => {
    await start();
    const p = await m.plugins.updatePlugin("loki", { enabled: true, values: { url: base, token: "good", tenant: "acme" } }, "a");
    expect(p.status).toEqual({ state: "ok" });
    expect(seen.at(-1)).toEqual({ path: "/loki/api/v1/labels", auth: "Bearer good", tenant: "acme" });
    await m.plugins.updatePlugin("loki", { values: { token: "bad" } }, "a");
    expect(await m.plugins.testPlugin("loki")).toEqual({ state: "error", message: "Loki answered 401: no org id" });
  });

  it("an error when nothing answers", async () => {
    await start();
    await new Promise<void>((r) => server.close(() => r()));
    await m.plugins.updatePlugin("loki", { enabled: true, values: { url: base } }, "a");
    expect(await m.plugins.testPlugin("loki")).toMatchObject({ state: "error", message: expect.stringContaining("Cannot reach Loki") });
    server.listen(0); // so afterEach can close it
  });
});

describe("moving the desktop's old Observability settings into the plugins", () => {
  const settingsFile = () => path.join(home, ".kubedeck", "settings.json");
  const writeSettings = (content: unknown) => {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(content));
  };
  const OLD = {
    kubeconfigPaths: ["/k/config"],
    observability: {
      tempoUrl: "https://tempo.example.com", tempoToken: "tempo-secret", tempoTenant: "", clusters: { "prod-admin": "shared", " ": "x" },
      grafanaUrl: "https://grafana.example.com", grafanaTempoDatasource: "tempo-uid",
      lokiUrl: "", lokiToken: "", lokiTenant: "",
      mcpUrl: "https://mcp.example.com/mcp", mcpToken: "mcp-secret",
    },
  };
  const migrate = () => m.obs.migrateObservability(m.plugins.databaseStore(d), m.settings.legacyObservability());

  it("carries the values over once, on when a URL was set, secrets encrypted", async () => {
    defineGrafana();
    writeSettings(OLD);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await start();
    expect(await migrate()).toEqual(["tempo", "grafana"]);
    expect(m.plugins.pluginState("tempo")).toEqual({
      enabled: true,
      values: { url: "https://tempo.example.com", token: "tempo-secret", clusters: { "prod-admin": "shared" }, grafanaUrl: "https://grafana.example.com", grafanaTempoDatasource: "tempo-uid" },
    });
    expect(m.plugins.pluginState("loki").enabled).toBe(false); // nothing to carry
    expect(m.obs.getObservability()).toMatchObject({ tempoUrl: "https://tempo.example.com", mcpUrl: "https://mcp.example.com/mcp", mcpToken: "mcp-secret" });
    const rows = await m.plugins.databaseStore(d).all();
    expect(rows.find((r) => r.id === "tempo")).toMatchObject({ enabled: true, updatedBy: "migration" });
    expect(JSON.stringify(rows)).not.toContain("tempo-secret");

    // once: after someone changes the plugin, a restart does not bring the old values back
    await m.plugins.updatePlugin("tempo", { enabled: false }, "a");
    await m.plugins.stopPlugins();
    await start();
    expect(await migrate()).toEqual([]);
    expect(m.plugins.pluginState("tempo").enabled).toBe(false);
  });

  it("skips the Grafana MCP server while no plugin of that name exists", async () => {
    writeSettings(OLD);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await start();
    expect(await migrate()).toEqual(["tempo"]);
    expect(m.obs.getObservability().mcpUrl).toBe("");
  });

  it("does nothing without an old block, and settings saves leave the block alone", async () => {
    await start();
    expect(await migrate()).toEqual([]);
    writeSettings(OLD);
    m.settings.saveSettings({ kubeconfigPaths: ["/other/config"] });
    const saved = JSON.parse(fs.readFileSync(settingsFile(), "utf-8"));
    expect(saved).toMatchObject({ kubeconfigPaths: ["/other/config"], observability: OLD.observability });
    expect(m.settings.loadSettings()).not.toHaveProperty("observability");
  });
});
