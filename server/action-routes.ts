/**
 * Actions that change the cluster from the UI: scale, restart, apply, delete pod; plus a pod's environment.
 */
import type { Express } from "express";
import { writeFileSync } from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { api } from "@shared/routes";
import { handleForbidden, runKubectlRaw } from "./kubectl-run";

export function registerActionRoutes(app: Express): void {
  // ── Scale Deployment ───────────────────────────────
  app.post(api.k8s.deploymentScale.path, async (req, res) => {
    try {
      const { name } = req.params;
      const { replicas } = api.k8s.deploymentScale.input.parse(req.body);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const result = await runKubectlRaw(`scale deployment ${name} --replicas=${replicas} ${context} ${namespace}`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Cannot scale ${name}`);
      res.json({ message: `Deployment ${name} scaled to ${replicas} replicas` });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Restart Deployment ─────────────────────────────
  app.post(api.k8s.deploymentRestart.path, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const result = await runKubectlRaw(`rollout restart deployment ${name} ${context} ${namespace}`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Cannot restart ${name}`);
      res.json({ message: `Deployment ${name} rolling restart initiated` });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Apply YAML ─────────────────────────────────────
  app.post(api.k8s.resourceApply.path, async (req, res) => {
    try {
      const { yaml } = api.k8s.resourceApply.input.parse(req.body);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      // Write yaml to temp file and apply
      const tmpFile = path.join(os.tmpdir(), `kubedeck-apply-${randomUUID()}.yaml`);
      writeFileSync(tmpFile, yaml);
      const result = await runKubectlRaw(`apply -f ${tmpFile} ${context}`);
      // Clean up
      try { require("fs").unlinkSync(tmpFile); } catch {}
      if (result.code !== 0) return handleForbidden(res, result.stderr, "Apply failed");
      res.json({ message: result.stdout || "Applied successfully" });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Delete Pod ────────────────────────────────────
  app.delete(`${api.k8s.podDelete.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const result = await runKubectlRaw(`delete pod ${name} ${context} ${namespace}`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Failed to delete pod ${name}`);
      res.json({ message: `Pod ${name} deleted` });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Pod Env ───────────────────────────────────────
  app.get(`${api.k8s.podEnv.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const container = req.query.container ? `-c ${req.query.container}` : "";
      const result = await runKubectlRaw(`exec ${name} ${context} ${namespace} ${container} -- env`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Cannot exec into pod ${name}`);
      res.json({ env: result.stdout });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });
}
