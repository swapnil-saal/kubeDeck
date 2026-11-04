import { describe, expect, it } from "vitest";
import { CONNECTOR_W, NODE_MIN_W, TURN_W, trailLayout, trailRows } from "./trail-layout";

describe("trailLayout", () => {
  it("fits as many fixed-width nodes as the column allows, at least one", () => {
    expect(trailLayout(720).perRow).toBe(3);
    expect(trailLayout(320).perRow).toBe(1);
    expect(trailLayout(0).perRow).toBe(1);
  });

  it("stretches nodes so a full row spans the column exactly", () => {
    for (const width of [360, 720, 900, 1400]) {
      const { perRow, nodeW } = trailLayout(width);
      const used = perRow * nodeW + (perRow - 1) * CONNECTOR_W;
      expect(used).toBeLessThanOrEqual(width - 2 * TURN_W);
      expect(width - 2 * TURN_W - used).toBeLessThan(perRow);
      expect(nodeW).toBeGreaterThanOrEqual(NODE_MIN_W);
    }
  });
});

describe("trailRows", () => {
  it("chunks steps into rows in trail order", () => {
    expect(trailRows([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(trailRows([1, 2], 1)).toEqual([[1], [2]]);
    expect(trailRows([], 3)).toEqual([]);
  });
});
