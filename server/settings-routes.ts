/**
 * Kubeconfig paths (desktop) and a read-only view of the AI provider. The AI provider is saved through
 * the "ai" plugin (Settings → AI assistant, server/ai/ai-plugin.ts); Tempo, Loki and Grafana are plugins.
 */
import type { Express } from "express";
import { existsSync } from "fs";
import { aiConfigured, loadSettings, saveSettings, scanKubeconfigs } from "./settings";
import { isWebMode } from "./web-mode";

export function registerSettingsRoutes(app: Express): void {
  // ── Settings endpoints ────────────────────────────

  app.get("/api/settings", async (_req, res) => {
    try {
      if (isWebMode()) {
        // settings come from the server's environment; never expose paths or keys to browsers
        const { ai } = loadSettings();
        return res.json({
          kubeconfigPaths: [], files: [],
          ai: { ...(ai ?? {}), apiKey: "", configured: aiConfigured(ai) },
          managed: true,
        });
      }
      const settings = loadSettings();
      const files = settings.kubeconfigPaths.map((p) => ({
        path: p,
        exists: existsSync(p),
      }));
      // the key never leaves the server; the AI page reads /api/plugins/ai for what is set
      res.json({ kubeconfigPaths: settings.kubeconfigPaths, files, ai: { ...(settings.ai ?? {}), apiKey: "", configured: aiConfigured(settings.ai) } });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load settings" });
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      if (isWebMode()) return res.status(403).json({ message: "Settings are managed by the server's environment on a shared KubeDeck." });
      const { kubeconfigPaths, ai, observability } = req.body;
      if (observability !== undefined) {
        return res.status(400).json({ message: "Tempo, Loki and Grafana are set up under Settings → Plugins now." });
      }
      if (!Array.isArray(kubeconfigPaths) || kubeconfigPaths.length === 0) {
        return res.status(400).json({ message: "kubeconfigPaths must be a non-empty array" });
      }
      for (const p of kubeconfigPaths) {
        if (typeof p !== "string" || !p.trim()) {
          return res.status(400).json({ message: `Invalid path: ${p}` });
        }
      }
      if (ai !== undefined) return res.status(400).json({ message: "The AI provider is saved under Settings → AI assistant (PUT /api/plugins/ai)." });
      saveSettings({ kubeconfigPaths });
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
