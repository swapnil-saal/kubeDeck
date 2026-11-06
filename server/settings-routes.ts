/**
 * Kubeconfig and AI settings. In web mode settings come from the environment and are read-only.
 */
import type { Express } from "express";
import { existsSync } from "fs";
import * as path from "path";
import { api } from "@shared/routes";
import { aiConfigured, loadSettings, saveSettings, savedObservability, scanKubeconfigs, type ObservabilitySettings } from "./settings";
import { isWebMode } from "./web-mode";

const OBS_TEXT = ["tempoUrl", "tempoToken", "tempoTenant", "lokiUrl", "lokiToken", "lokiTenant", "grafanaUrl", "grafanaTempoDatasource", "mcpUrl", "mcpToken"] as const;

/** The observability block from a request: known string fields, http(s) URLs, a context → cluster map. Null when malformed. */
export function cleanObservability(raw: unknown): Partial<ObservabilitySettings> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<ObservabilitySettings> = {};
  for (const k of OBS_TEXT) {
    const v = r[k];
    if (v === undefined || v === "") continue;
    if (typeof v !== "string" || v.length > 2000) return null;
    if (k.endsWith("Url") && !/^https?:\/\/[^\s]+$/.test(v.trim())) return null;
    out[k] = v.trim();
  }
  if (r.clusters !== undefined) {
    if (!r.clusters || typeof r.clusters !== "object" || Array.isArray(r.clusters)) return null;
    const clusters: Record<string, string> = {};
    for (const [ctx, cluster] of Object.entries(r.clusters as Record<string, unknown>)) {
      if (typeof cluster !== "string") return null;
      if (ctx.trim() && cluster.trim()) clusters[ctx.trim()] = cluster.trim();
    }
    out.clusters = clusters;
  }
  return out;
}

/** What to write for observability: the request's block when it sent one, else what the file holds. Null when malformed. */
function observabilityToSave(raw: unknown): Partial<ObservabilitySettings> | null | undefined {
  return raw === undefined ? savedObservability() : cleanObservability(raw);
}

/** Which observability fields the environment sets (the desktop form shows them as defaults; secrets as "set"). */
function envObservabilityHints() {
  const e = loadSettings().observability;
  const saved = savedObservability() ?? {};
  if (!e) return {};
  const hint = (k: (typeof OBS_TEXT)[number]) => (!saved[k] && e[k] ? (k.endsWith("Token") ? "set in the environment" : e[k]) : "");
  return Object.fromEntries(OBS_TEXT.map((k) => [k, hint(k)]).filter(([, v]) => v));
}

export function registerSettingsRoutes(app: Express): void {
  // ── Settings endpoints ────────────────────────────

  app.get("/api/settings", async (_req, res) => {
    try {
      if (isWebMode()) {
        // settings come from the server's environment; never expose paths or keys to browsers
        const { ai, observability } = loadSettings();
        return res.json({
          kubeconfigPaths: [], files: [],
          ai: { ...(ai ?? {}), apiKey: "", configured: aiConfigured(ai) },
          observability: observability && { ...observability, tempoToken: "", lokiToken: "", mcpToken: "" },
          managed: true,
        });
      }
      const settings = loadSettings();
      const files = settings.kubeconfigPaths.map((p) => ({
        path: p,
        exists: existsSync(p),
      }));
      // the form edits what the file holds; values that come from the environment show as placeholders
      res.json({ kubeconfigPaths: settings.kubeconfigPaths, files, ai: settings.ai, observability: savedObservability() ?? {}, observabilityEnv: envObservabilityHints() });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load settings" });
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      if (isWebMode()) return res.status(403).json({ message: "Settings are managed by the server's environment on a shared KubeDeck." });
      const { kubeconfigPaths, ai, observability } = req.body;
      if (!Array.isArray(kubeconfigPaths) || kubeconfigPaths.length === 0) {
        return res.status(400).json({ message: "kubeconfigPaths must be a non-empty array" });
      }
      for (const p of kubeconfigPaths) {
        if (typeof p !== "string" || !p.trim()) {
          return res.status(400).json({ message: `Invalid path: ${p}` });
        }
      }
      const obs = observabilityToSave(observability);
      if (obs === null) return res.status(400).json({ message: "Invalid observability settings." });
      saveSettings({ kubeconfigPaths, ai: ai || loadSettings().ai, ...(obs ? { observability: obs as ObservabilitySettings } : {}) });
      res.json({ message: "Settings saved" });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to save settings" });
    }
  });

  app.get("/api/settings/kubeconfig/scan", async (_req, res) => {
    try {
      if (isWebMode()) return res.json([]);
      const results = scanKubeconfigs();
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to scan kubeconfigs" });
    }
  });
}
