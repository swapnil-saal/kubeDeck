/**
 * The assistant's view beyond kubectl: traces from Tempo (scoped to the cluster and namespace in
 * view, like every other tool) and, when one is set up, the Grafana MCP server's read tools behind a
 * single `grafana` tool. Every tool here only reads.
 */
import { tool } from "ai";
import { z } from "zod";
import { TRACE_GROUP_BY, TRACE_SINCE, TRACE_WORKLOAD_ATTR, type TraceDetail, type TraceSpan } from "@shared/traces";
import { callGrafanaTool, describeCatalog, grafanaMcpConfigured, grafanaTools } from "../../grafana-mcp";
import { getObservability } from "../../settings";
import { logQuery, lokiConfigured, queryLogs } from "../../loki";
import { getTrace, groupStats, searchQuery, searchTraces, tempoConfigured, TempoError, type TraceScope } from "../../tempo";
import { mayReadNamespace, resolveCluster } from "../../traces-routes";
import { kubeScopeSchema, type KubeScope } from "./scope";

const name = z.string().regex(/^[\w.\-]+$/, "a plain name");
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s` : `${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`);
const time = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

/** The Tempo scope for one call: the tool's namespace, else the one selected in the header. */
async function scopeFor(context: KubeScope, namespace: string | undefined): Promise<{ scope: TraceScope } | { error: string }> {
  const o = getObservability();
  if (!tempoConfigured(o)) return { error: "Tracing is not set up on this KubeDeck (no Tempo URL)." };
  const ns = namespace || context.namespace;
  const found = await resolveCluster(o, context.context, ns);
  if (!found) return { error: `Cannot tell which Tempo cluster "${context.context || "default"}" is. The user can map it in Settings → Observability.` };
  if (!(await mayReadNamespace(context.context, ns))) return { error: `ACCESS_DENIED: the user may not list pods in "${ns || "every namespace"}", so its traces are hidden.` };
  return { scope: { cluster: found.cluster, namespace: ns } };
}

const errorText = (err: unknown) => (err instanceof TempoError || err instanceof Error ? `Error: ${err.message}` : `Error: ${String(err)}`);

/** A trace for the model: totals, services, errors with their messages, the slowest spans and the call tree. */
export function condenseTrace(t: TraceDetail, maxTree = 60): string {
  if (t.spans.length === 0) return `Trace ${t.traceId}: no spans.`;
  const byService = new Map<string, { spans: number; errors: number }>();
  for (const s of t.spans) {
    const e = byService.get(s.service) ?? { spans: 0, errors: 0 };
    e.spans++;
    if (s.error) e.errors++;
    byService.set(s.service, e);
  }
  const where = (s: TraceSpan) => `${s.service}${s.namespace ? ` [${s.namespace}]` : ""}`;
  const key = (s: TraceSpan) => {
    const a = s.attributes;
    const bits = [a["http.request.method"] && a["url.path"] ? `${a["http.request.method"]} ${a["url.path"]}` : "", a["http.response.status_code"] ? `status=${a["http.response.status_code"]}` : "",
      a["db.system.name"] || a["db.system"] ? `db=${a["db.system.name"] || a["db.system"]}` : "", a["server.address"] ? `→ ${a["server.address"]}` : "",
      a["messaging.destination.name"] ? `topic=${a["messaging.destination.name"]}` : "", a["error.type"] ? `error.type=${a["error.type"]}` : ""];
    return bits.filter(Boolean).join(" ");
  };
  const lines = [
    `Trace ${t.traceId} · ${time(t.start)} UTC · ${fmtMs(t.durationMs)} · ${t.spans.length} spans${t.hidden ? ` (${t.hidden} hidden: namespaces the user cannot read)` : ""}`,
    `Services: ${[...byService].map(([s, v]) => `${s} ${v.spans}${v.errors ? ` (${v.errors} errors)` : ""}`).join(", ")}`,
  ];
  const errors = t.spans.filter((s) => s.error);
  if (errors.length) {
    lines.push("", "Errors:");
    for (const s of errors.slice(0, 10)) {
      const exception = s.events.find((e) => e.name === "exception")?.attributes;
      const why = [s.statusMessage, exception?.["exception.type"], exception?.["exception.message"]?.slice(0, 300)].filter(Boolean).join(" · ");
      lines.push(`- ${where(s)} ${s.kind} "${s.name}" ${fmtMs(s.durationMs)} ${key(s)}${why ? ` — ${why}` : ""}`);
    }
  }
  lines.push("", "Slowest spans:");
  for (const s of [...t.spans].sort((a, b) => b.durationMs - a.durationMs).slice(0, 8)) lines.push(`- ${fmtMs(s.durationMs)} ${where(s)} ${s.kind} "${s.name}" ${key(s)}`);

  // the call tree, depth-first, so the model can follow who called whom
  const children = new Map<string, TraceSpan[]>();
  const ids = new Set(t.spans.map((s) => s.id));
  for (const s of t.spans) {
    const parent = s.parentId && ids.has(s.parentId) ? s.parentId : "";
    children.set(parent, [...(children.get(parent) ?? []), s]);
  }
  const tree: string[] = [];
  const walk = (parent: string, depth: number) => {
    for (const s of children.get(parent) ?? []) {
      if (tree.length >= maxTree) return;
      tree.push(`${"  ".repeat(Math.min(depth, 12))}${s.error ? "✗" : "·"} +${fmtMs(s.offsetMs)} ${fmtMs(s.durationMs)} ${where(s)} "${s.name}"`);
      walk(s.id, depth + 1);
    }
  };
  walk("", 0);
  lines.push("", `Call tree (+start, duration):`, ...tree);
  if (t.spans.length > tree.length) lines.push(`… ${t.spans.length - tree.length} more spans`);
  return lines.join("\n");
}

const workloadKinds = Object.keys(TRACE_WORKLOAD_ATTR) as [keyof typeof TRACE_WORKLOAD_ATTR, ...(keyof typeof TRACE_WORKLOAD_ATTR)[]];

export const observabilityTools = {
  traces_stats: tool({
    description:
      "Request rate, error rate and p50/p95 latency from traces (Tempo), grouped by service (default), endpoint (span name), " +
      "version (ReplicaSet: compares a rollout's new pods with the old) or pod. Optionally for one workload. " +
      "Start here for 'what is slow / failing / did the rollout make it worse', then traces_search for examples.",
    inputSchema: z.object({
      groupBy: z.enum(TRACE_GROUP_BY).optional().describe("service | endpoint | version | pod; default service"),
      namespace: name.optional().describe("Namespace; default the one selected in the header"),
      workloadKind: z.enum(workloadKinds).optional(),
      workloadName: name.optional(),
      since: z.enum(TRACE_SINCE).optional().describe("Window, default 1h; Tempo measures at most 3h"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async ({ groupBy = "service", namespace, workloadKind, workloadName, since = "1h" }, { abortSignal, context }) => {
      try {
        const s = await scopeFor(context, namespace);
        if ("error" in s) return s.error;
        const scope: TraceScope = { ...s.scope };
        if (workloadKind && workloadName) {
          if (workloadKind === "service") scope.service = workloadName;
          else scope.workload = { kind: workloadKind, name: workloadName };
        }
        const { since: measured, total, rows } = await groupStats(getObservability(), scope, since, groupBy, abortSignal);
        const where = `${workloadName ? `${workloadKind} ${workloadName} in ` : ""}${s.scope.namespace || "the cluster"}`;
        if (rows.length === 0) return `No traced requests for ${where} (Tempo cluster ${s.scope.cluster}) in the last ${measured}.`;
        const pct = (r: { rate: number; errorRate: number }) => (r.rate ? `${((r.errorRate / r.rate) * 100).toFixed(r.errorRate / r.rate < 0.01 ? 2 : 1)}%` : "0%");
        const line = (k: string, r: { rate: number; errorRate: number; p50Ms: number | null; p95Ms: number | null }) =>
          `${k} | ${r.rate.toFixed(3)} | ${pct(r)} | ${r.p50Ms === null ? "–" : fmtMs(r.p50Ms)} | ${r.p95Ms === null ? "–" : fmtMs(r.p95Ms)}`;
        return [
          `${where}, Tempo cluster ${s.scope.cluster}, last ${measured}${measured !== since ? ` (Tempo measures at most ${measured})` : ""}. Requests = server + consumer spans.`,
          `${groupBy} | req/s | error% | p50 | p95`,
          ...(total ? [line("TOTAL", total)] : []),
          ...rows.slice(0, 40).map((r) => line(r.key, r)),
          rows.length > 40 ? `… ${rows.length - 40} more` : "",
          groupBy === "version" && rows.length > 1 ? "Versions are ReplicaSets; the newest one is the current rollout (check with k8s_list replicasets)." : "",
        ].filter(Boolean).join("\n");
      } catch (err) {
        return errorText(err);
      }
    },
  }),

  logs_search: tool({
    description:
      "Search log history in Loki: a namespace, a workload (all its pods, including pods that no longer exist) or one pod, " +
      "over up to 7 days. Use it for pods that crashed or were replaced, errors kubectl's tail no longer has, or lines around a trace's time. " +
      "errorsOnly keeps error/exception/traceback lines.",
    inputSchema: z.object({
      namespace: name.optional().describe("Namespace; default the one selected in the header"),
      workloadKind: z.enum(workloadKinds).optional(),
      workloadName: name.optional(),
      pod: name.optional().describe("One pod (may no longer exist)"),
      contains: z.string().max(200).optional().describe("Case-insensitive text a line must contain"),
      errorsOnly: z.boolean().optional(),
      since: z.enum(["15m", "1h", "6h", "24h", "7d"]).optional().describe("Default 1h"),
      around: z.string().optional().describe("ISO time (e.g. a trace's start): search ±2 minutes around it instead of `since`"),
      limit: z.number().int().min(1).max(200).optional().describe("Default 80 (the newest)"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async (input, { abortSignal, context }) => {
      try {
        const o = getObservability();
        if (!lokiConfigured(o)) return "Log history is not set up on this KubeDeck (no Loki URL).";
        const ns = input.namespace || context.namespace;
        if (!ns || ns === "all") return "Name a namespace: log history is searched one namespace at a time.";
        if (!(await mayReadNamespace(context.context, ns))) return `ACCESS_DENIED: the user may not list pods in "${ns}", so its logs are hidden.`;
        const cluster = o.clusters[context.context] ?? (o.tempoUrl ? (await resolveCluster(o, context.context, ns).catch(() => null))?.cluster : undefined) ?? context.context;
        const workload = input.workloadKind && input.workloadName ? { kind: input.workloadKind, name: input.workloadName } : undefined;
        const query = logQuery({ cluster, namespace: ns, pod: input.pod, workload }, { contains: input.contains, errorsOnly: input.errorsOnly });
        let start: number, end: number;
        const at = input.around ? Date.parse(input.around) : NaN;
        if (Number.isFinite(at)) { start = at - 120_000; end = at + 120_000; }
        else { end = Date.now(); start = end - ({ "15m": 900, "1h": 3600, "6h": 21_600, "24h": 86_400, "7d": 604_800 }[input.since ?? "1h"]) * 1000; }
        const { lines, limited } = await queryLogs(o, query, start, end, input.limit ?? 80, true, abortSignal);
        if (lines.length === 0) return `No log lines. LogQL: ${query}`;
        return [
          `${lines.length}${limited ? " (newest; more exist)" : ""} lines, oldest first. LogQL: ${query}`,
          ...lines.map((l) => `${time(l.ts)} ${l.pod}${l.level ? ` [${l.level}]` : ""} ${l.line.slice(0, 400)}`),
        ].join("\n");
      } catch (err) {
        return errorText(err);
      }
    },
  }),

  traces_search: tool({
    description:
      "Find traces (Tempo) in the selected cluster: by workload or service, failing ones (errorsOnly), slow ones (minDuration), " +
      "or any TraceQL condition (where, e.g. span.http.route = \"/login\" or span.http.response.status_code >= 500). " +
      "Matches requests and consumed messages unless allSpans. Returns trace ids; read one with trace_get.",
    inputSchema: z.object({
      namespace: name.optional().describe("Namespace; default the one selected in the header"),
      workloadKind: z.enum(workloadKinds).optional().describe("deployment, statefulset, daemonset, pod, service, …"),
      workloadName: name.optional(),
      errorsOnly: z.boolean().optional(),
      minDuration: z.string().regex(/^\d+(\.\d+)?(ms|s|m)$/).optional().describe("e.g. 500ms, 2s"),
      where: z.string().max(300).optional().describe("Extra TraceQL condition on span./resource. attributes; no braces or pipes"),
      allSpans: z.boolean().optional().describe("Match every span, not only requests and consumed messages"),
      since: z.enum(TRACE_SINCE).optional().describe("Window, default 1h"),
      limit: z.number().int().min(1).max(20).optional().describe("Default 15"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async (input, { abortSignal, context }) => {
      try {
        const s = await scopeFor(context, input.namespace);
        if ("error" in s) return s.error;
        const scope: TraceScope = { ...s.scope };
        if (input.workloadKind && input.workloadName) {
          if (input.workloadKind === "service") scope.service = input.workloadName;
          else scope.workload = { kind: input.workloadKind, name: input.workloadName };
        }
        const query = searchQuery(scope, { errors: input.errorsOnly, minDuration: input.minDuration, where: input.where, entryOnly: !input.allSpans });
        const since = input.since ?? "1h";
        const limit = input.limit ?? 15;
        const { traces, limited } = await searchTraces(getObservability(), query, since, limit, abortSignal);
        if (traces.length === 0) return `No traces match in the last ${since}.\nTraceQL: ${query}`;
        return [
          `${traces.length}${limited ? "+" : ""} traces, last ${since}, newest first. TraceQL: ${query}`,
          ...traces.map((t) => {
            const span = t.span ? ` · span "${t.span.name}" ${t.span.kind} ${fmtMs(t.span.durationMs)}${t.span.error ? " ERROR" : ""}${t.span.route ? ` ${t.span.route}` : ""}` : "";
            return `${time(t.start)} · ${fmtMs(t.durationMs)} · root ${t.rootService}: "${t.rootName}"${span} · trace ${t.traceId}`;
          }),
        ].join("\n");
      } catch (err) {
        return errorText(err);
      }
    },
  }),

  trace_get: tool({
    description: "Read one trace (Tempo) by id: services involved, errors with exception messages, the slowest spans and the call tree.",
    inputSchema: z.object({ traceId: z.string().regex(/^[0-9a-fA-F]{16,32}$/).describe("Trace id from traces_search or the user") }),
    contextSchema: kubeScopeSchema,
    execute: async ({ traceId }, { abortSignal, context }) => {
      try {
        const o = getObservability();
        if (!tempoConfigured(o)) return "Tracing is not set up on this KubeDeck (no Tempo URL).";
        const trace = await getTrace(o, traceId, abortSignal);
        const namespaces = [...new Set(trace.spans.map((s) => s.namespace).filter(Boolean))];
        const readable = new Set((await Promise.all(namespaces.map(async (ns) => ((await mayReadNamespace(context.context, ns)) ? ns : "")))).filter(Boolean));
        const spans = trace.spans.filter((s) => !s.namespace || readable.has(s.namespace));
        if (spans.length === 0 && trace.spans.length) return "ACCESS_DENIED: this trace is from namespaces the user cannot list pods in.";
        return condenseTrace({ ...trace, spans, hidden: trace.spans.length - spans.length });
      } catch (err) {
        return errorText(err);
      }
    },
  }),

  grafana: tool({
    // replaced per request with the tools the server actually offers (see grafanaToolDescription)
    description: "Call a read-only tool on the Grafana MCP server (Loki logs, Prometheus metrics, dashboards, alerts).",
    inputSchema: z.object({
      tool: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).describe("Grafana MCP tool name from the list"),
      arguments: z.record(z.string(), z.unknown()).optional().describe("The tool's arguments as an object"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async ({ tool: toolName, arguments: args }, { abortSignal, context }) => {
      const o = getObservability();
      if (!grafanaMcpConfigured(o)) return "Grafana is not connected to this KubeDeck.";
      console.log(`[kubedeck:agent] grafana${context.user ? ` user=${JSON.stringify(context.user)}` : ""} thread=${context.threadId} tool=${toolName}`);
      try {
        return await callGrafanaTool(o, toolName, args ?? {}, abortSignal);
      } catch (err) {
        return errorText(err);
      }
    },
  }),
};

export const TRACE_TOOL_NAMES = ["traces_stats", "traces_search", "trace_get"] as const;

/**
 * What this request can use: trace tools when Tempo is set up, `grafana` when its MCP server answers,
 * plus the `grafana` description listing the server's read tools. Never slows a chat by more than the
 * MCP connect timeout; an unreachable server just leaves the tool out.
 */
export async function observabilityForCall(): Promise<{ active: string[]; grafanaDescription: string | null; prompt: string }> {
  const o = getObservability();
  const active: string[] = [];
  const prompt: string[] = [];
  if (tempoConfigured(o)) {
    active.push(...TRACE_TOOL_NAMES);
    prompt.push(
      "## Traces (Tempo)",
      "Traces show what a request did across services: use them for latency, errors/5xx, failing calls between services and \"what is X calling\".",
      "- traces_stats: req/s, error rate, p50/p95 by service, endpoint, version (rollout old vs new) or pod. Start here for slow / failing / 'did the deploy make it worse'.",
      "- traces_search: example traces (errorsOnly, minDuration, workload, or a TraceQL `where`). Then trace_get on 1–2 of them.",
      "- trace_get: one trace with errors (exception messages) and the call tree. Name the failing span, its service and the downstream it called.",
      "When a failing span has no exception message, read the failing pod's logs at that time yourself before answering (logs_search with pod and around=<trace start> when Loki is set up, else k8s_logs); do not ask first.",
      "A consumer/server span with no child spans and a round duration (e.g. 5.00s every time) usually measures a poll or timeout wait, not slow work: say that instead of calling the service slow, unless trace_get shows the time spent in child calls.",
      "Trace ids are 32 hex characters; quote them in answers.",
    );
  }
  if (lokiConfigured(o)) {
    active.push("logs_search");
    prompt.push(
      "## Log history (Loki)",
      "logs_search reads up to 7 days of logs, including pods that are gone. Prefer it over k8s_logs for errors in the past, crashed or replaced pods, and lines around a trace (around=<ISO time>). errorsOnly finds exceptions fast.",
    );
  }
  let grafanaDescription: string | null = null;
  if (grafanaMcpConfigured(o)) {
    try {
      const tools = await grafanaTools(o);
      if (tools.length) {
        active.push("grafana");
        grafanaDescription =
          "Call one read-only tool on the team's Grafana (MCP). Pass {tool, arguments}. Use it for Loki logs, Prometheus metrics, " +
          "dashboards, alert rules and incidents; most query tools need a datasourceUid: get it from list_datasources first.\nTools (* = required):\n" +
          describeCatalog(tools);
        prompt.push(
          "## Grafana",
          "The `grafana` tool reaches the team's Grafana: Prometheus metrics history (CPU, memory, request rates over time), Loki logs beyond what kubectl keeps, dashboards, firing alerts.",
          "Use it when kubectl cannot answer (history, trends, logs of pods that are gone). Find the data source uid with list_datasources once, then query.",
        );
      }
    } catch (err) {
      prompt.push("## Grafana", `The Grafana MCP server is configured but unreachable right now (${err instanceof Error ? err.message : String(err)}). Say so if the user asks for Grafana data.`);
    }
  }
  return { active, grafanaDescription, prompt: prompt.join("\n") };
}
