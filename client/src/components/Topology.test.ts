import { describe, expect, it } from "vitest";
import type { RelatedResources } from "@shared/routes";
import { buildColumns, podTone, readyTone } from "./Topology";

const related: RelatedResources = {
  ingresses: [{ name: "web", namespace: "e2", hosts: "app.example.com" }],
  services: [{ name: "web-svc", namespace: "e2", type: "ClusterIP", ports: "80/TCP" }],
  deployments: [{ name: "web", namespace: "e2", ready: "1/2" }],
  pods: [
    { name: "web-1", namespace: "e2", status: "Running", restarts: 0 },
    { name: "web-2", namespace: "e2", status: "CrashLoopBackOff", restarts: 9 },
  ],
};

describe("buildColumns", () => {
  it("orders the hops ingress → service → workload → pods", () => {
    expect(buildColumns("deployment", "web", "e2", related).map((c) => c.key)).toEqual(["ingress", "service", "workload", "pod"]);
  });
  it("marks the viewed resource as 'here'", () => {
    const cols = buildColumns("deployment", "web", "e2", related);
    expect(cols.find((c) => c.key === "workload")!.nodes[0].current).toBe(true);
    expect(cols.flatMap((c) => c.nodes).filter((n) => n.current)).toHaveLength(1);
  });
  it("adds the viewed resource when the API did not list it (a pod)", () => {
    const cols = buildColumns("pod", "web-9", "e2", { ...related, pods: [] });
    const pods = cols.find((c) => c.key === "pod")!;
    expect(pods.nodes).toHaveLength(1);
    expect(pods.nodes[0]).toMatchObject({ name: "web-9", current: true });
  });
  it("drops empty hops and survives an empty response", () => {
    expect(buildColumns("service", "x", "e2", { ingresses: [], services: [], deployments: [], pods: [] }).map((c) => c.key)).toEqual(["service"]);
    expect(buildColumns("pod", "p", "e2", undefined).map((c) => c.key)).toEqual(["pod"]);
  });
  it("colours the viewed workload from its pods when the API does not list it", () => {
    const onlyPods: RelatedResources = { ingresses: [], services: [], deployments: [], pods: related.pods };
    const cols = buildColumns("deployment", "web", "e2", onlyPods);
    expect(cols.find((c) => c.key === "workload")!.nodes[0].tone).toBe("bad"); // web-2 is crash-looping
    const healthy = buildColumns("deployment", "web", "e2", { ...onlyPods, pods: [related.pods[0]] });
    expect(healthy.find((c) => c.key === "workload")!.nodes[0].tone).toBe("good");
  });

  it("shows an ingress's backends when viewing the ingress", () => {
    const cols = buildColumns("ingress", "web", "e2", related);
    expect(cols[0].nodes.find((n) => n.name === "web")!.current).toBe(true);
  });
  it("colours hops by health", () => {
    const cols = buildColumns("deployment", "web", "e2", related);
    const tone = (key: string, name: string) => cols.find((c) => c.key === key)!.nodes.find((n) => n.name === name)!.tone;
    expect(tone("pod", "web-1")).toBe("good");
    expect(tone("pod", "web-2")).toBe("bad");
    expect(tone("workload", "web")).toBe("warn");
  });
});

describe("tones", () => {
  it("maps pod statuses", () => {
    expect(podTone("Running")).toBe("good");
    expect(podTone("Pending")).toBe("warn");
    expect(podTone("ImagePullBackOff")).toBe("bad");
    expect(podTone("Weird")).toBe("neutral");
  });
  it("maps ready ratios", () => {
    expect(readyTone("2/2")).toBe("good");
    expect(readyTone("1/2")).toBe("warn");
    expect(readyTone("0/2")).toBe("bad");
    expect(readyTone("0/0")).toBe("neutral");
  });
});
