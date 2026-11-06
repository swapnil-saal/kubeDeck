import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { isWebMode } from "./web-mode";

const SETTINGS_DIR = path.join(os.homedir(), ".kubedeck");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

export interface AiProviderSettings {
  provider: "openai" | "anthropic" | "ollama" | "custom";
  apiKey: string;
  model: string;
  fastModel?: string;
  baseUrl: string;
}

/** Grafana Tempo for traces, and the Grafana MCP server the assistant may use. Every field is optional. */
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

export interface KubeDeckSettings {
  kubeconfigPaths: string[];
  ai?: AiProviderSettings;
  observability?: ObservabilitySettings;
}

function defaults(): KubeDeckSettings {
  return {
    kubeconfigPaths: [path.join(os.homedir(), ".kube", "config")],
    ai: {
      provider: "openai",
      apiKey: "",
      model: "gpt-4o-mini",
      baseUrl: "",
    },
    observability: observabilityFromEnv(),
  };
}

function isFilePath(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

let warnedUnreadable = false;

/** Keep a copy of a settings file we cannot parse, so the next save does not destroy the only record of the user's AI key / kubeconfig paths. */
function backupUnreadableSettings(raw: string, reason: string): void {
  if (warnedUnreadable) return;
  warnedUnreadable = true;
  const backup = `${SETTINGS_FILE}.corrupt-${Date.now()}`;
  try {
    fs.writeFileSync(backup, raw, { encoding: "utf-8", mode: 0o600 });
    console.warn(`[kubedeck] ${SETTINGS_FILE} could not be read (${reason}); using defaults. A copy was saved to ${backup}`);
  } catch {
    console.warn(`[kubedeck] ${SETTINGS_FILE} could not be read (${reason}); using defaults.`);
  }
}

const PROVIDERS: AiProviderSettings["provider"][] = ["openai", "anthropic", "ollama", "custom"];

/** Web mode's AI provider, from the server's environment (a Kubernetes Secret), never from a browser. */
export function aiSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): AiProviderSettings {
  const provider = (env.KUBEDECK_AI_PROVIDER ?? "").trim().toLowerCase() as AiProviderSettings["provider"];
  return {
    provider: PROVIDERS.includes(provider) ? provider : "openai",
    apiKey: env.KUBEDECK_AI_API_KEY ?? "",
    model: env.KUBEDECK_AI_MODEL ?? "",
    fastModel: env.KUBEDECK_AI_FAST_MODEL || undefined,
    baseUrl: env.KUBEDECK_AI_BASE_URL ?? "",
  };
}

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

/** Tracing and Grafana settings from the environment (web mode's only source; a fallback on the desktop). */
export function observabilityFromEnv(env: NodeJS.ProcessEnv = process.env): ObservabilitySettings {
  return {
    tempoUrl: (env.KUBEDECK_TEMPO_URL ?? "").trim(),
    tempoToken: env.KUBEDECK_TEMPO_TOKEN ?? "",
    tempoTenant: (env.KUBEDECK_TEMPO_TENANT ?? "").trim(),
    lokiUrl: (env.KUBEDECK_LOKI_URL ?? "").trim(),
    lokiToken: env.KUBEDECK_LOKI_TOKEN ?? "",
    lokiTenant: (env.KUBEDECK_LOKI_TENANT ?? "").trim(),
    clusters: parseClusterMap(env.KUBEDECK_TEMPO_CLUSTERS),
    grafanaUrl: (env.KUBEDECK_GRAFANA_URL ?? "").trim(),
    grafanaTempoDatasource: (env.KUBEDECK_GRAFANA_TEMPO_DATASOURCE ?? "").trim(),
    mcpUrl: (env.KUBEDECK_GRAFANA_MCP_URL ?? "").trim(),
    mcpToken: env.KUBEDECK_GRAFANA_MCP_TOKEN ?? "",
  };
}

/** Saved values win; a field left empty in the settings file falls back to the environment. */
export function mergeObservability(saved: Partial<ObservabilitySettings> | undefined, env: ObservabilitySettings): ObservabilitySettings {
  const pick = (k: Exclude<keyof ObservabilitySettings, "clusters">) => (typeof saved?.[k] === "string" && saved[k] ? saved[k] : env[k]);
  return {
    tempoUrl: pick("tempoUrl"),
    tempoToken: pick("tempoToken"),
    tempoTenant: pick("tempoTenant"),
    lokiUrl: pick("lokiUrl"),
    lokiToken: pick("lokiToken"),
    lokiTenant: pick("lokiTenant"),
    clusters: { ...env.clusters, ...(saved?.clusters && typeof saved.clusters === "object" ? saved.clusters : {}) },
    grafanaUrl: pick("grafanaUrl"),
    grafanaTempoDatasource: pick("grafanaTempoDatasource"),
    mcpUrl: pick("mcpUrl"),
    mcpToken: pick("mcpToken"),
  };
}

