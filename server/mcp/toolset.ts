/**
 * An MCP server's tools for the assistant: ONE proxy tool (`{tool, arguments}`) whose per-call
 * description lists the server tools the person may use. Read tools run straight away; tools that may
 * change something (only when the plugin allows them) wait for the person's approval in the chat.
 * The tool is hidden on a call when the server does not answer or the person is not in its groups.
 */
import type { PluginStatus, PluginTool } from "@shared/plugins";
import type { PluginRuntime } from "../plugins";
import { proxyTool, registerTools, unregisterTools, type KubeScope, type ToolApproval, type ToolEntry, type ToolsetCall } from "../ai/tools";
import { currentPerson } from "../identity";
import { isWebMode, personMay, webConfig } from "../web-mode";
import { connectMcp, resultText, toInfo, type McpConnection, type McpTarget, type McpTool, type McpToolInfo } from "./hub";

/** The server's tools KubeDeck offers, by risk, sorted by name. */
export interface McpCatalog {
  read: McpToolInfo[];
  change: McpToolInfo[];
}

export interface McpToolsetOptions {
  /** the registry owner, e.g. "mcp:github" */
  owner: string;
  /** the proxy tool's name */
  toolName: string;
  /** how answers and log lines name the server: "Grafana" */
  source: string;
  target: McpTarget;
  /** a tool's risk, or null to leave it out */
  classify(t: McpTool): "read" | "change" | null;
  /** why `classify` leaves a tool out, for the settings page: "It may change things, and Allow changes is off." */
  hiddenReason(t: McpTool): string;
  /** whether any tool may be a "change" one: the proxy then has an approval policy */
  changes: boolean;
  /** the registered description, before the server's catalog is known */
  description: string;
  namePattern: RegExp;
  nameHint: string;
  /** the live description and system-prompt section for a call, from the catalog */
  describe(c: McpCatalog): string;
  prompt(c: McpCatalog): string;
  /** the prompt section when the server does not answer */
  unreachable(message: string): string;
  /** KubeDeck groups whose members get the tool; empty = everyone */
  groups: string[];
  /** the plugin's log, for the first catalog */
  log?(message: string): void;
}

export interface McpToolsetRuntime extends PluginRuntime {
  connection: McpConnection;
  /** the tools offered to the assistant, asking the server (cached) */
  offered(fresh?: boolean): Promise<McpCatalog>;
  /** every tool the server last listed, with its access, for the settings page */
  catalog(): PluginTool[] | undefined;
  status(): Promise<PluginStatus>;
  test(): Promise<PluginStatus>;
  stop(): Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Whether the person of the current request may use a server limited to `groups`: their groups must
 * allow MCP tools (Settings → Groups) and include one of `groups` when it is set. Groups only exist on
 * a shared (web) KubeDeck; the desktop's one person always may. Outside a request: no.
 */
export function personMayUse(groups: readonly string[]): boolean {
  if (!isWebMode()) return true;
  if (!personMay("mcp")) return false;
  if (groups.length === 0) return true;
  const person = currentPerson();
  return !!person && person.groups.some((g) => groups.includes(g));
}

/** A shared KubeDeck set read-only lets the assistant change nothing, here either. */
export const kubeDeckReadOnly = () => isWebMode() && webConfig().readOnly;

const riskOf = (c: McpCatalog, name: string): "read" | "change" | null =>
  c.read.some((t) => t.name === name) ? "read" : c.change.some((t) => t.name === name) ? "change" : null;

const countOf = (c: McpCatalog) => c.read.length + c.change.length;

const byName = (tools: McpTool[]) => [...tools].sort((a, b) => a.name.localeCompare(b.name));

/** A server's tools by the risk `classify` gives them, sorted by name; null leaves a tool out. */
function splitCatalog(tools: McpTool[], classify: McpToolsetOptions["classify"]): McpCatalog {
  const c: McpCatalog = { read: [], change: [] };
  for (const t of byName(tools)) {
    const risk = classify(t);
    if (risk) c[risk].push(toInfo(t));
  }
  return c;
}

/** All of a server's tools for the settings page, sorted by name: read, approval, or hidden with the reason. */
function pageCatalog(tools: McpTool[], o: Pick<McpToolsetOptions, "classify" | "hiddenReason">): PluginTool[] {
  return byName(tools).map((t) => {
    const { name, description } = toInfo(t);
    const risk = o.classify(t);
    if (!risk) return { name, description, access: "hidden", reason: o.hiddenReason(t) };
    return { name, description, access: risk === "read" ? "read" : "approval" };
  });
}

/** "6 tools (2 need approval)" */
function statusOf(c: McpCatalog): PluginStatus {
  const n = countOf(c);
  return { state: "ok", detail: `${n} tool${n === 1 ? "" : "s"}${c.change.length ? ` (${c.change.length} need approval)` : ""}` };
}

/**
 * The approval policy of a proxy that may change things: reads run, anything else waits for the
 * person. Decided from the last catalog the server sent (approval is synchronous); none yet: ask.
 */
function approve(connection: McpConnection, o: McpToolsetOptions, name: string): ReturnType<ToolApproval> {
  const known = connection.knownTools();
  const risk = known ? riskOf(splitCatalog(known, o.classify), name) : "change";
  if (risk === "read") return undefined;
  if (!risk) return { type: "denied", reason: `Blocked: "${name}" is not one of the ${o.source} tools KubeDeck may use.` };
  if (kubeDeckReadOnly()) return { type: "denied", reason: "Blocked: this KubeDeck is read-only, so the assistant can only read." };
  if (!personMay("assistantChanges")) return { type: "denied", reason: "Blocked: your KubeDeck groups let the assistant read only." };
  return "user-approval";
}

/** One MCP server's proxy tool while its plugin runs. */
class McpToolset implements McpToolsetRuntime {
  readonly connection: McpConnection;

