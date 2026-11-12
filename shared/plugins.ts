/**
 * Plugins: the parts of KubeDeck an admin switches on, configures and checks under Settings → Plugins.
 * Built-in plugins ship with KubeDeck (Tempo traces, Loki logs, Grafana, the Kubernetes tools); MCP
 * servers are plugins an admin adds by URL. Each plugin's settings form is described by its fields,
 * so the page renders any plugin without knowing it.
 */
import { z } from "zod";

export const pluginPaths = {
  list: "/api/plugins",
  one: "/api/plugins/:id",
  test: "/api/plugins/:id/test",
} as const;

export const PLUGIN_CATEGORIES = ["core", "observability", "ai", "mcp"] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<PluginCategory, string> = {
  core: "Core",
  observability: "Observability",
  ai: "Assistant tools",
  mcp: "MCP servers",
};

/** A value of a plugin setting: text, a switch, a list of words, or name → value pairs. */
export const fieldValueSchema = z.union([z.string(), z.boolean(), z.array(z.string()), z.record(z.string())]);
export type FieldValue = z.infer<typeof fieldValueSchema>;
export type PluginValues = Record<string, FieldValue>;

export const pluginFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** secret: never sent back to the browser; an empty value on save keeps the stored one */
  kind: z.enum(["text", "url", "secret", "select", "boolean", "list", "map"]),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  /** the value when nothing is saved or pinned (not for secrets); the manager fills it in, so the plugin and its form agree */
  default: fieldValueSchema.optional(),
});
export type PluginField = z.input<typeof pluginFieldSchema>;

export const pluginStatusSchema = z.object({
  /** off: switched off; unconfigured: on but missing settings; ok / error: what its last check found */
  state: z.enum(["off", "unconfigured", "ok", "error"]),
  message: z.string().optional(),
  /** a short fact for the card, e.g. "12 tools" or "4 clusters" */
  detail: z.string().optional(),
});
export type PluginStatus = z.infer<typeof pluginStatusSchema>;

/**
 * One tool of a tool server (an MCP server) as the assistant gets it. read: runs straight away;
 * approval: offered, and every call waits for the person's approval in the chat; hidden: not offered
 * (it may change things while "Allow changes" is off, or it is not in the "Only these tools" list).
 */
export const pluginToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  access: z.enum(["read", "approval", "hidden"]),
  /** why a hidden tool is not offered, in a sentence */
  reason: z.string().optional(),
});
export type PluginTool = z.infer<typeof pluginToolSchema>;

export const pluginInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(PLUGIN_CATEGORIES),
  /** builtin ships with KubeDeck; mcp is a server an admin added */
  kind: z.enum(["builtin", "mcp"]),
  /** cannot be switched off (the Kubernetes tools) */
  alwaysOn: z.boolean(),
  enabled: z.boolean(),
  /** an added MCP server can be removed; built-ins cannot */
  removable: z.boolean(),
  fields: z.array(pluginFieldSchema),
  /** current values for people who may manage plugins; secrets are always "" (see secretsSet) */
  values: z.record(fieldValueSchema),
  /** secret fields that have a stored value */
  secretsSet: z.array(z.string()),
  /** fields set by the server's environment: shown, not editable */
  envPinned: z.array(z.string()),
  status: pluginStatusSchema,
  /** what it adds: assistant tools by name, and app features */
  provides: z.object({ tools: z.array(z.string()), features: z.array(z.string()) }),
  /**
   * A running tool server's tools as it last listed them, sorted by name; absent before it first
   * answered, while it is off, or for a plugin that is not a tool server. Sent to everyone who sees the
   * page: names and access rules are not secret, and every call stays gated by groups and approval.
   */
  catalog: z.array(pluginToolSchema).optional(),
});
export type PluginInfo = z.infer<typeof pluginInfoSchema>;

export const pluginListSchema = z.object({
  plugins: z.array(pluginInfoSchema),
  /** the viewer may switch plugins and change their settings (an admin; the desktop's own user) */
  canManage: z.boolean(),
  /** kinds of plugin an admin can add (e.g. "mcp") */
  addable: z.array(z.enum(["mcp"])),
});
export type PluginList = z.infer<typeof pluginListSchema>;

export const pluginUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  /** only the fields to change; a secret sent as "" keeps the stored one */
  values: z.record(fieldValueSchema).optional(),
});
export type PluginUpdate = z.infer<typeof pluginUpdateSchema>;

/** Adding a plugin of an addable kind: its display name and first settings. */
export const pluginCreateSchema = z.object({
  kind: z.enum(["mcp"]),
  name: z.string().trim().min(1).max(40),
  values: z.record(fieldValueSchema).default({}),
});
export type PluginCreate = z.input<typeof pluginCreateSchema>;
