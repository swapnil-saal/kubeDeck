/**
 * `/api/traces/*`: traces from Grafana Tempo for the scope on screen. A kube context is matched to
 * the cluster name its traces carry (`k8s.cluster.name`); on a shared (web) KubeDeck a namespace's
 * traces are shown only to someone who may list its pods, the same check the cluster itself makes.
 */
import type { Express, Request, Response } from "express";
import {
  isTraceWorkloadKind,
  tracesPaths,
  TRACE_GROUP_BY,
  TRACE_SINCE,
  type TraceGroupBy,
  type GrafanaMcpStatus,
  type TraceStatus,
} from "@shared/traces";
import { grafanaMcpConfigured, grafanaTools } from "./grafana-mcp";
import { logQuery, lokiConfigured, LokiError, queryLogs, type LogScope } from "./loki";
import { currentIdentity } from "./identity";
import { spawnCommand } from "./kubectl-run";
import { findInvalidParam } from "./security";
import { getKubeconfigEnv, getObservability, type ObservabilitySettings } from "./settings";
import {
  getTrace,
  grafanaTraceUrl,
  q,
  groupStats,
  searchQuery,
  searchTraces,
  tagValues,
  tempoConfigured,
  TempoError,
  type TraceScope,
} from "./tempo";
import { isWebMode } from "./web-mode";

// ── which Tempo cluster a context is ────────────────

const CLUSTER_TTL_MS = 10 * 60_000;
let clusterList: { at: number; key: string; values: string[] } | null = null;
const resolved = new Map<string, { at: number; cluster: string; source: NonNullable<TraceStatus["source"]> }>();

/** Every `k8s.cluster.name` Tempo has seen in the last day. */
export async function tempoClusters(o: ObservabilitySettings): Promise<string[]> {
  const key = `${o.tempoUrl}|${o.tempoTenant}`;
  if (clusterList && clusterList.key === key && Date.now() - clusterList.at < CLUSTER_TTL_MS) return clusterList.values;
  const values = await tagValues(o, "resource.k8s.cluster.name", undefined, "24h");
  clusterList = { at: Date.now(), key, values };
  return values;
}

const traced = new Map<string, { at: number; values: string[] }>();

/**
 * The namespaces of a Tempo cluster that sent traces in the last day, limited on a shared KubeDeck to
 * those the user may read. Null when Tempo cannot say, so nothing is claimed about a namespace.
 */
async function tracedNamespaces(o: ObservabilitySettings, cluster: string, context: string): Promise<string[] | null> {
  const key = `${o.tempoUrl}|${o.tempoTenant}|${cluster}`;
  let hit = traced.get(key);
  if (!hit || Date.now() - hit.at >= CLUSTER_TTL_MS) {
    try {
      hit = { at: Date.now(), values: await tagValues(o, "resource.k8s.namespace.name", `{resource.k8s.cluster.name=${q(cluster)}}`, "24h") };
    } catch {
      return null;
    }
    traced.set(key, hit);
    if (traced.size > 50) traced.delete(traced.keys().next().value!);
  }
  const readable = await Promise.all(hit.values.map((ns) => mayReadNamespace(context, ns)));
  return hit.values.filter((_, i) => readable[i]);
}

/** The kubeconfig's own name for a context's cluster, and the namespace it defaults to. */
async function kubeconfigEntry(context: string): Promise<{ cluster: string; namespace: string }> {
  const r = await spawnCommand(
    "kubectl",
    ["config", "view", "--minify", "-o", "jsonpath={.contexts[0].context.cluster}{\"\\n\"}{.contexts[0].context.namespace}", ...(context ? [`--context=${context}`] : [])],
    getKubeconfigEnv(),
  );
  const [cluster = "", namespace = ""] = r.code === 0 ? r.stdout.split("\n").map((s) => s.trim()) : [];
  return { cluster, namespace };
}

export interface ResolvedCluster { cluster: string; source: NonNullable<TraceStatus["source"]> }

/**
 * Settings first; then a Tempo cluster with the context's (or its kubeconfig cluster's) name; then
 * the only Tempo cluster that has traces from the namespace in view. Null when none of that is certain.
 */
export async function resolveCluster(o: ObservabilitySettings, context: string, namespace: string): Promise<ResolvedCluster | null> {
  const mapped = o.clusters[context];
  if (mapped) return { cluster: mapped, source: "settings" };
  const key = `${o.tempoUrl}|${context}`;
  const hit = resolved.get(key);
  if (hit && Date.now() - hit.at < CLUSTER_TTL_MS) return hit;

  const remember = (r: ResolvedCluster) => { resolved.set(key, { ...r, at: Date.now() }); return r; };
  const clusters = await tempoClusters(o);
  if (clusters.length === 0) return null;
  if (context && clusters.includes(context)) return remember({ cluster: context, source: "name" });
  const entry = await kubeconfigEntry(context);
  if (entry.cluster && clusters.includes(entry.cluster)) return remember({ cluster: entry.cluster, source: "name" });
  if (clusters.length === 1) return remember({ cluster: clusters[0], source: "only" });

  const ns = namespace && namespace !== "all" ? namespace : entry.namespace;
  if (!ns) return null;
  const having = await tagValues(o, "resource.k8s.cluster.name", `{resource.k8s.namespace.name=${q(ns)}}`, "24h");
  return having.length === 1 ? remember({ cluster: having[0], source: "namespace" }) : null;
}

