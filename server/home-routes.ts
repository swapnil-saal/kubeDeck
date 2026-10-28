import type { Express, Response } from "express";
import {
  metricsUnavailable, parseNamespaceNames,
  parseTopNodes, parseTopPods,
} from "./k8s-parse";

type Raw = { stdout: string; stderr: string; code: number };

export interface HomeRouteDeps {
  runKubectlRaw: (command: string) => Promise<Raw>;
}

const TIMEOUT = "--request-timeout=10s";
const ACCESS_TTL_MS = 60_000;
const ACCESS_CONCURRENCY = 8;

const isForbidden = (r: Raw) => /forbidden/i.test(`${r.stderr} ${r.stdout}`);

function scope(ns: unknown): string {
  return !ns || ns === "all" ? "-A" : `-n ${ns}`;
}
function ctxFlag(ctx: unknown): string {
  return ctx ? `--context=${ctx}` : "";
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export interface NamespaceAccess {
  /** can list pods across all namespaces */
  all: boolean;
  /** namespaces the user can list pods in */
  namespaces: { name: string; canListPods: boolean }[];
  /** false when even the namespace list is forbidden */
  listed: boolean;
}

const accessCache = new Map<string, { at: number; data: NamespaceAccess }>();

export function registerHomeRoutes(app: Express, { runKubectlRaw }: HomeRouteDeps): void {
  const can = async (ctx: unknown, extra: string) => {
    const r = await runKubectlRaw(`auth can-i list pods ${extra} ${ctxFlag(ctx)} ${TIMEOUT}`);
    return r.stdout.trim() === "yes";
  };

  // Which namespaces can this user actually read? Lets the UI offer them instead of "Access denied".
  app.get("/api/k8s/namespace-access", async (req, res) => {
    try {
      const ctx = String(req.query.context ?? "");
      const hit = accessCache.get(ctx);
      if (hit && Date.now() - hit.at < ACCESS_TTL_MS && req.query.refresh !== "1") return res.json(hit.data);

      const [all, list] = await Promise.all([
        can(ctx, "--all-namespaces"),
        runKubectlRaw(`get namespaces ${ctxFlag(ctx)} -o name ${TIMEOUT}`),
      ]);
      const listed = list.code === 0;
      const names = listed ? parseNamespaceNames(list.stdout) : [];
      const namespaces = await mapLimit(names, ACCESS_CONCURRENCY, async (name) => ({
        name,
        canListPods: all || (await can(ctx, `-n ${name}`)),
      }));
      const data: NamespaceAccess = { all, namespaces, listed };
      accessCache.set(ctx, { at: Date.now(), data });
      res.json(data);
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  // Live usage (metrics-server). `available:false` is a normal answer, not an error.
  app.get("/api/k8s/metrics/pods", async (req, res) => {
    try {
      const allNs = !req.query.namespace || req.query.namespace === "all";
      const r = await runKubectlRaw(`top pods ${scope(req.query.namespace)} ${ctxFlag(req.query.context)} --no-headers ${TIMEOUT}`);
      if (r.code !== 0) return sendUnavailable(res, r);
      res.json({ available: true, items: parseTopPods(r.stdout, allNs) });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  app.get("/api/k8s/metrics/nodes", async (req, res) => {
    try {
      const r = await runKubectlRaw(`top nodes ${ctxFlag(req.query.context)} --no-headers ${TIMEOUT}`);
      if (r.code !== 0) return sendUnavailable(res, r);
      res.json({ available: true, items: parseTopNodes(r.stdout) });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });
}

function sendUnavailable(res: Response, r: Raw): void {
  if (isForbidden(r)) return void res.json({ available: false, reason: "forbidden" });
  if (metricsUnavailable(r.stderr)) return void res.json({ available: false, reason: "no-metrics-server" });
  res.json({ available: false, reason: "error", message: r.stderr.split("\n")[0].slice(0, 200) });
}
