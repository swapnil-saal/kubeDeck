/** `GET /api/k8s/map`: one namespace as a graph (see map.ts). */
import type { Express } from "express";
import { api } from "@shared/routes";
import { missingPermission, spawnCommand } from "./kubectl-run";
import { discover } from "./generic-routes";
import { buildMap } from "./map";
import { getKubeconfigEnv } from "./settings";

/** Everything the map draws, except Secrets and ConfigMaps: those come from references only. */
export const KINDS = [
  "ingresses.networking.k8s.io", "services", "deployments.apps", "statefulsets.apps", "daemonsets.apps",
  "replicasets.apps", "jobs.batch", "cronjobs.batch", "pods", "persistentvolumeclaims", "horizontalpodautoscalers.autoscaling",
];

/** kubectl prints "… is forbidden: … cannot list resource "ingresses" …" for each kind it may not read. */
export function forbiddenKinds(stderr: string): string[] {
  return [...stderr.matchAll(/cannot list resource "([^"]+)"/g)].map((m) => m[1]);
}

/** Gateway API routes, drawn next to Ingresses when the cluster serves them. */
export const ROUTE_KINDS = ["httproutes.gateway.networking.k8s.io", "grpcroutes.gateway.networking.k8s.io"];

export function registerMapRoutes(app: Express): void {
  app.get(api.k8s.map.path, async (req, res) => {
    const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
    if (!namespace || namespace === "all") return res.status(400).json({ message: "Pick one namespace: a map of every namespace would be unreadable." });
    const context = typeof req.query.context === "string" ? req.query.context : "";
    const ctx = context ? [`--context=${context}`] : [];
    // kubectl refuses the whole list if one kind is unknown: add Gateway API routes only where they exist
    const served = new Set((await discover(context).catch(() => [])).map((r) => r.id));
    const kinds = [...KINDS, ...ROUTE_KINDS.filter((k) => served.has(k))];
    // one call for every kind; a kind the account cannot read is left out, the rest still arrive
    const r = await spawnCommand("kubectl", ["get", kinds.join(","), "-n", namespace, "-o", "json", "--request-timeout=30s", ...ctx], getKubeconfigEnv());
    let items: any[] = [];
    try {
      items = JSON.parse(r.stdout || "{}").items ?? [];
    } catch {
      return res.status(500).json({ message: r.stderr.trim().slice(0, 300) || "Could not read the namespace" });
    }
    const missing = forbiddenKinds(r.stderr);
    if (r.code !== 0 && items.length === 0) {
      const why = missingPermission(r.stderr);
      return res.status(missing.length ? 403 : 500).json({ message: why ? `Cannot draw the map: ${why}` : r.stderr.trim().slice(0, 300) });
    }
    res.json({ ...buildMap(items), missing });
  });
}
