import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "child_process";
import { writeFileSync, existsSync } from "fs";
import * as path from "path";
import * as net from "net";
import { api } from "@shared/routes";
import { randomUUID } from "crypto";
import * as os from "os";
import { loadSettings, saveSettings, getKubeconfigEnv, scanKubeconfigs } from "./settings";
import { registerAiRoutes } from "./ai";
import { registerHomeRoutes } from "./home-routes";
import { ingressBackends, ingressHosts, ownerWorkload } from "./k8s-parse";
import { registerTerminalWebSocket } from "./terminal-ws";

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

function spawnCommand(cmd: string, args: string[], envOverride?: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, envOverride ? { env: { ...process.env, ...envOverride } } : undefined);
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
  // fail in seconds when a cluster is unreachable (kubectl would otherwise wait ~30s per call)
  const args = command.trim().split(/\s+/).concat("-o", "json", "--request-timeout=20s");
  const { stdout, stderr, code } = await spawnCommand("kubectl", args, getKubeconfigEnv());
  if (code !== 0) {
    const combined = `${stderr} ${stdout}`.toLowerCase();
    if (combined.includes("forbidden")) {
      return { items: [], _forbidden: true, _error: `Access denied: kubectl ${command.split(" ").slice(0, 3).join(" ")}` };
    }
    if (combined.includes("no resources found") || combined.includes("not found")) {
      return { items: [] };
    }
    throw new Error(stderr.substring(0, 200) || `kubectl exited with code ${code}`);
  }
  try { return JSON.parse(stdout); } catch {
    throw new Error("Failed to parse kubectl output");
  }
}

