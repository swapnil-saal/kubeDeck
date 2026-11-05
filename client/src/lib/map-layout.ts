import type { MapGraph, MapNode } from "@shared/routes";

/** Geometry of the map, in CSS pixels. */
export const MAP = { colW: 232, gapX: 92, nodeH: 46, gapY: 8, headerH: 30 } as const;

export interface Placed extends MapNode {
  x: number;
  y: number;
}

const TONE_ORDER: Record<MapNode["tone"], number> = { bad: 0, warn: 1, good: 2, neutral: 3 };

/** Nodes reachable from `start` following edges one way (forward: to, backward: from). */
function reach(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const n of next.get(queue.shift()!) ?? []) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen;
}

export function adjacency(graph: Pick<MapGraph, "edges">) {
  const fwd = new Map<string, string[]>();
  const back = new Map<string, string[]>();
  for (const { from, to } of graph.edges) {
    (fwd.get(from) ?? fwd.set(from, []).get(from)!).push(to);
    (back.get(to) ?? back.set(to, []).get(to)!).push(from);
  }
  return { fwd, back };
}

/**
 * A node's chain: everything upstream (what routes to it) and downstream (what it uses), but not
 * sideways, so focusing a shared ConfigMap does not light up every workload's other configs.
 */
export function chainOf(id: string, adj: ReturnType<typeof adjacency>): Set<string> {
  const up = reach(id, adj.back);
  const down = reach(id, adj.fwd);
  return new Set([...up, ...down]);
}

/**
 * Columns left to right (ingress → service → workload → config). Workloads anchor the map, broken
 * ones first; every other node sits level with the average of what it connects to, pushed down only
 * as far as it must to not overlap, so a workload's services and configs stay beside it.
 * Unconnected nodes go at the bottom of their column. Empty columns are dropped.
 */
export function layout(nodes: MapNode[], edges: MapGraph["edges"]): { placed: Placed[]; columns: { column: number; x: number; count: number }[]; width: number; height: number } {
  const step = MAP.nodeH + MAP.gapY;
  const byCol = new Map<number, MapNode[]>();
  for (const n of nodes) (byCol.get(n.column) ?? byCol.set(n.column, []).get(n.column)!).push(n);
  const neighbours = new Map<string, string[]>();
  for (const { from, to } of edges) {
    (neighbours.get(from) ?? neighbours.set(from, []).get(from)!).push(to);
    (neighbours.get(to) ?? neighbours.set(to, []).get(to)!).push(from);
  }
  /** row (in steps, may be fractional) of every node placed so far */
  const row = new Map<string, number>();
  const desired = (n: MapNode) => {
    const rows = (neighbours.get(n.id) ?? []).map((m) => row.get(m)).filter((r): r is number => r !== undefined);
    return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Number.POSITIVE_INFINITY;
  };
  const ordered = new Map<number, MapNode[]>();

  const workloads = [...(byCol.get(2) ?? [])].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.name.localeCompare(b.name));
  workloads.forEach((n, i) => row.set(n.id, i));
  ordered.set(2, workloads);
  for (const col of [1, 3, 0]) {
    const want = new Map((byCol.get(col) ?? []).map((n) => [n.id, desired(n)]));
    const list = [...(byCol.get(col) ?? [])].sort((a, b) => want.get(a.id)! - want.get(b.id)! || a.name.localeCompare(b.name));
    let prev = -1;
    for (const n of list) {
      const w = want.get(n.id)!;
      const r = Number.isFinite(w) ? Math.max(w, prev + 1) : prev + 1;
      row.set(n.id, r);
      prev = r;
    }
    ordered.set(col, list);
  }

  const columns = [0, 1, 2, 3].filter((c) => (ordered.get(c)?.length ?? 0) > 0).map((column, i) => ({
    column, x: i * (MAP.colW + MAP.gapX), count: ordered.get(column)!.length,
  }));
  const placed: Placed[] = [];
  for (const { column, x } of columns) {
    for (const n of ordered.get(column)!) placed.push({ ...n, x, y: MAP.headerH + row.get(n.id)! * step });
  }
  return {
    placed,
    columns,
    width: columns.length ? columns.length * MAP.colW + (columns.length - 1) * MAP.gapX : 0,
    height: placed.reduce<number>((h, p) => Math.max(h, p.y + MAP.nodeH), MAP.headerH),
  };
}
