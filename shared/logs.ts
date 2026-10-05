/**
 * The log engine: turns raw `kubectl logs --timestamps` lines into structured entries, filters them
 * with a small grep-style query language, and finds the noise (health checks, probes…) that buries
 * the lines you are actually debugging. Pure functions — no React, no network.
 */

export type Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "unknown";

export const LEVEL_ORDER: Level[] = ["fatal", "error", "warn", "info", "debug", "trace", "unknown"];

export interface LogEntry {
  /** monotonically increasing, stable React key */
  id: number;
  /** the line as received, without the kubectl timestamp */
  raw: string;
  /** lower-cased `raw`, for case-insensitive matching */
  lower: string;
  /** pod this line came from (multi-pod views) */
  source?: string;
  container?: string;
  /** epoch ms: kubectl's timestamp, else the JSON log's own time */
  ts?: number;
  level: Level;
  /** best-effort human message (JSON `msg`/`message`, else the raw text) */
  message: string;
  /** structured fields of a JSON / logfmt line, minus time/level/message */
  fields?: Record<string, unknown>;
  format: "json" | "logfmt" | "klog" | "text";
}

// ── parsing ───────────────────────────────────────────────────────────────

const TS_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s?([\s\S]*)$/;

/** Splits the RFC3339 timestamp `kubectl logs --timestamps` puts in front of every line. */
export function splitTimestamp(line: string): { ts?: number; rest: string } {
  const m = line.match(TS_PREFIX);
  if (!m) return { rest: line };
  const ts = Date.parse(m[1]);
  return Number.isFinite(ts) ? { ts, rest: m[2] } : { rest: line };
}

const LEVEL_WORDS: Record<string, Level> = {
  fatal: "fatal", panic: "fatal", emerg: "fatal", alert: "fatal", crit: "fatal", critical: "fatal",
  error: "error", err: "error", severe: "error",
  warn: "warn", warning: "warn",
  info: "info", notice: "info", information: "info",
  debug: "debug", dbg: "debug",
  trace: "trace", verbose: "trace",
};

function levelFromValue(v: unknown): Level | undefined {
  if (typeof v === "number") {
    // pino / bunyan: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal
    if (v >= 60) return "fatal";
    if (v >= 50) return "error";
    if (v >= 40) return "warn";
    if (v >= 30) return "info";
    if (v >= 20) return "debug";
    if (v >= 10) return "trace";
    return undefined;
  }
  if (typeof v === "string") return LEVEL_WORDS[v.trim().toLowerCase()];
  return undefined;
}

/**
 * Level of an unstructured line. Only upper-case level tokens and a few unmistakable forms count,
 * so prose like "0 failed" or "error handling enabled" is not mistaken for an error.
 */
function levelFromText(text: string): Level {
  if (/\b(FATAL|PANIC|CRITICAL)\b|^panic:/.test(text)) return "fatal";
  if (/\b(ERROR|ERR)\b|\bError:|\bException\b|Traceback \(most recent/.test(text)) return "error";
  if (/\bWARN(ING)?\b|\bWarning:/.test(text)) return "warn";
  if (/\bINFO\b/.test(text)) return "info";
  if (/\bDEBUG\b/.test(text)) return "debug";
  if (/\bTRACE\b/.test(text)) return "trace";
  return "unknown";
}

const KLOG = /^([IWEF])\d{4}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+\d+\s+\S+:\d+\]\s*(.*)$/;
const KLOG_LEVEL: Record<string, Level> = { I: "info", W: "warn", E: "error", F: "fatal" };

