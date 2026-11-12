/**
 * What one agent call hands the model, for each observability setup: the tools offered (in the order
 * the model gets them), every tool's name, description and input schema, which tools get the cluster
 * scope, which have an approval policy, and the system prompt. Runs the real agent's prepareCall
 * against a real settings file and, for Grafana, the real Grafana plugin (pinned by the environment,
 * as a web deployment does) and a small MCP server speaking the real protocol over HTTP. No model is
 * called.
 *
 * The AI SDK sends `tools` in their key order, keeping those named in `activeTools`; `activeTools`
 * and `toolsContext` are only looked up, so their own order is not recorded.
 */
import fs from "fs";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import { asSchema } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const realHome = process.env.HOME;
const realProfile = process.env.USERPROFILE;
const realEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("KUBEDECK_")));
let home = "";
let mcp: Server;
let mcpUrl = "";
let deadUrl = "";

/** Tools the test Grafana MCP server offers; KubeDeck keeps only the read ones. */
const MCP_TOOLS = [
  { name: "list_datasources", description: "List the data sources. Filter by type.", inputSchema: { type: "object", properties: { type: { type: "string" } } } },
  {
    name: "query_prometheus",
    description: "Run a PromQL query. Returns a matrix or vector.",
    inputSchema: { type: "object", properties: { datasourceUid: { type: "string" }, expr: { type: "string" } }, required: ["datasourceUid", "expr"] },
  },
  { name: "update_dashboard", description: "Change a dashboard.", inputSchema: { type: "object", properties: {} } },
];

