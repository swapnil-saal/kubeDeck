/**
 * Read-only resource lists: contexts, namespaces, pods, workloads, services, config, nodes, storage.
 */
import type { Express } from "express";
import * as os from "os";
import { api } from "@shared/routes";
import { ownerWorkload } from "./k8s-parse";
import { getNamespaceFlag, runKubectl, runKubectlRaw } from "./kubectl-run";

export function registerResourceRoutes(app: Express): void {
  // ── Contexts ──────────────────────────────────────
  app.get(api.k8s.contexts.path, async (req, res) => {
    try {
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
      const context = req.query.context ? `--context=${req.query.context}` : "";
      const data = await runKubectl(`get namespaces ${context}`);
      if (data._forbidden) return res.status(403).json({ message: data._error || "Access denied" });
      res.json((data.items || []).map((item: any) => ({ name: item.metadata.name, status: item.status?.phase || "Unknown", age: item.metadata.creationTimestamp })));
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // ── Pods ──────────────────────────────────────────
  app.get(api.k8s.pods.path, async (req, res) => {
    try {
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
          schedulable: !item.spec?.unschedulable,
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
}
