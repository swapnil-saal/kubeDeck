import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import { writeFileSync } from "fs";
import * as path from "path";
import * as net from "net";
import { api } from "@shared/routes";
import { randomUUID } from "crypto";
import * as os from "os";

/** Quick TCP connect test — resolves true if something is listening on host:port */
function tcpProbe(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => { sock.destroy(); resolve(false); });
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(false); });
  });
}

// ═══════════════════════════════════════════════════
//  PORT FORWARD STATE
// ═══════════════════════════════════════════════════

interface PortForwardRecord {
  id: string;
  pod: string;
  namespace: string;
  context: string;
  localPort: number;
  remotePort: number;
  startedAt: string;
  process: ChildProcess;
  status: "active" | "dead" | "error";
  error?: string;
  connections: number;          // how many "Handling connection for" lines seen
}

const activePortForwards = new Map<string, PortForwardRecord>();

function cleanupDeadForwards() {
  const ids = Array.from(activePortForwards.keys());
  for (const id of ids) {
    const rec = activePortForwards.get(id)!;
    if (rec.process.killed || rec.process.exitCode !== null) {
      activePortForwards.delete(id);
    }
  }
}

// ═══════════════════════════════════════════════════
//  KUBECTL HELPERS
// ═══════════════════════════════════════════════════

interface KubectlResult {
  items: any[];
  _forbidden?: boolean;
  _error?: string;
  [key: string]: any;
}

function spawnCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    proc.on("close", (code) => {
      resolve({ stdout: Buffer.concat(stdoutChunks).toString("utf-8"), stderr: Buffer.concat(stderrChunks).toString("utf-8"), code: code ?? 1 });
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
      return { items: [], _forbidden: true, _error: `Access denied: kubectl ${command.split(" ").slice(0, 3).join(" ")}` };
    }
    if (combined.includes("no resources found") || combined.includes("not found")) {
      return { items: [] };
    }
    console.error(`[kubectl] exit ${code}: ${stderr.substring(0, 300)}`);
    throw new Error(stderr.substring(0, 200) || `kubectl exited with code ${code}`);
  }
  try { return JSON.parse(stdout); } catch {
    console.error(`[kubectl] Failed to parse JSON (${stdout.length} bytes)`);
    throw new Error("Failed to parse kubectl output");
  }
}

