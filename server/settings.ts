import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SETTINGS_DIR = path.join(os.homedir(), ".kubedeck");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

export interface KubeDeckSettings {
  kubeconfigPaths: string[];
}

function defaults(): KubeDeckSettings {
  return {
    kubeconfigPaths: [path.join(os.homedir(), ".kube", "config")],
  };
}

export function loadSettings(): KubeDeckSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return defaults();
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.kubeconfigPaths) || parsed.kubeconfigPaths.length === 0) {
      return defaults();
    }
    return { kubeconfigPaths: parsed.kubeconfigPaths };
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
  const settings = loadSettings();
  const existing = settings.kubeconfigPaths.filter((p) => fs.existsSync(p));
  if (existing.length === 0) return {};
  const separator = process.platform === "win32" ? ";" : ":";
  return { KUBECONFIG: existing.join(separator) };
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
        if ([".yaml", ".yml", ".conf"].includes(ext)) {
          found.add(path.join(kubeDir, entry));
        }
      }
    } catch {}
  }

  // Check KUBECONFIG env var
  const envKubeconfig = process.env.KUBECONFIG;
  if (envKubeconfig) {
    const separator = process.platform === "win32" ? ";" : ":";
    for (const p of envKubeconfig.split(separator)) {
      if (p.trim()) found.add(p.trim());
    }
  }

  for (const filePath of found) {
    const exists = fs.existsSync(filePath);
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
