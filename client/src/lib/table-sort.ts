/**
 * Column sorting for the resource tables. Pure and type-aware: numbers numerically, "2/3"-style
 * ready counts by ratio, ISO timestamps by age (ascending = youngest first), text naturally
 * ("pod-2" before "pod-10"), and missing values always last whichever way you sort.
 */
export type SortDir = "asc" | "desc";
export interface SortState { id: string; dir: SortDir }

const READY = /^(\d+)\/(\d+)$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const isMissing = (v: unknown) => v === undefined || v === null || v === "" || v === "-" || (typeof v === "number" && Number.isNaN(v));

/** Comparable form of a value: a number when it is numeric/ratio/timestamp, else a string. */
export function sortKey(v: unknown): number | string {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v);
  const r = s.match(READY);
  if (r) {
    const total = Number(r[2]);
    return total === 0 ? 0 : Number(r[1]) / total + total / 1e6; // ratio first, size breaks ties
  }
  if (ISO.test(s)) {
    const t = Date.parse(s);
    if (Number.isFinite(t)) return -t; // older = larger age
  }
  return s;
}

export function compareValues(a: unknown, b: unknown): number {
  const x = sortKey(a);
  const y = sortKey(b);
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
}

/** Stable sort; rows with a missing value stay at the bottom in both directions. */
export function sortRows<T>(rows: T[], valueOf: (row: T) => unknown, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: valueOf(row) }))
    .sort((a, b) => {
      const am = isMissing(a.v);
      const bm = isMissing(b.v);
      if (am || bm) return am === bm ? a.i - b.i : am ? 1 : -1;
      return sign * compareValues(a.v, b.v) || a.i - b.i;
    })
    .map((x) => x.row);
}

/** Click on a header: none -> ascending -> descending -> none. */
export function cycleSort(cur: SortState | null, id: string): SortState | null {
  if (!cur || cur.id !== id) return { id, dir: "asc" };
  return cur.dir === "asc" ? { id, dir: "desc" } : null;
}

const key = (tableId: string) => `kubedeck-sort:${tableId}`;

export function loadSort(tableId?: string): SortState | null {
  if (!tableId) return null;
  try {
    const raw = localStorage.getItem(key(tableId));
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p.id === "string" && (p.dir === "asc" || p.dir === "desc") ? { id: p.id, dir: p.dir } : null;
  } catch {
    return null;
  }
}

export function saveSort(tableId: string | undefined, s: SortState | null): void {
  if (!tableId) return;
  try {
    if (s) localStorage.setItem(key(tableId), JSON.stringify(s));
    else localStorage.removeItem(key(tableId));
  } catch { /* storage unavailable */ }
}
