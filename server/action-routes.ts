/**
 * Actions that change the cluster from the UI: scale, restart, apply, delete pod; plus a pod's environment.
 */
import type { Express } from "express";
import { unlinkSync, writeFileSync } from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { api } from "@shared/routes";
import { parseAllDocuments } from "yaml";
import { getKubeconfigEnv } from "./settings";
import { handleForbidden, runKubectlRaw, spawnCommand } from "./kubectl-run";

/**
 * `-n <ns>` for objects that name no namespace, unless one names another: kubectl refuses a
 * file whose objects disagree with -n, so those keep their own (and the rest get the context's default).
 */
export function namespaceArgs(yamlText: string, namespace: string | undefined): string[] {
  if (!namespace || namespace === "all") return [];
  try {
    for (const doc of parseAllDocuments(yamlText)) {
      if ("errors" in doc && doc.errors.length) return ["-n", namespace];
      const ns = (doc.toJS() as { metadata?: { namespace?: string } } | null)?.metadata?.namespace;
      if (ns && ns !== namespace) return [];
    }
  } catch { /* kubectl reports the YAML problem itself */ }
  return ["-n", namespace];
}

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
  // ── Nodes: cordon / uncordon / drain ─────────────
  app.post(api.k8s.nodeAction.path, async (req, res) => {
    const { name, action } = req.params;
    if (action !== "cordon" && action !== "uncordon" && action !== "drain") return res.status(404).json({ message: "Unknown node action" });
    const opts = api.k8s.nodeAction.input.safeParse(req.body ?? {});
    if (!opts.success) return res.status(400).json({ message: "Invalid drain options" });
    const ctx = typeof req.query.context === "string" && req.query.context ? [`--context=${req.query.context}`] : [];
    const args = [action, name, ...ctx];
    if (action === "drain") {
      // DaemonSet pods would come straight back; the timeout bounds pods that refuse to leave (PDBs)
      args.push("--ignore-daemonsets", "--timeout=300s");
      if (opts.data.deleteEmptyDirData) args.push("--delete-emptydir-data");
      if (opts.data.force) args.push("--force");
    }
    const r = await spawnCommand("kubectl", args, getKubeconfigEnv());
    const output = `${r.stdout}${r.stderr}`.trim();
    if (r.code !== 0) return handleForbidden(res, r.stderr || r.stdout, `Could not ${action} node ${name}`);
    const done = { cordon: "cordoned: no new pods will be scheduled there", uncordon: "schedulable again", drain: "drained: its pods were evicted and it is cordoned" }[action];
    res.json({ message: `Node ${name} ${done}`, output });
  });

  // Apply YAML: ?mode=preview runs a server-side dry run and a diff (nothing changes); otherwise it applies.
  app.post(api.k8s.resourceApply.path, async (req, res) => {
    const parsed = api.k8s.resourceApply.input.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Send the YAML as { yaml }." });
    const { yaml } = parsed.data;
    const ctx = typeof req.query.context === "string" && req.query.context ? [`--context=${req.query.context}`] : [];
    const ns = namespaceArgs(yaml, typeof req.query.namespace === "string" ? req.query.namespace : undefined);
    const tmpFile = path.join(os.tmpdir(), `kubedeck-apply-${randomUUID()}.yaml`);
    writeFileSync(tmpFile, yaml, { mode: 0o600 });
    const kubectl = (args: string[]) => spawnCommand("kubectl", [...args, "-f", tmpFile, ...ctx, ...ns, "--request-timeout=30s"], getKubeconfigEnv());
    try {
      if (req.query.mode === "preview") {
        const dry = await kubectl(["apply", "--dry-run=server"]);
        if (dry.code !== 0) return handleForbidden(res, dry.stderr, "The cluster would reject this");
        // kubectl diff: 0 = no change, 1 = differences, anything else = an error
        const diff = await kubectl(["diff"]);
        const objects = dry.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        return res.json({
          message: diff.code > 1 ? `Dry run passed; the diff could not be computed (${diff.stderr.trim().slice(0, 200)})` : "Dry run passed",
          objects,
          diff: diff.code === 1 ? diff.stdout : "",
        });
      }
      const result = await kubectl(["apply"]);
      if (result.code !== 0) return handleForbidden(res, result.stderr, "Apply failed");
      res.json({ message: result.stdout.trim() || "Applied", objects: result.stdout.split("\n").map((l) => l.trim()).filter(Boolean) });
    } catch (err) {
      res.status(500).json({ message: String(err) });
    } finally {
      try { unlinkSync(tmpFile); } catch { /* already gone */ }
    }
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
