/**
 * One resource in depth: describe, YAML, events, cluster-wide events and related resources.
 */
import type { Express } from "express";
import { api } from "@shared/routes";
import { ingressBackends, ingressHosts } from "./k8s-parse";
import { handleForbidden, runKubectl, runKubectlRaw, selectorToString } from "./kubectl-run";

export function registerDetailRoutes(app: Express): void {
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
}
