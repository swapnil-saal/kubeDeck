/**
 * Grafana Tempo over its HTTP API: TraceQL search, one trace, tag values and TraceQL metrics.
 * Traces are found through the OpenTelemetry resource attributes the OTel operator / collector sets
 * (k8s.cluster.name, k8s.namespace.name, k8s.deployment.name, …), so a Kubernetes scope maps to TraceQL
 * exactly. Only GETs: nothing here can change Tempo.
 */
import {
  TRACE_WORKLOAD_ATTR,
  type StatRow,
  type TraceGroupBy,
  type TraceDetail,
  type TraceSince,
  type TraceSpan,
  type TraceSummary,
  type TraceWorkloadKind,
} from "@shared/traces";
import type { ObservabilitySettings } from "./settings";

const TIMEOUT_MS = 25_000;

export class TempoError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export const tempoConfigured = (o: ObservabilitySettings | undefined): o is ObservabilitySettings => !!o?.tempoUrl;

/** One GET against Tempo, as JSON. */
export async function tempoGet<T>(o: ObservabilitySettings, path: string, params: Record<string, string | number> = {}, signal?: AbortSignal): Promise<T> {
  const url = new URL(o.tempoUrl.replace(/\/+$/, "") + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (o.tempoToken) headers.Authorization = `Bearer ${o.tempoToken}`;
  if (o.tempoTenant) headers["X-Scope-OrgID"] = o.tempoTenant;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (err: any) {
    if (err?.name === "TimeoutError") throw new TempoError("Tempo did not answer within 25 seconds. Try a shorter time range.", 504);
    throw new TempoError(`Cannot reach Tempo at ${url.origin}: ${err?.cause?.code ?? err?.message ?? err}`);
  }
  const text = await res.text();
  if (res.status === 404 && path.startsWith("/api/v2/traces/")) throw new TempoError("Trace not found. It may be older than Tempo keeps traces.", 404);
  if (!res.ok) throw new TempoError(`Tempo answered ${res.status}: ${text.trim().slice(0, 300) || res.statusText}`, res.status === 400 ? 400 : 502);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TempoError("Tempo sent something that is not JSON. Is the Tempo URL pointing at Tempo's HTTP API?");
  }
}

// ── TraceQL ─────────────────────────────────────────

/** A TraceQL string literal. */
export const q = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export interface TraceScope {
  cluster: string;
  namespace?: string;
  workload?: { kind: TraceWorkloadKind; name: string };
  service?: string;
}

/** "250ms", "2s", "1.5s", "1m" → TraceQL duration; anything else is refused. */
export function traceqlDuration(raw: string): string {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(raw.trim());
  if (!m) throw new TempoError(`"${raw}" is not a duration like 500ms, 2s or 1m.`, 400);
  return `${m[1]}${m[2]}`;
}

/** The conditions that put a span inside a Kubernetes scope. */
export function scopeConditions(s: TraceScope): string[] {
  const c = [`resource.k8s.cluster.name=${q(s.cluster)}`];
  if (s.namespace && s.namespace !== "all") c.push(`resource.k8s.namespace.name=${q(s.namespace)}`);
  if (s.workload) c.push(`resource.${TRACE_WORKLOAD_ATTR[s.workload.kind]}=${q(s.workload.name)}`);
  if (s.service) c.push(`resource.service.name=${q(s.service)}`);
  return c;
}

/** Spans that start work in a service: requests it serves and messages it consumes. */
export const ENTRY_SPANS = "(kind=server || kind=consumer)";

export interface SearchFilter {
  /** only spans that failed */
  errors?: boolean;
  /** only spans at least this long, e.g. "1s" */
  minDuration?: string;
  /** only requests and consumed messages (default), or every span */
  entryOnly?: boolean;
  /** only spans with this name (an endpoint: "GET /users/{id}", "process orders") */
  spanName?: string;
  /** an extra TraceQL condition from the assistant, e.g. `span.http.route = "/login"`; validated by `extraCondition` */
  where?: string;
}

