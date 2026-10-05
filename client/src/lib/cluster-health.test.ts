import { describe, expect, it } from "vitest";
import { ago, analyzeHealth, diagnoseAllPrompt, parseCpuMilli, parseMemMi, type PodLike } from "./cluster-health";

const pod = (name: string, status: string, extra: Partial<PodLike> = {}): PodLike => ({
  name, namespace: "e2", status, restarts: 0, ready: "1/1", ...extra,
});

describe("analyzeHealth", () => {
  it("scores a fully healthy namespace 100 with no issues", () => {
    const p = analyzeHealth({
      pods: [pod("a", "Running"), pod("b", "Running")],
      deployments: [{ name: "a", ready: "1/1" }, { name: "b", ready: "3/3" }],
      nodes: [{ name: "n1", status: "Ready" }],
    });
    expect(p.score).toBe(100);
    expect(p.issues).toHaveLength(0);
    expect(p.pods).toMatchObject({ running: 2, pending: 0, failed: 0, total: 2 });
    expect(p.deployments).toEqual({ ready: 2, total: 2 });
    expect(p.nodes).toEqual({ ready: 1, total: 1 });
  });

  it("flags crashing, image-pull, pending, not-ready and failed pods with the right severity", () => {
    const p = analyzeHealth({
      pods: [
        pod("crash", "CrashLoopBackOff", { restarts: 12 }),
        pod("pull", "ImagePullBackOff"),
        pod("stuck", "Pending"),
        pod("half", "Running", { ready: "1/2" }),
        pod("dead", "Failed"),
        pod("fine", "Running"),
      ],
    });
    const by = Object.fromEntries(p.issues.map((i) => [i.title, i]));
    expect(by.crash).toMatchObject({ severity: "critical", reason: "CrashLoopBackOff" });
    expect(by.pull).toMatchObject({ severity: "critical", reason: "ImagePullBackOff" });
    expect(by.stuck).toMatchObject({ severity: "warning" });
    expect(by.half).toMatchObject({ severity: "warning", reason: "not ready 1/2" });
    expect(by.dead).toMatchObject({ severity: "critical" });
    expect(by.fine).toBeUndefined();
    // critical findings sort before warnings
    expect(p.issues[0].severity).toBe("critical");
    expect(p.issues[p.issues.length - 1].severity).toBe("warning");
  });

  it("puts the exact resource and namespace in each diagnosis prompt", () => {
    const [i] = analyzeHealth({ pods: [pod("web-1", "CrashLoopBackOff", { restarts: 4 })] }).issues;
    expect(i.prompt).toContain("web-1");
    expect(i.prompt).toContain("namespace e2");
    expect(i.prompt).toContain("4 restarts");
  });

  it("keeps restart-heavy-but-running pods out of 'needs attention'", () => {
    const p = analyzeHealth({
      pods: [pod("calm", "Running", { restarts: 2 }), pod("flaky", "Running", { restarts: 50 }), pod("meh", "Running", { restarts: 7 })],
    });
    expect(p.issues).toHaveLength(0);
    expect(p.flaky.map((f) => f.title)).toEqual(["flaky", "meh"]); // worst first, calm excluded
    expect(p.flakyTotal).toBe(2);
    expect(p.restarts).toBe(59);
    expect(p.score).toBe(100);
  });

  it("reports the true flaky total even though the list is capped", () => {
    const pods = Array.from({ length: 14 }, (_, i) => pod(`f${i}`, "Running", { restarts: 5 + i }));
    const p = analyzeHealth({ pods });
    expect(p.flaky).toHaveLength(6);
    expect(p.flakyTotal).toBe(14);
    expect(p.flaky[0].title).toBe("f13");
  });

  it("flags degraded deployments and NotReady nodes", () => {
    const p = analyzeHealth({
      deployments: [{ name: "down", ready: "0/2" }, { name: "partial", ready: "1/3" }, { name: "off", ready: "0/0" }, { name: "ok", ready: "2/2" }],
      nodes: [{ name: "n1", status: "NotReady" }, { name: "n2", status: "Ready" }],
    });
    const by = Object.fromEntries(p.issues.map((i) => [i.title, i]));
    expect(by.down).toMatchObject({ severity: "critical", reason: "0/2 ready" });
    expect(by.partial).toMatchObject({ severity: "warning" });
    expect(by.off).toBeUndefined(); // scaled to zero on purpose
    expect(by.n1).toMatchObject({ severity: "critical", kind: "node" });
    expect(p.deployments).toEqual({ ready: 1, total: 3 });
  });

  it("lowers the score as things break and never goes below zero", () => {
    const bad = analyzeHealth({ pods: Array.from({ length: 10 }, (_, i) => pod(`p${i}`, "CrashLoopBackOff")), deployments: [{ name: "d", ready: "0/1" }] });
    expect(bad.score).toBeLessThan(50);
    expect(bad.score).toBeGreaterThanOrEqual(0);
  });

  it("counts completed pods as healthy", () => {
    const p = analyzeHealth({ pods: [pod("job", "Completed", { ready: "0/1" }), pod("a", "Running")] });
    expect(p.pods).toMatchObject({ done: 1, running: 1, failed: 0 });
    expect(p.issues).toHaveLength(0);
    expect(p.score).toBe(100);
  });

  it("collapses repeated warning events per object and sums their counts", () => {
    const now = Date.parse("2026-10-03T12:00:00Z");
    const ev = (count: number, ts: string) => ({
      type: "Warning", reason: "BackOff", message: "Back-off restarting failed container", objectKind: "Pod",
      objectName: "web-1", namespace: "e2", count, lastTimestamp: ts,
    });
    const p = analyzeHealth({
      now,
      events: [ev(3, "2026-10-03T11:50:00Z"), ev(4, "2026-10-03T11:58:00Z"), { ...ev(1, "2026-10-03T11:59:00Z"), type: "Normal" }],
    });
    expect(p.events).toHaveLength(1);
    expect(p.events[0].reason).toBe("BackOff ×7");
    expect(p.events[0].meta).toContain("2m ago");
    expect(p.events[0].prompt).toContain("web-1");
  });

  it("ranks the busiest running pods by CPU", () => {
    const p = analyzeHealth({
      pods: [pod("a", "Running", { cpu: "50m", memory: "80Mi" }), pod("b", "Running", { cpu: "1500m" }), pod("c", "Running", { cpu: "2", memory: "1Gi" }), pod("d", "Pending", { cpu: "9" })],
    });
    expect(p.hot.map((h) => h.name)).toEqual(["c", "b", "a"]);
    expect(p.hot[0]).toMatchObject({ cpuMilli: 2000, memMi: 1024 });
  });

  it("gives no score when the pod list could not be read (never a made-up 100)", () => {
    const p = analyzeHealth({ deployments: [{ name: "d", ready: "1/1" }] });
    expect(p.score).toBeNull();
  });

  it("scores an empty but readable namespace", () => {
    expect(analyzeHealth({ pods: [] }).score).toBe(100);
  });

  it("flags failed jobs and unbound PVCs", () => {
    const p = analyzeHealth({
      pods: [],
      jobs: [{ name: "etl", namespace: "e2", status: "Failed" }, { name: "ok", status: "Complete" }],
      pvcs: [{ name: "data", namespace: "e2", status: "Pending" }, { name: "bound", status: "Bound" }],
    });
    const by = Object.fromEntries(p.issues.map((i) => [i.title, i]));
    expect(by.etl).toMatchObject({ kind: "job", severity: "warning" });
    expect(by.data).toMatchObject({ kind: "pvc", reason: "not bound" });
    expect(by.ok).toBeUndefined();
    expect(by.bound).toBeUndefined();
  });

  it("prefers live usage over requests and says which it is showing", () => {
    const pods = [pod("a", "Running", { cpu: "900m" }), pod("b", "Running", { cpu: "50m" })];
    const withUsage = analyzeHealth({ pods, usage: [{ name: "b", namespace: "e2", cpuMilli: 700, memMi: 300 }, { name: "a", namespace: "e2", cpuMilli: 2, memMi: 10 }] });
    expect(withUsage.hotSource).toBe("usage");
    expect(withUsage.hot[0]).toMatchObject({ name: "b", cpuMilli: 700 });
    const requestsOnly = analyzeHealth({ pods });
    expect(requestsOnly.hotSource).toBe("requests");
    expect(requestsOnly.hot[0]).toMatchObject({ name: "a", cpuMilli: 900 });
    expect(analyzeHealth({ pods: [pod("c", "Running", { cpu: "-" })] }).hotSource).toBe("none");
  });

  it("copes with empty input", () => {
    const p = analyzeHealth({});
    expect(p.score).toBeNull();
    expect(p.issues).toEqual([]);
  });
});

