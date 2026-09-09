import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SETTINGS_DIR = path.join(os.homedir(), ".kubedeck");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

export interface AiProviderSettings {
  provider: "openai" | "anthropic" | "ollama" | "custom";
  apiKey: string;
  model: string;
  fastModel?: string;
  baseUrl: string;
}

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

export function loadSettings(): KubeDeckSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return defaults();
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.kubeconfigPaths) || parsed.kubeconfigPaths.length === 0) {
      return defaults();
    }
    return {
      kubeconfigPaths: parsed.kubeconfigPaths,
      ai: parsed.ai || defaults().ai,
    };
  } catch {
    return defaults();
  }
}

export function saveSettings(settings: KubeDeckSettings): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

export function getKubeconfigEnv(): Record<string, string> {
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
