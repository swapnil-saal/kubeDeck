/**
 * Any resource kind the cluster serves, built-in or custom: discovery (`kubectl api-resources`)
 * and a list with the columns `kubectl get -o wide` prints, so a CRD's own printer columns show up.
 * Detail views (describe, YAML, events) already accept any type: see detail-routes.ts.
 */
import type { Express } from "express";
import { api, type ApiResource, type GenericList } from "@shared/routes";
import { parseTable } from "./ai/chat/kubectl";
import { spawnCommand } from "./kubectl-run";
import { getKubeconfigEnv } from "./settings";

const DISCOVERY_TTL_MS = 5 * 60_000;
const discoveryCache = new Map<string, { at: number; data: ApiResource[] }>();

const contextArgs = (context: unknown): string[] => (typeof context === "string" && context ? [`--context=${context}`] : []);

/** `kubectl api-resources -o json` → the kinds that can be listed, sorted by group then name. */
export function parseApiResources(json: string): ApiResource[] {
  const doc = JSON.parse(json) as { resources?: any[] };
  return (doc.resources ?? [])
    .filter((r) => Array.isArray(r.verbs) && r.verbs.includes("list") && !String(r.name).includes("/"))
    .map((r): ApiResource => {
      const group = r.group ?? "";
      return {
        id: group ? `${r.name}.${group}` : r.name,
        name: r.name,
        kind: r.kind,
        group,
        version: r.version ?? "",
        namespaced: !!r.namespaced,
        shortNames: r.shortNames ?? [],
        verbs: r.verbs ?? [],
        categories: r.categories ?? [],
      };
    })
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

/** `kubectl get -o wide` text → columns and rows (one string per column). */
export function toGenericList(stdout: string): GenericList {
  const { columns, rows } = parseTable(stdout);
  return { columns, rows: rows.map((r) => columns.map((c) => r[c] ?? "")) };
}

export function registerGenericRoutes(app: Express): void {
  app.get(api.k8s.apiResources.path, async (req, res) => {
    const key = String(req.query.context ?? "");
    const hit = discoveryCache.get(key);
    if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS && req.query.refresh !== "1") return res.json(hit.data);
    const r = await spawnCommand(
      "kubectl",
      ["api-resources", "--verbs=list", "-o", "json", "--request-timeout=20s", ...contextArgs(req.query.context)],
      getKubeconfigEnv(),
    );
    // discovery can partly fail (an aggregated API is down) and still print what it found
    if (!r.stdout.trim()) return res.status(500).json({ message: r.stderr.trim().slice(0, 300) || "Could not list the cluster's resource kinds" });
    try {
      const data = parseApiResources(r.stdout);
      discoveryCache.set(key, { at: Date.now(), data });
      res.json(data);
    } catch {
      res.status(500).json({ message: "Could not read the cluster's resource kinds" });
    }
  });

  app.get(api.k8s.genericList.path, async (req, res) => {
    const { type } = req.params;
    const ns = typeof req.query.namespace === "string" ? req.query.namespace : "";
    const nsArgs = ns && ns !== "all" ? ["-n", ns] : ["-A"];
    const r = await spawnCommand(
      "kubectl",
      ["get", type, "-o", "wide", "--request-timeout=20s", ...contextArgs(req.query.context), ...nsArgs],
      getKubeconfigEnv(),
    );
    const err = r.stderr.trim();
    if (r.code !== 0) {
      if (/forbidden/i.test(err)) return res.status(403).json({ message: `Access denied: cannot list ${type}` });
      if (/doesn't have a resource type|the server doesn't have/i.test(err)) return res.status(404).json({ message: `This cluster has no resource type "${type}"` });
      return res.status(500).json({ message: err.slice(0, 300) || `Cannot list ${type}` });
    }
    // "No resources found" arrives on stderr with an empty stdout
    res.json(r.stdout.trim() ? toGenericList(r.stdout) : { columns: [], rows: [] });
  });
}
