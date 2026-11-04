/** Geometry of the serpentine step trail (ToolTimeline.tsx). Pure, so it is unit-tested. */

// Geometry (px). Node width is computed so every full row spans the whole column.
export const NODE_MIN_W = 168;
export const NODE_H = 36;
export const CONNECTOR_W = 32;
export const TURN_W = 18;
export const ROW_GAP = 16;

export interface TrailLayout {
  perRow: number;
  nodeW: number;
}

/** Steps per row and node width for a trail `width` px wide. Depends on width only. */
export function trailLayout(width: number): TrailLayout {
  const column = Math.max(NODE_MIN_W, width - 2 * TURN_W);
  const perRow = Math.max(1, Math.floor((column + CONNECTOR_W) / (NODE_MIN_W + CONNECTOR_W)));
  const nodeW = Math.floor((column - (perRow - 1) * CONNECTOR_W) / perRow);
  return { perRow, nodeW };
}

/** Split ids into rows of `perRow`. Odd rows run right→left. */
export function trailRows<T>(items: readonly T[], perRow: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  return rows;
}

