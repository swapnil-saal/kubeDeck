import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { api } from "@shared/routes";

interface KubectlResult {
  items: any[];
  _forbidden?: boolean;
  _error?: string;
}

function spawnCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    proc.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        code: code ?? 1,
      });
    });

    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

async function runKubectl(command: string): Promise<KubectlResult> {
  const args = command.trim().split(/\s+/).concat("-o", "json");
  const { stdout, stderr, code } = await spawnCommand("kubectl", args);

  if (code !== 0) {
    const combined = `${stderr} ${stdout}`.toLowerCase();
    if (combined.includes("forbidden")) {
      const shortCmd = command.split(" ").slice(0, 3).join(" ");
      console.warn(`[kubectl] 403 Forbidden: ${shortCmd}`);
      return { items: [], _forbidden: true, _error: `Access denied: kubectl ${shortCmd}` };
    }
    if (combined.includes("no resources found") || combined.includes("not found")) {
      return { items: [] };
    }
    console.error(`[kubectl] exit ${code}: ${stderr.substring(0, 300)}`);
    throw new Error(stderr.substring(0, 200) || `kubectl exited with code ${code}`);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    console.error(`[kubectl] Failed to parse JSON (${stdout.length} bytes)`);
    throw new Error("Failed to parse kubectl output");
  }
}

async function runKubectlRaw(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const args = command.trim().split(/\s+/);
  return spawnCommand("kubectl", args);
}

function getNamespaceFlag(ns: string | undefined): string {
  if (!ns || ns === "all" || ns === "") return "-A";
  return `-n ${ns}`;
}

