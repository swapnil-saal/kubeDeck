/** Distributed tracing (Grafana Tempo): what the trace routes return. */
import { z } from "zod";

export const tracesPaths = {
  status: "/api/traces/status",
  clusters: "/api/traces/clusters",
  search: "/api/traces/search",
  stats: "/api/traces/stats",
  logs: "/api/logs/history",
  trace: "/api/traces/trace/:id",
  grafanaMcp: "/api/traces/grafana-mcp",
} as const;

/** The Grafana MCP connection as the assistant sees it. */
export interface GrafanaMcpStatus {
  configured: boolean;
  ok: boolean;
  /** the read tools KubeDeck lets the assistant call */
  tools: string[];
  message?: string;
}

/** The kinds whose traces can be looked up, and the OpenTelemetry resource attribute each one matches. */
export const TRACE_WORKLOAD_ATTR = {
  deployment: "k8s.deployment.name",
  statefulset: "k8s.statefulset.name",
  daemonset: "k8s.daemonset.name",
  replicaset: "k8s.replicaset.name",
  job: "k8s.job.name",
  cronjob: "k8s.cronjob.name",
  pod: "k8s.pod.name",
  // a Service has no attribute of its own: its traces are the ones whose service.name is its name
  service: "service.name",
} as const;
export type TraceWorkloadKind = keyof typeof TRACE_WORKLOAD_ATTR;
export const isTraceWorkloadKind = (k: string): k is TraceWorkloadKind => k in TRACE_WORKLOAD_ATTR;

export const TRACE_SINCE = ["15m", "1h", "6h", "24h"] as const;
export type TraceSince = (typeof TRACE_SINCE)[number];

/** Is tracing set up, and which Tempo cluster a kube context's traces carry. */
export const traceStatusSchema = z.object({
  configured: z.boolean(),
  /** the value of `k8s.cluster.name` for this context; null when it could not be worked out */
  cluster: z.string().nullable(),
  /** how it was found: set in settings, same name as the context, Tempo's only cluster, or the only one with this namespace */
  source: z.enum(["settings", "name", "only", "namespace"]).nullable(),
  /** Grafana Explore link for a trace, with `__TRACE_ID__` where the id goes; null when Grafana is not set up */
  grafanaTraceUrl: z.string().nullable(),
  /** Loki is set up: log history next to traces */
  logs: z.boolean().default(false),
  /** namespaces of this cluster that sent traces in the last day (the ones this user may read); null when unknown */
  tracedNamespaces: z.array(z.string()).nullable().default(null),
  message: z.string().optional(),
});
export type TraceStatus = z.infer<typeof traceStatusSchema>;

/** One trace in a search result: its root, its length, and the spans that matched the filter. */
export const traceSummarySchema = z.object({
  traceId: z.string(),
  rootService: z.string(),
  rootName: z.string(),
  /** epoch ms */
  start: z.number(),
  durationMs: z.number(),
  /** the matching spans in the scope asked for (the workload's own spans) */
  matched: z.number(),
  span: z.object({
    name: z.string(),
    durationMs: z.number(),
    error: z.boolean(),
    kind: z.string(),
    status: z.string(),
    route: z.string(),
  }).nullable(),
  /** spans per service across the whole trace */
  services: z.array(z.object({ name: z.string(), spans: z.number(), errors: z.number() })),
});
export type TraceSummary = z.infer<typeof traceSummarySchema>;

export const traceSearchSchema = z.object({
  cluster: z.string(),
  query: z.string(),
  traces: z.array(traceSummarySchema),
  /** the search stopped at `limit`; more traces exist */
  limited: z.boolean(),
});
export type TraceSearch = z.infer<typeof traceSearchSchema>;

/** One log line from Loki. */
export const logLineSchema = z.object({
  /** epoch ms */
  ts: z.number(),
  pod: z.string(),
  container: z.string(),
  /** Loki's detected level, when it has one */
  level: z.string(),
  line: z.string(),
});
export type LogLine = z.infer<typeof logLineSchema>;

export const logHistorySchema = z.object({
  cluster: z.string(),
  query: z.string(),
  lines: z.array(logLineSchema),
  /** stopped at the limit; there are more lines in the window */
  limited: z.boolean(),
});
export type LogHistory = z.infer<typeof logHistorySchema>;

export const TRACE_GROUP_BY = ["service", "endpoint", "version", "pod"] as const;
export type TraceGroupBy = (typeof TRACE_GROUP_BY)[number];

const statRowSchema = z.object({
  /** the service, endpoint (span name), ReplicaSet or pod; "" for a total */
  key: z.string(),
  /** incoming requests and consumed messages per second */
  rate: z.number(),
  errorRate: z.number(),
  p50Ms: z.number().nullable(),
  p95Ms: z.number().nullable(),
});
export type StatRow = z.infer<typeof statRowSchema>;

/** Requests, errors and latency in a scope from TraceQL metrics: grouped rows plus the scope's total. */
export const traceStatsSchema = z.object({
  cluster: z.string(),
  /** the window measured; Tempo may cap it (3h by default) */
  since: z.string(),
  by: z.enum(TRACE_GROUP_BY),
  total: statRowSchema.nullable(),
  rows: z.array(statRowSchema),
});
export type TraceStats = z.infer<typeof traceStatsSchema>;

export const spanSchema = z.object({
  id: z.string(),
  parentId: z.string(),
  name: z.string(),
  service: z.string(),
  namespace: z.string(),
  /** deployment / statefulset / … name, when the span carries one */
  workload: z.string(),
  pod: z.string(),
  kind: z.string(),
  /** ms from the start of the trace */
  offsetMs: z.number(),
  durationMs: z.number(),
  error: z.boolean(),
  statusMessage: z.string(),
  attributes: z.record(z.string(), z.string()),
  events: z.array(z.object({ name: z.string(), offsetMs: z.number(), attributes: z.record(z.string(), z.string()) })),
});
export type TraceSpan = z.infer<typeof spanSchema>;

export const traceDetailSchema = z.object({
  traceId: z.string(),
  /** epoch ms of the first span */
  start: z.number(),
  durationMs: z.number(),
  spans: z.array(spanSchema),
  /** spans left out because the signed-in user may not read their namespace */
  hidden: z.number(),
});
export type TraceDetail = z.infer<typeof traceDetailSchema>;
