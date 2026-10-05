import { describe, expect, it } from "vitest";
import { compareValues, cycleSort, sortKey, sortRows } from "./table-sort";

const rows = (vals: unknown[]) => vals.map((v, i) => ({ v, i }));
const order = (vals: unknown[], dir: "asc" | "desc") => sortRows(rows(vals), (r) => r.v, dir).map((r) => r.v);

describe("sortRows", () => {
  it("sorts numbers numerically, not as text", () => {
    expect(order([10, 2, 33, 4], "asc")).toEqual([2, 4, 10, 33]);
    expect(order([10, 2, 33, 4], "desc")).toEqual([33, 10, 4, 2]);
  });
  it("sorts names naturally", () => {
    expect(order(["pod-10", "pod-2", "Pod-1"], "asc")).toEqual(["Pod-1", "pod-2", "pod-10"]);
  });
  it("sorts ready counts by ratio, then size", () => {
    expect(order(["1/1", "0/2", "2/3", "1/2"], "asc")).toEqual(["0/2", "1/2", "2/3", "1/1"]);
    expect(order(["1/1", "2/2"], "asc")).toEqual(["2/2", "1/1"].sort((a, b) => (sortKey(a) as number) - (sortKey(b) as number)));
  });
  it("sorts timestamps by age: ascending = youngest first", () => {
    const old = "2026-01-01T00:00:00Z";
    const young = "2026-10-01T00:00:00Z";
    expect(order([old, young], "asc")).toEqual([young, old]);
    expect(order([old, young], "desc")).toEqual([old, young]);
  });
  it("keeps missing values last in both directions", () => {
    expect(order([3, undefined, 1, "-", null, 2], "asc")).toEqual([1, 2, 3, undefined, "-", null]);
    expect(order([3, undefined, 1, "-", null, 2], "desc")).toEqual([3, 2, 1, undefined, "-", null]);
  });
  it("is stable for equal values", () => {
    const r = [{ k: 1, n: "a" }, { k: 1, n: "b" }, { k: 0, n: "c" }, { k: 1, n: "d" }];
    expect(sortRows(r, (x) => x.k, "asc").map((x) => x.n)).toEqual(["c", "a", "b", "d"]);
    expect(sortRows(r, (x) => x.k, "desc").map((x) => x.n)).toEqual(["a", "b", "d", "c"]);
  });
  it("does not mutate its input", () => {
    const input = rows([3, 1, 2]);
    sortRows(input, (r) => r.v, "asc");
    expect(input.map((r) => r.v)).toEqual([3, 1, 2]);
  });
});

describe("compareValues / sortKey", () => {
  it("compares mixed text and numbers without throwing", () => {
    expect(() => compareValues("abc", 5)).not.toThrow();
  });
  it("treats 0/0 as zero", () => expect(sortKey("0/0")).toBe(0));
});

describe("cycleSort", () => {
  it("goes asc -> desc -> off, and restarts on another column", () => {
    let s = cycleSort(null, "name");
    expect(s).toEqual({ id: "name", dir: "asc" });
    s = cycleSort(s, "name");
    expect(s).toEqual({ id: "name", dir: "desc" });
    expect(cycleSort(s, "name")).toBeNull();
    expect(cycleSort({ id: "name", dir: "desc" }, "age")).toEqual({ id: "age", dir: "asc" });
  });
});
