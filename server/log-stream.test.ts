import { describe, expect, it } from "vitest";
import { findInvalidParam } from "./security";
import {
  LineSplitter, MAX_PODS, MAX_STREAMS, logArgs, parseStreamOptions, planStreams, podTarget, selectorFor,
  type PodTarget,
} from "./log-stream";

describe("selectorFor", () => {
  it("reads matchLabels for workloads", () => {
    expect(selectorFor("deployment", { spec: { selector: { matchLabels: { app: "web", tier: "fe" } } } })).toBe("app=web,tier=fe");
    expect(selectorFor("statefulset", { spec: { selector: { matchLabels: { app: "db" } } } })).toBe("app=db");
  });
  it("reads a service's plain selector map", () => {
    expect(selectorFor("service", { spec: { selector: { app: "web" } } })).toBe("app=web");
    expect(selectorFor("service", { spec: { clusterIP: "None" } })).toBeNull(); // selector-less service
  });
  it("falls back to job-name for jobs", () => {
    expect(selectorFor("job", { metadata: { name: "etl-1" }, spec: {} })).toBe("job-name=etl-1");
  });
  it("has no selector for a pod", () => {
    expect(selectorFor("pod", {})).toBeNull();
  });
});

describe("podTarget", () => {
  const pod = {
    metadata: { name: "web-1", creationTimestamp: "2026-10-05T10:00:00Z" },
    spec: { containers: [{ name: "app" }, { name: "sidecar" }] },
    status: {
      phase: "Running",
      containerStatuses: [
        { ready: true, restartCount: 2, state: { running: {} } },
        { ready: false, restartCount: 5, state: { waiting: { reason: "CrashLoopBackOff" } } },
      ],
    },
  };
  it("summarises containers, readiness, restarts and the worst status", () => {
    expect(podTarget(pod)).toMatchObject({ name: "web-1", containers: ["app", "sidecar"], ready: "1/2", restarts: 7, status: "CrashLoopBackOff" });
  });
  it("copes with a bare object", () => {
    expect(podTarget({})).toMatchObject({ name: "unknown", containers: [], restarts: 0 });
  });
});

describe("LineSplitter", () => {
  it("holds back a partial line until it completes", () => {
    const s = new LineSplitter();
    expect(s.push("one\ntw")).toEqual(["one"]);
    expect(s.push("o\nthree")).toEqual(["two"]);
    expect(s.flush()).toEqual(["three"]);
    expect(s.flush()).toEqual([]);
  });
  it("handles CRLF and skips blank lines", () => {
    expect(new LineSplitter().push("a\r\n\r\nb\r\n")).toEqual(["a", "b"]);
  });
  it("copes with a chunk that splits a multi-byte boundary being re-joined by the caller", () => {
    const s = new LineSplitter();
    expect(s.push("héllo wör")).toEqual([]);
    expect(s.push("ld\n")).toEqual(["héllo wörld"]);
  });
});

describe("parseStreamOptions / logArgs", () => {
  it("applies defaults and clamps tail", () => {
    expect(parseStreamOptions({})).toEqual({ tail: 200, since: undefined, previous: false, follow: true });
    expect(parseStreamOptions({ tail: "999999" }).tail).toBe(5000);
    expect(parseStreamOptions({ tail: "-3" }).tail).toBe(200);
    expect(parseStreamOptions({ tail: "abc" }).tail).toBe(200);
  });
  it("accepts only well-formed since values", () => {
    expect(parseStreamOptions({ since: "15m" }).since).toBe("15m");
    expect(parseStreamOptions({ since: "15m; id" }).since).toBeUndefined();
  });
  it("never follows previous-container logs", () => {
    expect(parseStreamOptions({ previous: "1", follow: "1" })).toMatchObject({ previous: true, follow: false });
  });
  it("builds an argument array (no shell string) with timestamps and the container", () => {
    const o = parseStreamOptions({ tail: "50", since: "1h", follow: "1" });
    expect(logArgs("web-1", "app", o, { context: "dev", namespace: "e2" })).toEqual([
      "logs", "web-1", "-c", "app", "--timestamps", "--tail=50", "--since=1h", "-f", "--context=dev", "-n", "e2",
    ]);
    expect(logArgs("web-1", "app", { ...o, follow: false, previous: true }, {}, 20)).toContain("--previous");
    expect(logArgs("web-1", "app", o, {}, 20)).toContain("--tail=20");
  });
});

describe("planStreams", () => {
  const mk = (n: number, containers = ["app"], created = n): PodTarget => ({
    name: `p${n}`, containers, status: "Running", ready: "1/1", restarts: 0, created,
  });
  it("streams every container of every pod, newest pod first", () => {
    const plan = planStreams([mk(1, ["a", "b"]), mk(2)]);
    expect(plan.streams).toEqual([{ pod: "p2", container: "app" }, { pod: "p1", container: "a" }, { pod: "p1", container: "b" }]);
  });
  it("honours the pod and container picks", () => {
    const pods = [mk(1, ["a", "b"]), mk(2, ["a"])];
    expect(planStreams(pods, { pods: ["p1"] }).streams.map((s) => s.pod)).toEqual(["p1", "p1"]);
    expect(planStreams(pods, { container: "b" }).streams).toEqual([{ pod: "p1", container: "b" }]);
  });
  it("caps the number of pods and streams, reporting what it dropped", () => {
    const many = Array.from({ length: 30 }, (_, i) => mk(i));
    const plan = planStreams(many);
    expect(plan.streams.length).toBeLessThanOrEqual(MAX_STREAMS);
    expect(new Set(plan.streams.map((s) => s.pod)).size).toBeLessThanOrEqual(MAX_PODS);
    expect(plan.skippedPods.length).toBe(30 - MAX_PODS);
    expect(plan.streams[0].pod).toBe("p29"); // newest kept
  });
  it("skips pods that lack the chosen container", () => {
    expect(planStreams([mk(1, ["a"])], { container: "zzz" }).streams).toEqual([]);
  });
});

describe("log stream parameters are validated at the edge", () => {
  it("accepts real values", () => {
    expect(findInvalidParam({ kind: "deployment", since: "15m", pods: "web-1,web-2", previous: "0", follow: "1", name: "e2-admin-module", tail: "500" })).toBeNull();
  });
  it.each([
    ["kind", "pod;id"], ["kind", "secret"], ["since", "5 minutes"], ["since", "15m;id"],
    ["pods", "a,b;c"], ["pods", "a b"], ["previous", "yes"], ["follow", "maybe"],
  ])("rejects %s=%j", (k, v) => expect(findInvalidParam({ [k]: v })).toBe(k));
});
