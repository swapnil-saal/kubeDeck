/**
 * Kubeconfig and AI settings. In web mode settings come from the environment and are read-only.
 */
import type { Express } from "express";
import { existsSync } from "fs";
import * as path from "path";
import { api } from "@shared/routes";
import { loadSettings, saveSettings, scanKubeconfigs } from "./settings";
import { isWebMode } from "./web-mode";

export function registerSettingsRoutes(app: Express): void {
  // ── Settings endpoints ────────────────────────────

  app.get("/api/settings", async (_req, res) => {
    try {
      if (isWebMode()) {
        // settings come from the server's environment; never expose paths or keys to browsers
        return res.json({ kubeconfigPaths: [], files: [], ai: { ...(loadSettings().ai ?? {}), apiKey: "" }, managed: true });
      }
      const settings = loadSettings();
      const files = settings.kubeconfigPaths.map((p) => ({
        path: p,
        exists: existsSync(p),
      }));
      res.json({ kubeconfigPaths: settings.kubeconfigPaths, files, ai: settings.ai });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load settings" });
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      if (isWebMode()) return res.status(403).json({ message: "Settings are managed by the server's environment on a shared KubeDeck." });
      const { kubeconfigPaths, ai } = req.body;
      if (!Array.isArray(kubeconfigPaths) || kubeconfigPaths.length === 0) {
        return res.status(400).json({ message: "kubeconfigPaths must be a non-empty array" });
      }
      for (const p of kubeconfigPaths) {
        if (typeof p !== "string" || !p.trim()) {
          return res.status(400).json({ message: `Invalid path: ${p}` });
        }
      }
      const current = loadSettings();
      saveSettings({ kubeconfigPaths, ai: ai || current.ai });
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