/**
 * An extra condition is ANDed inside the scope's braces, so it may not close them, start a pipeline
 * or a second spanset: it can narrow the scope, never widen it.
 */
export function extraCondition(raw: string): string {
  const where = raw.trim();
  if (!where) return "";
  if (where.length > 300) throw new TempoError("The condition is too long (300 characters at most).", 400);
  // outside string literals: no braces and no pipeline (`||` is a plain "or")
  const bare = where.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\|\|/g, " or ");
  const unclosedQuote = (bare.match(/"/g)?.length ?? 0) % 2 === 1;
  if (/[{}|]/.test(bare) || unclosedQuote) {
    throw new TempoError("The condition may only compare span or resource attributes, e.g. span.http.route = \"/login\".", 400);
  }
  return `(${where})`;
}

/** The TraceQL for a search in a scope. */
export function searchQuery(scope: TraceScope, f: SearchFilter = {}): string {
  const c = scopeConditions(scope);
  if (f.entryOnly !== false) c.push(ENTRY_SPANS);
  if (f.spanName) c.push(`name=${q(f.spanName)}`);
  if (f.errors) c.push("status=error");
  if (f.minDuration) c.push(`duration>=${traceqlDuration(f.minDuration)}`);
  if (f.where) c.push(extraCondition(f.where));
  return `{${c.join(" && ")}} | select(name, status, kind, span.http.route, span.http.response.status_code)`;
}

const SINCE_SECONDS: Record<TraceSince, number> = { "15m": 900, "1h": 3600, "6h": 21_600, "24h": 86_400 };
export const sinceSeconds = (since: string) => SINCE_SECONDS[since as TraceSince] ?? 3600;

export function window(since: string, now = Date.now()): { start: number; end: number } {
  const end = Math.floor(now / 1000);
  return { start: end - sinceSeconds(since), end };
}

// ── search ──────────────────────────────────────────

interface Attr { key: string; value: Record<string, unknown> }
const attrValue = (v: Record<string, unknown> | undefined): string => {
  if (!v) return "";
  const x = v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue;
  if (x !== undefined) return String(x);
  if (v.arrayValue) return JSON.stringify((v.arrayValue as { values?: Record<string, unknown>[] }).values?.map(attrValue) ?? []);
  return "";
};
const attrMap = (attrs: Attr[] | undefined): Record<string, string> =>
  Object.fromEntries((attrs ?? []).map((a) => [a.key, attrValue(a.value)]));

interface RawSearchSpan { spanID: string; name?: string; startTimeUnixNano: string; durationNanos: string; attributes?: Attr[] }
interface RawSearchTrace {
  traceID: string;
  rootServiceName?: string;
  rootTraceName?: string;
  startTimeUnixNano: string;
  durationMs?: number;
  spanSets?: { spans: RawSearchSpan[]; matched: number }[];
  spanSet?: { spans: RawSearchSpan[]; matched: number };
  serviceStats?: Record<string, { spanCount: number; errorCount?: number }>;
}

const nsToMs = (ns: string | undefined) => (ns ? Number(BigInt(ns) / 1_000_000n) : 0);
/** Tempo prints "nil" for a selected attribute the span does not have. */
const present = (v: string | undefined) => (v && v !== "nil" ? v : "");

export function toSummary(t: RawSearchTrace): TraceSummary {
  const sets = t.spanSets ?? (t.spanSet ? [t.spanSet] : []);
  const spans = sets.flatMap((s) => s.spans);
  // the longest matching span stands for the trace in this scope
  const first = spans.slice().sort((a, b) => Number(BigInt(b.durationNanos) - BigInt(a.durationNanos)))[0];
  const a = attrMap(first?.attributes);
  return {
    traceId: t.traceID,
    rootService: t.rootServiceName ?? "",
    rootName: t.rootTraceName ?? "",
    start: nsToMs(t.startTimeUnixNano),
    durationMs: t.durationMs ?? 0,
    matched: sets.reduce((n, s) => n + (s.matched ?? s.spans.length), 0),
    span: first
      ? {
          name: present(a.name) || first.name || "",
          durationMs: Number(BigInt(first.durationNanos)) / 1e6,
          error: a.status === "error",
          kind: present(a.kind),
          status: present(a.status),
          route: present(a["http.route"]) || present(a["http.response.status_code"]),
        }
      : null,
    services: Object.entries(t.serviceStats ?? {}).map(([name, s]) => ({ name, spans: s.spanCount, errors: s.errorCount ?? 0 })),
  };
}

export async function searchTraces(
  o: ObservabilitySettings,
  query: string,
  since: string,
  limit: number,
  signal?: AbortSignal,
): Promise<{ traces: TraceSummary[]; limited: boolean }> {
  // Tempo returns the first `limit` matches it finds, not the newest: in a busy namespace a one-hour
  // search can come back without the last minutes. Look at recent slices first and widen only when short.
  const { start, end } = window(since);
  const found = new Map<string, TraceSummary>();
  let limited = false;
  for (const from of searchSlices(start, end)) {
    const r = await tempoGet<{ traces?: RawSearchTrace[] }>(o, "/api/search", { q: query, start: from, end, limit, spss: 3 }, signal);
    for (const t of r.traces ?? []) if (!found.has(t.traceID)) found.set(t.traceID, toSummary(t));
    limited = (r.traces?.length ?? 0) >= limit;
    if (found.size >= limit) break;
  }
  const traces = [...found.values()].sort((a, b) => b.start - a.start).slice(0, limit);
  return { traces, limited: limited || found.size > limit };
}

/** Start times for a search that widens: the last 5 minutes, then the last hour, then the whole window. */
export function searchSlices(start: number, end: number): number[] {
  return [...[end - 300, end - 3600].filter((s) => s > start), start];
}

// ── one trace ───────────────────────────────────────

interface RawSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: Attr[];
  status?: { code?: string; message?: string };
  events?: { name: string; timeUnixNano: string; attributes?: Attr[] }[];
}
interface RawTrace { trace?: { resourceSpans?: { resource?: { attributes?: Attr[] }; scopeSpans?: { spans?: RawSpan[] }[] }[] } }