async function runKubectlRaw(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  if (command.includes("|") || command.includes(">") || command.includes("&&")) {
    return spawnCommand("sh", ["-c", `kubectl ${command.trim()}`], getKubeconfigEnv());
  }
  return spawnCommand("kubectl", command.trim().split(/\s+/), getKubeconfigEnv());
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
      if (ctxResult.code !== 0) {
        return res.status(500).json({ message: ctxResult.stderr.trim() || "Failed to get contexts" });
      }
      const contexts = ctxResult.stdout.trim().split("\n").filter(Boolean);
      const curResult = await runKubectlRaw("config current-context");
      const currentContext = curResult.stdout.trim();
      res.json(contexts.map(name => ({ name, cluster: name, user: name, isCurrent: name === currentContext })));
    } catch (err) {
      res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
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
          workload: ownerWorkload(item.metadata?.ownerReferences),
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

  // ── Deployment Logs (aggregate all pod logs) ──────
  app.get(api.k8s.deploymentLogs.path, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";
      const tail = req.query.tail ? `--tail=${req.query.tail}` : "--tail=300";
      const result = await runKubectlRaw(
        `logs deployment/${name} --all-containers=true --prefix ${context} ${namespace} ${tail}`
      );
      if (result.code !== 0) return handleForbidden(res, result.stderr, `Cannot view logs for deployment/${name}`);
      res.json({ logs: result.stdout });
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
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
    const kubeconfigEnv = getKubeconfigEnv();
    const spawnEnv = Object.keys(kubeconfigEnv).length > 0 ? { env: { ...process.env, ...kubeconfigEnv } } : undefined;
    const proc: ChildProcessWithoutNullStreams = spawn("kubectl", args, spawnEnv);
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


      const pfKubeconfigEnv = getKubeconfigEnv();
      const pfEnv = Object.keys(pfKubeconfigEnv).length > 0 ? { ...process.env, ...pfKubeconfigEnv } : undefined;
      const proc = spawn("kubectl", spawnArgs, { stdio: ["pipe", "pipe", "pipe"], env: pfEnv });
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
          stderrBuf += text;

          // Some kubectl versions print "Forwarding from" on stderr
          if (!settled && text.includes("Forwarding from")) {
            settled = true;
            clearTimeout(timeout);
            resolve({ ok: true, message: `Forwarding established: localhost:${localPort} → ${name}:${remotePort}` });
          }
        });

        proc.on("close", (code) => {
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
      // Verify the port is actually reachable (non-blocking — log result)
      setTimeout(async () => {
        const ok = await tcpProbe("127.0.0.1", localPort, 3000);
        if (!ok) {
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
    res.json({ message: `Port forward ${id} stopped (${record.pod}:${record.localPort})` });
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

  // ── Cluster-wide events (last N minutes, optionally filtered) ────
  app.get(api.k8s.clusterEvents.path, async (req, res) => {
    try {
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace && req.query.namespace !== "all"
        ? `-n ${req.query.namespace}`
        : "-A";
      const warningsOnly = String(req.query.warningsOnly ?? "true") === "true";
      const maxAgeMinutes = Math.max(1, Math.min(360, Number(req.query.maxAgeMinutes ?? 60)));
      const data = await runKubectl(`get events ${context} ${namespace}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });

      const cutoff = Date.now() - maxAgeMinutes * 60_000;
      const items = (data.items || [])
        .map((e: any) => {
          const last = e.lastTimestamp || e.eventTime || e.metadata?.creationTimestamp || null;
          return {
            lastTimestamp: last,
            firstTimestamp: e.firstTimestamp || null,
            count: e.count ?? 1,
            type: e.type || "Normal",
            reason: e.reason || "",
            message: e.message || "",
            objectKind: e.involvedObject?.kind || "",
            objectName: e.involvedObject?.name || "",
            namespace: e.metadata?.namespace || e.involvedObject?.namespace || "",
          };
        })
        .filter((e: any) => !warningsOnly || e.type === "Warning")
        .filter((e: any) => {
          if (!e.lastTimestamp) return true;
          return new Date(e.lastTimestamp).getTime() >= cutoff;
        })
        .sort((a: any, b: any) =>
          new Date(b.lastTimestamp || 0).getTime() - new Date(a.lastTimestamp || 0).getTime(),
        )
        .slice(0, 200);

      res.json(items);
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Related resources ─────────────────────────────
  app.get(api.k8s.resourceRelated.path, async (req, res) => {
    try {
      const { type, name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : "";

      const related: { pods: any[]; deployments: any[]; services: any[]; ingresses: any[] } = { pods: [], deployments: [], services: [], ingresses: [] };

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

      // Ingress → the Services it routes to, and the workloads / pods behind them.
      if (resourceType === "ingress") {
        const backends = ingressBackends(data);
        if (backends.size > 0) {
          const allSvc = await runKubectl(`get services ${context} ${namespace}`);
          const svcs = allSvc._forbidden ? [] : (allSvc.items || []).filter((sv: any) => backends.has(sv.metadata?.name));
          related.services = svcs.map((item: any) => ({
            name: item.metadata?.name, namespace: item.metadata?.namespace, type: item.spec?.type || "Unknown",
            ports: item.spec?.ports?.map((p: any) => `${p.port}/${p.protocol}`).join(", ") || "",
          }));
          const selectors = svcs.map((sv: any) => sv.spec?.selector).filter((sel: any) => sel && Object.keys(sel).length > 0);
          const matches = (labels: Record<string, string> = {}) => selectors.some((sel: Record<string, string>) => Object.entries(sel).every(([k, v]) => labels[k] === v));
          if (selectors.length > 0) {
            const allDeploy = await runKubectl(`get deployments ${context} ${namespace}`);
            if (!allDeploy._forbidden) {
              related.deployments = (allDeploy.items || []).filter((d: any) => matches(d.spec?.template?.metadata?.labels)).map((item: any) => ({
                name: item.metadata?.name, namespace: item.metadata?.namespace,
                ready: `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`,
              }));
            }
            const allPods = await runKubectl(`get pods ${context} ${namespace}`);
            if (!allPods._forbidden) {
              related.pods = (allPods.items || []).filter((pod: any) => matches(pod.metadata?.labels)).map((item: any) => {
                let status = item.status?.phase || "Unknown";
                const cs = item.status?.containerStatuses || [];
                for (const c of cs) { if (c.state?.waiting?.reason) { status = c.state.waiting.reason; break; } }
                return { name: item.metadata?.name, namespace: item.metadata?.namespace, status, restarts: cs.reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0) };
              });
            }
          }
        }
      } else {
        // Ingresses that route to the Services found above (or to this Service itself).
        const svcNames = new Set<string>(related.services.map((sv: any) => sv.name));
        if (resourceType === "service") svcNames.add(name);
        if (svcNames.size > 0) {
          const ing = await runKubectl(`get ingresses ${context} ${namespace}`);
          if (!ing._forbidden) {
            related.ingresses = (ing.items || [])
              .filter((i: any) => Array.from(ingressBackends(i)).some((b) => svcNames.has(b)))
              .map((i: any) => ({ name: i.metadata?.name, namespace: i.metadata?.namespace, hosts: ingressHosts(i) }));
          }
        }
      }

      res.json(related);
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Interactive terminal (WebSocket ↔ stdin/stdout) ─
  registerTerminalWebSocket(httpServer);

  // ── Settings endpoints ────────────────────────────

  app.get("/api/settings", async (_req, res) => {
    try {
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
      const results = scanKubeconfigs();
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to scan kubeconfigs" });
    }
  });

  // ── Execute arbitrary kubectl command ─────────────
  const EXEC_BLOCKED_VERBS = new Set(["delete", "drain", "cordon", "uncordon", "taint"]);
  const EXEC_DANGEROUS_VERBS = new Set(["apply", "patch", "edit", "replace", "create", "label", "annotate"]);

  app.post("/api/kubectl/exec", async (req, res) => {
    try {
      const { command, confirmed } = req.body;
      if (!command || typeof command !== "string") {
        return res.status(400).json({ message: "Missing command" });
      }
      let raw = command.replace(/^kubectl\s+/, "").trim();
      // Sanitize: fix "cluster info" → "cluster-info"
      raw = raw.replace(/\bcluster\s+info\b/gi, "cluster-info");
      // Fix flags before verb
      const tokens = raw.split(/\s+/);
      const leadingFlags: string[] = [];
      let i = 0;
      while (i < tokens.length && tokens[i].startsWith("-")) {
        leadingFlags.push(tokens[i]);
        i++;
      }
      if (leadingFlags.length > 0 && i < tokens.length) {
        raw = tokens.slice(i).join(" ") + " " + leadingFlags.join(" ");
      }

      const verb = raw.split(/\s+/)[0]?.toLowerCase() || "";
      if (EXEC_BLOCKED_VERBS.has(verb)) {
        return res.status(403).json({
          message: `Command '${verb}' is blocked for safety. Use the KubeDeck UI or run it manually in your terminal.`,
          blocked: true,
        });
      }
      if (EXEC_DANGEROUS_VERBS.has(verb) && !confirmed) {
        return res.status(200).json({
          needsConfirmation: true,
          command: `kubectl ${raw}`,
          warning: `This is a mutating command (${verb}). Are you sure you want to execute it?`,
        });
      }
      const result = await runKubectlRaw(raw);
      res.json({ stdout: result.stdout, stderr: result.stderr, code: result.code });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Execution failed" });
    }
  });

  registerHomeRoutes(app, { runKubectlRaw });
  registerAiRoutes(app);

  return httpServer;
}
