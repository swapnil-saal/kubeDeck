import { describe, expect, it } from "vitest";
import type { MapNode } from "@shared/routes";
import { adjacency, chainOf, layout, MAP } from "./map-layout";

const n = (id: string, column: MapNode["column"], tone: MapNode["tone"] = "good"): MapNode =>
  ({ id, kind: id.split("/")[0], name: id.split("/")[1], type: "x", column, detail: "", tone });

const nodes = [
  n("Ingress/a", 0), n("Service/a", 1), n("Service/b", 1),
  n("Deployment/b", 2), n("Deployment/a", 2), n("Deployment/z", 2, "bad"),
  n("ConfigMap/shared", 3), n("ConfigMap/b-only", 3),
];
const edges = [
  { from: "Ingress/a", to: "Service/a" },
  { from: "Service/a", to: "Deployment/a" },
  { from: "Service/b", to: "Deployment/b" },
  { from: "Deployment/a", to: "ConfigMap/shared" },
  { from: "Deployment/b", to: "ConfigMap/shared" },
  { from: "Deployment/b", to: "ConfigMap/b-only" },
];

describe("layout", () => {
  const { placed, columns, width } = layout(nodes, edges);
  const rowOf = (id: string) => placed.findIndex((p) => p.id === id) - placed.findIndex((p) => p.column === placed.find((q) => q.id === id)!.column);

  it("puts broken workloads first, then orders the other columns by what they connect to", () => {
    expect(placed.filter((p) => p.column === 2).map((p) => p.id)).toEqual(["Deployment/z", "Deployment/a", "Deployment/b"]);
    expect(placed.filter((p) => p.column === 1).map((p) => p.id)).toEqual(["Service/a", "Service/b"]);
    expect(rowOf("ConfigMap/shared")).toBeLessThan(rowOf("ConfigMap/b-only"));
  });
  it("keeps a node level with what it connects to", () => {
    const y = (id: string) => placed.find((p) => p.id === id)!.y;
    expect(y("Service/a")).toBe(y("Deployment/a"));
    expect(y("Service/b")).toBe(y("Deployment/b"));
    expect(y("Ingress/a")).toBe(y("Service/a"));
  });
  it("lays columns out left to right and drops empty ones", () => {
    expect(columns.map((c) => c.column)).toEqual([0, 1, 2, 3]);
    expect(layout(nodes.filter((x) => x.column !== 0), edges).columns[0]).toMatchObject({ column: 1, x: 0 });
    expect(width).toBe(4 * MAP.colW + 3 * MAP.gapX);
  });
});

describe("chainOf", () => {
  it("follows a node upstream and downstream, not sideways", () => {
    const chain = chainOf("Deployment/a", adjacency({ edges }));
    expect([...chain].sort()).toEqual(["ConfigMap/shared", "Deployment/a", "Ingress/a", "Service/a"]);
    // focusing the shared ConfigMap lights its users and their routes, not Deployment/b's other config
    expect(chainOf("ConfigMap/shared", adjacency({ edges })).has("ConfigMap/b-only")).toBe(false);
  });
});