  constructor(private readonly o: McpToolsetOptions) {
    this.connection = connectMcp(o.target);
  }

  /** The tools this plugin offers, by risk, sorted by name. */
  async offered(fresh = false): Promise<McpCatalog> {
    return splitCatalog(await this.connection.listTools({ fresh }), this.o.classify);
  }

  /** Every tool the server last listed (none asked for here), with what the assistant may do with it. */
  catalog(): PluginTool[] | undefined {
    const known = this.connection.knownTools();
    return known ? pageCatalog(known, this.o) : undefined;
  }

  /** Register the proxy tool, and ask for the catalog once so the server's state is known (and logged) before the first chat. */
  register(): void {
    const { o } = this;
    const proxy = proxyTool({ description: o.description, namePattern: o.namePattern, nameHint: o.nameHint, run: (n, a, call) => this.run(n, a, call) });
    const entry: ToolEntry = o.changes
      ? { tool: proxy, scoped: true, risk: "change", approval: (input: { tool: string }) => approve(this.connection, o, input.tool) }
      : { tool: proxy, scoped: true };
    registerTools(o.owner, { tools: { [o.toolName]: entry }, forCall: () => this.forCall() });
    this.offered().then((c) => o.log?.(`${countOf(c)} tools from ${o.target.url}`), (err) => o.log?.(message(err)));
  }

  async status(): Promise<PluginStatus> {
    return statusOf(await this.offered());
  }

  async test(): Promise<PluginStatus> {
    return statusOf(await this.offered(true));
  }

  async stop(): Promise<void> {
    unregisterTools(this.o.owner);
    await this.connection.close();
  }

  /** On for this call when the person may use it and the server answers; else off, and the prompt says why. */
  private async forCall(): Promise<ToolsetCall> {
    const { o } = this;
    if (!personMayUse(o.groups)) return { active: [] };
    try {
      const c = await this.offered();
      if (countOf(c) === 0) return { active: [] };
      return { active: [o.toolName], descriptions: { [o.toolName]: o.describe(c) }, prompt: o.prompt(c) };
    } catch (err) {
      return { active: [], prompt: o.unreachable(message(err)) };
    }
  }

  /** One call of the proxy tool, audited with the person and the thread. */
  private async run(name: string, args: Record<string, unknown>, { scope, signal }: { scope: KubeScope; signal?: AbortSignal }): Promise<string> {
    const { o } = this;
    console.log(`[kubedeck:agent] ${o.toolName}${scope.user ? ` user=${JSON.stringify(scope.user)}` : ""} thread=${scope.threadId} tool=${name}`);
    if (!personMayUse(o.groups)) return `Blocked: ${o.source} is not available to this user.`;
    const c = await this.offered();
    if (!riskOf(c, name)) {
      return `Blocked: "${name}" is not one of the ${o.source} tools KubeDeck may use${o.changes ? "" : " (read-only)"}. ` +
        `Available: ${[...c.read, ...c.change].map((t) => t.name).join(", ")}`;
    }
    try {
      return resultText(await this.connection.callTool(name, args, signal), o.source);
    } catch (err) {
      if (signal?.aborted) throw err;
      return `Error calling ${o.source} ${name}: ${message(err)}`;
    }
  }
}

/** Connect, register the proxy tool, and return the plugin runtime that undoes it. Never throws for an unreachable server. */
export function startMcpToolset(o: McpToolsetOptions): McpToolsetRuntime {
  const set = new McpToolset(o);
  set.register();
  return set;
}
