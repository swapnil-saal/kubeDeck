/**
 * The one place that decides what "healthy" means, shared by the home screen and the AI chat's
 * Cluster pulse rail. Pure functions over the pod / deployment / node / job / PVC / event lists
 * the app already polls — no LLM, no extra network calls. Every finding carries a ready-made
 * prompt so one click hands the agent the exact resource and the right question.
 *
 * Honesty rule: a list that could not be read is `undefined`, never "empty". With no pod list
 * there is no score — an unreadable cluster must not look healthy.
 */

export interface PodLike {
  name: string;
  namespace?: string;
  status: string;
  restarts?: number;
  ready?: string;
  age?: string;
  node?: string;
  cpu?: string;
  memory?: string;
  workload?: { kind: string; name: string };
}
export interface DeployLike { name: string; namespace?: string; ready?: string }
export interface NodeLike { name: string; status?: string }
export interface JobLike { name: string; namespace?: string; status?: string }
export interface PvcLike { name: string; namespace?: string; status?: string }
export interface UsageLike { name: string; namespace?: string; cpuMilli: number; memMi: number }
export interface EventLike {
  type?: string;
  reason?: string;
  message?: string;
  objectKind?: string;
  objectName?: string;
  namespace?: string;
  count?: number;
  lastTimestamp?: string | null;
}

export type Severity = "critical" | "warning" | "info";
export type IssueKind = "pod" | "deployment" | "node" | "job" | "pvc" | "event";

export interface Issue {
  id: string;
  severity: Severity;
  kind: IssueKind;
  /** resource name */
  title: string;
  /** short why, e.g. "CrashLoopBackOff" */
  reason: string;
  /** secondary line, e.g. "12 restarts · ns e2" */
  meta: string;
  /** prompt that hands this finding to the agent */
  prompt: string;
}

export interface PodBuckets {
  running: number;
  pending: number;
  failed: number;
  done: number;
  total: number;
}

export interface HotPod {
  name: string;
  namespace?: string;
  cpuMilli: number;
  memMi: number;
}

export interface ClusterHealth {
  /** 0–100, or null when pods could not be read (never a made-up number) */
  score: number | null;
  pods: PodBuckets;
  deployments: { ready: number; total: number };
  nodes: { ready: number; total: number };
  restarts: number;
  /** Broken right now (critical / warning). */
  issues: Issue[];
  /** Running but restart-heavy, worst first (capped list). Informational — restarts may be historical. */
  flaky: Issue[];
  /** how many pods are restart-heavy in total (the list above is capped) */
  flakyTotal: number;
  events: Issue[];
  /** busiest pods by CPU */
  hot: HotPod[];
  /** "usage" = live metrics; "requests" = what the pods asked for (no metrics-server access) */
  hotSource: "usage" | "requests" | "none";
}

const CRASH = new Set([
  "CrashLoopBackOff", "Error", "OOMKilled", "RunContainerError", "CreateContainerError",
  "CreateContainerConfigError", "ContainerCannotRun", "StartError",
]);
const PULL = new Set(["ImagePullBackOff", "ErrImagePull", "InvalidImageName", "ErrImageNeverPull"]);
const PENDING = /^(Pending|ContainerCreating|PodInitializing|Init:.*)$/;
const DONE = new Set(["Completed", "Succeeded"]);
/** A restart count only matters when it is high enough to suggest a recurring crash. */
const RESTART_WARN = 5;
const MAX_ISSUES = 24;

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function scopeLabel(ns?: string): string {
  return ns ? `namespace ${ns}` : "the current namespace";
}