async function runKubectlRaw(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return spawnCommand("kubectl", command.trim().split(/\s+/));
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

function selectorToString(selector: Record<string, string>): string {
  return Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(",");
}

// ═══════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const isReplit = process.env.REPL_ID !== undefined;

  // ── Contexts ──────────────────────────────────────
  app.get(api.k8s.contexts.path, async (req, res) => {
    try {
      if (isReplit) return res.json([
          { name: "minikube", cluster: "minikube", user: "minikube", isCurrent: true },
          { name: "docker-desktop", cluster: "docker-desktop", user: "docker-desktop", isCurrent: false }
        ]);
      const ctxResult = await runKubectlRaw("config get-contexts -o name");
      if (ctxResult.code !== 0) return res.status(500).json({ message: ctxResult.stderr || "Failed to get contexts" });
      const contexts = ctxResult.stdout.trim().split("\n").filter(Boolean);
      const curResult = await runKubectlRaw("config current-context");
      const currentContext = curResult.stdout.trim();
      res.json(contexts.map(name => ({ name, cluster: name, user: name, isCurrent: name === currentContext })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Namespaces ────────────────────────────────────
  app.get(api.k8s.namespaces.path, async (req, res) => {
    try {
      if (isReplit) return res.json([{ name: "default", status: "Active", age: "10d" }, { name: "kube-system", status: "Active", age: "10d" }]);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const data = await runKubectl(`get namespaces ${context}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({ name: item.metadata.name, status: item.status?.phase || "Unknown", age: item.metadata.creationTimestamp })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Pods ──────────────────────────────────────────
  app.get(api.k8s.pods.path, async (req, res) => {
    try {
      if (isReplit) return res.json([
          { name: "nginx-12345", namespace: "default", status: "Running", restarts: 0, age: "2d", node: "node-1" },
      ]);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get pods ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      const result = (data.items || []).map((item: any) => {
        let status = item.status?.phase || "Unknown";
        const cs = item.status?.containerStatuses || [];
        const initCs = item.status?.initContainerStatuses || [];
        for (const c of cs) { if (c.state?.waiting?.reason) { status = c.state.waiting.reason; break; } if (c.state?.terminated?.reason) { status = c.state.terminated.reason; break; } }
        const readyCount = cs.filter((c: any) => c.ready).length;
        const totalCount = (item.spec?.containers || []).length;
        const images = (item.spec?.containers || []).map((c: any) => c.image).filter(Boolean);
        // Aggregate resource requests
        let cpuReq = "", memReq = "";
        const containers = item.spec?.containers || [];
        if (containers.length > 0) {
          const cpus: string[] = []; const mems: string[] = [];
          for (const c of containers) {
            if (c.resources?.requests?.cpu) cpus.push(c.resources.requests.cpu);
            if (c.resources?.requests?.memory) mems.push(c.resources.requests.memory);
          }
          cpuReq = cpus.join("+") || "-";
          memReq = mems.join("+") || "-";
        }
        // Extract container ports
        const containerPorts: { port: number; protocol?: string; name?: string }[] = [];
        for (const c of containers) {
          for (const p of (c.ports || [])) {
            if (p.containerPort) {
              containerPorts.push({ port: p.containerPort, protocol: p.protocol || "TCP", name: p.name || undefined });
            }
          }
        }

        return {
          name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
          status, restarts: cs.reduce((s: number, c: any) => s + (c.restartCount || 0), 0),
          age: item.metadata?.creationTimestamp || "", node: item.spec?.nodeName || "N/A",
          ready: `${readyCount}/${totalCount}`, ip: item.status?.podIP || "-",
          images, cpu: cpuReq || "-", memory: memReq || "-",
          containerPorts: containerPorts.length > 0 ? containerPorts : undefined,
        };
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
      res.json((data.items || []).map((item: any) => ({
        name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
        ready: `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`,
        upToDate: String(item.status?.updatedReplicas || 0),
        available: String(item.status?.availableReplicas || 0),
        age: item.metadata?.creationTimestamp || "",
        images: (item.spec?.template?.spec?.containers || []).map((c: any) => c.image).filter(Boolean),
        strategy: item.spec?.strategy?.type || "RollingUpdate",
      })));
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

  // ── ConfigMaps ──────────────────────────────────────
  app.get(api.k8s.configmaps.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get configmaps ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({
        name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
        dataKeys: Object.keys(item.data || {}).length, age: item.metadata?.creationTimestamp || "",
      })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Secrets ────────────────────────────────────────
  app.get(api.k8s.secrets.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get secrets ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({
        name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
        type: item.type || "Opaque", dataKeys: Object.keys(item.data || {}).length,
        age: item.metadata?.creationTimestamp || "",
      })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Ingresses ──────────────────────────────────────
  app.get(api.k8s.ingresses.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get ingresses ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => {
        const hosts = (item.spec?.rules || []).map((r: any) => r.host || "*").join(", ");
        const tls = item.spec?.tls ? "443" : "80";
        return {
          name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
          hosts, ports: tls, age: item.metadata?.creationTimestamp || "",
          className: item.spec?.ingressClassName || item.metadata?.annotations?.["kubernetes.io/ingress.class"] || "-",
        };
      }));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── StatefulSets ───────────────────────────────────
  app.get(api.k8s.statefulsets.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get statefulsets ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({
        name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
        ready: `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`,
        replicas: item.spec?.replicas || 0, age: item.metadata?.creationTimestamp || "",
        images: (item.spec?.template?.spec?.containers || []).map((c: any) => c.image).filter(Boolean),
      })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── DaemonSets ─────────────────────────────────────
  app.get(api.k8s.daemonsets.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get daemonsets ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({
        name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
        desired: item.status?.desiredNumberScheduled || 0, current: item.status?.currentNumberScheduled || 0,
        ready: item.status?.numberReady || 0, available: item.status?.numberAvailable || 0,
        age: item.metadata?.creationTimestamp || "",
      })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Jobs ───────────────────────────────────────────
  app.get(api.k8s.jobs.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get jobs ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => {
        const succeeded = item.status?.succeeded || 0;
        const total = item.spec?.completions || 1;
        const active = item.status?.active || 0;
        const failed = item.status?.failed || 0;
        let status = "Running";
        if (succeeded >= total) status = "Complete";
        else if (failed > 0 && active === 0) status = "Failed";
        let duration = "-";
        if (item.status?.startTime && item.status?.completionTime) {
          const ms = new Date(item.status.completionTime).getTime() - new Date(item.status.startTime).getTime();
          duration = ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`;
        }
        return {
          name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
          completions: `${succeeded}/${total}`, duration, status,
          age: item.metadata?.creationTimestamp || "",
        };
      }));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── CronJobs ───────────────────────────────────────
  app.get(api.k8s.cronjobs.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get cronjobs ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({
        name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
        schedule: item.spec?.schedule || "-", suspend: item.spec?.suspend || false,
        lastSchedule: item.status?.lastScheduleTime || null,
        active: (item.status?.active || []).length,
        age: item.metadata?.creationTimestamp || "",
      })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Nodes ──────────────────────────────────────────
  app.get(api.k8s.nodes.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const data = await runKubectl(`get nodes ${context}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => {
        const conditions = item.status?.conditions || [];
        const readyCond = conditions.find((c: any) => c.type === "Ready");
        const status = readyCond?.status === "True" ? "Ready" : "NotReady";
        const labels = item.metadata?.labels || {};
        const roleKeys = Object.keys(labels).filter(k => k.startsWith("node-role.kubernetes.io/"));
        const roles = roleKeys.map(k => k.replace("node-role.kubernetes.io/", "")).join(", ") || "worker";
        return {
          name: item.metadata?.name || "unknown", status, roles,
          version: item.status?.nodeInfo?.kubeletVersion || "-",
          cpu: item.status?.capacity?.cpu || "-", memory: item.status?.capacity?.memory || "-",
          os: `${item.status?.nodeInfo?.osImage || "-"}`,
          age: item.metadata?.creationTimestamp || "",
        };
      }));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── HPA ────────────────────────────────────────────
  app.get(api.k8s.hpa.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get hpa ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => {
        const metrics = (item.status?.currentMetrics || []).map((m: any) => {
          if (m.type === "Resource") return `${m.resource?.name}: ${m.resource?.current?.averageUtilization || 0}%`;
          return m.type;
        }).join(", ") || "-";
        return {
          name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
          reference: `${item.spec?.scaleTargetRef?.kind}/${item.spec?.scaleTargetRef?.name}`,
          minReplicas: item.spec?.minReplicas || 1, maxReplicas: item.spec?.maxReplicas || 1,
          currentReplicas: item.status?.currentReplicas || 0, metrics,
          age: item.metadata?.creationTimestamp || "",
        };
      }));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── PVCs ───────────────────────────────────────────
  app.get(api.k8s.pvcs.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = getNamespaceFlag(req.query.namespace as string);
      const data = await runKubectl(`get pvc ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({
        name: item.metadata?.name || "unknown", namespace: item.metadata?.namespace || "unknown",
        status: item.status?.phase || "Unknown", volume: item.spec?.volumeName || "-",
        capacity: item.status?.capacity?.storage || "-",
        accessModes: (item.status?.accessModes || []).join(", ") || "-",
        storageClass: item.spec?.storageClassName || "-",
        age: item.metadata?.creationTimestamp || "",
      })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Scale Deployment ───────────────────────────────
  app.post(api.k8s.deploymentScale.path, async (req, res) => {
    try {
      const { name } = req.params;
      const { replicas } = api.k8s.deploymentScale.input.parse(req.body);
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      if (isReplit) return res.json({ message: `Scaled ${name} to ${replicas} (mock)` });
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
      if (isReplit) return res.json({ message: `Restarted ${name} (mock)` });
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
      if (isReplit) return res.json({ message: "Applied (mock)" });
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
      if (isReplit) return res.json({ logs: `[MOCK LOGS for ${name}]\n2026-02-20 INFO Initializing...\n2026-02-20 INFO Ready.` });
      const result = await runKubectlRaw(`logs ${name} ${context} ${namespace} ${container} --tail=500`);
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Cannot view logs for ${name}`);
      res.json({ logs: result.stdout });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Pod Logs (SSE realtime stream) ────────────────
  app.get(api.k8s.podLogsStream.path, (req: Request, res: Response) => {
    const name = String(req.params.name);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`data: ${JSON.stringify("[stream connected]")}\n\n`);
    const args: string[] = ["logs", "-f", "--tail=200", name];
    if (req.query.context) args.push(`--context=${String(req.query.context)}`);
    if (req.query.namespace) args.push("-n", String(req.query.namespace));
    if (req.query.container) args.push("-c", String(req.query.container));
    const proc: ChildProcessWithoutNullStreams = spawn("kubectl", args);
    proc.stdout.on("data", (chunk: Buffer) => { for (const line of chunk.toString().split("\n")) { if (line) res.write(`data: ${JSON.stringify(line)}\n\n`); } });
    proc.stderr.on("data", (chunk: Buffer) => { const msg = chunk.toString().trim(); if (msg) res.write(`data: ${JSON.stringify("[stderr] " + msg)}\n\n`); });
    proc.on("close", () => { res.write(`data: ${JSON.stringify("[stream ended]")}\n\n`); res.end(); });
    req.on("close", () => { proc.kill(); });
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

  // ═══════════════════════════════════════════════════
  //  PORT FORWARD (with tracking)
  // ═══════════════════════════════════════════════════

  app.post(`${api.k8s.portForward.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const parsed = api.k8s.portForward.input.parse(req.body);
      const localPort = parsed.port;
      const remotePort = parsed.remotePort || localPort;
      const context = req.query.context ? String(req.query.context) : "";
      const namespace = req.query.namespace ? String(req.query.namespace) : "";

      if (isReplit) return res.json({ message: `Port forwarding started for ${name} on port ${localPort} (mock)`, id: "mock-id" });

      // Check if the local port is already in use by an existing forward
      cleanupDeadForwards();
      for (const [, rec] of activePortForwards) {
        if (rec.localPort === localPort) {
          return res.status(409).json({ message: `Port ${localPort} is already in use by forward to ${rec.pod}` });
        }
      }

      // Build args — no --address flag so kubectl binds to localhost (IPv4 + IPv6)
      const spawnArgs: string[] = ["port-forward", name, `${localPort}:${remotePort}`];
      if (context) spawnArgs.push(`--context=${context}`);
      if (namespace) spawnArgs.push("-n", namespace);

      console.log(`[port-forward] spawning: kubectl ${spawnArgs.join(" ")}`);

      const proc = spawn("kubectl", spawnArgs, { stdio: ["pipe", "pipe", "pipe"] });
      const id = randomUUID().slice(0, 8);

      // Create record immediately so we can track status
      const record: PortForwardRecord = {
        id, pod: name, namespace, context, localPort, remotePort,
        startedAt: new Date().toISOString(), process: proc,
        status: "active", connections: 0,
      };

      // Wait for kubectl to confirm "Forwarding from ..." or fail
      const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
        let stderrBuf = "";
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({ ok: true, message: `Port forward started (waiting for kubectl confirmation timed out, may still be connecting)` });
          }
        }, 8000);

        proc.stdout!.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          console.log(`[port-forward:${id}] stdout: ${text.trim()}`);

          // kubectl prints "Forwarding from 127.0.0.1:XXXX -> YYYY" when ready
          if (!settled && text.includes("Forwarding from")) {
            settled = true;
            clearTimeout(timeout);
            resolve({ ok: true, message: `Forwarding established: localhost:${localPort} → ${name}:${remotePort}` });
          }

          // Count "Handling connection" lines
          const matches = text.match(/Handling connection/g);
          if (matches) {
            record.connections += matches.length;
          }
        });

        proc.stderr!.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          console.log(`[port-forward:${id}] stderr: ${text.trim()}`);
          stderrBuf += text;

          // Some kubectl versions print "Forwarding from" on stderr
          if (!settled && text.includes("Forwarding from")) {
            settled = true;
            clearTimeout(timeout);
            resolve({ ok: true, message: `Forwarding established: localhost:${localPort} → ${name}:${remotePort}` });
          }
        });

        proc.on("close", (code) => {
          console.log(`[port-forward:${id}] process exited with code ${code}`);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            const errMsg = stderrBuf.trim() || `kubectl port-forward exited with code ${code}`;
            resolve({ ok: false, message: errMsg });
          }
          // Update status after promise resolved
          record.status = "dead";
          record.error = stderrBuf.trim() || `Exited with code ${code}`;
        });

        proc.on("error", (err) => {
          console.log(`[port-forward:${id}] process error: ${err.message}`);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve({ ok: false, message: `Failed to start kubectl: ${err.message}` });
          }
          record.status = "error";
          record.error = err.message;
        });
      });

      if (!result.ok) {
        try { proc.kill(); } catch {}
        return res.status(500).json({ message: result.message });
      }

      activePortForwards.set(id, record);
      console.log(`[port-forward:${id}] established — localhost:${localPort} → ${name}:${remotePort} (ns: ${namespace || "default"}, ctx: ${context})`);

      // Verify the port is actually reachable (non-blocking — log result)
      setTimeout(async () => {
        const ok = await tcpProbe("127.0.0.1", localPort, 3000);
        if (ok) {
          console.log(`[port-forward:${id}] ✓ TCP verify SUCCESS — 127.0.0.1:${localPort} is reachable`);
        } else {
          console.warn(`[port-forward:${id}] ✗ TCP verify FAILED — 127.0.0.1:${localPort} not reachable (kubectl may not have bound yet)`);
          record.error = `Port ${localPort} not reachable after forward established`;
        }
      }, 500);

      res.json({ message: result.message, id });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  app.get(api.k8s.portForwards.path, (_req, res) => {
    cleanupDeadForwards();
    const entries = Array.from(activePortForwards.values()).map(r => {
      // Double-check liveness
      const alive = r.process.exitCode === null && !r.process.killed;
      return {
        id: r.id, pod: r.pod, namespace: r.namespace, context: r.context,
        localPort: r.localPort, remotePort: r.remotePort, startedAt: r.startedAt,
        status: alive ? "active" : "dead",
        error: r.error,
        connections: r.connections,
      };
    });
    res.json(entries);
  });

  app.delete(api.k8s.portForwardStop.path, (req, res) => {
    const { id } = req.params;
    const record = activePortForwards.get(id);
    if (!record) return res.status(404).json({ message: "Port forward not found (may have already stopped)" });
    try {
      record.process.kill("SIGTERM");
      // Force kill after 2s if still alive
      setTimeout(() => { try { record.process.kill("SIGKILL"); } catch {} }, 2000);
    } catch {}
    activePortForwards.delete(id);
    console.log(`[port-forward:${id}] stopped by user`);
    res.json({ message: `Port forward ${id} stopped (${record.pod}:${record.localPort})` });
  });

  // Test a port-forward by TCP-probing the local port
  app.get("/api/k8s/port-forwards/:id/test", async (req, res) => {
    const record = activePortForwards.get(req.params.id);
    if (!record) return res.status(404).json({ reachable: false, message: "Port forward not found" });
    const alive = record.process.exitCode === null && !record.process.killed;
    if (!alive) return res.json({ reachable: false, message: "kubectl process has exited" });
    const ok = await tcpProbe("127.0.0.1", record.localPort, 3000);
    console.log(`[port-forward:${record.id}] TCP test → ${ok ? "REACHABLE" : "UNREACHABLE"} on 127.0.0.1:${record.localPort}`);
    res.json({
      reachable: ok,
      localPort: record.localPort,
      message: ok ? `Port ${record.localPort} is reachable` : `Port ${record.localPort} is NOT reachable — kubectl may have failed silently`,
    });
  });

  // ═══════════════════════════════════════════════════
  //  DETAIL ENDPOINTS
  // ═══════════════════════════════════════════════════

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

  app.get(api.k8s.resourceEvents.path, async (req, res) => {
    try {
      const { type, name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const kindMap: Record<string, string> = {
        pod: "Pod", deployment: "Deployment", service: "Service", replicaset: "ReplicaSet",
        configmap: "ConfigMap", secret: "Secret", ingress: "Ingress", statefulset: "StatefulSet",
        daemonset: "DaemonSet", job: "Job", cronjob: "CronJob", node: "Node",
        horizontalpodautoscaler: "HorizontalPodAutoscaler", hpa: "HorizontalPodAutoscaler",
        persistentvolumeclaim: "PersistentVolumeClaim", pvc: "PersistentVolumeClaim",
      };
      const kind = kindMap[type.toLowerCase()] || type;
      const result = await runKubectlRaw(`get events ${context} ${namespace} --field-selector involvedObject.name=${name},involvedObject.kind=${kind} --sort-by=.lastTimestamp`);
      if (result.code !== 0) {
        const fallback = await runKubectlRaw(`get events ${context} ${namespace} --field-selector involvedObject.name=${name}`);
        if (fallback.code !== 0) return handleForbidden(res, fallback.stderr, `Cannot get events for ${type}/${name}`);
        return res.json({ content: fallback.stdout });
      }
      res.json({ content: result.stdout });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Related resources ─────────────────────────────
  app.get(api.k8s.resourceRelated.path, async (req, res) => {
    try {
      const { type, name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";

      const related: { pods: any[]; deployments: any[]; services: any[] } = { pods: [], deployments: [], services: [] };

      // Get the resource JSON to extract selectors
      const data = await runKubectl(`get ${type} ${name} ${context} ${namespace}`);
      if (data._forbidden || !data.metadata) return res.json(related);

      const resourceType = type.toLowerCase();

      if (resourceType === "service") {
        // Service → find pods + deployments via spec.selector
        const selector = data.spec?.selector;
        if (selector && Object.keys(selector).length > 0) {
          const labelStr = selectorToString(selector);
          // Find pods
          const podsData = await runKubectl(`get pods ${context} ${namespace} -l ${labelStr}`);
          if (!podsData._forbidden) {
            related.pods = (podsData.items || []).map((item: any) => {
              let status = item.status?.phase || "Unknown";
              const cs = item.status?.containerStatuses || [];
              for (const c of cs) { if (c.state?.waiting?.reason) { status = c.state.waiting.reason; break; } }
              return { name: item.metadata?.name, namespace: item.metadata?.namespace, status, restarts: cs.reduce((s: number, c: any) => s + (c.restartCount || 0), 0) };
            });
          }
          // Find deployments by matching labels
          const deployData = await runKubectl(`get deployments ${context} ${namespace} -l ${labelStr}`);
          if (!deployData._forbidden) {
            related.deployments = (deployData.items || []).map((item: any) => ({
              name: item.metadata?.name, namespace: item.metadata?.namespace,
              ready: `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`,
            }));
          }
          // If no deployments found by label, try matching deployments whose selector matches
          if (related.deployments.length === 0) {
            const allDeploy = await runKubectl(`get deployments ${context} ${namespace}`);
            if (!allDeploy._forbidden) {
              related.deployments = (allDeploy.items || []).filter((d: any) => {
                const dSel = d.spec?.selector?.matchLabels || {};
                return Object.entries(selector).some(([k, v]) => dSel[k] === v);
              }).map((item: any) => ({
                name: item.metadata?.name, namespace: item.metadata?.namespace,
                ready: `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`,
              }));
            }
          }
        }
      } else if (resourceType === "deployment") {
        // Deployment → find pods via spec.selector.matchLabels
        const selector = data.spec?.selector?.matchLabels;
        if (selector && Object.keys(selector).length > 0) {
          const labelStr = selectorToString(selector);
          const podsData = await runKubectl(`get pods ${context} ${namespace} -l ${labelStr}`);
          if (!podsData._forbidden) {
            related.pods = (podsData.items || []).map((item: any) => {
              let status = item.status?.phase || "Unknown";
              const cs = item.status?.containerStatuses || [];
              for (const c of cs) { if (c.state?.waiting?.reason) { status = c.state.waiting.reason; break; } }
              return { name: item.metadata?.name, namespace: item.metadata?.namespace, status, restarts: cs.reduce((s: number, c: any) => s + (c.restartCount || 0), 0) };
            });
          }
        }
        // Find services that select this deployment's pods
        const podLabels = data.spec?.template?.metadata?.labels || {};
        if (Object.keys(podLabels).length > 0) {
          const allSvc = await runKubectl(`get services ${context} ${namespace}`);
          if (!allSvc._forbidden) {
            related.services = (allSvc.items || []).filter((svc: any) => {
              const sel = svc.spec?.selector || {};
              return Object.entries(sel).every(([k, v]) => podLabels[k] === v);
            }).map((item: any) => {
              const ports = item.spec?.ports?.map((p: any) => `${p.port}/${p.protocol}`).join(", ") || "";
              return { name: item.metadata?.name, namespace: item.metadata?.namespace, type: item.spec?.type || "Unknown", ports };
            });
          }
        }
      } else if (resourceType === "pod") {
        // Pod → find owning deployment via ownerReferences, and services that target this pod
        const ownerRefs = data.metadata?.ownerReferences || [];
        const podLabels = data.metadata?.labels || {};

        // Find ReplicaSet owner → then Deployment
        for (const ref of ownerRefs) {
          if (ref.kind === "ReplicaSet") {
            const rsData = await runKubectl(`get replicaset ${ref.name} ${context} ${namespace}`);
            if (!rsData._forbidden && rsData.metadata?.ownerReferences) {
              for (const rsRef of rsData.metadata.ownerReferences) {
                if (rsRef.kind === "Deployment") {
                  const depData = await runKubectl(`get deployment ${rsRef.name} ${context} ${namespace}`);
                  if (!depData._forbidden && depData.metadata) {
                    related.deployments.push({
                      name: depData.metadata.name, namespace: depData.metadata.namespace,
                      ready: `${depData.status?.readyReplicas || 0}/${depData.spec?.replicas || 0}`,
                    });
                  }
                }
              }
            }
          }
        }

        // Find services whose selector matches this pod's labels
        if (Object.keys(podLabels).length > 0) {
          const allSvc = await runKubectl(`get services ${context} ${namespace}`);
          if (!allSvc._forbidden) {
            related.services = (allSvc.items || []).filter((svc: any) => {
              const sel = svc.spec?.selector || {};
              if (Object.keys(sel).length === 0) return false;
              return Object.entries(sel).every(([k, v]) => podLabels[k] === v);
            }).map((item: any) => {
              const ports = item.spec?.ports?.map((p: any) => `${p.port}/${p.protocol}`).join(", ") || "";
              return { name: item.metadata?.name, namespace: item.metadata?.namespace, type: item.spec?.type || "Unknown", ports };
            });
          }
        }
      }

      res.json(related);
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ═══════════════════════════════════════════════════
  //  INTERACTIVE TERMINAL (WebSocket + Python PTY)
  // ═══════════════════════════════════════════════════

  // Write Python PTY relay to temp file once at startup.
  // Python's pty.fork() uses forkpty() which creates a real pseudo-terminal.
  const ptyRelayPath = path.join(os.tmpdir(), "kubedeck-pty-relay.py");
  const ptyRelayCode = [
    "import os,sys,pty,select,struct,fcntl,termios,signal",
    "def sz(fd,r,c):",
    "  fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',r,c,0,0))",
    "def main():",
    "  sh=os.environ.get('SHELL','/bin/zsh')",
    "  pid,fd=pty.fork()",
    "  if pid==0:",
    "    os.execvp(sh,[sh,'-i','-l'])",
    "    os._exit(1)",
    "  sz(fd,int(os.environ.get('ROWS','30')),int(os.environ.get('COLS','120')))",
    "  try:",
    "    while True:",
    "      try:",
    "        rl,_,_=select.select([0,fd],[],[],0.02)",
    "      except: break",
    "      if 0 in rl:",
    "        try: d=os.read(0,16384)",
    "        except: break",
    "        if not d: break",
    "        os.write(fd,d)",
    "      if fd in rl:",
    "        try: d=os.read(fd,16384)",
    "        except OSError: break",
    "        if not d: break",
    "        os.write(1,d)",
    "  except: pass",
    "  finally:",
    "    os.close(fd)",
    "    try:",
    "      os.kill(pid,signal.SIGHUP)",
    "      os.waitpid(pid,0)",
    "    except: pass",
    "main()",
  ].join("\n");

  try {
    writeFileSync(ptyRelayPath, ptyRelayCode, { mode: 0o755 });
  } catch (e: any) {
    console.error("[terminal] Could not write PTY relay script:", e.message);
  }

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname === api.k8s.terminal.path) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      // Let other upgrade handlers (like Vite HMR) pass through
    }
  });

  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const context = url.searchParams.get("context") || "";
    const namespace = url.searchParams.get("namespace") || "";

    const isWindows = os.platform() === "win32";
    const userShell = process.env.SHELL || "/bin/zsh";

    // Build env
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    env["TERM"] = "xterm-256color";
    env["ROWS"] = "30";
    env["COLS"] = "120";
    if (context) env["KUBECTX"] = context;
    if (namespace && namespace !== "all") env["KUBENS"] = namespace;

    let shell: ChildProcess;

    try {
      if (isWindows) {
        shell = spawn("cmd.exe", [], {
          env, cwd: os.homedir(), stdio: ["pipe", "pipe", "pipe"],
        });
      } else {
        // Use Python PTY relay — creates a real pseudo-terminal via forkpty()
        shell = spawn("python3", [ptyRelayPath], {
          env, cwd: os.homedir(), stdio: ["pipe", "pipe", "pipe"],
        });
      }
    } catch (e: any) {
      console.error("[terminal] Failed to spawn:", e.message);
      ws.send(JSON.stringify({ type: "output", data: `\r\n\x1b[31m[error] Could not spawn shell: ${e.message}\x1b[0m\r\n` }));
      ws.close();
      return;
    }

    // Send welcome banner directly via WebSocket (no shell echo pollution)
    const bannerLines: string[] = [
      "\x1b[36m╔══════════════════════════════════════════════════╗\x1b[0m",
      "\x1b[36m║\x1b[0m  \x1b[1;37mKubeDeck Terminal\x1b[0m                               \x1b[36m║\x1b[0m",
    ];
    if (context) {
      const ctxDisplay = context.length > 40 ? context.substring(0, 37) + "..." : context;
      const pad = " ".repeat(Math.max(0, 40 - 10 - ctxDisplay.length));
      bannerLines.push(`\x1b[36m║\x1b[0m  \x1b[33mcontext:\x1b[0m  \x1b[32m${ctxDisplay}\x1b[0m${pad}\x1b[36m║\x1b[0m`);
    }
    if (namespace && namespace !== "all") {
      const nsDisplay = namespace.length > 40 ? namespace.substring(0, 37) + "..." : namespace;
      const pad = " ".repeat(Math.max(0, 40 - 12 - nsDisplay.length));
      bannerLines.push(`\x1b[36m║\x1b[0m  \x1b[33mnamespace:\x1b[0m  \x1b[32m${nsDisplay}\x1b[0m${pad}\x1b[36m║\x1b[0m`);
    }
    bannerLines.push("\x1b[36m║\x1b[0m  \x1b[90mkubectl/k aliased to include ctx/ns\x1b[0m        \x1b[36m║\x1b[0m");
    bannerLines.push("\x1b[36m╚══════════════════════════════════════════════════╝\x1b[0m");
    bannerLines.push("");

    ws.send(JSON.stringify({ type: "output", data: bannerLines.join("\r\n") + "\r\n" }));

    // Silently set up aliases after shell initializes (no visible output)
    setTimeout(() => {
      if (!shell.stdin?.writable) return;
      if (context && namespace && namespace !== "all") {
        shell.stdin.write(`alias kubectl='kubectl --context=${context} -n ${namespace}' 2>/dev/null\n`);
        shell.stdin.write(`alias k='kubectl --context=${context} -n ${namespace}' 2>/dev/null\n`);
      } else if (context) {
        shell.stdin.write(`alias kubectl='kubectl --context=${context}' 2>/dev/null\n`);
        shell.stdin.write(`alias k='kubectl --context=${context}' 2>/dev/null\n`);
      }
      shell.stdin.write("clear\n");
    }, 500);

    // Forward shell stdout → WebSocket
    shell.stdout?.on("data", (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data: data.toString("utf-8") }));
      }
    });

    shell.stderr?.on("data", (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data: data.toString("utf-8") }));
      }
    });

    shell.on("close", (code) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", code }));
        ws.close();
      }
    });

    shell.on("error", (err) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", data: err.message }));
      }
    });

    // Forward WebSocket messages → shell stdin
    ws.on("message", (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === "input" && shell.stdin?.writable) {
          shell.stdin.write(parsed.data);
        }
      } catch {
        if (shell.stdin?.writable) {
          shell.stdin.write(msg.toString());
        }
      }
    });

    ws.on("close", () => {
      try { shell.kill(); } catch {}
    });
  });

  return httpServer;
}