/** What the settings file itself holds for observability (without the environment), so a save keeps it as written. */
export function savedObservability(): Partial<ObservabilitySettings> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    return parsed?.observability && typeof parsed.observability === "object" ? parsed.observability : undefined;
  } catch {
    return undefined;
  }
}

/** Tracing and Grafana settings in effect now. */
export function getObservability(): ObservabilitySettings {
  return loadSettings().observability ?? observabilityFromEnv();
}

/** Whether a request to the provider can be made at all: a key, or a keyless local / self-hosted endpoint. */
export function aiConfigured(ai: AiProviderSettings | undefined): boolean {
  if (!ai) return false;
  return !!ai.apiKey || ai.provider === "ollama" || (ai.provider === "custom" && !!ai.baseUrl);
}

export function loadSettings(): KubeDeckSettings {
  // Shared service: no per-machine settings file; the AI provider comes from the environment.
  if (isWebMode()) return { kubeconfigPaths: [], ai: aiSettingsFromEnv(), observability: observabilityFromEnv() };
  if (!fs.existsSync(SETTINGS_FILE)) return defaults();
  let raw: string;
  try {
    raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
  } catch (err: any) {
    console.warn(`[kubedeck] cannot read ${SETTINGS_FILE}: ${err?.message ?? err}; using defaults.`);
    return defaults();
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    backupUnreadableSettings(raw, err?.message ?? "invalid JSON");
    return defaults();
  }
  const base = defaults();
  return {
    // An empty kubeconfig list falls back to the default paths, but must not discard the AI settings.
    kubeconfigPaths:
      Array.isArray(parsed?.kubeconfigPaths) && parsed.kubeconfigPaths.length > 0
        ? parsed.kubeconfigPaths
        : base.kubeconfigPaths,
    ai: parsed?.ai || base.ai,
    observability: mergeObservability(parsed?.observability, observabilityFromEnv()),
  };
}

export function saveSettings(settings: KubeDeckSettings): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { encoding: "utf-8", mode: 0o600 });
  // `mode` only applies to new files; tighten an existing (previously world-readable) one too. No-op on Windows.
  try { fs.chmodSync(SETTINGS_FILE, 0o600); } catch { /* best effort */ }
}

export function getKubeconfigEnv(): Record<string, string> {
  // Shared service: kubectl uses the server's own KUBECONFIG / in-cluster identity, untouched.
  if (isWebMode()) return {};
  const separator = process.platform === "win32" ? ";" : ":";
  const settings = loadSettings();
  const existing = settings.kubeconfigPaths.filter(isFilePath);
  if (existing.length > 0) return { KUBECONFIG: existing.join(separator) };

  // Nothing configured is usable. Fall back to the ambient KUBECONFIG, but drop
  // entries that are missing or are directories — kubectl aborts the whole
  // command on those ("is a directory") rather than skipping them.
  const ambient = process.env.KUBECONFIG;
  if (!ambient) return {};
  const usable = ambient.split(separator).map((p) => p.trim()).filter(isFilePath);
  if (usable.length > 0) return { KUBECONFIG: usable.join(separator) };

  // Every ambient entry is unusable. Blank it out so kubectl falls back to its
  // own default (~/.kube/config) instead of erroring on the bad path.
  return { KUBECONFIG: "" };
}

export interface KubeconfigFileInfo {
  path: string;
  exists: boolean;
  contexts: string[];
}

export function scanKubeconfigs(): KubeconfigFileInfo[] {
  const found = new Set<string>();
  const results: KubeconfigFileInfo[] = [];

  const defaultPath = path.join(os.homedir(), ".kube", "config");
  found.add(defaultPath);

  // Scan ~/.kube/ for *.yaml, *.yml, *.conf files
  const kubeDir = path.join(os.homedir(), ".kube");
  if (fs.existsSync(kubeDir)) {
    try {
      for (const entry of fs.readdirSync(kubeDir)) {
        const ext = path.extname(entry).toLowerCase();
        const fullPath = path.join(kubeDir, entry);
        if ([".yaml", ".yml", ".conf"].includes(ext) && isFilePath(fullPath)) {
          found.add(fullPath);
        }
      }
    } catch {}
  }

  // Check KUBECONFIG env var
  const envKubeconfig = process.env.KUBECONFIG;
  if (envKubeconfig) {
    const separator = process.platform === "win32" ? ";" : ":";
    for (const p of envKubeconfig.split(separator)) {
      const trimmed = p.trim();
      if (trimmed && isFilePath(trimmed)) found.add(trimmed);
    }
  }

  for (const filePath of found) {
    const exists = isFilePath(filePath);
    let contexts: string[] = [];
    if (exists) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const contextMatches = content.match(/- context:[\s\S]*?name:\s*(.+)/g);
        if (contextMatches) {
          contexts = contextMatches
            .map((m) => m.match(/name:\s*(.+)/)?.[1]?.trim())
            .filter(Boolean) as string[];
        }
      } catch {}
    }
    results.push({ path: filePath, exists, contexts });
  }

  return results;
}
