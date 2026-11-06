/**
 * The Grafana MCP server (github.com/grafana/mcp-grafana) as a source for the assistant: Loki logs,
 * Prometheus metrics, Tempo traces, dashboards, alert rules, incidents. KubeDeck only READS through it:
 * a tool is offered when its name says it reads and the server does not mark it destructive; anything
 * that creates, updates, deletes or runs raw SQL stays out, whatever the server allows.
 */
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ObservabilitySettings } from "./settings";

const CATALOG_TTL_MS = 5 * 60_000;
const CONNECT_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 60_000;
/** A tool result longer than this is cut; the model gets the head and a note. */
const MAX_RESULT_CHARS = 14_000;

const READ_NAME = /^(search_|get_|list_|query_|find_|analyze_|diff_|check_|fetch_|describe_)|^(generate_deeplink|alerting_rules_read|alerting_silences_read)$/;
const NEVER = /(create|update|delete|install|write|manage|patch|add_|remove|silence_create|ask_assistant|run_panel_query|query_sql|query_influxdb|grafana_api_request|get_panel_image|render)/;

export interface GrafanaToolInfo {
  name: string;
  description: string;
  /** "name*: type" per parameter, * = required */
  params: string[];
}

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string | string[] }>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** Whether KubeDeck lets the assistant call this Grafana MCP tool. */
export function isReadTool(t: Pick<ToolDef, "name" | "annotations">): boolean {
  if (t.annotations?.destructiveHint === true) return false;
  if (t.annotations?.readOnlyHint === false) return false;
  return READ_NAME.test(t.name) && !NEVER.test(t.name);
}

export function toInfo(t: ToolDef): GrafanaToolInfo {
  const required = new Set(t.inputSchema?.required ?? []);
  const params = Object.entries(t.inputSchema?.properties ?? {}).map(([k, v]) => {
    const type = Array.isArray(v?.type) ? v.type.join("|") : v?.type ?? "any";
    return `${k}${required.has(k) ? "*" : ""}: ${type}`;
  });
  // the first sentence is enough to pick a tool; the server returns the full schema on a bad call
  const description = (t.description ?? "").replace(/\s+/g, " ").trim().split(/(?<=\.)\s/)[0].slice(0, 220);
  return { name: t.name, description, params };
}

let client: { key: string; mcp: Promise<MCPClient> } | null = null;
let catalog: { key: string; at: number; tools: GrafanaToolInfo[] } | null = null;

const keyOf = (o: ObservabilitySettings) => `${o.mcpUrl}|${o.mcpToken}`;

export const grafanaMcpConfigured = (o: ObservabilitySettings | undefined): o is ObservabilitySettings => !!o?.mcpUrl;

function connect(o: ObservabilitySettings): Promise<MCPClient> {
  const key = keyOf(o);
  if (client?.key === key) return client.mcp;
  const old = client;
  if (old) void old.mcp.then((c) => c.close()).catch(() => {});
  const mcp = createMCPClient({
    transport: { type: "http", url: o.mcpUrl, headers: o.mcpToken ? { Authorization: `Bearer ${o.mcpToken}` } : undefined },
    clientName: "kubedeck",
    initializationOptions: { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) },
  });
  client = { key, mcp };
  // a failed connection is forgotten so the next call tries again
  mcp.catch(() => { if (client?.mcp === mcp) client = null; });
  return mcp;
}

/** Drop the connection (after an error), so the next call reconnects. */
function reset(o: ObservabilitySettings) {
  if (client?.key !== keyOf(o)) return;
  const old = client;
  client = null;
  catalog = null;
  void old.mcp.then((c) => c.close()).catch(() => {});
}

/** The read tools this Grafana MCP server offers. Cached for five minutes; throws when the server is unreachable. */
export async function grafanaTools(o: ObservabilitySettings): Promise<GrafanaToolInfo[]> {
  const key = keyOf(o);
  if (catalog?.key === key && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.tools;
  try {
    const mcp = await connect(o);
    const all: ToolDef[] = [];
    let cursor: string | undefined;
    do {
      const page = await mcp.listTools({ params: cursor ? { cursor } : undefined, options: { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) } });
      all.push(...(page.tools as ToolDef[]));
      cursor = page.nextCursor;
    } while (cursor && all.length < 500);
    const tools = all.filter(isReadTool).map(toInfo).sort((a, b) => a.name.localeCompare(b.name));
    catalog = { key, at: Date.now(), tools };
    return tools;
  } catch (err) {
    reset(o);
    throw new Error(`Cannot reach the Grafana MCP server at ${o.mcpUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** MCP content blocks → text for the model. */
export function resultText(result: { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown }): string {
  const text = (result.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type} content left out]`)).join("\n").trim()
    || (result.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : "");
  const body = text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (cut at ${MAX_RESULT_CHARS} characters: narrow the query)` : text;
  return result.isError ? `Error from Grafana: ${body || "the tool failed"}` : body || "(empty result)";
}

/** Call one read tool. Refuses any tool that is not in the read catalog. */
export async function callGrafanaTool(o: ObservabilitySettings, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const tools = await grafanaTools(o);
  if (!tools.some((t) => t.name === name)) {
    return `Blocked: "${name}" is not one of the Grafana tools KubeDeck may use (read-only). Available: ${tools.map((t) => t.name).join(", ")}`;
  }
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  try {
    const mcp = await connect(o);
    const result = await mcp.callTool({ name, arguments: args, options: { signal: signal ? AbortSignal.any([signal, timeout]) : timeout } });
    return resultText(result as Parameters<typeof resultText>[0]);
  } catch (err) {
    if (signal?.aborted) throw err;
    reset(o);
    return `Error calling Grafana ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** The catalog as compact lines for the tool description. */
export function describeCatalog(tools: GrafanaToolInfo[]): string {
  return tools.map((t) => `- ${t.name}(${t.params.join(", ")}): ${t.description}`).join("\n");
}
