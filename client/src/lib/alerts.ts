/**
 * Decides WHEN something is worth interrupting the user for. Pure: it diffs successive snapshots
 * of the pod / deployment lists the app already polls and reports what is newly broken. No
 * network, no timers, no Notification API — the watcher hook and alert store do those.
 *
 * Rules that keep it trustworthy:
 *  - The first snapshot of a scope is a baseline: what is already broken is counted, not announced.
 *  - Crash / image-pull failures alert at once; softer states (Pending, not-ready, a deployment
 *    short of replicas) must persist for a grace period, so an ordinary rollout stays quiet.
 *  - One alert per resource until it recovers; a flapping resource waits out a cooldown.
 *  - A pod that restarted again since the last snapshot gets its own (rate-limited) alert.
 */
import { analyzeHealth, type DeployLike, type Issue, type PodLike, type Severity } from "./cluster-health";

export type AlertKind = "failure" | "restart" | "recovered";

export interface Alert {
  /** stable per resource + kind, used as the notification tag so repeats replace each other */
  key: string;
  kind: AlertKind;
  severity: Severity;
  title: string;
  body: string;
  resource: { type: "pod" | "deployment" | "node" | "job" | "pvc"; name: string; namespace?: string };
  at: number;
  /** ready-made question for the chat agent */
  prompt: string;
}

interface Tracked { firstSeen: number; severity: Severity; alerted: boolean }

export interface TrackerState {
  primed: boolean;
  active: Map<string, Tracked>;
  lastAlerted: Map<string, number>;
  restarts: Map<string, number>;
}

export function newTracker(): TrackerState {
  return { primed: false, active: new Map(), lastAlerted: new Map(), restarts: new Map() };
}

export interface TrackOptions {
  /** how long a soft problem must persist before it alerts */
  graceMs?: number;
  /** how long a resource that already alerted stays quiet if it recovers and breaks again */
  cooldownMs?: number;
  /** also announce when a failing deployment recovers */
  recoveries?: boolean;
}

const DEFAULTS = { graceMs: 45_000, cooldownMs: 30 * 60_000, restartCooldownMs: 10 * 60_000 };
const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const DONE = new Set(["Completed", "Succeeded"]);

const podKey = (p: { namespace?: string; name: string }) => `${p.namespace ?? ""}/${p.name}`;

function resourceOf(issue: Issue): Alert["resource"] {
  const [ns, name] = issue.id.replace(/^[a-z]+:/, "").split("/");
  const type = issue.kind === "event" ? "pod" : issue.kind;
  return issue.kind === "node" ? { type: "node", name: issue.title } : { type, name: name ?? issue.title, namespace: ns || undefined };
}

function graceFor(issue: Issue, graceMs: number): number {
  // a crash loop or a bad image is never a transient rollout state
  if (issue.kind === "pod" && issue.severity === "critical") return 0;
  if (issue.kind === "node") return 0;
  return graceMs;
}

export interface TrackResult {
  alerts: Alert[];
  /** problems that already existed when this scope was first seen (not announced) */
  baseline: number;
}

export function trackAlerts(
  state: TrackerState,
  input: { pods?: PodLike[]; deployments?: DeployLike[]; now?: number },
  opts: TrackOptions = {},
): TrackResult {
  const now = input.now ?? Date.now();
  const graceMs = opts.graceMs ?? DEFAULTS.graceMs;
  const cooldownMs = opts.cooldownMs ?? DEFAULTS.cooldownMs;

  // An unreadable list is "unknown", never "healthy": do not touch state, do not raise or clear anything.
  if (input.pods === undefined) return { alerts: [], baseline: 0 };

  const issues = analyzeHealth({ pods: input.pods, deployments: input.deployments, now }).issues;
  const alerts: Alert[] = [];
  const present = new Set<string>();

  if (!state.primed) {
    for (const i of issues) state.active.set(i.id, { firstSeen: now, severity: i.severity, alerted: true });
    for (const p of input.pods) state.restarts.set(podKey(p), p.restarts ?? 0);
    state.primed = true;
    return { alerts, baseline: issues.length };
  }

  const alertedPods = new Set<string>();

  for (const i of issues) {
    present.add(i.id);
    const tracked = state.active.get(i.id);
    if (!tracked) {
      state.active.set(i.id, { firstSeen: now, severity: i.severity, alerted: false });
    }
    const t = state.active.get(i.id)!;
    const worse = RANK[i.severity] < RANK[t.severity];
    if (worse) { t.severity = i.severity; t.alerted = false; }
    if (t.alerted || now - t.firstSeen < graceFor(i, graceMs)) continue;
    const last = state.lastAlerted.get(i.id);
    if (last !== undefined && now - last < cooldownMs && !worse) { t.alerted = true; continue; }

    t.alerted = true;
    state.lastAlerted.set(i.id, now);
    const resource = resourceOf(i);
    if (resource.type === "pod") alertedPods.add(`${resource.namespace ?? ""}/${resource.name}`);
    alerts.push({
      key: i.id,
      kind: "failure",
      severity: i.severity,
      title: `${i.kind === "deployment" ? "Deployment" : i.kind === "pod" ? "Pod" : "Resource"} ${i.title}: ${i.reason}`,
      body: i.meta || (resource.namespace ? `namespace ${resource.namespace}` : ""),
      resource,
      at: now,
      prompt: i.prompt,
    });
  }

  // recoveries and forgotten resources
  for (const [id, t] of Array.from(state.active)) {
    if (present.has(id)) continue;
    state.active.delete(id);
    if (opts.recoveries && t.alerted && id.startsWith("deploy:")) {
      const [ns, name] = id.slice("deploy:".length).split("/");
      alerts.push({
        key: `${id}#recovered`,
        kind: "recovered",
        severity: "info",
        title: `Deployment ${name} is healthy again`,
        body: ns ? `namespace ${ns}` : "",
        resource: { type: "deployment", name, namespace: ns || undefined },
        at: now,
        prompt: `Deployment ${name} recovered. Summarise what was wrong and whether anything should be followed up.`,
      });
    }
  }

  // restarts since the previous snapshot
  const seenPods = new Set<string>();
  for (const p of input.pods) {
    const k = podKey(p);
    seenPods.add(k);
    const now_ = p.restarts ?? 0;
    const before = state.restarts.get(k);
    state.restarts.set(k, now_);
    if (before === undefined || now_ <= before || DONE.has(p.status) || alertedPods.has(k)) continue;
    const rk = `restart:${k}`;
    const last = state.lastAlerted.get(rk);
    if (last !== undefined && now - last < DEFAULTS.restartCooldownMs) continue;
    state.lastAlerted.set(rk, now);
    alerts.push({
      key: rk,
      kind: "restart",
      severity: "warning",
      title: `Pod ${p.name} restarted`,
      body: `${now_} restart${now_ === 1 ? "" : "s"} in total${p.namespace ? ` · namespace ${p.namespace}` : ""}`,
      resource: { type: "pod", name: p.name, namespace: p.namespace },
      at: now,
      prompt:
        `Pod ${p.name}${p.namespace ? ` in namespace ${p.namespace}` : ""} just restarted (now ${now_} restarts). ` +
        `Find the last termination reason (OOMKilled? exit code?), the previous container's logs and events, and tell me why.`,
    });
  }
  for (const k of Array.from(state.restarts.keys())) if (!seenPods.has(k)) state.restarts.delete(k);

  alerts.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return { alerts, baseline: 0 };
}