describe("helpers", () => {
  it("parses CPU and memory quantities", () => {
    expect(parseCpuMilli("250m")).toBe(250);
    expect(parseCpuMilli("2")).toBe(2000);
    expect(parseCpuMilli("500000000n")).toBe(500);
    expect(parseCpuMilli(undefined)).toBe(0);
    expect(parseMemMi("512Ki")).toBe(0.5);
    expect(parseMemMi("2Gi")).toBe(2048);
    expect(parseMemMi("80Mi")).toBe(80);
    expect(parseMemMi("nonsense")).toBe(0);
    expect(parseCpuMilli("50m+100m")).toBe(150); // several containers
    expect(parseMemMi("64Mi+128Mi")).toBe(192);
    expect(parseCpuMilli("-")).toBe(0);
  });
  it("formats ages", () => {
    const now = Date.parse("2026-10-03T12:00:00Z");
    expect(ago("2026-10-03T11:59:30Z", now)).toBe("30s");
    expect(ago("2026-10-03T11:30:00Z", now)).toBe("30m");
    expect(ago("2026-10-03T06:00:00Z", now)).toBe("6h");
    expect(ago("2026-09-23T12:00:00Z", now)).toBe("10d");
    expect(ago(null, now)).toBe("");
  });
  it("builds a triage prompt that lists the findings", () => {
    const p = analyzeHealth({ pods: [pod("a", "CrashLoopBackOff"), pod("b", "ImagePullBackOff")] });
    const text = diagnoseAllPrompt(p.issues, "e2");
    expect(text).toContain("namespace e2");
    expect(text).toContain("pod a: CrashLoopBackOff");
    expect(text).toContain("pod b: ImagePullBackOff");
  });
});
