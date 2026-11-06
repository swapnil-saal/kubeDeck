import { stableIndex } from "@shared/logs";
import type { TraceSpan } from "@shared/traces";

/** 0.4ms, 35ms, 1.2s, 12s, 2m 5s */
export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** "12s ago", "5m ago", "3h ago", or a date for older. */
export function ago(epochMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - epochMs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(epochMs).toLocaleDateString();
}

export const clockTime = (epochMs: number) =>
  new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Requests per second as a short figure: 26/s, 0.4/s, 12/min, 3/h. */
export function fmtRate(perSecond: number): string {
  if (perSecond >= 10) return `${Math.round(perSecond)}/s`;
  if (perSecond >= 1) return `${perSecond.toFixed(1)}/s`;
  if (perSecond * 60 >= 1) return `${(perSecond * 60).toFixed(perSecond * 60 >= 10 ? 0 : 1)}/min`;
  if (perSecond > 0) return `${Math.max(1, Math.round(perSecond * 3600))}/h`;
  return "0";
}

/** Error share as a percentage with enough precision to tell 0.04% from 0. */
export function fmtPercent(part: number, whole: number): string {
  if (!whole || !part) return "0%";
  const p = (part / whole) * 100;
  return `${p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2)}%`;
}

/** A stable colour per service, readable on light and dark backgrounds. */
// no reds or near-reds: red only ever means a failure
const HUES = [212, 152, 268, 38, 186, 96, 248, 56, 292, 170, 200, 128];
export const serviceHue = (service: string) => HUES[stableIndex(service, HUES.length)];
export const serviceColor = (service: string) => `hsl(${serviceHue(service)} 62% 52%)`;

export interface TreeRow {
  span: TraceSpan;
  depth: number;
  childCount: number;
  /** every span below it, for collapsing */
  descendants: number;
}

/**
 * Spans in call order: each span followed by its children (by start time). A span whose parent is
 * missing (not received, or hidden) starts its own branch at the top level.
 */
export function spanTree(spans: TraceSpan[]): TreeRow[] {
  const ids = new Set(spans.map((s) => s.id));
  const children = new Map<string, TraceSpan[]>();
  for (const s of spans) {
    const parent = s.parentId && ids.has(s.parentId) && s.parentId !== s.id ? s.parentId : "";
    const list = children.get(parent);
    if (list) list.push(s);
    else children.set(parent, [s]);
  }
  for (const list of children.values()) list.sort((a, b) => a.offsetMs - b.offsetMs);
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number): number => {
    let total = 0;
    for (const s of children.get(parent) ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const row: TreeRow = { span: s, depth, childCount: children.get(s.id)?.length ?? 0, descendants: 0 };
      rows.push(row);
      row.descendants = walk(s.id, depth + 1);
      total += 1 + row.descendants;
    }
    return total;
  };
  walk("", 0);
  return rows;
}

/** The rows left visible when some spans are collapsed. */
export function visibleRows(rows: TreeRow[], collapsed: Set<string>): TreeRow[] {
  const out: TreeRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    out.push(rows[i]);
    if (collapsed.has(rows[i].span.id)) i += rows[i].descendants;
  }
  return out;
}

/** What a span did, in a few words: "GET /users → 200", "mongodb find", "kafka topic-x". */
export function spanSummary(s: TraceSpan): string {
  const a = s.attributes;
  const method = a["http.request.method"] || a["http.method"];
  const status = a["http.response.status_code"] || a["http.status_code"];
  const target = a["url.path"] || a["http.route"] || a["http.target"] || a["url.full"];
  if (method && (target || status)) return [method, target, status ? `→ ${status}` : ""].filter(Boolean).join(" ");
  const db = a["db.system.name"] || a["db.system"];
  if (db) return [db, a["db.operation.name"] || a["db.operation"], a["db.collection.name"] || a["db.mongodb.collection"]].filter(Boolean).join(" ");
  const topic = a["messaging.destination.name"];
  if (topic) return [a["messaging.system"], topic].filter(Boolean).join(" ");
  return "";
}

/** Grafana's link for one trace, from the server's template. */
export const grafanaLink = (template: string | null | undefined, traceId: string) =>
  template ? template.replace("__TRACE_ID__", traceId) : null;
