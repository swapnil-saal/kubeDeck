import { describe, expect, it } from "vitest";
import { newTracker, trackAlerts } from "./alerts";
import type { PodLike } from "./cluster-health";

const pod = (name: string, status = "Running", restarts = 0, ready = "1/1"): PodLike => ({ name, namespace: "e2", status, restarts, ready });
const T0 = 1_000_000;

describe("trackAlerts", () => {
  it("treats the first snapshot as a baseline and announces nothing", () => {
    const s = newTracker();
    const r = trackAlerts(s, { pods: [pod("a", "CrashLoopBackOff", 9)], now: T0 });
    expect(r.alerts).toEqual([]);
    expect(r.baseline).toBe(1);
  });

  it("alerts at once when a pod starts crash-looping after the baseline", () => {
    const s = newTracker();
    trackAlerts(s, { pods: [pod("a")], now: T0 });
    const r = trackAlerts(s, { pods: [pod("a", "CrashLoopBackOff", 3)], now: T0 + 10_000 });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ kind: "failure", severity: "critical", resource: { type: "pod", name: "a", namespace: "e2" } });
  });

  it("does not repeat an alert while the pod stays broken", () => {
    const s = newTracker();
    trackAlerts(s, { pods: [pod("a")], now: T0 });
    trackAlerts(s, { pods: [pod("a", "ImagePullBackOff")], now: T0 + 10_000 });
    const again = trackAlerts(s, { pods: [pod("a", "ImagePullBackOff")], now: T0 + 20_000 });
    expect(again.alerts).toEqual([]);
  });

  it("keeps an ordinary rollout quiet: Pending pods wait out the grace period", () => {
    const s = newTracker();
    trackAlerts(s, { pods: [pod("a")], now: T0 });
    expect(trackAlerts(s, { pods: [pod("a"), pod("b", "ContainerCreating", 0, "0/1")], now: T0 + 10_000 }).alerts).toEqual([]);
    expect(trackAlerts(s, { pods: [pod("a"), pod("b", "Running")], now: T0 + 20_000 }).alerts).toEqual([]);
  });

  it("alerts when a soft problem persists past the grace period", () => {
    const s = newTracker();
    trackAlerts(s, { pods: [pod("a")], now: T0 });
    trackAlerts(s, { pods: [pod("a"), pod("b", "Pending", 0, "0/1")], now: T0 + 10_000 });
    const r = trackAlerts(s, { pods: [pod("a"), pod("b", "Pending", 0, "0/1")], now: T0 + 70_000 });
    expect(r.alerts.map((a) => a.resource.name)).toEqual(["b"]);
    expect(r.alerts[0].severity).toBe("warning");
  });

  it("flags a deployment that stays short of replicas, not one that is mid-rollout", () => {
    const s = newTracker();
    const dep = (ready: string) => [{ name: "api", namespace: "e2", ready }];
    trackAlerts(s, { pods: [], deployments: dep("2/2"), now: T0 });
    expect(trackAlerts(s, { pods: [], deployments: dep("1/2"), now: T0 + 10_000 }).alerts).toEqual([]);
    const r = trackAlerts(s, { pods: [], deployments: dep("1/2"), now: T0 + 60_000 });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].title).toContain("Deployment api");
    expect(r.alerts[0].resource).toMatchObject({ type: "deployment", name: "api" });
  });

  it("reports a restart since the last snapshot, once per cooldown", () => {
    const s = newTracker();
    trackAlerts(s, { pods: [pod("a", "Running", 1)], now: T0 });
    const r = trackAlerts(s, { pods: [pod("a", "Running", 2)], now: T0 + 10_000 });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].kind).toBe("restart");
    expect(trackAlerts(s, { pods: [pod("a", "Running", 3)], now: T0 + 20_000 }).alerts).toEqual([]);
  });

  it("does not double-report a pod that is both crashing and restarting", () => {
    const s = newTracker();
    trackAlerts(s, { pods: [pod("a", "Running", 1)], now: T0 });
    const r = trackAlerts(s, { pods: [pod("a", "CrashLoopBackOff", 2)], now: T0 + 10_000 });
    expect(r.alerts.map((a) => a.kind)).toEqual(["failure"]);
  });

  it("never invents or clears anything when the pod list could not be read", () => {
    const s = newTracker();
    trackAlerts(s, { pods: [pod("a")], now: T0 });
    trackAlerts(s, { pods: [pod("a", "CrashLoopBackOff")], now: T0 + 1000 });
    expect(trackAlerts(s, { pods: undefined, now: T0 + 2000 }).alerts).toEqual([]);
    // still known as broken: no repeat alert once the list is readable again
    expect(trackAlerts(s, { pods: [pod("a", "CrashLoopBackOff")], now: T0 + 3000 }).alerts).toEqual([]);
  });

  it("does not re-announce a flapping pod inside the cooldown, but does after it", () => {
    const s = newTracker();
    trackAlerts(s, { pods: [pod("a")], now: T0 });
    expect(trackAlerts(s, { pods: [pod("a", "CrashLoopBackOff")], now: T0 + 1000 }).alerts).toHaveLength(1);
    trackAlerts(s, { pods: [pod("a")], now: T0 + 2000 });
    expect(trackAlerts(s, { pods: [pod("a", "CrashLoopBackOff")], now: T0 + 3000 }).alerts).toEqual([]);
    trackAlerts(s, { pods: [pod("a")], now: T0 + 4000 });
    expect(trackAlerts(s, { pods: [pod("a", "CrashLoopBackOff")], now: T0 + 31 * 60_000 }).alerts).toHaveLength(1);
  });

  it("announces a deployment recovering only when asked", () => {
    const run = (recoveries: boolean) => {
      const s = newTracker();
      const dep = (ready: string) => [{ name: "api", namespace: "e2", ready }];
      trackAlerts(s, { pods: [], deployments: dep("2/2"), now: T0 }, { recoveries });
      trackAlerts(s, { pods: [], deployments: dep("0/2"), now: T0 + 1000 }, { recoveries });
      trackAlerts(s, { pods: [], deployments: dep("0/2"), now: T0 + 60_000 }, { recoveries });
      return trackAlerts(s, { pods: [], deployments: dep("2/2"), now: T0 + 70_000 }, { recoveries }).alerts;
    };
    expect(run(false)).toEqual([]);
    expect(run(true).map((a) => a.kind)).toEqual(["recovered"]);
  });
});
