import { describe, expect, it } from "vitest";
import { buildMap, podHealth, specRefs } from "./map";
import { forbiddenKinds } from "./map-routes";

const meta = (name: string, extra: Record<string, unknown> = {}) => ({ name, namespace: "e2", ...extra });
const ctrl = (kind: string, name: string) => ({ ownerReferences: [{ kind, name, controller: true }] });
const running = { phase: "Running", containerStatuses: [{ ready: true, state: { running: {} } }] };
const crashing = { phase: "Running", containerStatuses: [{ ready: false, state: { waiting: { reason: "CrashLoopBackOff" } } }] };
const podSpec = {
  volumes: [{ configMap: { name: "web-config" } }, { persistentVolumeClaim: { claimName: "web-data" } }],
  containers: [{ envFrom: [{ secretRef: { name: "web-secret" } }], env: [{ valueFrom: { configMapKeyRef: { name: "shared" } } }] }],
};

const items = [
  { kind: "Ingress", metadata: meta("web"), spec: { rules: [{ host: "web.example.com", http: { paths: [{ backend: { service: { name: "web" } } }] } }] } },
  { kind: "Ingress", metadata: meta("old"), spec: { defaultBackend: { service: { name: "gone" } } } },
  { kind: "Service", metadata: meta("web"), spec: { type: "ClusterIP", selector: { app: "web" }, ports: [{ port: 80 }] } },
  { kind: "Service", metadata: meta("orphan"), spec: { type: "ClusterIP", selector: { app: "nothing" } } },
  { kind: "Deployment", metadata: meta("web"), spec: { replicas: 2, template: { metadata: { labels: { app: "web" } }, spec: podSpec } } },
  { kind: "ReplicaSet", metadata: meta("web-abc", ctrl("Deployment", "web")) },
  { kind: "Pod", metadata: meta("web-abc-1", { ...ctrl("ReplicaSet", "web-abc"), labels: { app: "web" } }), spec: podSpec, status: running },
  { kind: "Pod", metadata: meta("web-abc-2", { ...ctrl("ReplicaSet", "web-abc"), labels: { app: "web" } }), spec: podSpec, status: crashing },
  { kind: "CronJob", metadata: meta("nightly"), spec: { schedule: "0 2 * * *", jobTemplate: { spec: { template: { spec: {} } } } } },
  { kind: "Job", metadata: meta("nightly-1", ctrl("CronJob", "nightly")) },
  { kind: "Pod", metadata: meta("nightly-1-x", ctrl("Job", "nightly-1")), spec: {}, status: { phase: "Succeeded" } },
  { kind: "Pod", metadata: meta("debug"), spec: {}, status: running },
  { kind: "PersistentVolumeClaim", metadata: meta("web-data"), spec: { resources: { requests: { storage: "1Gi" } } }, status: { phase: "Bound" } },
  { kind: "HorizontalPodAutoscaler", metadata: meta("web"), spec: { scaleTargetRef: { kind: "Deployment", name: "web" }, minReplicas: 2, maxReplicas: 6 } },
];

describe("buildMap", () => {
  const g = buildMap(items as any);
  const node = (id: string) => g.nodes.find((n) => n.id === id);
  const linked = (from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to);

  it("folds pods into the workload that owns them, through ReplicaSets and Jobs", () => {
    expect(node("Deployment/web")).toMatchObject({ column: 2, pods: { total: 2, ready: 1, bad: 1 }, tone: "bad", badge: "autoscales 2–6" });
    expect(node("CronJob/nightly")).toMatchObject({ detail: "every 0 2 * * *", pods: { total: 0 } });
    expect(node("Pod/debug")).toMatchObject({ column: 2, tone: "good" });
    expect(g.nodes.some((n) => n.kind === "ReplicaSet" || n.kind === "Job")).toBe(false);
  });
  it("links ingress → service → workload → config and storage", () => {
    expect(linked("Ingress/web", "Service/web")).toBe(true);
    expect(linked("Service/web", "Deployment/web")).toBe(true);
    for (const to of ["ConfigMap/web-config", "ConfigMap/shared", "Secret/web-secret", "PersistentVolumeClaim/web-data"]) {
      expect(linked("Deployment/web", to)).toBe(true);
    }
  });
  it("flags what is broken: a service selecting nothing, an ingress to a missing service", () => {
    expect(node("Service/orphan")).toMatchObject({ tone: "warn", badge: "selects no pods" });
    expect(node("Service/gone")).toMatchObject({ tone: "bad", badge: "does not exist" });
  });
});

describe("podHealth / specRefs", () => {
  it("reads pod health", () => {
    expect(podHealth({ kind: "Pod", metadata: {}, status: running })).toBe("ready");
    expect(podHealth({ kind: "Pod", metadata: {}, status: crashing })).toBe("bad");
    expect(podHealth({ kind: "Pod", metadata: {}, status: { phase: "Pending" } })).toBe("waiting");
  });
  it("collects references from volumes and env", () => {
    const r = specRefs(podSpec);
    expect([...r.configMaps].sort()).toEqual(["shared", "web-config"]);
    expect([...r.secrets]).toEqual(["web-secret"]);
    expect([...r.claims]).toEqual(["web-data"]);
  });
  it("lists the kinds kubectl was not allowed to read", () => {
    expect(forbiddenKinds('Error from server (Forbidden): daemonsets.apps is forbidden: User "x" cannot list resource "daemonsets" in API group "apps"')).toEqual(["daemonsets"]);
  });
});