const LOGFMT_PAIR = /([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|\S*)/g;

function parseLogfmt(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let n = 0;
  let consumed = 0;
  for (const m of text.matchAll(LOGFMT_PAIR)) {
    n++;
    consumed += m[0].length;
    out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1).replace(/\\"/g, '"') : m[2];
  }
  // Prose that happens to contain `a=b` is not logfmt: need several pairs covering most of the line.
  return n >= 3 && consumed / Math.max(text.length, 1) > 0.5 ? out : null;
}

const TIME_KEYS = ["time", "timestamp", "ts", "@timestamp", "t", "date"];
const LEVEL_KEYS = ["level", "severity", "lvl", "levelname", "loglevel"];
const MSG_KEYS = ["message", "msg", "log", "text", "event"];

function pick(obj: Record<string, unknown>, keys: string[]): { key?: string; value?: unknown } {
  for (const k of keys) if (k in obj && obj[k] !== undefined && obj[k] !== null) return { key: k, value: obj[k] };
  return {};
}

function parseTimeValue(v: unknown): number | undefined {
  if (typeof v === "number") return v > 1e12 ? v : v > 1e9 ? v * 1000 : undefined; // epoch ms or s
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

/** Turns one line (as sent by the server) into a structured entry. */
export function parseEntry(line: string, id: number, source?: string, container?: string): LogEntry {
  const { ts: kubectlTs, rest } = splitTimestamp(line);
  const trimmed = rest.trim();
  let level: Level = "unknown";
  let message = rest;
  let fields: Record<string, unknown> | undefined;
  let format: LogEntry["format"] = "text";
  let ts = kubectlTs;

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        format = "json";
        const lv = pick(obj, LEVEL_KEYS);
        const mg = pick(obj, MSG_KEYS);
        const tm = pick(obj, TIME_KEYS);
        level = levelFromValue(lv.value) ?? levelFromText(trimmed);
        message = mg.value !== undefined ? (typeof mg.value === "string" ? mg.value : JSON.stringify(mg.value)) : trimmed;
        ts = ts ?? parseTimeValue(tm.value);
        const skip = new Set([lv.key, mg.key, tm.key].filter(Boolean) as string[]);
        fields = {};
        for (const [k, v] of Object.entries(obj)) if (!skip.has(k)) fields[k] = v;
      }
    } catch { /* not JSON after all — fall through to text */ }
  }

  if (format === "text") {
    const klog = trimmed.match(KLOG);
    if (klog) {
      format = "klog";
      level = KLOG_LEVEL[klog[1]];
      message = klog[2];
    } else {
      const kv = parseLogfmt(trimmed);
      if (kv) {
        format = "logfmt";
        const lv = pick(kv, LEVEL_KEYS);
        const mg = pick(kv, MSG_KEYS);
        const tm = pick(kv, TIME_KEYS);
        level = levelFromValue(lv.value) ?? levelFromText(trimmed);
        message = mg.value !== undefined ? String(mg.value) : trimmed;
        ts = ts ?? parseTimeValue(tm.value);
        const skip = new Set([lv.key, mg.key, tm.key].filter(Boolean) as string[]);
        fields = {};
        for (const [k, v] of Object.entries(kv)) if (!skip.has(k)) fields[k] = v;
      } else {
        level = levelFromText(trimmed);
      }
    }
  }

  return { id, raw: rest, lower: rest.toLowerCase(), source, container, ts, level, message, fields, format };
}

// ── query language ────────────────────────────────────────────────────────

type Matcher = (e: LogEntry) => boolean;

export interface QueryOptions {
  /** treat bare terms as regular expressions */
  regex: boolean;
  caseSensitive: boolean;
}

export interface ParsedQuery {
  /** every one must match (AND) */
  must: Matcher[];
  /** none may match */
  mustNot: Matcher[];
  levels: Set<Level> | null;
  pods: string[];
  /** set when a regex did not compile — the query then matches nothing rather than everything */
  error?: string;
  empty: boolean;
}

/** Splits on whitespace, keeping "quoted phrases" and /regex literals/ together. */
export function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(?:[-!]?\/(?:\\\/|[^/])+\/[gimsuy]*|[-!]?"[^"]*"|[^\s"]+(?:"[^"]*")?)/g;
  for (const m of q.matchAll(re)) out.push(m[0]);
  return out;
}

function matcherFor(term: string, opts: QueryOptions): Matcher | { error: string } {
  // /regex/flags
  const lit = term.match(/^\/((?:\\\/|[^/])+)\/([gimsuy]*)$/);
  if (lit) {
    try {
      const re = new RegExp(lit[1], lit[2].replace("g", ""));
      return (e) => re.test(e.raw);
    } catch (err) {
      return { error: (err as Error).message };
    }
  }
  if (opts.regex) {
    try {
      const re = new RegExp(term, opts.caseSensitive ? "" : "i");
      return (e) => re.test(e.raw);
    } catch (err) {
      return { error: (err as Error).message };
    }
  }
  if (opts.caseSensitive) return (e) => e.raw.includes(term);
  const lower = term.toLowerCase();
  return (e) => e.lower.includes(lower);
}

const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s);

