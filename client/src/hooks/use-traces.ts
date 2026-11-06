import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  tracesPaths,
  type LogHistory,
  type TraceDetail,
  type TraceGroupBy,
  type TraceStats,
  type TraceSearch,
  type TraceSince,
  type TraceStatus,
  type TraceWorkloadKind,
} from "@shared/traces";

async function getJson<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const res = await fetch(`${path}${qs.size ? `?${qs}` : ""}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message || `Request failed (${res.status})`);
  return body as T;
}

/** Whether tracing is set up, and which Tempo cluster this context is. */
export function useTraceStatus(context: string, namespace: string) {
  return useQuery({
    queryKey: [tracesPaths.status, context, namespace],
    queryFn: () => getJson<TraceStatus>(tracesPaths.status, { context, namespace }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Tracing is set up on this server (cheap: one status call, cached). */
export function useTracingEnabled(context = "", namespace = ""): boolean {
  return useTraceStatus(context, namespace).data?.configured === true;
}

export type TraceFilter = "all" | "errors" | "slow";

export interface TraceQuery {
  context: string;
  namespace: string;
  kind?: TraceWorkloadKind;
  name?: string;
  filter: TraceFilter;
  since: TraceSince;
  /** only requests and consumed messages (default) */
  entryOnly: boolean;
  minDuration?: string;
  /** one endpoint (span name) */
  span?: string;
}

export function useTraceSearch(q: TraceQuery, enabled = true) {
  return useQuery({
    queryKey: [tracesPaths.search, q],
    queryFn: () => getJson<TraceSearch>(tracesPaths.search, {
      context: q.context, namespace: q.namespace, kind: q.kind, name: q.name, filter: q.filter, since: q.since,
      entry: q.entryOnly ? undefined : "0", minDuration: q.filter === "slow" ? q.minDuration : undefined, span: q.span, limit: 100,
    }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
}

export function useTraceStats(
  q: { context: string; namespace: string; since: TraceSince; by: TraceGroupBy; kind?: TraceWorkloadKind; name?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: [tracesPaths.stats, q],
    queryFn: () => getJson<TraceStats>(tracesPaths.stats, { context: q.context, namespace: q.namespace, since: q.since, by: q.by, kind: q.kind, name: q.name }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
}

/** Log lines from Loki for a pod (or workload) in a time window, oldest first. */
export function useLogHistory(
  q: { context: string; namespace: string; pod?: string; kind?: TraceWorkloadKind; name?: string; start: number; end: number; errors?: boolean; limit?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: [tracesPaths.logs, q],
    queryFn: () => getJson<LogHistory>(tracesPaths.logs, {
      context: q.context, namespace: q.namespace, pod: q.pod, kind: q.kind, name: q.name,
      start: Math.floor(q.start), end: Math.ceil(q.end), errors: q.errors ? "1" : undefined, limit: q.limit ?? 200, order: "oldest",
    }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useTrace(traceId: string | null, context: string) {
  return useQuery({
    queryKey: [tracesPaths.trace, traceId, context],
    queryFn: () => getJson<TraceDetail>(tracesPaths.trace.replace(":id", encodeURIComponent(traceId!)), { context }),
    enabled: !!traceId,
    // a finished trace does not change
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useTempoClusters(enabled: boolean) {
  return useQuery({
    queryKey: [tracesPaths.clusters],
    queryFn: () => getJson<{ clusters: string[] }>(tracesPaths.clusters, {}),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