/** Tempo's JSON carries ids as base64; Grafana and the search API use hex. */
export const b64ToHex = (b64: string | undefined) => (b64 ? Buffer.from(b64, "base64").toString("hex") : "");

const WORKLOAD_KEYS = ["k8s.deployment.name", "k8s.statefulset.name", "k8s.daemonset.name", "k8s.job.name", "k8s.cronjob.name"];
/** Attributes worth showing on a span; resource attributes the span list already shows are dropped. */
const SHOWN_ELSEWHERE = new Set(["service.name", "k8s.namespace.name", "k8s.pod.name", ...WORKLOAD_KEYS]);

export function parseTrace(traceId: string, raw: RawTrace): TraceDetail {
  const flat: (Omit<TraceSpan, "offsetMs" | "events"> & { startNs: bigint; events: { name: string; ns: bigint; attributes: Record<string, string> }[] })[] = [];
  for (const rs of raw.trace?.resourceSpans ?? []) {
    const res = attrMap(rs.resource?.attributes);
    for (const ss of rs.scopeSpans ?? []) {
      for (const s of ss.spans ?? []) {
        const startNs = BigInt(s.startTimeUnixNano);
        const attributes = { ...Object.fromEntries(Object.entries(res).filter(([k]) => !SHOWN_ELSEWHERE.has(k)).map(([k, v]) => [`resource.${k}`, v])), ...attrMap(s.attributes) };
        flat.push({
          id: b64ToHex(s.spanId),
          parentId: b64ToHex(s.parentSpanId),
          name: s.name,
          service: res["service.name"] ?? "",
          namespace: res["k8s.namespace.name"] ?? "",
          workload: WORKLOAD_KEYS.map((k) => res[k]).find(Boolean) ?? "",
          pod: res["k8s.pod.name"] ?? "",
          kind: (s.kind ?? "").replace(/^SPAN_KIND_/, "").toLowerCase(),
          startNs,
          durationMs: Number(BigInt(s.endTimeUnixNano) - startNs) / 1e6,
          error: s.status?.code === "STATUS_CODE_ERROR",
          statusMessage: s.status?.message ?? "",
          attributes,
          events: (s.events ?? []).map((e) => ({ name: e.name, ns: BigInt(e.timeUnixNano), attributes: attrMap(e.attributes) })),
        });
      }
    }
  }
  if (flat.length === 0) return { traceId, start: 0, durationMs: 0, spans: [], hidden: 0 };
  const t0 = flat.reduce((m, s) => (s.startNs < m ? s.startNs : m), flat[0].startNs);
  const endMs = Math.max(...flat.map((s) => Number(s.startNs - t0) / 1e6 + s.durationMs));
  const spans: TraceSpan[] = flat
    .sort((a, b) => (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : 0))
    .map(({ startNs, events, ...s }) => ({
      ...s,
      offsetMs: Number(startNs - t0) / 1e6,
      events: events.map((e) => ({ name: e.name, offsetMs: Number(e.ns - t0) / 1e6, attributes: e.attributes })),
    }));
  return { traceId, start: Number(t0 / 1_000_000n), durationMs: endMs, spans, hidden: 0 };
}