/**
 * Grep-style query: terms are ANDed. `-term` excludes. `"a phrase"`, `/regex/i`, `level:error,warn`,
 * `pod:suffix`. Example: `timeout -healthcheck level:error,warn`.
 */
export function parseQuery(q: string, opts: QueryOptions): ParsedQuery {
  const parsed: ParsedQuery = { must: [], mustNot: [], levels: null, pods: [], empty: true };
  for (const raw of tokenize(q.trim())) {
    parsed.empty = false;
    const neg = /^[-!]./.test(raw) && !/^-\d/.test(raw);
    const body = neg ? raw.slice(1) : raw;

    const lv = !neg ? body.match(/^level:(.+)$/i) : null;
    if (lv) {
      const set = new Set<Level>();
      for (const part of lv[1].split(/[,|]/)) {
        const l = levelFromValue(part);
        if (l) set.add(l);
      }
      if (set.size > 0) {
        if (set.has("error")) set.add("fatal");
        parsed.levels = new Set([...(parsed.levels ?? []), ...set]);
        continue;
      }
    }
    const pod = !neg ? body.match(/^(?:pod|source):(.+)$/i) : null;
    if (pod) {
      parsed.pods.push(pod[1].toLowerCase());
      continue;
    }

    const m = matcherFor(unquote(body), opts);
    if (typeof m !== "function") {
      parsed.error = m.error;
      continue;
    }
    (neg ? parsed.mustNot : parsed.must).push(m);
  }
  return parsed;
}

/** One pattern from the always-hide list: plain text (case-insensitive) or /regex/. */
export function compileExclude(pattern: string): Matcher | null {
  const p = pattern.trim();
  if (!p) return null;
  const m = matcherFor(p, { regex: false, caseSensitive: false });
  return typeof m === "function" ? m : null;
}

export interface ViewFilter {
  query: ParsedQuery;
  exclude: Matcher[];
  /** level chips; null = all */
  levels: Set<Level> | null;
  /** pod selection; null = all */
  sources: Set<string> | null;
  /** container selection; null = all */
  containers?: Set<string> | null;
  /** lines of surrounding context kept around each match */
  context: number;
}

export type LogRow = { kind: "entry"; entry: LogEntry; match: boolean } | { kind: "gap"; hidden: number; id: string };

export interface FilterResult {
  rows: LogRow[];
  /** lines that matched the query */
  matches: number;
  /** lines hidden by the always-hide patterns */
  hiddenByExclude: number;
  /** after exclude / level / pod filters, before the query — what the level chips count */
  base: LogEntry[];
}

export function applyFilter(entries: LogEntry[], f: ViewFilter): FilterResult {
  const lvl = f.levels ?? f.query.levels;
  const podTerms = f.query.pods;
  let hiddenByExclude = 0;
  const base: LogEntry[] = [];
  for (const e of entries) {
    if (f.sources && e.source && !f.sources.has(e.source)) continue;
    if (f.containers && e.container && !f.containers.has(e.container)) continue;
    if (podTerms.length > 0 && !podTerms.some((t) => (e.source ?? "").toLowerCase().includes(t))) continue;
    if (f.exclude.some((m) => m(e))) { hiddenByExclude++; continue; }
    base.push(e);
  }

  const queryActive = !f.query.empty && !f.query.error;
  const matched: boolean[] = base.map((e) => {
    if (f.query.error) return false;
    if (lvl && !lvl.has(e.level)) return false;
    return f.query.must.every((m) => m(e)) && !f.query.mustNot.some((m) => m(e));
  });
  const matches = matched.filter(Boolean).length;

  const filtering = queryActive || lvl !== null || !!f.query.error;
  if (!filtering) {
    return { rows: base.map((entry) => ({ kind: "entry", entry, match: false })), matches: base.length, hiddenByExclude, base };
  }

  // Keep matches plus `context` lines around each, with a marker where lines were skipped.
  const keep = new Array<boolean>(base.length).fill(false);
  for (let i = 0; i < base.length; i++) {
    if (!matched[i]) continue;
    for (let j = Math.max(0, i - f.context); j <= Math.min(base.length - 1, i + f.context); j++) keep[j] = true;
  }
  const rows: LogRow[] = [];
  let skipped = 0;
  for (let i = 0; i < base.length; i++) {
    if (keep[i]) {
      if (skipped > 0 && f.context > 0 && rows.length > 0) rows.push({ kind: "gap", hidden: skipped, id: `gap-${base[i].id}` });
      skipped = 0;
      rows.push({ kind: "entry", entry: base[i], match: matched[i] });
    } else skipped++;
  }
  return { rows, matches, hiddenByExclude, base };
}

