import { describe, expect, it } from "vitest";
import type { PluginField, PluginValues } from "@shared/plugins";
import { changedValues, draftFrom, hasChanges, parseList, rowsToMap, sameValue, wireValue } from "@/pages/settings/plugins/plugin-form";

const FIELDS: PluginField[] = [
  { key: "url", label: "URL", kind: "url", required: true },
  { key: "token", label: "Token", kind: "secret" },
  { key: "tenant", label: "Tenant", kind: "text" },
  { key: "mode", label: "Mode", kind: "select", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
  { key: "allowChanges", label: "Allow changes", kind: "boolean" },
  { key: "tools", label: "Tools", kind: "list" },
  { key: "clusters", label: "Clusters", kind: "map" },
];

const plugin = (values: PluginValues, envPinned: string[] = []) => ({ fields: FIELDS, values, envPinned });

describe("parseList", () => {
  it("splits on commas and new lines, trims, drops blanks and repeats", () => {
    expect(parseList(" a, b ,,\nc, a ")).toEqual(["a", "b", "c"]);
    expect(parseList("")).toEqual([]);
  });
});

describe("rowsToMap", () => {
  it("trims, drops rows without a name, and lets a later row win", () => {
    expect(rowsToMap([{ key: " dev ", value: " east " }, { key: "", value: "x" }, { key: "dev", value: "west" }])).toEqual({ dev: "west" });
  });
});

describe("draftFrom", () => {
  it("starts secrets empty, lists as text and maps as rows", () => {
    const draft = draftFrom(plugin({ url: "https://t", token: "", allowChanges: true, tools: ["a", "b"], clusters: { dev: "east" } }));
    expect(draft).toEqual({
      url: "https://t", token: "", tenant: "", mode: "", allowChanges: true, tools: "a, b", clusters: [{ key: "dev", value: "east" }],
    });
  });
});

describe("wireValue", () => {
  it("turns each input back into what the API takes", () => {
    expect(wireValue(FIELDS[0], " https://x ")).toBe("https://x");
    expect(wireValue(FIELDS[4], true)).toBe(true);
    expect(wireValue(FIELDS[5], "x, y")).toEqual(["x", "y"]);
    expect(wireValue(FIELDS[6], [{ key: "a", value: "b" }])).toEqual({ a: "b" });
    expect(wireValue(FIELDS[5], undefined)).toEqual([]);
  });
});

describe("changedValues", () => {
  const stored = plugin({ url: "https://t", tenant: "", allowChanges: false, tools: ["a"], clusters: { dev: "east" } });

  it("sends nothing when nothing changed", () => {
    expect(changedValues(stored, draftFrom(stored))).toEqual({});
    expect(hasChanges(stored, draftFrom(stored))).toBe(false);
  });

  it("sends only the fields that changed", () => {
    const draft = { ...draftFrom(stored), url: "https://new", allowChanges: true, tools: "a, b", clusters: [{ key: "dev", value: "west" }] };
    expect(changedValues(stored, draft)).toEqual({ url: "https://new", allowChanges: true, tools: ["a", "b"], clusters: { dev: "west" } });
  });

  it("ignores whitespace-only and order-preserving edits that mean the same value", () => {
    const draft = { ...draftFrom(stored), url: " https://t ", tools: "a,", clusters: [{ key: " dev", value: "east " }, { key: "", value: "" }] };
    expect(changedValues(stored, draft)).toEqual({});
  });

  it("sends a secret only when one was typed", () => {
    expect(changedValues(stored, { ...draftFrom(stored), token: "" })).toEqual({});
    expect(changedValues(stored, { ...draftFrom(stored), token: "s3cret" })).toEqual({ token: "s3cret" });
  });

  it("never sends a field the environment pins", () => {
    const pinned = plugin({ url: "https://env" }, ["url"]);
    expect(changedValues(pinned, { ...draftFrom(pinned), url: "https://other" })).toEqual({});
  });

  it("treats a missing stored value as empty", () => {
    const empty = plugin({});
    expect(changedValues(empty, draftFrom(empty))).toEqual({});
    expect(changedValues(empty, { ...draftFrom(empty), mode: "b" })).toEqual({ mode: "b" });
  });
});

describe("sameValue", () => {
  it("compares strings, lists and maps by content", () => {
    expect(sameValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameValue({ a: "1" }, { a: "1" })).toBe(true);
    expect(sameValue({ a: "1" }, { b: "1" })).toBe(false);
    expect(sameValue(["a"], { 0: "a" })).toBe(false);
    expect(sameValue("x", "x")).toBe(true);
  });
});
