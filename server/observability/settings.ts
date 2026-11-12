/**
 * The observability settings in effect, as the Tempo, Loki and Grafana plugins say: a plugin that is
 * off (or not configured) contributes empty values, so everything treats that part as not set up.
 */
import type { PluginValues } from "@shared/plugins";
import { pluginState } from "../plugins";

/** Grafana Tempo for traces, Loki for logs, and the Grafana MCP server the assistant may use. Every field is optional. */
export interface ObservabilitySettings {
  /** Tempo's HTTP API, e.g. https://tempo.example.com */
  tempoUrl: string;
  /** sent as `Authorization: Bearer …` when set */
  tempoToken: string;
  /** sent as `X-Scope-OrgID` for a multi-tenant Tempo */
  tempoTenant: string;
  /** Loki's HTTP API, e.g. https://loki.example.com: log history, pods that are gone, logs next to a trace */
  lokiUrl: string;
  lokiToken: string;
  lokiTenant: string;
  /** kube context → the cluster name its traces carry (`k8s.cluster.name`), when it cannot be worked out */
  clusters: Record<string, string>;
  /** for "Open in Grafana" links */
  grafanaUrl: string;
  /** the Tempo data source's uid in Grafana */
  grafanaTempoDatasource: string;
  /** the Grafana MCP server's streamable-HTTP endpoint, e.g. https://grafana-mcp.example.com/mcp */
  mcpUrl: string;
  /** sent as `Authorization: Bearer …` to the MCP server when set */
  mcpToken: string;
}

/** A setting as text ("" when unset or not text). */
export const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A setting as name → value pairs, blank ones dropped ({} when unset or not a map). */
export function pairs(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(v)) if (name.trim() && text(value)) out[name.trim()] = text(value);
  return out;
}

/** Only the settings that hold something: an empty one must not pin, lock or overwrite its field. */
export const nonEmpty = (values: PluginValues): PluginValues =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => (typeof v === "string" ? v !== "" : typeof v === "boolean" || Object.keys(v).length > 0)));

/** `ctx=cluster,ctx2=cluster2` → { ctx: "cluster", ctx2: "cluster2" } */
export function parseClusterMap(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const context = pair.slice(0, at).trim();
    const cluster = pair.slice(at + 1).trim();
    if (context && cluster) out[context] = cluster;
  }
  return out;
}

/** Which plugin, and which of its settings, each observability setting comes from. */
const SOURCES = {
  tempo: { url: "tempoUrl", token: "tempoToken", tenant: "tempoTenant", clusters: "clusters", grafanaUrl: "grafanaUrl", grafanaTempoDatasource: "grafanaTempoDatasource" },
  loki: { url: "lokiUrl", token: "lokiToken", tenant: "lokiTenant" },
  // the Grafana MCP server, defined by the MCP plugins; until it is, it reads as off
  grafana: { url: "mcpUrl", token: "mcpToken" },
} as const satisfies Record<string, Record<string, keyof ObservabilitySettings>>;

export type ObservabilityPlugin = keyof typeof SOURCES;
const PLUGINS = Object.keys(SOURCES) as ObservabilityPlugin[];

const fieldsOf = (plugin: ObservabilityPlugin): [string, keyof ObservabilitySettings][] => Object.entries(SOURCES[plugin]);
const valueOf = (field: keyof ObservabilitySettings, raw: unknown) => (field === "clusters" ? pairs(raw) : text(raw));

/** Observability settings from the plugins' values (a plugin left out, or off, contributes nothing). */
export function observabilityOf(values: Partial<Record<ObservabilityPlugin, PluginValues>>): ObservabilitySettings {
  const out: Record<string, string | Record<string, string>> = {};
  for (const plugin of PLUGINS) for (const [key, field] of fieldsOf(plugin)) out[field] = valueOf(field, values[plugin]?.[key]);
  return out as unknown as ObservabilitySettings;
}

/** The other way: settings in the old shape (the desktop's settings file) → each plugin's values, empty ones left out. */
export function pluginValuesOf(settings: Record<string, unknown>): Record<ObservabilityPlugin, PluginValues> {
  const one = (plugin: ObservabilityPlugin) => nonEmpty(Object.fromEntries(fieldsOf(plugin).map(([key, field]) => [key, valueOf(field, settings[field])])));
  return { tempo: one("tempo"), loki: one("loki"), grafana: one("grafana") };
}

const valuesIfOn = (id: ObservabilityPlugin): PluginValues => {
  const s = pluginState(id);
  return s.enabled ? s.values : {};
};

/** Tracing, log history and Grafana settings in effect now (Settings → Plugins, or the environment). */
export function getObservability(): ObservabilitySettings {
  return observabilityOf({ tempo: valuesIfOn("tempo"), loki: valuesIfOn("loki"), grafana: valuesIfOn("grafana") });
}