export function countLevels(entries: LogEntry[]): Record<Level, number> {
  const c: Record<Level, number> = { fatal: 0, error: 0, warn: 0, info: 0, debug: 0, trace: 0, unknown: 0 };
  for (const e of entries) c[e.level]++;
  return c;
}

// ── noise ─────────────────────────────────────────────────────────────────

const PROBE_WORDS = /health(?:z|check|-check)?|readyz|livez|\/ready\b|\/live\b|\/ping\b|kube-probe|\/metrics\b|\/status\b|\/favicon\.ico|heartbeat|keep-?alive/i;
const PATH_KEYS = ["path", "url", "uri", "endpoint", "route", "request_uri", "request", "target", "http.target"];

/** Values like `/healthcheck` inside a JSON/logfmt field, or a probe word anywhere in the line. */
function noiseKey(e: LogEntry): string | null {
  if (e.fields) {
    for (const k of PATH_KEYS) {
      const v = e.fields[k];
      if (typeof v === "string" && PROBE_WORDS.test(v)) return v.split("?")[0];
    }
  }
  const m = e.raw.match(PROBE_WORDS);
  return m ? m[0] : null;
}

/** Strips the parts of a line that change every time (ids, numbers, times) so repeats collapse. */
export function signature(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<t>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/"(?:requestId|request_id|traceId|trace_id|spanId|id)":"[^"]*"/g, '"$1":"<id>"')
    .replace(/\b[A-Za-z0-9_-]{16,}\b/g, "<id>")
    // digits glued to a unit ("5000ms") count too, so no \b; but keep digits inside words ("abc123")
    .replace(/(?<![A-Za-z_])\d+(?:\.\d+)?/g, "<n>");
}

export interface NoiseSuggestion {
  /** what to put in the always-hide list (plain text, or a /regex/) */
  pattern: string;
  count: number;
  pct: number;
  sample: string;
  /** a known probe/health pattern (as opposed to just "repeats a lot") */
  probe: boolean;
}

const escapeRegExp = (t: string) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * A hide-pattern for a message that repeats with only ids/numbers/times changing: the message itself
 * when it has none, otherwise a /regex/ with those parts as wildcards.
 */
export function templatePattern(message: string, raw: string): string {
  const msg = message.trim().length > 0 && message.length <= 200 ? message.trim() : raw.slice(0, 120);
  const sig = signature(msg);
  if (sig === msg) return msg.length > 80 ? msg.slice(0, 80) : msg;
  const re = escapeRegExp(sig).replace(/<t>/g, "\\S+").replace(/<id>/g, "\\S+").replace(/<n>/g, "[\\d.]+");
  return `/${re}/`;
}

/**
 * The lines that repeat the most. Probe-like traffic (`/healthcheck`, `/healthz`, kube-probe…) is
 * grouped by what it hits, so "Request received" and "Request served" for the same path count as one.
 * Anything else is only suggested when the *whole line* repeats (ids/times aside), and never with a
 * pattern that would also hide lines outside the group — hiding "Request served" because one endpoint
 * is polled would hide real traffic.
 */
export function detectNoise(entries: LogEntry[], opts: { minCount?: number; minPct?: number; max?: number } = {}): NoiseSuggestion[] {
  const { minCount = 8, minPct = 0.05, max = 3 } = opts;
  if (entries.length < minCount) return [];
  const groups = new Map<string, { count: number; sample: LogEntry; probe: string | null }>();
  for (const e of entries) {
    const probe = noiseKey(e);
    const key = probe !== null ? `p:${probe}` : `r:${signature(e.raw)}`;
    const g = groups.get(key) ?? { count: 0, sample: e, probe };
    g.count++;
    groups.set(key, g);
  }
  const out: NoiseSuggestion[] = [];
  const ranked = Array.from(groups.values())
    .filter((g) => g.count >= minCount && g.count / entries.length >= minPct)
    .sort((a, b) => b.count - a.count);
  for (const g of ranked) {
    const pattern = g.probe !== null ? g.probe : templatePattern(g.sample.message, g.sample.raw);
    const matcher = compileExclude(pattern);
    if (!matcher) continue;
    const reach = entries.reduce((n, e) => n + (matcher(e) ? 1 : 0), 0);
    if (reach > g.count * 1.2 + 2) continue; // would hide more than what repeats
    out.push({ pattern, count: reach, pct: reach / entries.length, sample: g.sample.raw, probe: g.probe !== null });
    if (out.length >= max) break;
  }
  return out;
}

