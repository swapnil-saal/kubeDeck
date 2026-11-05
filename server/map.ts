/**
 * A namespace as a graph: Ingress → Service → workload → ConfigMap / Secret / volume claim.
 * Pods are folded into the workload that owns them (Deployment via its ReplicaSet, StatefulSet,
 * DaemonSet, CronJob via its Job), so a namespace of 300 pods reads as its 90 workloads.
 * Secrets and ConfigMaps come only from the references in pod specs: their contents are never read.
 */
import type { MapGraph, MapNode } from "@shared/routes";
import { ingressBackends, ingressHosts } from "./k8s-parse";

type Obj = { kind: string; metadata: any; spec?: any; status?: any };

const WORKLOAD_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job", "Pod"]);
const BAD_REASON = /^(CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerConfigError|CreateContainerError|InvalidImageName|RunContainerError)$/;

/** route type for the detail page */
const ROUTE_TYPE: Record<string, string> = {
  Ingress: "ingress", Service: "service", Deployment: "deployment", StatefulSet: "statefulset", DaemonSet: "daemonset",
  CronJob: "cronjob", Job: "job", Pod: "pod", ConfigMap: "configmap", Secret: "secret", PersistentVolumeClaim: "pvc",
};

const id = (kind: string, name: string) => `${kind}/${name}`;

/** Healthy, starting, or broken: from phase, readiness and the containers' waiting reasons. */
export function podHealth(pod: Obj): "ready" | "waiting" | "bad" | "done" {
  const phase = pod.status?.phase;
  if (phase === "Succeeded") return "done";
  if (phase === "Failed") return "bad";
  const statuses: any[] = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])];
  if (statuses.some((c) => BAD_REASON.test(c.state?.waiting?.reason ?? c.state?.terminated?.reason ?? ""))) return "bad";
  const main: any[] = pod.status?.containerStatuses ?? [];
  return phase === "Running" && main.length > 0 && main.every((c) => c.ready) ? "ready" : "waiting";
}

/** ConfigMaps, Secrets and claims a pod spec refers to (volumes, env, envFrom, projected sources). */
export function specRefs(spec: any): { configMaps: Set<string>; secrets: Set<string>; claims: Set<string> } {
  const configMaps = new Set<string>();
  const secrets = new Set<string>();
  const claims = new Set<string>();
  for (const v of spec?.volumes ?? []) {
    if (v.configMap?.name) configMaps.add(v.configMap.name);
    if (v.secret?.secretName) secrets.add(v.secret.secretName);
    if (v.persistentVolumeClaim?.claimName) claims.add(v.persistentVolumeClaim.claimName);
    for (const s of v.projected?.sources ?? []) {
      if (s.configMap?.name) configMaps.add(s.configMap.name);
      if (s.secret?.name) secrets.add(s.secret.name);
    }
  }
  for (const c of [...(spec?.initContainers ?? []), ...(spec?.containers ?? [])]) {
    for (const e of c.envFrom ?? []) {
      if (e.configMapRef?.name) configMaps.add(e.configMapRef.name);
      if (e.secretRef?.name) secrets.add(e.secretRef.name);
    }
    for (const e of c.env ?? []) {
      if (e.valueFrom?.configMapKeyRef?.name) configMaps.add(e.valueFrom.configMapKeyRef.name);
      if (e.valueFrom?.secretKeyRef?.name) secrets.add(e.valueFrom.secretKeyRef.name);
    }
  }
  return { configMaps, secrets, claims };
}

const matches = (selector: Record<string, string> | undefined, labels: Record<string, string> | undefined) =>
  !!selector && Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => labels?.[k] === v);