// ── who may see which namespace (web mode) ──────────

const ACCESS_TTL_MS = 60_000;
const access = new Map<string, { at: number; ok: boolean }>();

/**
 * On a shared KubeDeck, traces of a namespace are for those who may list its pods (traces carry URLs,
 * ids and payload fragments). Checked as the identity KubeDeck acts as: the signed-in user when
 * impersonating, otherwise its service account. The desktop app shows what its Tempo returns.
 */
export async function mayReadNamespace(context: string, namespace: string): Promise<boolean> {
  if (!isWebMode()) return true;
  const key = `${currentIdentity()?.user ?? ""}|${context}|${namespace}`;
  const hit = access.get(key);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.ok;
  const where = namespace && namespace !== "all" ? ["-n", namespace] : ["-A"];
  const r = await spawnCommand("kubectl", ["auth", "can-i", "list", "pods", ...where, ...(context ? [`--context=${context}`] : [])], getKubeconfigEnv());
  const ok = r.stdout.trim() === "yes";
  access.set(key, { at: Date.now(), ok });
  if (access.size > 2000) access.delete(access.keys().next().value!);
  return ok;
}

// ── HTTP ────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v : "");

function fail(res: Response, err: unknown) {
  if (err instanceof TempoError || err instanceof LokiError) return res.status(err.status).json({ message: err.message });
  res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
}

/** The scope a request asks about, validated; sends the error and returns null when it is not usable. */
async function scopeOf(req: Request, res: Response, o: ObservabilitySettings | null): Promise<{ o: ObservabilitySettings; scope: TraceScope; context: string } | null> {
  if (!o) {
    res.status(404).json({ message: "Tracing is not set up. Add the Tempo URL in Settings → Observability (KUBEDECK_TEMPO_URL on a shared KubeDeck)." });
    return null;
  }
  const context = str(req.query.context);
  const namespace = str(req.query.namespace);
  const kind = str(req.query.kind);
  const name = str(req.query.name);
  const bad = findInvalidParam({ context, namespace, name });
  if (bad) { res.status(400).json({ message: `Invalid "${bad}" parameter.` }); return null; }
  if (kind && !isTraceWorkloadKind(kind)) { res.status(400).json({ message: `Traces cannot be looked up for "${kind}".` }); return null; }
  if (kind && !name) { res.status(400).json({ message: "A kind needs a name." }); return null; }
  const found = await resolveCluster(o, context, namespace);
  if (!found) {
    res.status(409).json({ message: `Which Tempo cluster is "${context || "the default context"}"? Map it in Settings → Observability (KUBEDECK_TEMPO_CLUSTERS on a shared KubeDeck).` });
    return null;
  }
  if (!(await mayReadNamespace(context, namespace))) {
    res.status(403).json({ message: namespace && namespace !== "all" ? `You cannot list pods in "${namespace}", so its traces are hidden.` : "Pick a namespace: you cannot list pods in every namespace." });
    return null;
  }
  const scope: TraceScope = { cluster: found.cluster, namespace };
  if (kind && isTraceWorkloadKind(kind)) {
    if (kind === "service") scope.service = name;
    else scope.workload = { kind, name };
  }
  return { o, scope, context };
}

const configured = () => {
  const o = getObservability();
  return tempoConfigured(o) ? o : null;
};

const sinceOf = (v: unknown) => ((TRACE_SINCE as readonly string[]).includes(str(v)) ? str(v) : "1h");

