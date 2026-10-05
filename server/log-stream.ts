/** Pure helpers for the multi-pod log endpoints (no I/O, so they can be unit-tested). */

export type LogKind = "pod" | "deployment" | "statefulset" | "daemonset" | "replicaset" | "job" | "service";

export const LOG_KINDS: LogKind[] = ["pod", "deployment", "statefulset", "daemonset", "replicaset", "job", "service"];

/** `k=v,k2=v2` label selector for the pods behind a workload or service, or null when there is none. */
export function selectorFor(kind: LogKind, obj: any): string | null {
  if (kind === "pod") return null;
  let labels: Record<string, string> | undefined;
  if (kind === "service") labels = obj?.spec?.selector;
  else if (kind === "job") labels = obj?.spec?.selector?.matchLabels ?? (obj?.metadata?.name ? { "job-name": obj.metadata.name } : undefined);
  else labels = obj?.spec?.selector?.matchLabels;
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}=${v}`).join(",");
}

export interface PodTarget {
  name: string;
  containers: string[];
  status: string;
  ready: string;
  restarts: number;
  /** epoch ms, for newest-first ordering when there are more pods than we stream */
  created: number;
}

/** What the UI needs to know about a pod: where its logs are and whether it is healthy. */
export function podTarget(item: any): PodTarget {
  const cs = item?.status?.containerStatuses ?? [];
  let status: string = item?.status?.phase ?? "Unknown";
  for (const c of cs) {
    if (c.state?.waiting?.reason) { status = c.state.waiting.reason; break; }
    if (c.state?.terminated?.reason && status === "Running") { status = c.state.terminated.reason; break; }
  }
  const containers: string[] = (item?.spec?.containers ?? []).map((c: any) => c.name).filter(Boolean);
  return {
    name: item?.metadata?.name ?? "unknown",
    containers,
    status,
    ready: `${cs.filter((c: any) => c.ready).length}/${containers.length}`,
    restarts: cs.reduce((n: number, c: any) => n + (c.restartCount || 0), 0),
    created: Date.parse(item?.metadata?.creationTimestamp ?? "") || 0,
  };
}

/** Splits a byte stream into lines, holding back a trailing partial line until it is complete. */
export class LineSplitter {
  private rest = "";
  push(chunk: string): string[] {
    const text = this.rest + chunk;
    const parts = text.split("\n");
    this.rest = parts.pop() ?? "";
    return parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)).filter((l) => l.length > 0);
  }
  flush(): string[] {
    const last = this.rest.replace(/\r$/, "");
    this.rest = "";
    return last ? [last] : [];
  }
}

export interface StreamOptions {
  tail: number;
  since?: string;
  previous: boolean;
  follow: boolean;
}

const MAX_TAIL = 5000;

/** Query string -> safe stream options (the values are validated again at the edge). */
export function parseStreamOptions(q: Record<string, unknown>): StreamOptions {
  const flag = (v: unknown, dflt: boolean) => (v === undefined ? dflt : v === "1" || v === "true");
  const tailRaw = Number(q.tail);
  const tail = Number.isFinite(tailRaw) && tailRaw > 0 ? Math.min(Math.floor(tailRaw), MAX_TAIL) : 200;
  const previous = flag(q.previous, false);
  return {
    tail,
    since: typeof q.since === "string" && /^\d{1,4}[smhd]$/.test(q.since) ? q.since : undefined,
    previous,
    // a terminated container's previous logs cannot be followed
    follow: previous ? false : flag(q.follow, true),
  };
}

/** `kubectl logs` argument list for one container (an array — never a shell string). */
export function logArgs(
  pod: string, container: string, opts: StreamOptions,
  ctx: { context?: string; namespace?: string }, tailOverride?: number,
): string[] {
  const args = ["logs", pod, "-c", container, "--timestamps", `--tail=${tailOverride ?? opts.tail}`];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.previous) args.push("--previous");
  if (opts.follow) args.push("-f");
  if (ctx.context) args.push(`--context=${ctx.context}`);
  if (ctx.namespace) args.push("-n", ctx.namespace);
  return args;
}

/** Hard ceilings so a 200-pod workload cannot start 200 kubectl processes. */
export const MAX_PODS = 12;
export const MAX_STREAMS = 24;

export interface StreamPlan {
  streams: { pod: string; container: string }[];
  /** pods dropped to stay under the limits */
  skippedPods: string[];
}

/** Which (pod, container) pairs to stream: newest pods first, restricted to the user's picks. */
export function planStreams(pods: PodTarget[], pick?: { pods?: string[]; container?: string }): StreamPlan {
  let list = [...pods].sort((a, b) => b.created - a.created);
  if (pick?.pods && pick.pods.length > 0) list = list.filter((p) => pick.pods!.includes(p.name));
  const streams: StreamPlan["streams"] = [];
  const skippedPods: string[] = [];
  let podCount = 0;
  for (const p of list) {
    const containers = pick?.container ? p.containers.filter((c) => c === pick.container) : p.containers;
    if (containers.length === 0) continue;
    if (podCount >= MAX_PODS || streams.length + containers.length > MAX_STREAMS) { skippedPods.push(p.name); continue; }
    podCount++;
    for (const c of containers) streams.push({ pod: p.name, container: c });
  }
  return { streams, skippedPods };
}