export const TRACE_ID = /^[0-9a-f]{16,32}$/i;

export async function getTrace(o: ObservabilitySettings, traceId: string, signal?: AbortSignal): Promise<TraceDetail> {
  if (!TRACE_ID.test(traceId)) throw new TempoError("A trace id is 16 or 32 hexadecimal characters.", 400);
  return parseTrace(traceId.toLowerCase(), await tempoGet<RawTrace>(o, `/api/v2/traces/${traceId}`, {}, signal));
}

// ── tag values ──────────────────────────────────────

export async function tagValues(o: ObservabilitySettings, tag: string, query: string | undefined, since = "24h", signal?: AbortSignal): Promise<string[]> {
  const { start, end } = window(since);
  const r = await tempoGet<{ tagValues?: { value: string }[] }>(
    o, `/api/v2/search/tag/${encodeURIComponent(tag)}/values`, { ...(query ? { q: query } : {}), start, end }, signal,
  );
  return (r.tagValues ?? []).map((v) => v.value).filter(Boolean).sort();
}

// ── TraceQL metrics: requests, errors, latency per service ──

interface RawInstant { series?: { labels: Attr[]; value: number }[] }

/** What stats can be grouped by, and the TraceQL attribute for each. */
export const GROUP_ATTR: Record<TraceGroupBy, string> = {
  service: "resource.service.name",
  endpoint: "name",
  version: "resource.k8s.replicaset.name",
  pod: "resource.k8s.pod.name",
};

/** Series values keyed by the grouping label ("" for an ungrouped total); `p` picks one quantile. */
const byKey = (r: RawInstant, label: string | null, p?: string) => {
  const out = new Map<string, number>();
  for (const s of r.series ?? []) {
    const labels = attrMap(s.labels);
    const key = label ? labels[label] : "";
    if (key === undefined || (label && !key) || (p && labels.p !== p)) continue;
    out.set(key, s.value);
  }
  return out;
};

