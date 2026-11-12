/**
 * The MCP servers page as plain data: which servers it shows where, a server's tools grouped by what
 * the assistant may do with them, the one-line summary on a card, and the add form's URL check.
 */
import type { FieldValue, PluginInfo, PluginTool } from "@shared/plugins";

export type ToolAccess = PluginTool["access"];

export const ACCESS_LABEL: Record<ToolAccess, string> = {
  read: "Reads",
  approval: "Needs approval in the chat",
  hidden: "Not offered to the assistant",
};

/** Built-in servers (Grafana) first, then the added ones, each by name. */
export function splitServers(plugins: readonly PluginInfo[]): { builtin: PluginInfo[]; added: PluginInfo[] } {
  const servers = plugins.filter((p) => p.category === "mcp").sort((a, b) => a.name.localeCompare(b.name));
  return { builtin: servers.filter((p) => p.kind === "builtin"), added: servers.filter((p) => p.kind !== "builtin") };
}

/** The tools in groups of one access each, in the order read → approval → hidden; empty groups left out. */
export function groupTools(catalog: readonly PluginTool[]): { access: ToolAccess; tools: PluginTool[] }[] {
  const order: ToolAccess[] = ["read", "approval", "hidden"];
  return order.map((access) => ({ access, tools: catalog.filter((t) => t.access === access) })).filter((g) => g.tools.length > 0);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 tools · 1 needs approval · 2 hidden"; null before the server listed its tools. */
export function toolSummary(catalog: readonly PluginTool[] | undefined): string | null {
  if (!catalog) return null;
  const approval = catalog.filter((t) => t.access === "approval").length;
  const hidden = catalog.filter((t) => t.access === "hidden").length;
  const offered = catalog.length - hidden;
  const parts = [offered ? plural(offered, "tool") : "No tools offered"];
  if (approval) parts.push(`${approval} ${approval === 1 ? "needs" : "need"} approval`);
  if (hidden) parts.push(`${hidden} hidden`);
  return parts.join(" · ");
}

/** The host of a server's URL setting ("grafana-mcp.example.com:8000"), or null when it has none the viewer may see. */
export function hostOf(url: FieldValue | undefined): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * What is wrong with a server URL typed into the add form, or null when the server would take it
 * (an http or https address; KubeDeck never starts a local stdio server).
 */
export function serverUrlProblem(raw: string): string | null {
  const url = raw.trim();
  if (!url) return "Enter the server's URL.";
  if (/\s/.test(url)) return "A URL has no spaces.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Enter a full URL, starting with https:// or http://.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Use the server's http(s) address: KubeDeck connects to remote servers only and never runs a local (stdio) one.";
  }
  if (!parsed.hostname) return "The URL needs a host name.";
  return null;
}
