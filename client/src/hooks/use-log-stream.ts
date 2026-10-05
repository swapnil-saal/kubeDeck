import { useCallback, useEffect, useRef, useState } from "react";
import { parseEntry, sortByTime, type LogEntry } from "@shared/logs";

export type LogKind = "pod" | "deployment" | "statefulset" | "daemonset" | "replicaset" | "job" | "service";

export interface LogSource {
  kind: LogKind;
  name: string;
  context: string;
  namespace: string;
}

export interface LogPod {
  name: string;
  containers: string[];
  status: string;
  ready: string;
  restarts: number;
  created: number;
}

export interface StreamSettings {
  tail: number;
  /** e.g. "15m"; undefined = no time limit */
  since?: string;
  previous: boolean;
  follow: boolean;
}

export type StreamStatus = "idle" | "connecting" | "live" | "ended" | "error";

/** Hard cap kept in the browser; older lines fall off the front. */
export const MAX_ENTRIES = 20_000;
const FLUSH_MS = 150;
const MAX_NOTES = 20;

export interface StreamError { message: string; reason?: string }

/** Merges a batch into the list, re-sorting by time only when the batch is older than what we have. */
export function mergeBatch(prev: LogEntry[], batch: LogEntry[]): LogEntry[] {
  if (batch.length === 0) return prev;
  const last = prev.length > 0 ? prev[prev.length - 1].ts : undefined;
  const firstNew = Math.min(...batch.map((e) => e.ts ?? Infinity));
  let all = prev.concat(batch);
  if (last !== undefined && firstNew < last) all = sortByTime(all);
  else if (prev.length === 0) all = sortByTime(all);
  return all.length > MAX_ENTRIES ? all.slice(all.length - MAX_ENTRIES) : all;
}

/**
 * One SSE connection carrying every pod/container of a pod, workload or service. Lines are buffered
 * and flushed every 150 ms (a busy service would otherwise re-render the page on every line) and
 * kept in timestamp order across pods.
 */
export function useLogStream(source: LogSource, settings: StreamSettings, enabled = true) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [pods, setPods] = useState<LogPod[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<StreamError | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  const reconnect = useCallback(() => setNonce((n) => n + 1), []);
  const clear = useCallback(() => setEntries([]), []);

  useEffect(() => {
    if (!enabled || !source.name) {
      setStatus("idle");
      return;
    }
    setEntries([]);
    setPods([]);
    setSkipped([]);
    setNotes([]);
    setError(null);
    setStatus("connecting");
    seq.current = 0;

    const params = new URLSearchParams({
      kind: source.kind,
      name: source.name,
      context: source.context,
      namespace: source.namespace,
      tail: String(settings.tail),
      previous: settings.previous ? "1" : "0",
      follow: settings.follow ? "1" : "0",
    });
    if (settings.since) params.set("since", settings.since);

    const buffer: LogEntry[] = [];
    let ended = false;
    const es = new EventSource(`/api/k8s/logs/stream?${params.toString()}`);

    const flush = () => {
      if (buffer.length === 0) return;
      const batch = buffer.splice(0, buffer.length);
      setEntries((prev) => mergeBatch(prev, batch));
    };
    const timer = setInterval(flush, FLUSH_MS);

    es.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case "meta":
          setPods(m.pods ?? []);
          setSkipped(m.skipped ?? []);
          setStatus(settings.follow ? "live" : "connecting");
          break;
        case "pods":
          setPods(m.pods ?? []);
          break;
        case "line":
          buffer.push(parseEntry(m.l, seq.current++, m.p, m.c));
          break;
        case "err":
          if (m.reason) setError({ message: m.m, reason: m.reason });
          else setNotes((n) => [...n, `${m.p ? `${m.p}: ` : ""}${m.m}`].slice(-MAX_NOTES));
          break;
        case "end":
          ended = true;
          flush();
          setStatus((s) => (s === "error" ? s : "ended"));
          es.close();
          break;
      }
    };
    es.onerror = () => {
      es.close();
      if (ended) return;
      flush();
      setStatus("error");
      setError((e) => e ?? { message: "The connection to KubeDeck was lost." });
    };

    return () => {
      clearInterval(timer);
      es.close();
    };
  }, [source.kind, source.name, source.context, source.namespace, settings.tail, settings.since, settings.previous, settings.follow, enabled, nonce]);

  return { entries, pods, skipped, status, error, notes, reconnect, clear };
}
