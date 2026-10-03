import { describe, expect, it } from "vitest";
import {
  countDeployments, countNodes, countPods, metricsUnavailable, ownerWorkload, parseNamespaceNames,
  parseTopNodes, parseTopPods,
} from "./k8s-parse";

describe("parseTopPods", () => {
  it("parses a single-namespace listing", () => {
    const out = "e2-admin-module-dd8c44c74-pgz4r   1m    88Mi\ne2-aggregation-apis-7948689757-4vclb   12m   70Mi\n";
    expect(parseTopPods(out, false)).toEqual([
      { name: "e2-admin-module-dd8c44c74-pgz4r", namespace: undefined, cpuMilli: 1, memMi: 88 },
      { name: "e2-aggregation-apis-7948689757-4vclb", namespace: undefined, cpuMilli: 12, memMi: 70 },
    ]);
  });
  it("reads the namespace column with -A and converts cores / Gi", () => {
    const out = "kube-system   coredns-1   2   1Gi\n";
    expect(parseTopPods(out, true)).toEqual([{ name: "coredns-1", namespace: "kube-system", cpuMilli: 2000, memMi: 1024 }]);
  });
  it("ignores blank and short lines", () => {
    expect(parseTopPods("\n  \nonly-two cols\n", false)).toEqual([]);
  });
});

describe("parseTopNodes", () => {
  it("parses cores, percentages and memory", () => {
    expect(parseTopNodes("node-1   420m   10%   3120Mi   40%\n")).toEqual([
      { name: "node-1", cpuMilli: 420, cpuPct: 10, memMi: 3120, memPct: 40 },
    ]);
  });
});

describe("metricsUnavailable", () => {
  it("recognises a missing metrics-server", () => {
    expect(metricsUnavailable("error: Metrics API not available")).toBe(true);
    expect(metricsUnavailable("the server could not find the requested resource (get pods.metrics.k8s.io)")).toBe(true);
    expect(metricsUnavailable("connection refused")).toBe(false);
  });
});

describe("ownerWorkload", () => {
  it("maps a ReplicaSet to its Deployment by dropping the template hash", () => {
    expect(ownerWorkload([{ kind: "ReplicaSet", name: "e2-admin-module-dd8c44c74" }])).toEqual({ kind: "Deployment", name: "e2-admin-module" });
    expect(ownerWorkload([{ kind: "ReplicaSet", name: "web-5d79ccfd54" }])).toEqual({ kind: "Deployment", name: "web" });
  });
  it("keeps StatefulSets and DaemonSets as they are", () => {
    expect(ownerWorkload([{ kind: "StatefulSet", name: "nifi" }])).toEqual({ kind: "StatefulSet", name: "nifi" });
    expect(ownerWorkload([{ kind: "DaemonSet", name: "agent" }])).toEqual({ kind: "DaemonSet", name: "agent" });
  });
  it("strips a CronJob run suffix from Job owners", () => {
    expect(ownerWorkload([{ kind: "Job", name: "backup-28734120" }])).toEqual({ kind: "Job", name: "backup" });
  });
  it("returns undefined for unowned pods", () => {
    expect(ownerWorkload(undefined)).toBeUndefined();
    expect(ownerWorkload([])).toBeUndefined();
  });
});

describe("summary counters", () => {
  it("counts pod states from custom-columns output", () => {
    const out = [
      "Running   <none>",
      "Running   <none>",
      "Running   CrashLoopBackOff",
      "Running   ContainerCreating",
      "Pending   <none>",
      "Failed    <none>",
      "Succeeded <none>",
      "Running   ImagePullBackOff,<none>",
    ].join("\n");
    expect(countPods(out)).toEqual({ total: 8, running: 3, pending: 2, failing: 3 });
  });
  it("counts deployments and skips scaled-to-zero ones", () => {
    expect(countDeployments("2 2\n1 3\n<none> 2\n<none> <none>\n0 0\n")).toEqual({ ready: 1, total: 3 });
  });
  it("counts ready nodes", () => {
    expect(countNodes("True\nTrue\nFalse\nUnknown\n")).toEqual({ ready: 2, total: 4 });
  });
  it("reads namespace names", () => {
    expect(parseNamespaceNames("namespace/e2\nnamespace/kube-system\n")).toEqual(["e2", "kube-system"]);
  });
});