export function registerTracesRoutes(app: Express): void {
  app.get(tracesPaths.status, async (req, res) => {
    const o = configured();
    if (!o) return res.json({ configured: false, cluster: null, source: null, grafanaTraceUrl: null, logs: lokiConfigured(getObservability()), tracedNamespaces: null } satisfies TraceStatus);
    const context = str(req.query.context);
    const namespace = str(req.query.namespace);
    if (findInvalidParam({ context, namespace })) return res.status(400).json({ message: "Invalid scope." });
    try {
      const found = await resolveCluster(o, context, namespace);
      res.json({
        configured: true,
        cluster: found?.cluster ?? null,
        source: found?.source ?? null,
        grafanaTraceUrl: grafanaTraceUrl(o),
        logs: lokiConfigured(o),
        tracedNamespaces: found ? await tracedNamespaces(o, found.cluster, context) : null,
        ...(found ? {} : { message: `Tempo has no cluster that is clearly "${context || "the default context"}". Map it in Settings → Observability.` }),
      } satisfies TraceStatus);
    } catch (err) {
      res.json({ configured: true, cluster: null, source: null, grafanaTraceUrl: grafanaTraceUrl(o), logs: lokiConfigured(o), tracedNamespaces: null, message: err instanceof Error ? err.message : String(err) } satisfies TraceStatus);
    }
  });

  app.get(tracesPaths.clusters, async (_req, res) => {
    const o = configured();
    if (!o) return res.json({ clusters: [] });
    try {
      res.json({ clusters: await tempoClusters(o) });
    } catch (err) { fail(res, err); }
  });

  app.get(tracesPaths.grafanaMcp, async (_req, res) => {
    const o = getObservability();
    if (!grafanaMcpConfigured(o)) return res.json({ configured: false, ok: false, tools: [] } satisfies GrafanaMcpStatus);
    try {
      const tools = await grafanaTools(o);
      res.json({ configured: true, ok: true, tools: tools.map((t) => t.name) } satisfies GrafanaMcpStatus);
    } catch (err) {
      res.json({ configured: true, ok: false, tools: [], message: err instanceof Error ? err.message : String(err) } satisfies GrafanaMcpStatus);
    }
  });

  app.get(tracesPaths.search, async (req, res) => {
    try {
      const s = await scopeOf(req, res, configured());
      if (!s) return;
      const filter = str(req.query.filter);
      const query = searchQuery(s.scope, {
        errors: filter === "errors",
        minDuration: filter === "slow" ? (str(req.query.minDuration) || "1s") : undefined,
        entryOnly: req.query.entry !== "0",
        spanName: str(req.query.span).slice(0, 300) || undefined,
      });
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const result = await searchTraces(s.o, query, sinceOf(req.query.since), limit);
      res.json({ cluster: s.scope.cluster, query, ...result });
    } catch (err) { fail(res, err); }
  });

  app.get(tracesPaths.stats, async (req, res) => {
    try {
      const s = await scopeOf(req, res, configured());
      if (!s) return;
      const by = ((TRACE_GROUP_BY as readonly string[]).includes(str(req.query.by)) ? str(req.query.by) : "service") as TraceGroupBy;
      res.json({ cluster: s.scope.cluster, by, ...(await groupStats(s.o, s.scope, sinceOf(req.query.since), by)) });
    } catch (err) { fail(res, err); }
  });

  // Loki: log history for a namespace, workload or pod; also the lines around a traced request
  app.get(tracesPaths.logs, async (req, res) => {
    try {
      const o = getObservability();
      if (!lokiConfigured(o)) return res.status(404).json({ message: "Log history is not set up. Add the Loki URL in Settings → Observability (KUBEDECK_LOKI_URL on a shared KubeDeck)." });
      const context = str(req.query.context);
      const namespace = str(req.query.namespace);
      const kind = str(req.query.kind);
      const name = str(req.query.name);
      const pod = str(req.query.pod);
      if (findInvalidParam({ context, namespace, name }) || findInvalidParam({ name: pod })) return res.status(400).json({ message: "Invalid scope." });
      if (!namespace || namespace === "all") return res.status(400).json({ message: "Pick a namespace." });
      if (kind && !isTraceWorkloadKind(kind)) return res.status(400).json({ message: `Logs cannot be looked up for "${kind}".` });
      const found = o.tempoUrl ? await resolveCluster(o, context, namespace).catch(() => null) : null;
      const cluster = o.clusters[context] ?? found?.cluster ?? context;
      if (!(await mayReadNamespace(context, namespace))) return res.status(403).json({ message: `You cannot list pods in "${namespace}", so its logs are hidden.` });
      const scope: LogScope = { cluster, namespace, ...(pod ? { pod } : kind && name && isTraceWorkloadKind(kind) ? { workload: { kind, name } } : {}) };
      const query = logQuery(scope, { contains: str(req.query.contains).slice(0, 200), errorsOnly: req.query.errors === "1" });
      const end = Number(req.query.end) || Date.now();
      const start = Number(req.query.start) || end - 15 * 60_000;
      if (end - start > 7 * 86_400_000 || start >= end) return res.status(400).json({ message: "The window must be between a moment and 7 days long." });
      const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000);
      res.json({ cluster, query, ...(await queryLogs(o, query, start, end, limit, req.query.order !== "oldest")) });
    } catch (err) { fail(res, err); }
  });

  app.get(tracesPaths.trace, async (req, res) => {
    try {
      const o = configured();
      if (!o) return res.status(404).json({ message: "Tracing is not set up." });
      const context = str(req.query.context);
      if (findInvalidParam({ context })) return res.status(400).json({ message: "Invalid context." });
      const trace = await getTrace(o, req.params.id);
      if (!isWebMode()) return res.json(trace);
      // a trace crosses namespaces: keep the spans from namespaces this user may read
      const namespaces = [...new Set(trace.spans.map((s) => s.namespace).filter(Boolean))];
      const allowed = new Set((await Promise.all(namespaces.map(async (ns) => ((await mayReadNamespace(context, ns)) ? ns : "")))).filter(Boolean));
      const spans = trace.spans.filter((s) => !s.namespace || allowed.has(s.namespace));
      if (spans.length === 0 && trace.spans.length > 0) return res.status(403).json({ message: "This trace is from namespaces you cannot list pods in." });
      res.json({ ...trace, spans, hidden: trace.spans.length - spans.length });
    } catch (err) { fail(res, err); }
  });
}
