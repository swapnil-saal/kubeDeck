import { describe, expect, it } from "vitest";
import { matchQuery, resolveName } from "./patterns";

const names: Record<string, string[]> = {
  pod: ["api-7d9f-x2k", "worker-55c-abc", "e2-course-77-q1"],
  deployment: ["api", "worker", "e2-course"],
};
const known = (type: string) => names[type] ?? [];
const run = (q: string) => matchQuery(q, "dev", "shop", known).map((r) => r.command);

describe("resolveName", () => {
  it("takes an exact name, or the only name containing the word", () => {
    expect(resolveName("api", names.deployment)).toBe("api");
    expect(resolveName("course", names.pod)).toBe("e2-course-77-q1");
  });
  it("refuses filler words, ambiguous fragments and anything that is not a name", () => {
    expect(resolveName("the", names.pod)).toBeNull();
    expect(resolveName("e2", ["e2-a", "e2-b"])).toBeNull();
    expect(resolveName("$(id)", names.pod)).toBeNull();
  });
});

describe("matchQuery", () => {
  it("never builds a command around a filler word", () => {
    expect(run("show me the logs of the pod")).toEqual([]);
    expect(run("logs for the")).toEqual([]);
  });
  it("resolves the name a request mentions, skipping filler", () => {
    expect(run("show me the logs of the course pod")).toEqual(["kubectl logs e2-course-77-q1 --context=dev -n shop --tail=200"]);
    expect(run("scale the worker deployment to 5")).toEqual(["kubectl scale deployment/worker --context=dev -n shop --replicas=5"]);
    expect(run("scale worker to 5")).toEqual(["kubectl scale deployment/worker --context=dev -n shop --replicas=5"]);
    expect(run("restart api")).toEqual(["kubectl rollout restart deployment/api --context=dev -n shop"]);
  });
  it("matches whole words only", () => {
    expect(run("how to prevent outages")).toEqual([]);
    expect(run("stop pods from crashing")).toContain("kubectl get pods --context=dev -n shop --field-selector=status.phase!=Running,status.phase!=Succeeded");
    expect(run("stop pods from crashing").some((c) => c.includes("top pods"))).toBe(false);
  });
  it("passes kubectl through, and offers no file applies, cordons or drains", () => {
    expect(run("kubectl get pods -A")).toEqual(["kubectl get pods -A"]);
    expect(run("apply from /etc/passwd")).toEqual([]);
    expect(run("drain node worker-1")).toEqual([]);
  });
  it("lists nodes cluster-wide", () => {
    expect(run("list nodes")).toEqual(["kubectl get nodes --context=dev"]);
  });
});