/** Every object of one namespace (one `kubectl get … -o json` List) → the map. */
export function buildMap(items: Obj[]): Omit<MapGraph, "missing"> {
  const of = (kind: string) => items.filter((i) => i.kind === kind);
  const byName = (kind: string) => new Map(of(kind).map((i) => [i.metadata.name as string, i]));
  const replicaSets = byName("ReplicaSet");
  const jobs = byName("Job");

  // which workload a pod belongs to
  const ownerOf = (o: Obj): { kind: string; name: string } | null =>
    (o.metadata.ownerReferences ?? []).find((r: any) => r.controller) ?? null;
  const workloadOf = (pod: Obj): string => {
    const owner = ownerOf(pod);
    if (!owner) return id("Pod", pod.metadata.name);
    if (owner.kind === "ReplicaSet") {
      const rsOwner = ownerOf(replicaSets.get(owner.name) ?? { kind: "", metadata: {} });
      return rsOwner?.kind === "Deployment" ? id("Deployment", rsOwner.name) : id("Pod", pod.metadata.name);
    }
    if (owner.kind === "Job") {
      const jobOwner = ownerOf(jobs.get(owner.name) ?? { kind: "", metadata: {} });
      return jobOwner?.kind === "CronJob" ? id("CronJob", jobOwner.name) : id("Job", owner.name);
    }
    return WORKLOAD_KINDS.has(owner.kind) ? id(owner.kind, owner.name) : id("Pod", pod.metadata.name);
  };

  const nodes = new Map<string, MapNode>();
  const edges = new Set<string>();
  const add = (n: MapNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return nodes.get(n.id)!; };
  const link = (from: string, to: string) => { if (nodes.has(from) && nodes.has(to)) edges.add(`${from}\u0000${to}`); };
  const node = (kind: string, name: string, column: MapNode["column"], detail = ""): MapNode =>
    ({ id: id(kind, name), kind, name, type: ROUTE_TYPE[kind] ?? kind.toLowerCase(), column, detail, tone: "neutral" });

  // workloads: controllers (even with no pods) and pods without one
  const templates = new Map<string, any>();
  for (const kind of ["Deployment", "StatefulSet", "DaemonSet", "CronJob"]) {
    for (const w of of(kind)) {
      const n = add(node(kind, w.metadata.name, 2));
      n.pods = { total: 0, ready: 0, bad: 0 };
      if (kind === "CronJob") n.detail = w.spec?.schedule ? `every ${w.spec.schedule}` : "";
      templates.set(n.id, kind === "CronJob" ? w.spec?.jobTemplate?.spec?.template?.spec : w.spec?.template?.spec);
      const want = w.spec?.replicas ?? w.status?.desiredNumberScheduled;
      if (typeof want === "number") n.want = want;
    }
  }
  const podsOf = new Map<string, Obj[]>();
  for (const pod of of("Pod")) {
    const wid = workloadOf(pod);
    if (!podsOf.has(wid)) podsOf.set(wid, []);
    podsOf.get(wid)!.push(pod);
    if (!nodes.has(wid)) {
      const [kind, name] = [wid.slice(0, wid.indexOf("/")), wid.slice(wid.indexOf("/") + 1)];
      const n = add(node(kind, name, 2));
      n.pods = { total: 0, ready: 0, bad: 0 };
      templates.set(wid, pod.spec);
    }
  }
  for (const [wid, pods] of podsOf) {
    const n = nodes.get(wid)!;
    for (const p of pods) {
      const h = podHealth(p);
      if (h === "done") continue; // finished job pods are history, not health
      n.pods!.total++;
      if (h === "ready") n.pods!.ready++;
      if (h === "bad") n.pods!.bad++;
    }
  }
  for (const n of nodes.values()) {
    if (n.column !== 2 || !n.pods) continue;
    const { total, ready, bad } = n.pods;
    const want = n.want ?? total;
    n.tone = bad > 0 ? "bad" : n.kind === "CronJob" ? "neutral" : want === 0 && total === 0 ? "neutral" : ready >= want && ready > 0 ? "good" : "warn";
    if (n.kind !== "CronJob") n.detail = `${ready}/${want} ready${bad ? ` · ${bad} failing` : ""}`;
  }

  // autoscalers: shown on the workload they scale
  for (const hpa of of("HorizontalPodAutoscaler")) {
    const ref = hpa.spec?.scaleTargetRef;
    const n = ref && nodes.get(id(ref.kind, ref.name));
    if (n) n.badge = `autoscales ${hpa.spec?.minReplicas ?? 1}–${hpa.spec?.maxReplicas}`;
  }

  // services, and which workloads' pods they select
  for (const svc of of("Service")) {
    const n = add(node("Service", svc.metadata.name, 1, svc.spec?.type ?? ""));
    const ports = (svc.spec?.ports ?? []).map((p: any) => p.port).join(", ");
    if (ports) n.detail = `${n.detail} · ${ports}`;
    const selector = svc.spec?.selector;
    let selected = 0;
    for (const [wid, pods] of podsOf) {
      if (pods.some((p) => matches(selector, p.metadata.labels))) { link(n.id, wid); selected++; }
    }
    // controllers scaled to zero still match through their pod template
    for (const kind of ["Deployment", "StatefulSet", "DaemonSet"]) {
      for (const w of of(kind)) {
        if (matches(selector, w.spec?.template?.metadata?.labels)) { link(n.id, id(kind, w.metadata.name)); selected++; }
      }
    }
    n.tone = selector && Object.keys(selector).length && selected === 0 ? "warn" : "neutral";
    if (n.tone === "warn") n.badge = "selects no pods";
  }

  // ingresses → the services they route to
  for (const ing of of("Ingress")) {
    const n = add(node("Ingress", ing.metadata.name, 0, ingressHosts(ing)));
    for (const svc of ingressBackends(ing)) {
      if (!nodes.has(id("Service", svc))) {
        const missing = add(node("Service", svc, 1, "missing"));
        missing.tone = "bad";
        missing.badge = "does not exist";
      }
      link(n.id, id("Service", svc));
    }
  }

  // what each workload mounts or reads
  const claims = byName("PersistentVolumeClaim");
  for (const [wid, spec] of templates) {
    const refs = specRefs(spec);
    for (const p of podsOf.get(wid) ?? []) {
      const more = specRefs(p.spec);
      more.configMaps.forEach((x) => refs.configMaps.add(x));
      more.secrets.forEach((x) => refs.secrets.add(x));
      more.claims.forEach((x) => refs.claims.add(x));
    }
    refs.configMaps.forEach((name) => { add(node("ConfigMap", name, 3)); link(wid, id("ConfigMap", name)); });
    refs.secrets.forEach((name) => { add(node("Secret", name, 3)); link(wid, id("Secret", name)); });
    refs.claims.forEach((name) => {
      const pvc = claims.get(name);
      const n = add(node("PersistentVolumeClaim", name, 3, pvc ? `${pvc.status?.phase ?? ""} · ${pvc.spec?.resources?.requests?.storage ?? ""}` : "missing"));
      n.tone = !pvc ? "bad" : pvc.status?.phase === "Bound" ? "neutral" : "warn";
      link(wid, n.id);
    });
  }
  // StatefulSet volume claim templates create claims named <template>-<set>-<ordinal>
  for (const sts of of("StatefulSet")) {
    for (const t of sts.spec?.volumeClaimTemplates ?? []) {
      for (const pvc of claims.values()) {
        if (pvc.metadata.name.startsWith(`${t.metadata?.name}-${sts.metadata.name}-`)) {
          const n = add(node("PersistentVolumeClaim", pvc.metadata.name, 3, `${pvc.status?.phase ?? ""} · ${pvc.spec?.resources?.requests?.storage ?? ""}`));
          n.tone = pvc.status?.phase === "Bound" ? "neutral" : "warn";
          link(id("StatefulSet", sts.metadata.name), n.id);
        }
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges].map((e) => { const [from, to] = e.split("\u0000"); return { from, to }; }),
  };
}
