import type { K8sDeployment, K8sPod } from "@shared/schema";

export interface ScopeHealth {
  pods: number;
  running: number;
  failing: number;
  deployments: number;
  degraded: number;
}

const FAILING = /^(CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerConfigError|CreateContainerError|InvalidImageName|Failed|Evicted)$/;

export const podFailing = (status: string) => FAILING.test(status);

export function deploymentDegraded(ready: string): boolean {
  const [have, want] = ready.split("/").map(Number);
  return Number.isFinite(have) && Number.isFinite(want) && have < want;
}

/** Counts for one scope, or for a whole project when given every scope's lists. */
export function healthOf(pods: K8sPod[] = [], deployments: K8sDeployment[] = []): ScopeHealth {
  return {
    pods: pods.length,
    running: pods.filter((p) => p.status === "Running" || p.status === "Completed" || p.status === "Succeeded").length,
    failing: pods.filter((p) => podFailing(p.status)).length,
    deployments: deployments.length,
    degraded: deployments.filter((d) => deploymentDegraded(d.ready)).length,
  };
}

export interface Scope {
  context: string;
  namespace: string;
}

export interface ScopeLists {
  scope: Scope;
  pods?: K8sPod[];
  deployments?: K8sDeployment[];
}

export const scopeKey = (s: Scope) => `${s.context}/${s.namespace}`;

/** One workload with problems, and where: a crashing pod and its 0/1 deployment are the same problem. */
export interface WorkloadProblem {
  name: string;
  kind: string;
  /** per scope: the reason (the first failing pod's status, else "0/1 ready") and the failing pods */
  places: { scope: Scope; reason: string; ready?: string; pods: string[] }[];
}

/** Problems grouped by workload, the most widespread first. */
export function problemsByWorkload(data: ScopeLists[]): WorkloadProblem[] {
  const byName = new Map<string, WorkloadProblem>();
  const place = (name: string, kind: string, scope: Scope) => {
    const w = byName.get(name) ?? { name, kind, places: [] };
    byName.set(name, w);
    let p = w.places.find((x) => scopeKey(x.scope) === scopeKey(scope));
    if (!p) { p = { scope, reason: "", pods: [] }; w.places.push(p); }
    return p;
  };
  for (const d of data) {
    for (const pod of d.pods ?? []) {
      if (!podFailing(pod.status)) continue;
      const p = place(pod.workload?.name ?? pod.name, pod.workload?.kind ?? "Pod", d.scope);
      p.pods.push(pod.name);
      p.reason ||= pod.status;
    }
    for (const dep of d.deployments ?? []) {
      if (!deploymentDegraded(dep.ready)) continue;
      const p = place(dep.name, "Deployment", d.scope);
      p.ready = dep.ready;
      p.reason ||= `${dep.ready} ready`;
    }
  }
  return [...byName.values()].sort((a, b) => b.places.length - a.places.length || a.name.localeCompare(b.name));
}

/** "registry:5000/team/api:v1.4.2" → "v1.4.2"; a digest → its first 12 characters; no tag → "latest". */
export function imageTag(image: string): string {
  const at = image.indexOf("@");
  if (at >= 0) return image.slice(at + 1).replace(/^sha256:/, "").slice(0, 12);
  const last = image.slice(image.lastIndexOf("/") + 1);
  const colon = last.lastIndexOf(":");
  return colon >= 0 ? last.slice(colon + 1) : "latest";
}

export interface CompareCell {
  ready: string;
  degraded: boolean;
  tags: string[];
}

export interface CompareRow {
  name: string;
  /** by scopeKey; absent where the deployment does not exist (or the scope did not load) */
  cells: Record<string, CompareCell>;
  /** runs different image tags in different places */
  drift: boolean;
  /** missing from a scope that loaded */
  missing: boolean;
  degraded: boolean;
}

/** Every deployment of the project against every scope: readiness and image tags, and where they differ. */
export function compareDeployments(data: ScopeLists[]): CompareRow[] {
  const loaded = data.filter((d) => d.deployments).map((d) => scopeKey(d.scope));
  const rows = new Map<string, CompareRow>();
  for (const d of data) {
    for (const dep of d.deployments ?? []) {
      const row = rows.get(dep.name) ?? { name: dep.name, cells: {}, drift: false, missing: false, degraded: false };
      rows.set(dep.name, row);
      row.cells[scopeKey(d.scope)] = { ready: dep.ready, degraded: deploymentDegraded(dep.ready), tags: (dep.images ?? []).map(imageTag) };
    }
  }
  for (const row of rows.values()) {
    const cells = Object.values(row.cells);
    row.drift = new Set(cells.map((c) => c.tags.join(","))).size > 1;
    row.missing = loaded.some((k) => !row.cells[k]);
    row.degraded = cells.some((c) => c.degraded);
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
