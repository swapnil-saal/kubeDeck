/**
 * Any resource kind the cluster serves, built-in or custom: discovery (`kubectl api-resources`)
 * and a list with the columns `kubectl get -o wide` prints, so a CRD's own printer columns show up.
 * Detail views (describe, YAML, events) already accept any type: see detail-routes.ts.
 */
import type { Express } from "express";
import { readableCell, ROUTE_TYPE, routeTable } from "./route-table";
import { api, type ApiResource, type ExplainResult, type GenericList } from "@shared/routes";
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
        singular: r.singularName ?? "",
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
  return { columns, rows: rows.map((r) => columns.map((c) => readableCell(r[c] ?? ""))) };
}

/** `kubectl explain` plain text → kind, the field's type and description, and its sub-fields. */
export function parseExplain(text: string): ExplainResult {
  const lines = text.replace(/\r/g, "").split("\n");
  const header = (key: string) => lines.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).trim() ?? "";
  const fieldLine = header("FIELD").match(/^(\S+)\s+<(.+)>$/);
  const descStart = lines.findIndex((l) => l.trim() === "DESCRIPTION:");
  const fieldsStart = lines.findIndex((l) => l.trim() === "FIELDS:");
  const description = descStart < 0 ? "" : lines
    .slice(descStart + 1, fieldsStart < 0 ? undefined : fieldsStart)
    .map((l) => l.trim())
    .join("\n")
    // kubectl wraps at ~80 columns: rejoin lines into paragraphs (blank lines separate them)
    .split(/\n{2,}/)
    .map((para) => para.replace(/\n/g, " "))
    .join("\n\n")
    .trim();
  const fields: ExplainResult["fields"] = [];
  if (fieldsStart >= 0) {
    for (const line of lines.slice(fieldsStart + 1)) {
      const m = line.match(/^ {2}(\S+)\s+<([^>]+)>(\s+-required-)?\s*$/);
      if (m) fields.push({ name: m[1], type: m[2], required: !!m[3], description: "" });
      else if (fields.length && line.startsWith("    ")) {
        const last = fields[fields.length - 1];
        last.description += (last.description ? " " : "") + line.trim();
      }
    }
  }
  return {
    kind: header("KIND"),
    version: [header("GROUP"), header("VERSION")].filter(Boolean).join("/"),
    field: fieldLine?.[1],
    type: fieldLine?.[2],
    description,
    fields,
  };
}

const EXPLAIN_PATH = /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*)*$/;
const API_VERSION = /^[a-z0-9.-]+(\/[a-z0-9]+)?$/i;
const explainCache = new Map<string, ExplainResult>();
const MAX_EXPLAIN_CACHE = 500;

/** The cluster's listable kinds, cached per context for five minutes. */
export async function discover(context: string, refresh = false): Promise<ApiResource[]> {
  const hit = discoveryCache.get(context);
  if (hit && !refresh && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.data;
  const r = await spawnCommand(
    "kubectl",
    ["api-resources", "--verbs=list", "-o", "json", "--request-timeout=20s", ...contextArgs(context)],
    getKubeconfigEnv(),
  );
  // discovery can partly fail (an aggregated API is down) and still print what it found
  if (!r.stdout.trim()) throw new Error(r.stderr.trim().slice(0, 300) || "Could not list the cluster's resource kinds");
  let data: ApiResource[];
  try {
    data = parseApiResources(r.stdout);
  } catch {
    throw new Error("Could not read the cluster's resource kinds");
  }
  discoveryCache.set(context, { at: Date.now(), data });
  return data;
}

export function registerGenericRoutes(app: Express): void {
  // field documentation from the cluster's own OpenAPI schema (custom resources included)
  app.get(api.k8s.explain.path, async (req, res) => {
    const path = String(req.query.path ?? "");
    const apiVersion = String(req.query.apiVersion ?? "");
    if (!EXPLAIN_PATH.test(path) || path.length > 300) return res.status(400).json({ message: "Invalid field path" });
    if (apiVersion && !API_VERSION.test(apiVersion)) return res.status(400).json({ message: "Invalid apiVersion" });
    const key = `${req.query.context ?? ""}|${apiVersion}|${path}`;
    const hit = explainCache.get(key);
    if (hit) return res.json(hit);
    const r = await spawnCommand(
      "kubectl",
      ["explain", path, ...(apiVersion ? [`--api-version=${apiVersion}`] : []), "--request-timeout=20s", ...contextArgs(req.query.context)],
      getKubeconfigEnv(),
    );
    if (r.code !== 0) return res.status(404).json({ message: r.stderr.trim().split("\n")[0]?.slice(0, 200) || `No documentation for ${path}` });
    const parsed = parseExplain(r.stdout);
    if (explainCache.size >= MAX_EXPLAIN_CACHE) explainCache.delete(explainCache.keys().next().value!);
    explainCache.set(key, parsed);
    res.json(parsed);
  });

  app.get(api.k8s.apiResources.path, async (req, res) => {
    try {
      res.json(await discover(String(req.query.context ?? ""), req.query.refresh === "1"));
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  app.get(api.k8s.genericList.path, async (req, res) => {
    const { type } = req.params;
    const ns = typeof req.query.namespace === "string" ? req.query.namespace : "";
    const nsArgs = ns && ns !== "all" ? ["-n", ns] : ["-A"];
    // Gateway API routes are read from their objects: the wide table has no paths or backends
    const asRoutes = ROUTE_TYPE.test(type);
    const r = await spawnCommand(
      "kubectl",
      ["get", type, "-o", asRoutes ? "json" : "wide", "--request-timeout=20s", ...contextArgs(req.query.context), ...nsArgs],
      getKubeconfigEnv(),
    );
    const err = r.stderr.trim();
    if (r.code !== 0) {
      if (/forbidden/i.test(err)) return res.status(403).json({ message: `Access denied: cannot list ${type}` });
      if (/doesn't have a resource type|the server doesn't have/i.test(err)) return res.status(404).json({ message: `This cluster has no resource type "${type}"` });
      return res.status(500).json({ message: err.slice(0, 300) || `Cannot list ${type}` });
    }
    // "No resources found" arrives on stderr with an empty stdout
    if (!r.stdout.trim()) return res.json({ columns: [], rows: [] });
    if (asRoutes) {
      const items = JSON.parse(r.stdout).items ?? [];
      return res.json(items.length ? routeTable(items, nsArgs[0] === "-A") : { columns: [], rows: [] });
    }
    res.json(toGenericList(r.stdout));
  });
}
