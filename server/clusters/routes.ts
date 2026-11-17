/** Settings → Clusters (web mode, admins only). */
import type { Express, Request, Response } from "express";
import { clusterPaths, createClusterSchema, updateClusterSchema, type ClusterList } from "@shared/clusters";
import { asKubeDeck } from "../identity";
import { spawnCommand } from "../kubectl-run";
import { findInvalidParam } from "../security";
import { getKubeconfigEnv } from "../settings";
import { addCluster, ClusterError, clusterFile, inClusterAvailable, listClusters, removeCluster, replaceConnection } from "./manager";

export interface ClusterRouteDeps {
  /** names of the groups that have a service account on a cluster */
  usedBy(name: string): string[];
}

const who = (req: Request) => req.kubedeckUser?.email || req.kubedeckUser?.name || "unknown";

function fail(res: Response, err: unknown): void {
  if (err instanceof ClusterError) return void res.status(err.status).json({ message: err.message });
  res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
}

const adminOnly = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  if (req.kubedeckUser?.role !== "admin") return void res.status(403).json({ message: "Only a KubeDeck admin can manage clusters." });
  handler(req, res).catch((err) => fail(res, err));
};

export function registerClusterRoutes(app: Express, deps: ClusterRouteDeps): void {
  const list = (): ClusterList => ({ clusters: listClusters(deps.usedBy), inClusterAvailable: inClusterAvailable() });

  app.get(clusterPaths.list, adminOnly(async (_req, res) => res.json(list())));

  app.post(clusterPaths.list, adminOnly(async (req, res) => {
    const parsed = createClusterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid cluster." });
    const c = parsed.data;
    await addCluster(c.name, c.source, c.source === "kubeconfig" ? c.kubeconfig : undefined, who(req));
    res.status(201).json(list());
  }));

  app.get(clusterPaths.namespaces, adminOnly(async (req, res) => {
    const name = String(req.params.name);
    const file = findInvalidParam({ context: name }) ? undefined : clusterFile(name);
    if (!file) return res.status(404).json({ message: `No cluster named ${name}.` });
    const r = await asKubeDeck(() => spawnCommand("kubectl", ["get", "namespaces", "-o", "jsonpath={.items[*].metadata.name}", `--kubeconfig=${file}`, `--context=${name}`, "--request-timeout=10s"], getKubeconfigEnv()));
    if (r.code !== 0) return res.json({ namespaces: [], error: (r.stderr.trim().split("\n").pop() || "The cluster did not answer.").slice(0, 300) });
    res.json({ namespaces: r.stdout.trim().split(/\s+/).filter(Boolean).sort() });
  }));

  app.patch(clusterPaths.one, adminOnly(async (req, res) => {
    const parsed = updateClusterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Upload or paste a kubeconfig." });
    await replaceConnection(String(req.params.name), parsed.data.kubeconfig, who(req));
    res.json(list());
  }));

  app.delete(clusterPaths.one, adminOnly(async (req, res) => {
    const name = String(req.params.name);
    await removeCluster(name, deps.usedBy(name), who(req));
    res.json(list());
  }));
}
