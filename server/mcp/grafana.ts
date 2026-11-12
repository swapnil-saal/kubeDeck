/**
 * Grafana (github.com/grafana/mcp-grafana) as a built-in plugin: the assistant's `grafana` tool reads
 * Loki logs, Prometheus metrics, Tempo traces, dashboards, alert rules and incidents through it.
 * KubeDeck only READS here, whatever the server allows: on top of the hub's read rule, Grafana tools
 * that run raw queries, call the HTTP API or render images stay out.
 */
import type { GrafanaMcpStatus } from "@shared/traces";
import { definePlugin, pluginState } from "../plugins";
import { describeCatalog } from "./hub";
import { isReadTool, type ReadRule } from "./read-only";
import { startMcpToolset, type McpToolsetRuntime } from "./toolset";

export const GRAFANA_PLUGIN_ID = "grafana";

/** Grafana's own read tools without a read verb, and the tools that never only read. */
export const GRAFANA_RULE: ReadRule = {
  readNames: /^(generate_deeplink|alerting_rules_read|alerting_silences_read)$/,
  never: /(create|update|delete|install|write|manage|patch|add_|remove|silence_create|ask_assistant|run_panel_query|query_sql|query_influxdb|grafana_api_request|get_panel_image|render)/,
};

let running: McpToolsetRuntime | null = null;

definePlugin({
  id: GRAFANA_PLUGIN_ID,
  name: "Grafana",
  description:
    "Lets the assistant read the team's Grafana through the Grafana MCP server: Prometheus metrics, Loki logs, dashboards, alert rules and incidents. Read-only.",
  category: "mcp",
  kind: "builtin",
  fields: [
    { key: "url", label: "Grafana MCP server URL", kind: "url", required: true, placeholder: "https://grafana-mcp.example.com/mcp", help: "The Grafana MCP server's Streamable HTTP endpoint (usually ending in /mcp)." },
    { key: "token", label: "Token", kind: "secret", help: "Sent as Authorization: Bearer <token>, if the server needs one." },
  ],
  provides: { tools: ["grafana"] },
  fromEnv: (env) => ({ url: (env.KUBEDECK_GRAFANA_MCP_URL ?? "").trim(), token: env.KUBEDECK_GRAFANA_MCP_TOKEN ?? "" }),
  defaultEnabled: (v) => !!v.url,
  validate: (v) => (typeof v.url === "string" && /^https?:\/\/\S+$/.test(v.url) ? [] : ["Set the Grafana MCP server's URL (http or https)."]),
  start(ctx) {
    const runtime = startMcpToolset({
      owner: `mcp:${GRAFANA_PLUGIN_ID}`,
      toolName: "grafana",
      source: "Grafana",
      target: { url: String(ctx.values.url), token: typeof ctx.values.token === "string" ? ctx.values.token : "", label: "the Grafana MCP server" },
      classify: (t) => (isReadTool(t, GRAFANA_RULE) ? "read" : null),
      changes: false,
      // replaced per request with the tools the server actually offers
      description: "Call a read-only tool on the Grafana MCP server (Loki logs, Prometheus metrics, dashboards, alerts).",
      namePattern: /^[a-z][a-z0-9_]{1,63}$/,
      nameHint: "Grafana MCP tool name from the list",
      describe: (c) =>
        "Call one read-only tool on the team's Grafana (MCP). Pass {tool, arguments}. Use it for Loki logs, Prometheus metrics, " +
        "dashboards, alert rules and incidents; most query tools need a datasourceUid: get it from list_datasources first.\nTools (* = required):\n" +
        describeCatalog(c.read),
      prompt: () => [
        "## Grafana",
        "The `grafana` tool reaches the team's Grafana: Prometheus metrics history (CPU, memory, request rates over time), Loki logs beyond what kubectl keeps, dashboards, firing alerts.",
        "Use it when kubectl cannot answer (history, trends, logs of pods that are gone). Find the data source uid with list_datasources once, then query.",
      ].join("\n"),
      unreachable: (m) => `## Grafana\nThe Grafana MCP server is configured but unreachable right now (${m}). Say so if the user asks for Grafana data.`,
      groups: [],
      log: ctx.log,
    });
    running = runtime;
    return {
      status: () => runtime.status(),
      test: () => runtime.test(),
      async stop() {
        if (running === runtime) running = null;
        await runtime.stop();
      },
    };
  },
});

/** The Grafana MCP connection as the assistant sees it (GET /api/traces/grafana-mcp). */
export async function grafanaMcpStatus(): Promise<GrafanaMcpStatus> {
  const r = running;
  if (!pluginState(GRAFANA_PLUGIN_ID).enabled || !r) return { configured: false, ok: false, tools: [] };
  try {
    return { configured: true, ok: true, tools: (await r.catalog()).read.map((t) => t.name) };
  } catch (err) {
    return { configured: true, ok: false, tools: [], message: err instanceof Error ? err.message : String(err) };
  }
}