function ratio(ready?: string): [number, number] | null {
  const m = ready?.match(/^(\d+)\/(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function ago(iso?: string | null, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function sumParts(v: string | undefined, one: (p: string) => number): number {
  if (!v || v === "-") return 0;
  return v.split("+").reduce((t, p) => t + one(p.trim()), 0);
}

function cpuOne(v: string): number {
  const m = v.match(/^([\d.]+)(n|u|m)?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (m[2] === "n") return n / 1e6;
  if (m[2] === "u") return n / 1e3;
  if (m[2] === "m") return n;
  return n * 1000;
}

function memOne(v: string): number {
  const m = v.match(/^([\d.]+)(Ki|Mi|Gi|Ti|K|M|G)?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  switch (m[2]) {
    case "Ki": return n / 1024;
    case "Gi": return n * 1024;
    case "Ti": return n * 1024 * 1024;
    case "K": return n / 1000;
    case "G": return n * 1000;
    default: return n; // Mi, or a bare number (metrics output)
  }
}

/** CPU quantity ("250m", "2", "50m+100m" for several containers) in millicores. */
export function parseCpuMilli(v?: string): number { return sumParts(v, cpuOne); }

/** Memory quantity ("80Mi", "1Gi", "64Mi+128Mi") in MiB. */
export function parseMemMi(v?: string): number { return sumParts(v, memOne); }

function podIssue(p: PodLike): Issue | null {
  const ns = p.namespace;
  const where = scopeLabel(ns);
  const restarts = p.restarts ?? 0;
  const base = { kind: "pod" as const, title: p.name, id: `pod:${ns ?? ""}/${p.name}` };
  const restartMeta = restarts > 0 ? `${restarts} restart${restarts === 1 ? "" : "s"}` : "";
  const nsMeta = ns ? `ns ${ns}` : "";
  const meta = [restartMeta, nsMeta].filter(Boolean).join(" · ");

  if (CRASH.has(p.status)) {
    return {
      ...base, severity: "critical", reason: p.status, meta,
      prompt:
        `Diagnose pod ${p.name} in ${where} — it is ${p.status} with ${restarts} restarts. ` +
        `Describe it, pull the previous-container logs and recent events, then give the root cause with evidence and a concrete fix.`,
    };
  }
  if (PULL.has(p.status)) {
    return {
      ...base, severity: "critical", reason: p.status, meta: nsMeta,
      prompt:
        `Pod ${p.name} in ${where} is ${p.status}. Check the image reference, tag, registry and imagePullSecrets in its spec and events, ` +
        `and tell me exactly what is wrong and how to fix it.`,
    };
  }
  if (PENDING.test(p.status)) {
    return {
      ...base, severity: "warning", reason: p.status, meta: [p.age ? `age ${ago(p.age)}` : "", nsMeta].filter(Boolean).join(" · "),
      prompt:
        `Why is pod ${p.name} in ${where} stuck in ${p.status}? Check its events, scheduling (node capacity, taints, affinity), PVC binding and image pulls, and tell me the cause.`,
    };
  }
  if (p.status === "Failed" || p.status === "Unknown" || p.status === "Evicted" || p.status === "NodeLost") {
    return {
      ...base, severity: "critical", reason: p.status, meta,
      prompt: `Pod ${p.name} in ${where} is ${p.status}. Describe it and its events, find out why, and tell me what to do.`,
    };
  }
  const r = ratio(p.ready);
  if (p.status === "Running" && r && r[0] < r[1]) {
    return {
      ...base, severity: "warning", reason: `not ready ${r[0]}/${r[1]}`, meta,
      prompt:
        `Pod ${p.name} in ${where} is Running but only ${r[0]}/${r[1]} containers are ready. ` +
        `Check readiness/liveness probes, container states and recent logs, and explain why.`,
    };
  }
  if (restarts >= RESTART_WARN && !DONE.has(p.status)) {
    return {
      ...base, severity: "info", reason: `${restarts} restarts`, meta: nsMeta,
      prompt:
        `Pod ${p.name} in ${where} has restarted ${restarts} times. Look at the last termination reason (OOMKilled? exit code?), ` +
        `current and previous logs and events, and tell me whether it is still crashing and why.`,
    };
  }
  return null;
}

function deployIssue(d: DeployLike): Issue | null {
  const r = ratio(d.ready);
  if (!r) return null;
  const [ready, want] = r;
  if (want === 0 || ready >= want) return null;
  const where = scopeLabel(d.namespace);
  return {
    id: `deploy:${d.namespace ?? ""}/${d.name}`,
    kind: "deployment",
    severity: ready === 0 ? "critical" : "warning",
    title: d.name,
    reason: `${ready}/${want} ready`,
    meta: d.namespace ? `ns ${d.namespace}` : "",
    prompt:
      `Deployment ${d.name} in ${where} has only ${ready}/${want} replicas ready. Check rollout status, the ReplicaSet, ` +
      `and the events and logs of its pods to find out why, then recommend the fix.`,
  };
}

function jobIssue(j: JobLike): Issue | null {
  if (j.status !== "Failed") return null;
  const where = scopeLabel(j.namespace);
  return {
    id: `job:${j.namespace ?? ""}/${j.name}`, kind: "job", severity: "warning", title: j.name, reason: "Failed",
    meta: j.namespace ? `ns ${j.namespace}` : "",
    prompt: `Job ${j.name} in ${where} failed. Look at its pods' logs and events, tell me why it failed and how to fix or rerun it.`,
  };
}

function pvcIssue(p: PvcLike): Issue | null {
  if (!p.status || p.status === "Bound") return null;
  const where = scopeLabel(p.namespace);
  return {
    id: `pvc:${p.namespace ?? ""}/${p.name}`, kind: "pvc", severity: "warning", title: p.name, reason: `not ${p.status === "Pending" ? "bound" : p.status}`,
    meta: p.namespace ? `ns ${p.namespace}` : "",
    prompt: `PersistentVolumeClaim ${p.name} in ${where} is ${p.status}. Check its StorageClass, the matching PV and events, and tell me why it is not bound and what to do.`,
  };
}

function nodeIssue(n: NodeLike): Issue | null {
  if (!n.status || n.status === "Ready") return null;
  return {
    id: `node:${n.name}`,
    kind: "node",
    severity: "critical",
    title: n.name,
    reason: n.status,
    meta: "node",
    prompt: `Node ${n.name} is ${n.status}. Describe it, check its conditions (Ready, MemoryPressure, DiskPressure, PIDPressure), recent events, and list the pods affected. Tell me the cause and what to do.`,
  };
}

/** Warning events collapsed per (reason, object), newest first. */
function eventIssues(events: EventLike[], now: number): Issue[] {
  const groups = new Map<string, EventLike & { n: number }>();
  for (const e of events) {
    if (e.type && e.type !== "Warning") continue;
    const key = `${e.reason}|${e.objectKind}|${e.namespace}|${e.objectName}`;
    const g = groups.get(key);
    const n = e.count ?? 1;
    if (!g) groups.set(key, { ...e, n });
    else {
      g.n += n;
      if ((e.lastTimestamp ?? "") > (g.lastTimestamp ?? "")) g.lastTimestamp = e.lastTimestamp;
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => (b.lastTimestamp ?? "").localeCompare(a.lastTimestamp ?? ""))
    .map((e) => ({
      id: `event:${e.reason}|${e.objectKind}|${e.namespace}|${e.objectName}`,
      kind: "event" as const,
      severity: "warning" as const,
      title: e.objectName ?? "",
      reason: `${e.reason ?? "Warning"}${e.n > 1 ? ` ×${e.n}` : ""}`,
      meta: [e.lastTimestamp ? `${ago(e.lastTimestamp, now)} ago` : "", e.message ?? ""].filter(Boolean).join(" · "),
      prompt:
        `Explain this Kubernetes warning event and what I should do: ${e.reason} on ${(e.objectKind ?? "object").toLowerCase()} ${e.objectName} ` +
        `(${scopeLabel(e.namespace)}) — "${(e.message ?? "").slice(0, 300)}". Inspect the resource if needed and give the root cause and fix.`,
    }));
}

export function analyzeHealth(input: {
  pods?: PodLike[];
  deployments?: DeployLike[];
  nodes?: NodeLike[];
  jobs?: JobLike[];
  pvcs?: PvcLike[];
  events?: EventLike[];
  /** live usage from metrics-server, when the user may read it */
  usage?: UsageLike[];
  now?: number;
}): ClusterHealth {
  const pods = input.pods ?? [];
  const deployments = input.deployments ?? [];
  const nodes = input.nodes ?? [];
  const now = input.now ?? Date.now();

  const buckets: PodBuckets = { running: 0, pending: 0, failed: 0, done: 0, total: pods.length };
  let restarts = 0;
  for (const p of pods) {
    restarts += p.restarts ?? 0;
    if (DONE.has(p.status)) buckets.done++;
    else if (PENDING.test(p.status)) buckets.pending++;
    else if (p.status === "Running") {
      const r = ratio(p.ready);
      if (r && r[0] < r[1]) buckets.pending++;
      else buckets.running++;
    } else buckets.failed++;
  }

  let dReady = 0, dTotal = 0;
  for (const d of deployments) {
    const r = ratio(d.ready);
    if (!r || r[1] === 0) continue;
    dTotal++;
    if (r[0] >= r[1]) dReady++;
  }
  const nReady = nodes.filter((n) => n.status === "Ready").length;

  const found = [
    ...nodes.map(nodeIssue),
    ...pods.map(podIssue),
    ...deployments.map(deployIssue),
    ...(input.jobs ?? []).map(jobIssue),
    ...(input.pvcs ?? []).map(pvcIssue),
  ].filter((x): x is Issue => !!x);

  const issues = found
    .filter((i) => i.severity !== "info")
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_ISSUES);

  const restartsOf = (i: Issue) => Number(i.reason.match(/^(\d+) restarts/)?.[1] ?? 0);
  const flakyAll = found.filter((i) => i.severity === "info");
  const flaky = flakyAll
    .sort((a, b) => restartsOf(b) - restartsOf(a))
    .slice(0, 6);

  const podHealth = buckets.total > 0 ? (buckets.running + buckets.done) / buckets.total : 1;
  const deployHealth = dTotal > 0 ? dReady / dTotal : 1;
  const criticals = issues.filter((i) => i.severity === "critical").length;
  // No pod list ⇒ no verdict. (An empty list is a real namespace; a missing one is unknown.)
  const score = input.pods === undefined
    ? null
    : Math.max(0, Math.round(100 * (0.55 * podHealth + 0.45 * deployHealth) - Math.min(30, criticals * 4)));

  let hot: HotPod[];
  let hotSource: ClusterHealth["hotSource"];
  if (input.usage && input.usage.length > 0) {
    hotSource = "usage";
    hot = input.usage.map((u) => ({ name: u.name, namespace: u.namespace, cpuMilli: u.cpuMilli, memMi: u.memMi }));
  } else {
    hot = pods
      .filter((p) => p.status === "Running")
      .map((p) => ({ name: p.name, namespace: p.namespace, cpuMilli: parseCpuMilli(p.cpu), memMi: parseMemMi(p.memory) }));
    hotSource = hot.some((h) => h.cpuMilli > 0) ? "requests" : "none";
  }
  hot = hot.filter((p) => p.cpuMilli > 0).sort((a, b) => b.cpuMilli - a.cpuMilli).slice(0, 5);

  return {
    score,
    pods: buckets,
    deployments: { ready: dReady, total: dTotal },
    nodes: { ready: nReady, total: nodes.length },
    restarts,
    issues,
    flaky,
    flakyTotal: flakyAll.length,
    events: eventIssues(input.events ?? [], now).slice(0, 12),
    hot,
    hotSource,
  };
}

/** One prompt covering the most important findings, for the "Diagnose all" button. */
export function diagnoseAllPrompt(issues: Issue[], namespace: string): string {
  const top = issues.slice(0, 8);
  const lines = top.map((i) => `- ${i.kind} ${i.title}: ${i.reason}${i.meta ? ` (${i.meta})` : ""}`);
  return (
    `Triage ${namespace && namespace !== "all" ? `namespace ${namespace}` : "this cluster"}. These problems were detected live:\n${lines.join("\n")}\n\n` +
    `Investigate them in priority order, group the ones that likely share a root cause, and give me a short ranked action list with evidence. ` +
    `Present a dashboard of the impact.`
  );
}

// ── Recent changes ──────────────────────────────────────────────────────────

export interface Change {
  id: string;
  kind: "rollout" | "scaled" | "stopped";
  /** workload / object */
  title: string;
  detail: string;
  /** epoch ms */
  at: number;
  prompt: string;
}

const CHANGE_WINDOW_HOURS = 24 * 7;

/**
 * What changed lately. Kubernetes only keeps events for about an hour, so rollouts are also read
 * from pod creation times (a workload whose pods were created recently was rolled or rescheduled),
 * which is always available.
 */
export function recentChanges(input: { pods?: PodLike[]; events?: EventLike[]; now?: number; limit?: number }): Change[] {
  const now = input.now ?? Date.now();
  const cutoff = now - CHANGE_WINDOW_HOURS * 3600_000;
  const out: Change[] = [];

  const byWorkload = new Map<string, { count: number; at: number; ns?: string }>();
  for (const p of input.pods ?? []) {
    const at = p.age ? Date.parse(p.age) : NaN;
    if (!Number.isFinite(at) || at < cutoff) continue;
    // pod name minus its ReplicaSet / pod hash is the workload when the API did not say
    const workload = p.workload?.name ?? p.name.replace(/-[a-z0-9]{6,10}-[a-z0-9]{5}$/, "").replace(/-[a-z0-9]{5}$/, "");
    const g = byWorkload.get(`${p.namespace ?? ""}/${workload}`) ?? { count: 0, at: 0, ns: p.namespace };
    g.count++;
    g.at = Math.max(g.at, at);
    byWorkload.set(`${p.namespace ?? ""}/${workload}`, g);
  }
  for (const [key, g] of Array.from(byWorkload.entries())) {
    const workload = key.slice(key.indexOf("/") + 1);
    out.push({
      id: `rollout:${key}`,
      kind: "rollout",
      title: workload,
      detail: `${g.count} new pod${g.count === 1 ? "" : "s"}`,
      at: g.at,
      prompt: `${workload} (${scopeLabel(g.ns)}) was rolled out ${ago(new Date(g.at).toISOString(), now)} ago. Check that the rollout finished cleanly: rollout status, the new pods' health, restarts since, and any errors in their logs or events.`,
    });
  }

  for (const e of input.events ?? []) {
    if (e.type !== "Normal" || !e.lastTimestamp) continue;
    const at = Date.parse(e.lastTimestamp);
    if (!Number.isFinite(at) || at < cutoff) continue;
    if (e.reason === "ScalingReplicaSet") {
      out.push({
        id: `scaled:${e.namespace}/${e.objectName}/${e.lastTimestamp}`, kind: "scaled", title: e.objectName ?? "",
        detail: (e.message ?? "Scaled").replace(/^Scaled (up|down) replica set \S+ /, (_m, d: string) => `Scaled ${d} `).slice(0, 80),
        at,
        prompt: `${e.objectName} (${scopeLabel(e.namespace)}) was scaled: "${e.message}". Check it is healthy at the new size and whether anything triggered the change (HPA, a person, a rollout).`,
      });
    } else if (e.reason === "Killing") {
      out.push({
        id: `stopped:${e.namespace}/${e.objectName}/${e.lastTimestamp}`, kind: "stopped", title: e.objectName ?? "",
        detail: (e.message ?? "Container stopped").slice(0, 80), at,
        prompt: `Pod ${e.objectName} (${scopeLabel(e.namespace)}) had a container killed: "${e.message}". Find out why (probe failure, eviction, rollout) and whether it is back to normal.`,
      });
    }
  }

  return out.sort((a, b) => b.at - a.at).slice(0, input.limit ?? 8);
}

/** Score for a cluster known only through summary counts (the multi-cluster overview). */
export function summaryScore(s: {
  pods?: { total: number; running: number; failing: number };
  deployments?: { ready: number; total: number } | null;
  nodes?: { ready: number; total: number } | null;
}): number | null {
  if (!s.pods) return null;
  const podHealth = s.pods.total > 0 ? s.pods.running / s.pods.total : 1;
  const deployHealth = s.deployments && s.deployments.total > 0 ? s.deployments.ready / s.deployments.total : 1;
  const nodesDown = s.nodes ? s.nodes.total - s.nodes.ready : 0;
  const penalty = Math.min(30, (s.pods.failing > 0 ? 4 : 0) * Math.min(s.pods.failing, 5) + nodesDown * 8);
  return Math.max(0, Math.round(100 * (0.55 * podHealth + 0.45 * deployHealth) - penalty));
}
