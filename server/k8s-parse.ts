/** Pure helpers for turning kubectl output into the small shapes the home screen needs. */

export interface PodUsage { name: string; namespace?: string; cpuMilli: number; memMi: number }
export interface NodeUsage { name: string; cpuMilli: number; cpuPct: number; memMi: number; memPct: number }

export function parseCpuMilli(v: string): number {
  const m = v.match(/^([\d.]+)(n|u|m)?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (m[2] === "n") return n / 1e6;
  if (m[2] === "u") return n / 1e3;
  if (m[2] === "m") return n;
  return n * 1000;
}

export function parseMemMi(v: string): number {
  const m = v.match(/^([\d.]+)(Ki|Mi|Gi|Ti|K|M|G)?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  switch (m[2]) {
    case "Ki": return n / 1024;
    case "Gi": return n * 1024;
    case "Ti": return n * 1024 * 1024;
    case "K": return n / 1000;
    case "G": return n * 1000;
    default: return n;
  }
}

/** `kubectl top pods --no-headers` (with `-A` the first column is the namespace). */
export function parseTopPods(stdout: string, allNamespaces: boolean): PodUsage[] {
  const out: PodUsage[] = [];
  for (const line of stdout.split("\n")) {
    const c = line.trim().split(/\s+/);
    if (allNamespaces ? c.length < 4 : c.length < 3) continue;
    const namespace = allNamespaces ? c[0] : undefined;
    const [name, cpu, mem] = allNamespaces ? c.slice(1) : c;
    out.push({ name, namespace, cpuMilli: parseCpuMilli(cpu), memMi: parseMemMi(mem) });
  }
  return out;
}

/** `kubectl top nodes --no-headers`: NAME CPU(cores) CPU% MEMORY(bytes) MEMORY%. */
export function parseTopNodes(stdout: string): NodeUsage[] {
  const out: NodeUsage[] = [];
  for (const line of stdout.split("\n")) {
    const c = line.trim().split(/\s+/);
    if (c.length < 5) continue;
    out.push({
      name: c[0],
      cpuMilli: parseCpuMilli(c[1]),
      cpuPct: parseInt(c[2], 10) || 0,
      memMi: parseMemMi(c[3]),
      memPct: parseInt(c[4], 10) || 0,
    });
  }
  return out;
}

/** True when kubectl says the metrics API is missing (so "no data" is not an error). */
export function metricsUnavailable(stderr: string): boolean {
  return /metrics api not available|metrics\.k8s\.io|metrics-server|the server could not find the requested resource/i.test(stderr);
}

export interface OwnerRef { kind?: string; name?: string }

/**
 * The workload a pod belongs to: a ReplicaSet owner is mapped to its Deployment by dropping the
 * pod-template hash from the ReplicaSet name (`web-5d79ccfd54` -> `web`).
 */
export function ownerWorkload(refs: OwnerRef[] | undefined): { kind: string; name: string } | undefined {
  const ref = (refs ?? []).find((r) => r.kind && r.name);
  if (!ref || !ref.kind || !ref.name) return undefined;
  if (ref.kind === "ReplicaSet") return { kind: "Deployment", name: ref.name.replace(/-[a-z0-9]{6,10}$/, "") };
  if (ref.kind === "Job") return { kind: "Job", name: ref.name.replace(/-\d{6,}$/, "") }; // CronJob run suffix
  return { kind: ref.kind, name: ref.name };
}

const FAILING_WAITING = new Set([
  "CrashLoopBackOff", "Error", "ImagePullBackOff", "ErrImagePull", "InvalidImageName", "OOMKilled",
  "CreateContainerConfigError", "CreateContainerError", "RunContainerError",
]);

export interface PodCounts { total: number; running: number; pending: number; failing: number }

/** `kubectl get pods --no-headers -o custom-columns=P:.status.phase,W:...waiting.reason` lines: `Running <none>`. */
export function countPods(stdout: string): PodCounts {
  const c: PodCounts = { total: 0, running: 0, pending: 0, failing: 0 };
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    c.total++;
    const [phase, waiting = "<none>"] = line.split(/\s+/);
    const reasons = waiting === "<none>" ? [] : waiting.split(",").filter(Boolean);
    if (reasons.some((r) => FAILING_WAITING.has(r)) || phase === "Failed") c.failing++;
    else if (phase === "Pending" || reasons.length > 0) c.pending++;
    else if (phase === "Running" || phase === "Succeeded") c.running++;
  }
  return c;
}

/** `... -o custom-columns=R:.status.readyReplicas,W:.spec.replicas` lines: `2 3` / `<none> 2`. */
export function countDeployments(stdout: string): { ready: number; total: number } {
  let ready = 0, total = 0;
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [r, w] = line.split(/\s+/);
    const want = Number(w === "<none>" ? 0 : w);
    if (!want) continue; // scaled to zero on purpose
    total++;
    if (Number(r === "<none>" ? 0 : r) >= want) ready++;
  }
  return { ready, total };
}

/** Lines that are the node Ready condition: `True` / `False` / `Unknown`. */
export function countNodes(stdout: string): { ready: number; total: number } {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  return { ready: lines.filter((l) => l === "True").length, total: lines.length };
}

/** `namespace/foo` lines from `kubectl get ns -o name`. */
export function parseNamespaceNames(stdout: string): string[] {
  return stdout.split("\n").map((l) => l.trim().replace(/^namespace\//, "")).filter(Boolean);
}