/** A Grafana-like MCP server: legacy `initialize` handshake, `tools/list`, plain JSON responses. */
function startMcp(): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") return void res.writeHead(405).end();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const msg = JSON.parse(Buffer.concat(chunks).toString());
    if (msg.id === undefined) return void res.writeHead(202).end(); // a notification
    const reply = (body: object) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...body }));
    if (msg.method === "initialize") return reply({ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "grafana-test", version: "1" } } });
    if (msg.method === "tools/list") return reply({ result: { tools: MCP_TOOLS } });
    reply({ error: { code: -32601, message: `Method not found: ${msg.method}` } });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kd-agent-call-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  for (const k of Object.keys(realEnv)) delete process.env[k];
  mcp = await startMcp();
  mcpUrl = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;
  // a port nothing listens on
  const closed = await startMcp();
  deadUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/mcp`;
  await new Promise<void>((r) => closed.close(() => r()));
});

afterAll(async () => {
  await (await import("../../plugins")).stopPlugins();
  await new Promise<void>((r) => mcp.close(() => r()));
  process.env.HOME = realHome;
  process.env.USERPROFILE = realProfile;
  Object.assign(process.env, realEnv);
  fs.rmSync(home, { recursive: true, force: true });
});

/** One setup: the settings file, and the plugins started as the server starts them (Grafana from its environment variable). */
async function setUp(observability: Record<string, string>, grafanaMcpUrl = "") {
  writeSettings(observability);
  // the agent first: its own tools register when it is imported, plugin tools when plugins start
  await import("./agent");
  const { memoryStore, startPlugins, stopPlugins } = await import("../../plugins");
  await stopPlugins();
  await startPlugins(memoryStore(), grafanaMcpUrl ? { KUBEDECK_GRAFANA_MCP_URL: grafanaMcpUrl } : {});
}

function writeSettings(observability: Record<string, string>) {
  fs.mkdirSync(path.join(home, ".kubedeck"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".kubedeck", "settings.json"),
    // a keyless local provider: building the model needs no network
    JSON.stringify({ kubeconfigPaths: [], ai: { provider: "ollama", apiKey: "", model: "test-model", baseUrl: "http://127.0.0.1:9" }, observability }),
  );
}

interface PreparedCall {
  tools: Record<string, { description?: string; inputSchema: unknown; execute?: unknown; contextSchema?: unknown }>;
  activeTools: string[];
  toolsContext: Record<string, unknown>;
  toolApproval: Record<string, unknown>;
  instructions: string;
}

const scope = { context: "docker-desktop", namespace: "e2", threadId: "agent-call-test", user: "alice" };
const SCOPE_END = "- Never mention or switch to another cluster unless asked.";

/** The arguments the agent would hand to streamText for one request. */
async function prepare(): Promise<PreparedCall> {
  // settings.ts reads the home directory at import time, so the agent is imported after HOME is set
  const { getKubeAgent } = await import("./agent");
  const agent = getKubeAgent() as unknown as { prepareCall(o: object): Promise<PreparedCall> };
  return agent.prepareCall({ prompt: "hi", options: { scope, mode: "chat" } });
}

async function describeCall() {
  const call = await prepare();
  const tools = await Promise.all(
    Object.entries(call.tools).map(async ([name, t]) => ({
      name,
      description: t.description,
      input: await asSchema(t.inputSchema as never).jsonSchema,
      executes: typeof t.execute === "function",
      scoped: name in call.toolsContext,
    })),
  );
  for (const [name, ctx] of Object.entries(call.toolsContext)) expect(ctx, name).toEqual(scope);
  const at = call.instructions.indexOf(SCOPE_END);
  expect(at).toBeGreaterThan(0);
  // the unreachable server's random port shows up in the prompt
  const clean = (text: string) => text.split(deadUrl).join("<dead-mcp-url>");
  return {
    offered: Object.keys(call.tools).filter((name) => call.activeTools.includes(name)),
    toolNames: Object.keys(call.tools),
    scopedTools: Object.keys(call.toolsContext).sort(),
    approvalTools: Object.keys(call.toolApproval).sort(),
    /** everything the prompt says up to the observability sections; the same for every setup */
    basePrompt: call.instructions.slice(0, at + SCOPE_END.length),
    observabilityPrompt: clean(call.instructions.slice(at + SCOPE_END.length).trim()),
    tools,
  };
}

/** One setup's call for the snapshot: the parts that vary per call, and every tool in full when asked. */
async function snapshotOf(full = false) {
  const { basePrompt, tools, ...d } = await describeCall();
  const { buildSystemPrompt } = await import("./prompts");
  expect(basePrompt).toBe(buildSystemPrompt("", "chat", [], scope));
  return { ...d, grafanaDescription: tools.find((t) => t.name === "grafana")?.description, ...(full ? { tools, basePrompt } : {}) };
}

describe("what one agent call offers the model", () => {
  it("with nothing set up", async () => {
    await setUp({});
    const d = await snapshotOf();
    expect(d.offered).toEqual(["k8s_list", "k8s_describe", "k8s_logs", "kubectl", "bash", "monitor_logs", "ask_human", "present_dashboard"]);
    expect(d.observabilityPrompt).toBe("");
    expect(d).toMatchSnapshot();
  });

  it("with Tempo only", async () => {
    await setUp({ tempoUrl: "http://tempo.invalid" });
    const d = await snapshotOf();
    expect(d.offered.slice(8)).toEqual(["traces_stats", "traces_search", "trace_get"]);
    expect(d.observabilityPrompt).toMatch(/^## Traces \(Tempo\)/);
    expect(d).toMatchSnapshot();
  });

  it("with Tempo, Loki and a Grafana MCP server", async () => {
    await setUp({ tempoUrl: "http://tempo.invalid", lokiUrl: "http://loki.invalid" }, mcpUrl);
    const d = await snapshotOf(true);
    expect(d.offered.slice(8)).toEqual(["traces_stats", "logs_search", "traces_search", "trace_get", "grafana"]);
    expect(d.grafanaDescription).toContain("- list_datasources(type: string): List the data sources.");
    expect(d.grafanaDescription).not.toContain("update_dashboard");
    expect(d).toMatchSnapshot();
  });

  it("with a Grafana MCP server that does not answer", async () => {
    await setUp({}, deadUrl);
    const d = await snapshotOf();
    expect(d.offered).not.toContain("grafana");
    expect(d.observabilityPrompt).toMatch(/^## Grafana\nThe Grafana MCP server is configured but unreachable/);
    expect(d).toMatchSnapshot();
  });
});
