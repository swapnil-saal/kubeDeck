/**
 * The MCP hub: KubeDeck's one way to talk to MCP servers. A connection reaches a server over
 * Streamable HTTP (or the older SSE transport), keeps its client, caches the tool catalog and
 * reconnects after an error. stdio servers are not supported: they would run arbitrary commands
 * inside KubeDeck.
 */
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { McpToolAnnotations } from "./read-only";

const CATALOG_TTL_MS = 5 * 60_000;
const CONNECT_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 60_000;
/** A tool result longer than this is cut; the model gets the head and a note. */
export const MAX_RESULT_CHARS = 14_000;
/** Servers with more tools than this are cut off (a catalog the model could not use anyway). */
const MAX_TOOLS = 500;

export interface McpTarget {
  /** the server's endpoint, e.g. https://grafana-mcp.example.com/mcp */
  url: string;
  /** sent as `Authorization: Bearer <token>` */
  token?: string;
  /** extra request headers */
  headers?: Record<string, string>;
  /** "http" (Streamable HTTP, the default) or "sse" (the older transport) */
  transport?: "http" | "sse";
  /** how errors name the server: "the Grafana MCP server" */
  label?: string;
}

/** One tool as the server describes it. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string | string[] }>; required?: string[] };
  annotations?: McpToolAnnotations;
}

/** What a tool call returns (MCP content blocks). */
export interface McpCallResult {
  content?: { type: string; text?: string }[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpConnection {
  readonly target: McpTarget;
  /** Every tool the server offers. Cached for five minutes (`fresh` asks again); throws when the server is unreachable. */
  listTools(o?: { fresh?: boolean }): Promise<McpTool[]>;
  /** The last catalog the server sent, without asking it; null before the first one. */
  knownTools(): McpTool[] | null;
  /** Call one tool; a failure drops the connection so the next call reconnects. */
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>;
  close(): Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The request headers for a target: its own, then the bearer token. */
export function headersOf(t: McpTarget): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.headers ?? {})) if (k.trim() && typeof v === "string") headers[k.trim()] = v;
  if (t.token) headers.Authorization = `Bearer ${t.token}`;
  return Object.keys(headers).length ? headers : undefined;
}

/** Close a client that is being dropped. It may already be dead; its error tells nothing new, so it is logged only when debugging. */
async function closeClient(client: Promise<MCPClient>): Promise<void> {
  try {
    await (await client).close();
  } catch (err) {
    if (process.env.KUBEDECK_DEBUG === "1") console.debug(`[kubedeck] MCP client did not close cleanly: ${message(err)}`);
  }
}

/** Every tool a server lists, page by page. */
async function listAll(mcp: MCPClient): Promise<McpTool[]> {
  const all: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await mcp.listTools({ params: cursor ? { cursor } : undefined, options: { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) } });
    all.push(...(page.tools as McpTool[]));
    cursor = page.nextCursor;
  } while (cursor && all.length < MAX_TOOLS);
  return all;
}

class Connection implements McpConnection {
  private client: Promise<MCPClient> | null = null;
  private catalog: { at: number; tools: McpTool[] } | null = null;
  private known: McpTool[] | null = null;
  private loading: Promise<McpTool[]> | null = null;
  private closed = false;

  constructor(readonly target: McpTarget) {}

  listTools({ fresh = false } = {}): Promise<McpTool[]> {
    if (!fresh && this.catalog && Date.now() - this.catalog.at < CATALOG_TTL_MS) return Promise.resolve(this.catalog.tools);
    // callers asking at the same moment share one request
    this.loading ??= this.load().finally(() => { this.loading = null; });
    return this.loading;
  }

  knownTools(): McpTool[] | null {
    return this.known;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    try {
      const mcp = await this.open();
      return (await mcp.callTool({ name, arguments: args, options: { signal: signal ? AbortSignal.any([signal, timeout]) : timeout } })) as McpCallResult;
    } catch (err) {
      if (!signal?.aborted) void this.drop();
      throw err;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.drop();
  }

  private open(): Promise<MCPClient> {
    if (this.closed) return Promise.reject(new Error("the connection was closed"));
    if (this.client) return this.client;
    const c = createMCPClient({
      transport: { type: this.target.transport ?? "http", url: this.target.url, headers: headersOf(this.target) },
      clientName: "kubedeck",
      initializationOptions: { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) },
    });
    this.client = c;
    // a failed connection is forgotten so the next call tries again
    c.catch(() => { if (this.client === c) this.client = null; });
    return c;
  }

  /** Forget the client and the catalog (after an error, or on close), so the next call reconnects. */
  private async drop(): Promise<void> {
    const old = this.client;
    this.client = null;
    this.catalog = null;
    if (old) await closeClient(old);
  }

  private async load(): Promise<McpTool[]> {
    try {
      const tools = await listAll(await this.open());
      this.catalog = { at: Date.now(), tools };
      this.known = tools;
      return tools;
    } catch (err) {
      void this.drop(); // forgets at once; closing the old client needs no wait
      throw new Error(`Cannot reach ${this.target.label ?? "the MCP server"} at ${this.target.url}: ${message(err)}`);
    }
  }
}

/** A connection to one MCP server. Nothing is sent until the first call. */
export function connectMcp(target: McpTarget): McpConnection {
  return new Connection(target);
}

/** A tool for the model: its name, the first sentence of its description and its parameters ("name*: type", * = required). */
export interface McpToolInfo {
  name: string;
  description: string;
  params: string[];
}

export function toInfo(t: McpTool): McpToolInfo {
  const required = new Set(t.inputSchema?.required ?? []);
  const params = Object.entries(t.inputSchema?.properties ?? {}).map(([k, v]) => {
    const type = Array.isArray(v?.type) ? v.type.join("|") : v?.type ?? "any";
    return `${k}${required.has(k) ? "*" : ""}: ${type}`;
  });
  // the first sentence is enough to pick a tool; the server returns the full schema on a bad call
  const description = (t.description ?? "").replace(/\s+/g, " ").trim().split(/(?<=\.)\s/)[0].slice(0, 220);
  return { name: t.name, description, params };
}

/** A catalog as compact lines for a tool description. */
export function describeCatalog(tools: McpToolInfo[]): string {
  return tools.map((t) => `- ${t.name}(${t.params.join(", ")}): ${t.description}`).join("\n");
}

/** MCP content blocks → text for the model, cut to a safe size. `source` names the server in errors ("Grafana"). */
export function resultText(result: McpCallResult, source = "the MCP server"): string {
  const text = (result.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type} content left out]`)).join("\n").trim()
    || (result.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : "");
  const body = text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (cut at ${MAX_RESULT_CHARS} characters: narrow the query)` : text;
  return result.isError ? `Error from ${source}: ${body || "the tool failed"}` : body || "(empty result)";
}