export interface TopMessage { signature: string; sample: string; count: number; level: Level }

/** The most frequent error/warn messages — what is actually going wrong, grouped. */
export function topProblems(entries: LogEntry[], max = 5): TopMessage[] {
  const groups = new Map<string, TopMessage>();
  for (const e of entries) {
    if (e.level !== "error" && e.level !== "fatal" && e.level !== "warn") continue;
    const sig = signature(e.message);
    const g = groups.get(sig) ?? { signature: sig, sample: e.message, count: 0, level: e.level };
    g.count++;
    if (e.level === "error" || e.level === "fatal") g.level = e.level;
    groups.set(sig, g);
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count).slice(0, max);
}

// ── multi-pod helpers ─────────────────────────────────────────────────────

/** `e2-admin-module-dd8c44c74-pgz4r` -> `dd8c44c74-pgz4r` (the part that tells replicas apart). */
export function shortPod(pod: string, workload?: string): string {
  if (workload && pod.startsWith(workload + "-")) return pod.slice(workload.length + 1);
  const parts = pod.split("-");
  return parts.length > 2 ? parts.slice(-2).join("-") : pod;
}

/**
 * Short, distinguishing label per pod: the part of the name left once what every pod shares is
 * removed (`web-5584d999b5-9wvpw` + `web-5584d999b5-g8jxg` -> `9wvpw` / `g8jxg`).
 */
export function podLabels(pods: string[], workload?: string): Map<string, string> {
  const out = new Map<string, string>();
  const tails = pods.map((p) => (workload && p.startsWith(workload + "-") ? p.slice(workload.length + 1) : p));
  if (pods.length <= 1) {
    pods.forEach((p) => out.set(p, shortPod(p, workload)));
    return out;
  }
  const segs = tails.map((t) => t.split("-"));
  const max = Math.min(...segs.map((x) => x.length)) - 1; // always keep the last segment
  let k = 0;
  while (k < max && segs.every((x) => x[k] === segs[0][k])) k++;
  pods.forEach((p, i) => out.set(p, segs[i].slice(k).join("-") || shortPod(p, workload)));
  return out;
}

const POD_COLORS = [
  "text-sky-500", "text-violet-500", "text-amber-500", "text-emerald-500",
  "text-rose-500", "text-cyan-500", "text-fuchsia-500", "text-lime-500",
] as const;

export function podColor(pod: string): string {
  let h = 0;
  for (let i = 0; i < pod.length; i++) h = (h * 31 + pod.charCodeAt(i)) >>> 0;
  return POD_COLORS[h % POD_COLORS.length];
}

/** Oldest first; entries without a timestamp keep their arrival order relative to each other. */
export function sortByTime(entries: LogEntry[]): LogEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.ts ?? Infinity) - (b.e.ts ?? Infinity) || a.i - b.i)
    .map((x) => x.e);
}

export function formatTime(ts?: number): string {
  if (ts === undefined) return "";
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Splits `text` into [before, match, after] chunks for highlighting every query term. */
export function highlightRanges(text: string, terms: RegExp | null): { text: string; hit: boolean }[] {
  if (!terms) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(terms)) {
    if (m.index === undefined || m[0].length === 0) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}

/** One regex that matches any of the positive plain/regex terms, for highlighting. */
export function highlightRegex(q: string, opts: QueryOptions): RegExp | null {
  const parts: string[] = [];
  for (const raw of tokenize(q.trim())) {
    if (/^[-!]./.test(raw) && !/^-\d/.test(raw)) continue;
    if (/^(level|pod|source):/i.test(raw)) continue;
    const body = unquote(raw);
    const lit = body.match(/^\/((?:\\\/|[^/])+)\/[gimsuy]*$/);
    if (lit) parts.push(lit[1]);
    else if (opts.regex) parts.push(body);
    else parts.push(body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  if (parts.length === 0) return null;
  try {
    return new RegExp(parts.join("|"), opts.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}
