import { describe, expect, it } from "vitest";
import { readableCell, ROUTE_TYPE, routeTable, shortAge } from "./route-table";

const NOW = Date.parse("2026-11-06T12:00:00Z");

describe("Gateway API routes as a table", () => {
  it("knows the route kinds", () => {
    expect(["httproutes", "httproutes.gateway.networking.k8s.io", "grpcroutes.gateway.networking.k8s.io"].every((t) => ROUTE_TYPE.test(t))).toBe(true);
    expect(ROUTE_TYPE.test("ingresses")).toBe(false);
  });

  it("shows hostnames, paths, backends, gateway and status", () => {
    const t = routeTable([
      {
        metadata: { name: "storefront-insights", namespace: "shop", creationTimestamp: "2026-08-14T12:00:00Z" },
        spec: {
          hostnames: ["shop.example.com", "shop-v2.example.com"],
          parentRefs: [{ name: "kong", namespace: "kong-system" }],
          rules: [
            { matches: [{ path: { type: "PathPrefix", value: "/storefront" } }], backendRefs: [{ name: "storefront", port: 80 }] },
            { matches: [{ path: { type: "Exact", value: "/health" }, method: "GET" }], backendRefs: [{ name: "storefront", port: 80 }] },
          ],
        },
        status: { parents: [{ conditions: [{ type: "Accepted", status: "True" }, { type: "ResolvedRefs", status: "True" }] }] },
      },
      { metadata: { name: "catch-all" }, spec: { rules: [{ backendRefs: [{ name: "web", namespace: "other", port: 8080 }] }] } },
    ], false);
    expect(t.columns).toEqual(["NAME", "HOSTNAMES", "PATHS", "BACKENDS", "GATEWAY", "STATUS", "AGE"]);
    expect(t.rows[0].slice(0, 6)).toEqual([
      "storefront-insights", "shop.example.com, shop-v2.example.com",
      "/storefront, GET /health (exact)", "storefront:80", "kong-system/kong", "Accepted",
    ]);
    expect(t.rows[1].slice(0, 6)).toEqual(["catch-all", "*", "/", "other/web:8080", "", "Pending"]);
  });

  it("flags a route whose backend is missing, and adds the namespace for all namespaces", () => {
    const t = routeTable([{ metadata: { name: "r", namespace: "a" }, status: { parents: [{ conditions: [{ type: "Accepted", status: "True" }, { type: "ResolvedRefs", status: "False" }] }] } }], true);
    expect(t.columns[0]).toBe("NAMESPACE");
    expect(t.rows[0]).toContain("Backend missing");
  });

  it("writes ages like kubectl", () => {
    expect(shortAge("2026-11-06T11:59:30Z", NOW)).toBe("30s");
    expect(shortAge("2026-11-06T09:00:00Z", NOW)).toBe("3h");
    expect(shortAge("2026-08-14T12:00:00Z", NOW)).toBe("84d");
    expect(shortAge(undefined, NOW)).toBe("");
  });
});

describe("readable cells", () => {
  it("turns a JSON list of strings into a plain list and leaves anything else alone", () => {
    expect(readableCell('["a.example.com","b.example.com"]')).toBe("a.example.com, b.example.com");
    expect(readableCell("[1,2]")).toBe("[1,2]");
    expect(readableCell("Running")).toBe("Running");
  });
});
