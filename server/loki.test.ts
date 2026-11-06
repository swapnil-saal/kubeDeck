import { describe, expect, it } from "vitest";
import { logQuery, podPattern, toLines } from "./loki";

describe("LogQL for a scope", () => {
  it("selects streams by cluster and namespace and filters the pod afterwards", () => {
    expect(logQuery({ cluster: "shared", namespace: "shop", pod: "api-7f59d5f6c8-2wxvz" })).toBe(
      '{cluster="shared", namespace="shop"} | pod="api-7f59d5f6c8-2wxvz"',
    );
  });

  it("finds a workload's pods, including ones that are gone, without matching a longer name", () => {
    const re = new RegExp(`^${podPattern("deployment", "checkout")}$`);
    expect(re.test("checkout-6d4f8b7c9-x2k8p")).toBe(true);
    expect(re.test("checkout-worker-7f59d5f6c8-2wxvz")).toBe(false);
    expect(new RegExp(`^${podPattern("statefulset", "db")}$`).test("db-0")).toBe(true);
    expect(podPattern("service", "web")).toBeNull();
  });

  it("matches a Service by service_name, and adds text and error filters", () => {
    expect(logQuery({ cluster: "c", namespace: "n", workload: { kind: "service", name: "web" } }, { contains: "a.b (c)", errorsOnly: true })).toBe(
      '{cluster="c", namespace="n", service_name="web"} |~ "(?i)a\\\\.b \\\\(c\\\\)" |~ "(?i)(error|exception|traceback|fatal|panic)"',
    );
  });

  it("escapes quotes so a filter cannot end the string", () => {
    expect(logQuery({ cluster: "c", namespace: "n" }, { contains: 'x" } or {' })).toBe('{cluster="c", namespace="n"} |~ "(?i)x\\" \\\\} or \\\\{"');
  });
});

describe("Loki streams", () => {
  it("become lines, oldest first, with the pod from metadata or the instance label", () => {
    const lines = toLines({
      data: {
        result: [
          { stream: { pod: "api-1", container: "api", detected_level: "error" }, values: [["1793954794511000000", "KeyError: 'startDate'\n"]] },
          { stream: { instance: "shop/api-2:api", detected_level: "unknown" }, values: [["1793954793754000000", "POST /x 500"]] },
        ],
      },
    });
    expect(lines).toEqual([
      { ts: 1793954793754, pod: "api-2", container: "", level: "", line: "POST /x 500" },
      { ts: 1793954794511, pod: "api-1", container: "api", level: "error", line: "KeyError: 'startDate'" },
    ]);
  });
});
