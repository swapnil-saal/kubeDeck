import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { pluginState } from "./plugins";
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

// Tempo / Loki / Grafana settings are plugins now (server/observability); re-exported for older callers.
export { getObservability, type ObservabilitySettings } from "./observability";

export interface KubeDeckSettings {
  kubeconfigPaths: string[];
  ai?: AiProviderSettings;
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
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** AI provider settings from the "ai" plugin's values (server/ai/ai-plugin.ts): environment first, then saved. */
export function aiSettingsFrom(values: Record<string, unknown>): AiProviderSettings {
  const provider = text(values.provider).toLowerCase() as AiProviderSettings["provider"];
  return {
    provider: PROVIDERS.includes(provider) ? provider : "openai",
    apiKey: text(values.apiKey),
    model: text(values.model),
    fastModel: text(values.fastModel) || undefined,
    baseUrl: text(values.baseUrl),
  };
}

/** The AI provider in effect: set under Settings → AI assistant (or pinned by KUBEDECK_AI_*), in both modes. */
export const currentAiSettings = (): AiProviderSettings => aiSettingsFrom(pluginState("ai").values);

/** The raw JSON of the settings file; undefined when there is none or it cannot be read. */
function readSettingsFile(): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The desktop's old Settings → Observability block, for the one-time move into Settings → Plugins
 * (server/observability). Nothing else reads it; a shared KubeDeck never had one.
 */
/** The desktop's AI settings as settings.json kept them, for the one-time move into the "ai" plugin. */
export function legacyAi(): Partial<AiProviderSettings> | undefined {
  if (isWebMode()) return undefined;
  const block = readSettingsFile()?.ai;
  return block && typeof block === "object" && !Array.isArray(block) ? (block as Partial<AiProviderSettings>) : undefined;
}

export function legacyObservability(): Record<string, unknown> | undefined {
  if (isWebMode()) return undefined;
  const block = readSettingsFile()?.observability;
  return block && typeof block === "object" && !Array.isArray(block) ? (block as Record<string, unknown>) : undefined;
}

/** Whether a request to the provider can be made at all: a key, or a keyless local / self-hosted endpoint. */
export function aiConfigured(ai: AiProviderSettings | undefined): boolean {
  if (!ai) return false;
  return !!ai.apiKey || ai.provider === "ollama" || (ai.provider === "custom" && !!ai.baseUrl);
}

export function loadSettings(): KubeDeckSettings {
  // Shared service: no per-machine settings file; the AI provider comes from the environment.
  if (isWebMode()) return { kubeconfigPaths: [], ai: currentAiSettings() };
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
    ai: currentAiSettings(),
  };
}

export function saveSettings(settings: KubeDeckSettings): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  // keys this version does not manage (the old `observability` block) stay as they were in the file
  const kept = readSettingsFile() ?? {};
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...kept, ...settings }, null, 2), { encoding: "utf-8", mode: 0o600 });
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
