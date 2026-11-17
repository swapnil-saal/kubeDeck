import { describe, expect, it } from "vitest";
import { compareDeployments, imageTag, problemsByWorkload } from "@/pages/projects/project-health";

const dev = { context: "dev", namespace: "shop" };
const uat = { context: "uat", namespace: "shop" };
const pod = (name: string, status: string, workload?: string) => ({ name, namespace: "shop", status, restarts: 0, age: "1d", workload: workload ? { kind: "Deployment", name: workload } : undefined });
const dep = (name: string, ready: string, images: string[] = []) => ({ name, namespace: "shop", ready, upToDate: "1", available: "1", age: "1d", images });

describe("problemsByWorkload", () => {
  it("folds a workload's failing pods and its unready deployment into one problem per place", () => {
    const out = problemsByWorkload([
      { scope: dev, pods: [pod("api-7d-a", "CrashLoopBackOff", "api"), pod("api-7d-b", "CrashLoopBackOff", "api"), pod("web-1", "Running", "web")], deployments: [dep("api", "0/2"), dep("web", "1/1")] },
      { scope: uat, pods: [pod("api-9f-c", "ImagePullBackOff", "api")], deployments: [dep("api", "0/1"), dep("cron", "0/1")] },
    ]);
    expect(out.map((w) => w.name)).toEqual(["api", "cron"]);
    expect(out[0].places).toEqual([
      { scope: dev, reason: "CrashLoopBackOff", ready: "0/2", pods: ["api-7d-a", "api-7d-b"] },
      { scope: uat, reason: "ImagePullBackOff", ready: "0/1", pods: ["api-9f-c"] },
    ]);
    expect(out[1].places[0].reason).toBe("0/1 ready");
  });
});

describe("imageTag", () => {
  it("reads the tag, a digest, or none", () => {
    expect(imageTag("registry:5000/team/api:v1.4.2")).toBe("v1.4.2");
    expect(imageTag("registry:5000/team/api")).toBe("latest");
    expect(imageTag("nginx@sha256:0123456789abcdef0123")).toBe("0123456789ab");
  });
});

describe("compareDeployments", () => {
  it("lines each deployment up across places and marks drift and gaps", () => {
    const rows = compareDeployments([
      { scope: dev, deployments: [dep("api", "1/1", ["r/api:v2"]), dep("web", "1/1", ["r/web:v1"])] },
      { scope: uat, deployments: [dep("api", "0/1", ["r/api:v1"])] },
    ]);
    expect(rows.find((r) => r.name === "api")).toMatchObject({ drift: true, missing: false, degraded: true, cells: { "uat/shop": { tags: ["v1"] } } });
    expect(rows.find((r) => r.name === "web")).toMatchObject({ drift: false, missing: true, degraded: false });
  });
});
