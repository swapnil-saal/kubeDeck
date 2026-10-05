import { spawn } from "child_process";
import { parseEntry, sortByTime, type LogEntry } from "@shared/logs";
import { getKubeconfigEnv } from "./settings";
import { logArgs, planStreams, podTarget, selectorFor, type LogKind, type PodTarget } from "./log-stream";

/** `kubectl get … -o json` as the callers need it: Forbidden mapped to `_forbidden`, not-found to an empty object. */
export type GetJson = (command: string) => Promise<any>;

export type Resolved =
  | { ok: true; pods: PodTarget[]; selector: string | null }
  | { ok: false; reason: "forbidden" | "not-found" | "no-selector" | "error"; message: string };

/** Which pods (and containers) belong to a pod, workload or service. */
export async function resolveTargets(getJson: GetJson, kind: LogKind, name: string, context: string, namespace: string): Promise<Resolved> {
  const ctx = context ? `--context=${context}` : "";
  const ns = namespace && namespace !== "all" ? `-n ${namespace}` : "";
  try {
    const obj = await getJson(`get ${kind} ${name} ${ctx} ${ns}`);
    if (obj._forbidden) return { ok: false, reason: "forbidden", message: `You don't have permission to read ${kind}/${name}.` };
    if (!obj.metadata) return { ok: false, reason: "not-found", message: `${kind}/${name} was not found.` };
    if (kind === "pod") return { ok: true, pods: [podTarget(obj)], selector: null };

    const selector = selectorFor(kind, obj);
    if (!selector) return { ok: false, reason: "no-selector", message: `${kind}/${name} has no pod selector, so there are no pods to read logs from.` };
    const list = await getJson(`get pods ${ctx} ${ns} -l ${selector}`);
    if (list._forbidden) return { ok: false, reason: "forbidden", message: "You don't have permission to list pods here." };
    return { ok: true, pods: (list.items ?? []).map(podTarget), selector };
  } catch (err) {
    return { ok: false, reason: "error", message: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}

const MAX_OUTPUT_BYTES = 2_000_000;
const READ_TIMEOUT_MS = 30_000;
const CONCURRENCY = 8;

/** Self-contained `kubectl get -o json` (for callers that are not inside routes.ts). */
export const kubectlJson: GetJson = (command) =>
  new Promise((resolve, reject) => {
    const args = command.trim().split(/\s+/).concat("-o", "json", "--request-timeout=20s");
    const proc = spawn("kubectl", args, { env: { ...process.env, ...getKubeconfigEnv() } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (b: Buffer) => out.push(b));
    proc.stderr.on("data", (b: Buffer) => err.push(b));
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      const stderr = Buffer.concat(err).toString("utf8");
      if (code !== 0) {
        if (/forbidden/i.test(stderr)) return resolve({ items: [], _forbidden: true });
        if (/not found/i.test(stderr)) return resolve({ items: [] });
        return reject(new Error(stderr.slice(0, 300) || `kubectl exited with ${code}`));
      }
      try { resolve(JSON.parse(Buffer.concat(out).toString("utf8"))); } catch { reject(new Error("Failed to parse kubectl output")); }
    });
  });

export interface FetchLogsOptions {
  kind: LogKind;
  name: string;
  context: string;
  namespace: string;
  /** lines per container */
  tail: number;
  since?: string;
  previous?: boolean;
  container?: string;
  pods?: string[];
  signal?: AbortSignal;
}

export type FetchLogsResult =
  | { ok: true; entries: LogEntry[]; pods: PodTarget[]; skippedPods: string[]; notes: string[] }
  | { ok: false; reason: Extract<Resolved, { ok: false }>["reason"]; message: string };

function readOne(pod: string, container: string, o: FetchLogsOptions): Promise<{ lines: string[]; note?: string }> {
  return new Promise((resolve) => {
    if (o.signal?.aborted) return resolve({ lines: [] });
    const args = logArgs(pod, container, { tail: o.tail, since: o.since, previous: !!o.previous, follow: false }, { context: o.context, namespace: o.namespace });
    const proc = spawn("kubectl", args, { env: { ...process.env, ...getKubeconfigEnv() } });
    const out: Buffer[] = [];
    let size = 0;
    let stderr = "";
    const kill = () => proc.kill("SIGTERM");
    const timer = setTimeout(kill, READ_TIMEOUT_MS);
    o.signal?.addEventListener("abort", kill, { once: true });
    proc.stdout.on("data", (b: Buffer) => { size += b.length; if (size <= MAX_OUTPUT_BYTES) out.push(b); });
    proc.stderr.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });
    proc.on("error", (e) => { clearTimeout(timer); resolve({ lines: [], note: `${pod}/${container}: ${e.message}` }); });
    proc.on("close", () => {
      clearTimeout(timer);
      const lines = Buffer.concat(out).toString("utf8").split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
      resolve({ lines, note: stderr.trim() ? `${pod}/${container}: ${stderr.trim().split("\n")[0].slice(0, 200)}` : undefined });
    });
  });
}

/** Reads the current logs of every selected pod/container (no follow) and merges them in time order. */
export async function fetchLogs(o: FetchLogsOptions, getJson: GetJson = kubectlJson): Promise<FetchLogsResult> {
  const r = await resolveTargets(getJson, o.kind, o.name, o.context, o.namespace);
  if (!r.ok) return r;
  const plan = planStreams(r.pods, { pods: o.pods, container: o.container });

  const results: { pod: string; container: string; lines: string[]; note?: string }[] = new Array(plan.streams.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plan.streams.length) }, async () => {
    while (next < plan.streams.length) {
      const i = next++;
      const s = plan.streams[i];
      results[i] = { ...s, ...(await readOne(s.pod, s.container, o)) };
    }
  }));

  let id = 0;
  const entries: LogEntry[] = [];
  const notes: string[] = [];
  for (const res of results) {
    if (!res) continue;
    if (res.note) notes.push(res.note);
    for (const line of res.lines) entries.push(parseEntry(line, id++, res.pod, res.container));
  }
  return { ok: true, entries: sortByTime(entries), pods: r.pods, skippedPods: plan.skippedPods, notes };
}