/** Tempo's refusal of a long metrics window ("… maximum allowed duration of 3h0m0s") → that maximum in seconds. */
export function metricsLimitSeconds(message: string): number | null {
  const m = /maximum allowed duration of ((?:\d+h)?(?:\d+m)?(?:\d+(?:\.\d+)?s)?)/.exec(message);
  if (!m || !m[1]) return null;
  const part = (unit: string) => Number(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}`).exec(m[1])?.[1] ?? 0);
  const seconds = part("h") * 3600 + part("m") * 60 + part("s");
  return seconds > 0 ? Math.floor(seconds) : null;
}

/** 10800 → "3h", 5400 → "90m" */
export const windowLabel = (seconds: number) => (seconds % 3600 === 0 ? `${seconds / 3600}h` : `${Math.round(seconds / 60)}m`);

/**
 * Request rate, error rate and p50/p95 latency in a scope, grouped (per service, endpoint, version or
 * pod), plus the scope's total. TraceQL metrics, Tempo 2.6+. Tempo caps how far back a metrics query
 * may look (3h by default); a longer window is shortened to that cap, and `since` says what was measured.
 */
export async function groupStats(
  o: ObservabilitySettings,
  scope: TraceScope,
  since: string,
  by: TraceGroupBy,
  signal?: AbortSignal,
): Promise<{ since: string; total: StatRow | null; rows: StatRow[] }> {
  const { end } = window(since);
  let seconds = sinceSeconds(since);
  const base = [...scopeConditions(scope), ENTRY_SPANS].join(" && ");
  const attr = GROUP_ATTR[by];
  const run = (s: number) => {
    const metric = (query: string) => tempoGet<RawInstant>(o, "/api/metrics/query", { q: query, start: end - s, end }, signal);
    const grouped = ` by (${attr})`;
    return Promise.all([
      metric(`{${base}} | rate()${grouped}`),
      metric(`{${base} && status=error} | rate()${grouped}`),
      metric(`{${base}} | quantile_over_time(duration, .5, .95)${grouped}`),
      metric(`{${base}} | rate()`),
      metric(`{${base} && status=error} | rate()`),
      metric(`{${base}} | quantile_over_time(duration, .5, .95)`),
    ]);
  };
  let r: RawInstant[];
  try {
    r = await run(seconds);
  } catch (err) {
    const cap = err instanceof TempoError ? metricsLimitSeconds(err.message) : null;
    if (!cap || cap >= seconds) throw err;
    seconds = cap;
    r = await run(seconds);
  }
  const ms = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : v * 1000);
  const rowsOf = (rate: RawInstant, errors: RawInstant, latency: RawInstant, label: string | null): StatRow[] => {
    const rates = byKey(rate, label);
    const errs = byKey(errors, label);
    const p50 = byKey(latency, label, "0.5");
    const p95 = byKey(latency, label, "0.95");
    return [...rates.keys()].map((key) => ({ key, rate: rates.get(key) ?? 0, errorRate: errs.get(key) ?? 0, p50Ms: ms(p50.get(key)), p95Ms: ms(p95.get(key)) }));
  };
  const rows = rowsOf(r[0], r[1], r[2], attr).sort((a, b) => b.errorRate - a.errorRate || b.rate - a.rate);
  const total = rowsOf(r[3], r[4], r[5], null)[0] ?? null;
  return { since: windowLabel(seconds), total, rows };
}

/** Stands for the trace id in `grafanaTraceUrl`; survives URL encoding unchanged. */
export const TRACE_ID_PLACEHOLDER = "__TRACE_ID__";

/** Grafana Explore opening one trace in the Tempo data source; null without a Grafana URL and data source. */
export function grafanaTraceUrl(o: ObservabilitySettings): string | null {
  if (!o.grafanaUrl || !o.grafanaTempoDatasource) return null;
  const ds = o.grafanaTempoDatasource;
  const panes = { a: { datasource: ds, queries: [{ refId: "A", datasource: { type: "tempo", uid: ds }, queryType: "traceql", query: TRACE_ID_PLACEHOLDER }], range: { from: "now-24h", to: "now" } } };
  return `${o.grafanaUrl.replace(/\/+$/, "")}/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}