function handleForbidden(res: Response, stderr: string, fallbackMsg: string) {
  if (stderr.toLowerCase().includes("forbidden")) {
    return res.status(403).json({ message: fallbackMsg });
  }
  return res.status(500).json({ message: stderr || fallbackMsg });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  const isReplit = process.env.REPL_ID !== undefined;

  // ── Contexts ──────────────────────────────────────
  app.get(api.k8s.contexts.path, async (req, res) => {
    try {
      if (isReplit) {
        return res.json([
          { name: "minikube", cluster: "minikube", user: "minikube", isCurrent: true },
          { name: "docker-desktop", cluster: "docker-desktop", user: "docker-desktop", isCurrent: false }
        ]);
      }
      const ctxResult = await runKubectlRaw("config get-contexts -o name");
      if (ctxResult.code !== 0) return res.status(500).json({ message: ctxResult.stderr || "Failed to get contexts" });
      const contexts = ctxResult.stdout.trim().split("\n").filter(Boolean);
      const curResult = await runKubectlRaw("config current-context");
      const currentContext = curResult.stdout.trim();
      res.json(contexts.map(name => ({ name, cluster: name, user: name, isCurrent: name === currentContext })));
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Namespaces ────────────────────────────────────
  app.get(api.k8s.namespaces.path, async (req, res) => {
    try {
      if (isReplit) return res.json([{ name: "default", status: "Active", age: "10d" }, { name: "kube-system", status: "Active", age: "10d" }]);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const data = await runKubectl(`get namespaces ${context}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({ name: item.metadata.name, status: item.status?.phase || "Unknown", age: item.metadata.creationTimestamp })));
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Pods ──────────────────────────────────────────
  app.get(api.k8s.pods.path, async (req, res) => {
    try {
      if (isReplit) return res.json([
        { name: "nginx-12345", namespace: "default", status: "Running", restarts: 0, age: "2d", node: "node-1" },
        { name: "api-gateway-xyz", namespace: "default", status: "CrashLoopBackOff", restarts: 5, age: "1d", node: "node-2" },
        { name: "redis-master-0", namespace: "default", status: "Running", restarts: 1, age: "5d", node: "node-1" }
      ]);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get pods ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      const result = (data.items || []).map((item: any) => {
        let status = item.status?.phase || "Unknown";
        const cs = item.status?.containerStatuses || [];
        for (const c of cs) { if (c.state?.waiting?.reason) { status = c.state.waiting.reason; break; } if (c.state?.terminated?.reason) { status = c.state.terminated.reason; break; } }
        return { name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown", status, restarts: cs.reduce((s: number, c: any) => s + (c.restartCount || 0), 0), age: item.metadata?.creationTimestamp || "", node: item.spec?.nodeName || "N/A" };
      });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: String(err) }); }
  });

  // ── Deployments ───────────────────────────────────
  app.get(api.k8s.deployments.path, async (req, res) => {
    try {
      if (isReplit) return res.json([{ name: "nginx-deployment", namespace: "default", ready: "2/2", upToDate: "2", available: "2", age: "2d" }]);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get deployments ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({ name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown", ready: `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`, upToDate: String(item.status?.updatedReplicas || 0), available: String(item.status?.availableReplicas || 0), age: item.metadata?.creationTimestamp || "" })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Services ──────────────────────────────────────
  app.get(api.k8s.services.path, async (req, res) => {
    try {
      if (isReplit) return res.json([{ name: "kubernetes", namespace: "default", type: "ClusterIP", clusterIP: "10.96.0.1", ports: "443/TCP", age: "10d" }]);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get services ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => {
        const ports = item.spec?.ports?.map((p: any) => p.nodePort ? `${p.port}:${p.nodePort}/${p.protocol}` : `${p.port}/${p.protocol}`).join(", ") || "";
        return { name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown", type: item.spec?.type || "Unknown", clusterIP: item.spec?.clusterIP || "None", ports, age: item.metadata?.creationTimestamp || "" };
      }));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Delete Pod ────────────────────────────────────
  app.delete(`${api.k8s.podDelete.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      if (isReplit) return res.json({ message: `Pod ${name} deleted (mock)` });
      const result = await runKubectlRaw(`delete pod ${name} ${context} ${namespace}`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Failed to delete pod ${name}`);
      res.json({ message: `Pod ${name} deleted` });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Pod Logs (snapshot) ───────────────────────────
  app.get(`${api.k8s.podLogs.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const container = req.query.container ? `-c ${req.query.container}` : "";
      if (isReplit) return res.json({ logs: `[MOCK LOGS for ${name}]\n2026-02-20T07:30:00Z INFO Initializing...\n2026-02-20T07:30:01Z INFO Ready to serve requests.` });
      const result = await runKubectlRaw(`logs ${name} ${context} ${namespace} ${container} --tail=500`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Cannot view logs for ${name}`);
      res.json({ logs: result.stdout });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Pod Logs (SSE realtime stream) ────────────────
  app.get(api.k8s.podLogsStream.path, (req: Request, res: Response) => {
    const name = String(req.params.name);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write(`data: ${JSON.stringify("[stream connected]")}\n\n`);

    const args: string[] = ["logs", "-f", "--tail=200", name];
    if (req.query.context) args.push(`--context=${String(req.query.context)}`);
    if (req.query.namespace) args.push("-n", String(req.query.namespace));
    if (req.query.container) args.push("-c", String(req.query.container));

    const proc: ChildProcessWithoutNullStreams = spawn("kubectl", args);

    proc.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line) res.write(`data: ${JSON.stringify(line)}\n\n`);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) res.write(`data: ${JSON.stringify("[stderr] " + msg)}\n\n`);
    });

    proc.on("close", () => {
      res.write(`data: ${JSON.stringify("[stream ended]")}\n\n`);
      res.end();
    });

    req.on("close", () => {
      proc.kill();
    });
  });

  // ── Pod Env ───────────────────────────────────────
  app.get(`${api.k8s.podEnv.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const container = req.query.container ? `-c ${req.query.container}` : "";
      if (isReplit) return res.json({ env: `KUBERNETES_SERVICE_HOST=10.96.0.1\nKUBERNETES_SERVICE_PORT=443\nNODE_NAME=node-1\nPOD_IP=10.244.0.5` });
      const result = await runKubectlRaw(`exec ${name} ${context} ${namespace} ${container} -- env`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Cannot exec into pod ${name}`);
      res.json({ env: result.stdout });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Port Forward ──────────────────────────────────
  app.post(`${api.k8s.portForward.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const { port } = api.k8s.portForward.input.parse(req.body);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      if (isReplit) return res.json({ message: `Port forwarding started for ${name} on port ${port} (mock)` });
      spawn("kubectl", ["port-forward", name, `${port}:${port}`, ...(context ? [context] : []), ...(namespace ? [namespace] : [])], { detached: true, stdio: "ignore" }).unref();
      res.json({ message: `Port forward started for ${name} on port ${port}` });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ══════════════════════════════════════════════════
  //  DETAIL ENDPOINTS
  // ══════════════════════════════════════════════════

  // ── Resource Describe ─────────────────────────────
  app.get(api.k8s.resourceDescribe.path, async (req, res) => {
    try {
      const { type, name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const result = await runKubectlRaw(`describe ${type} ${name} ${context} ${namespace}`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Cannot describe ${type}/${name}`);
      res.json({ content: result.stdout });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Resource YAML ─────────────────────────────────
  app.get(api.k8s.resourceYaml.path, async (req, res) => {
    try {
      const { type, name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const result = await runKubectlRaw(`get ${type} ${name} ${context} ${namespace} -o yaml`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Cannot get yaml for ${type}/${name}`);
      res.json({ content: result.stdout });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Resource Events ───────────────────────────────
  app.get(api.k8s.resourceEvents.path, async (req, res) => {
    try {
      const { type, name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      // Map type to Kind for field-selector
      const kindMap: Record<string, string> = { pod: "Pod", deployment: "Deployment", service: "Service", replicaset: "ReplicaSet" };
      const kind = kindMap[type.toLowerCase()] || type;
      const result = await runKubectlRaw(`get events ${context} ${namespace} --field-selector involvedObject.name=${name},involvedObject.kind=${kind} --sort-by=.lastTimestamp`);
      if (result.code !== 0) {
        // Try without kind filter as fallback
        const fallback = await runKubectlRaw(`get events ${context} ${namespace} --field-selector involvedObject.name=${name}`);
        if (fallback.code !== 0) return handleForbidden(res, fallback.stderr, `Cannot get events for ${type}/${name}`);
        return res.json({ content: fallback.stdout });
      }
      res.json({ content: result.stdout });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  return httpServer;
}
