/**
 * Grafana Loki over its HTTP API: log history for a namespace, workload or pod, including pods that no
 * longer exist, and the lines a pod wrote while a traced request ran. Streams are found by the labels
 * the collector sets (`cluster`, `namespace`, `pod`), the same cluster names Tempo uses. Only GETs.
 */
import type { LogLine, TraceWorkloadKind } from "@shared/traces";
import type { ObservabilitySettings } from "./settings";

const TIMEOUT_MS = 25_000;

export class LokiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export const lokiConfigured = (o: ObservabilitySettings | undefined): o is ObservabilitySettings => !!o?.lokiUrl;

async function lokiGet<T>(o: ObservabilitySettings, path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const url = new URL(o.lokiUrl.replace(/\/+$/, "") + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (o.lokiToken) headers.Authorization = `Bearer ${o.lokiToken}`;
  if (o.lokiTenant) headers["X-Scope-OrgID"] = o.lokiTenant;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (err: any) {
    if (err?.name === "TimeoutError") throw new LokiError("Loki did not answer within 25 seconds. Try a shorter time range or a narrower filter.", 504);
    throw new LokiError(`Cannot reach Loki at ${url.origin}: ${err?.cause?.code ?? err?.message ?? err}`);
  }
  const text = await res.text();
  if (!res.ok) throw new LokiError(`Loki answered ${res.status}: ${text.trim().slice(0, 300) || res.statusText}`, res.status === 400 ? 400 : 502);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LokiError("Loki sent something that is not JSON. Is the Loki URL pointing at Loki's HTTP API?");
  }
}

/** A LogQL string literal. */
const lit = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** A name inside a LogQL regex (RE2): escape what is special. */
const reEscape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pod names a workload's pods get, so its logs survive the pods: `api-7f59d5f6c8-2wxvz` for a
 * Deployment, `db-0` for a StatefulSet. Exact enough that `checkout` does not match `checkout-worker`.
 */
export function podPattern(kind: TraceWorkloadKind, name: string): string | null {
  const n = reEscape(name);
  switch (kind) {
    case "deployment": return `${n}-[a-z0-9]{5,10}-[a-z0-9]{5}`;
    case "statefulset": return `${n}-[0-9]+`;
    case "daemonset":
    case "replicaset":
    case "job": return `${n}-[a-z0-9]{5}`;
    case "cronjob": return `${n}-[0-9]+-[a-z0-9]{5}`;
    default: return null;
  }
}

export interface LogScope {
  cluster: string;
  namespace: string;
  pod?: string;
  workload?: { kind: TraceWorkloadKind; name: string };
}

export interface LogFilter {
  /** case-insensitive text the line must contain */
  contains?: string;
  /** only lines that look like errors (error, exception, traceback, fatal, panic) */
  errorsOnly?: boolean;
}

/**
 * LogQL for a scope. Streams are selected by `cluster` and `namespace` (indexed labels); the pod is
 * filtered after that, because collectors commonly attach it as structured metadata, which a stream
 * selector cannot match, while a label filter matches either.
 */
export function logQuery(s: LogScope, f: LogFilter = {}): string {
  const sel = [`cluster=${lit(s.cluster)}`, `namespace=${lit(s.namespace)}`];
  if (!s.pod && s.workload?.kind === "service") sel.push(`service_name=${lit(s.workload.name)}`);
  let q = `{${sel.join(", ")}}`;
  if (s.pod) q += ` | pod=${lit(s.pod)}`;
  else if (s.workload) {
    const pattern = podPattern(s.workload.kind, s.workload.name);
    if (pattern) q += ` | pod=~${lit(pattern)}`;
  }
  if (f.contains?.trim()) q += ` |~ ${lit(`(?i)${reEscape(f.contains.trim())}`)}`;
  if (f.errorsOnly) q += ` |~ ${lit("(?i)(error|exception|traceback|fatal|panic)")}`;
  return q;
}

interface RawStreams {
  data?: { result?: { stream: Record<string, string>; values: [string, string][] }[] };
}

export function toLines(r: RawStreams): LogLine[] {
  const lines: LogLine[] = [];
  for (const { stream, values } of r.data?.result ?? []) {
    for (const [ns, line] of values) {
      lines.push({
        ts: Number(BigInt(ns) / 1_000_000n),
        pod: stream.pod ?? stream.instance?.split("/")[1]?.split(":")[0] ?? "",
        container: stream.container ?? "",
        level: stream.detected_level && stream.detected_level !== "unknown" ? stream.detected_level : stream.level ?? "",
        line: line.replace(/\n$/, ""),
      });
    }
  }
  return lines.sort((a, b) => a.ts - b.ts);
}

/** Lines in [startMs, endMs], oldest first. `newest` keeps the last `limit` lines of the window, else the first. */
export async function queryLogs(
  o: ObservabilitySettings,
  query: string,
  startMs: number,
  endMs: number,
  limit: number,
  newest = true,
  signal?: AbortSignal,
): Promise<{ lines: LogLine[]; limited: boolean }> {
  const r = await lokiGet<RawStreams>(o, "/loki/api/v1/query_range", {
    query,
    start: `${Math.floor(startMs)}000000`,
    end: `${Math.ceil(endMs)}000000`,
    limit,
    direction: newest ? "backward" : "forward",
  }, signal);
  const lines = toLines(r);
  return { lines, limited: lines.length >= limit };
}
