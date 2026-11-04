/**
 * The kubectl palette: runs one kubectl command (or, on the desktop, a kubectl-plus-filters pipeline).
 */
import type { Express } from "express";
import { api } from "@shared/routes";
import { getKubeconfigEnv } from "./settings";
import { isWebMode, webConfig, webExecAllowed } from "./web-mode";
import { classifyBashCommand, classifyKubectlCommand, sanitizeKubectlCommand, scanShell, splitArgs } from "./kubectl-safety";
import { spawnCommand } from "./kubectl-run";

export function registerExecRoutes(app: Express): void {
  // ── Execute arbitrary kubectl command (the palette) ─
  // Same policy as the AI agent: reads run, changes need confirmation, destructive verbs are refused.
  app.post("/api/kubectl/exec", async (req, res) => {
    try {
      const { command, confirmed } = req.body;
      if (!command || typeof command !== "string") {
        return res.status(400).json({ message: "Missing command" });
      }
      const raw = sanitizeKubectlCommand(command.replace(/^kubectl\s+/, ""));
      const verb = raw.split(/\s+/)[0]?.toLowerCase() || "";
      // `get pods | grep api` is a pipeline: judged like the agent's bash tool (kubectl plus text filters)
      const shell = scanShell(raw);
      const isPipeline = shell.segments.length > 1 || shell.substitution || shell.writesFile;
      const level = isPipeline ? classifyBashCommand(`kubectl ${raw}`) : classifyKubectlCommand(raw);
      if (isWebMode()) {
        if (isPipeline) {
          return res.status(403).json({ message: "Pipes and shell syntax are not available on a shared KubeDeck.", blocked: true });
        }
        const allowed = webExecAllowed(raw);
        if (!allowed.ok) return res.status(403).json({ message: allowed.message, blocked: true });
        if (webConfig().readOnly && level !== "allow") {
          return res.status(403).json({ message: "This KubeDeck is read-only: only read commands can run here.", blocked: true });
        }
      }
      if (level === "block") {
        return res.status(403).json({
          message: isPipeline
            ? "Only kubectl piped into text filters (grep, jq, awk, sort, head, wc…) can run here. Run anything else in your terminal."
            : `Command '${verb}' is blocked for safety. Use the KubeDeck UI or run it manually in your terminal.`,
          blocked: true,
        });
      }
      if (level === "warn" && !confirmed) {
        return res.status(200).json({
          needsConfirmation: true,
          command: `kubectl ${raw}`,
          warning: `This command changes the cluster (${verb}). Are you sure you want to execute it?`,
        });
      }
      const result = isPipeline
        ? await spawnCommand("sh", ["-c", `kubectl ${raw}`], getKubeconfigEnv())
        : await spawnCommand("kubectl", splitArgs(raw), getKubeconfigEnv());
      res.json({ stdout: result.stdout, stderr: result.stderr, code: result.code });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Execution failed" });
    }
  });
}
