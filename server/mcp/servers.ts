/**
 * MCP servers an admin adds under Settings → MCP servers. Each one becomes one assistant tool,
 * `mcp_<name>`, that forwards to the server's tools: read-only ones by default; with "Allow changes"
 * the others too, each call waiting for the person's approval in the chat. Remote servers only
 * (Streamable HTTP or SSE): KubeDeck never starts a local (stdio) server, which would run arbitrary
 * commands inside it.
 */
import type { PluginValues } from "@shared/plugins";
import { definePluginKind, type PluginDefinition } from "../plugins";
import { describeCatalog, type McpTool } from "./hub";
import { isReadTool } from "./read-only";
import { kubeDeckReadOnly, startMcpToolset, type McpCatalog, type McpToolsetOptions } from "./toolset";

/**
 * The assistant's tool for an added server: "mcp-github-tools" → "mcp_github_tools". Plugin ids are
 * `<kind>-<slug>` (an older form used ":"); the slug is made of [a-z0-9-], so names never collide.
 */
export const mcpToolName = (id: string) =>
  `mcp_${id.replace(/^mcp[-:]/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "server"}`.slice(0, 64);

const text = (v: PluginValues[string] | undefined) => (typeof v === "string" ? v.trim() : "");
const list = (v: PluginValues[string] | undefined) => (Array.isArray(v) ? v.map((s) => s.trim()).filter(Boolean) : []);
const map = (v: PluginValues[string] | undefined): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};

/** An added MCP server's settings, as the runtime reads them. */
export function serverSettings(v: PluginValues) {
  return {
    url: text(v.url),
    transport: v.transport === "sse" ? ("sse" as const) : ("http" as const),
    token: text(v.token),
    headers: map(v.headers),
    allowChanges: v.allowChanges === true,
    tools: list(v.tools),
    groups: list(v.groups),
  };
}

/** The proxy tool's live description: the read tools, then the ones that wait for approval. */
function describe(name: string, c: McpCatalog): string {
  const lines = [`Call one tool on the MCP server "${name}". Pass {tool, arguments}. Tools (* = required):`, describeCatalog(c.read)];
  if (c.change.length) lines.push("These may change things; each call waits for the user's approval:", describeCatalog(c.change));
  return lines.filter(Boolean).join("\n");
}

/**
 * What the assistant may do with a server's tools: read ones run, others need "Allow changes" (and a
 * KubeDeck that is not read-only), and an "Only these tools" list leaves out the rest; with the reason
 * the settings page shows for each tool left out.
 */
function accessRule(s: ReturnType<typeof serverSettings>): Pick<McpToolsetOptions, "classify" | "hiddenReason" | "changes"> {
  const allowed = s.tools.length ? new Set(s.tools) : null;
  const changes = s.allowChanges && !kubeDeckReadOnly();
  const listed = (t: McpTool) => !allowed || allowed.has(t.name);
  return {
    changes,
    classify: (t) => (!listed(t) ? null : isReadTool(t) ? "read" : changes ? "change" : null),
    hiddenReason: (t) => !listed(t) ? "Not in this server's “Only these tools” list."
      : s.allowChanges ? "It may change things, and this KubeDeck is read-only." : "It may change things, and Allow changes is off.",
  };
}

function definition({ id, name }: { id: string; name: string }): PluginDefinition {
  const toolName = mcpToolName(id);
  return {
    id,
    name,
    description: `MCP server "${name}": its tools for the assistant, behind one tool (${toolName}). Remote servers only (HTTP); KubeDeck does not run local (stdio) servers.`,
    category: "mcp",
    kind: "mcp",
    fields: [
      { key: "url", label: "Server URL", kind: "url", required: true, placeholder: "https://mcp.example.com/mcp", help: "The server's remote endpoint. Local (stdio) servers are not supported." },
      {
        key: "transport", label: "Transport", kind: "select", default: "http",
        options: [{ value: "http", label: "Streamable HTTP" }, { value: "sse", label: "SSE (older servers)" }],
        help: "Streamable HTTP unless the server only speaks the older SSE transport.",
      },
      { key: "token", label: "Token", kind: "secret", help: "Sent as Authorization: Bearer <token>." },
      { key: "headers", label: "Extra headers", kind: "map", help: "Sent with every request. Not secret: put credentials in Token." },
      {
        key: "allowChanges", label: "Allow changes", kind: "boolean", default: false,
        help: "Off: only tools that read. On: other tools too, and every call of one waits for the person's approval in the chat.",
      },
      { key: "tools", label: "Only these tools", kind: "list", help: "Tool names; empty allows every tool the read/change rule allows." },
      { key: "groups", label: "Only for these groups", kind: "list", help: "KubeDeck groups whose members get this server's tools; empty = everyone. The desktop app has no groups." },
    ],
    provides: { tools: [toolName] },
    validate: (v) => (/^https?:\/\/\S+$/.test(serverSettings(v).url) ? [] : ["Set the server's URL (http or https)."]),
    start(ctx) {
      const s = serverSettings(ctx.values);
      const access = accessRule(s);
      return startMcpToolset({
        owner: `mcp:${id}`,
        toolName,
        source: name,
        target: { url: s.url, transport: s.transport, token: s.token, headers: s.headers, label: `the MCP server "${name}"` },
        ...access,
        description: `Call a tool on the MCP server "${name}".`,
        namePattern: /^[A-Za-z][\w.\-/]{0,127}$/,
        nameHint: `Tool name from the list of "${name}"`,
        describe: (c) => describe(name, c),
        prompt: (c) => [
          `## ${name} (MCP)`,
          `The \`${toolName}\` tool reaches the MCP server "${name}"; its description lists the tools.` +
            (c.change.length ? " Tools that change things wait for the user's approval: call them only when the user asked for that change." : " Only tools that read are offered."),
        ].join("\n"),
        unreachable: (m) => `## ${name} (MCP)\nThe MCP server "${name}" is configured but unreachable right now (${m}). Say so if the user asks for its data.`,
        groups: s.groups,
        log: ctx.log,
      });
    },
  };
}

definePluginKind("mcp", definition);
