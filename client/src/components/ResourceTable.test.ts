import { describe, expect, it } from "vitest";
import { rowKeys } from "./ResourceTable";

describe("rowKeys", () => {
  it("keys a row by namespace and name, not by position", () => {
    const a = { name: "api", namespace: "shop" };
    const b = { name: "web", namespace: "shop" };
    // re-sorted or filtered, each row keeps its key, so React moves it instead of remounting it
    expect(rowKeys([a, b])).toEqual(["shop/api", "shop/web"]);
    expect(rowKeys([b, a])).toEqual(["shop/web", "shop/api"]);
    expect(rowKeys([b])).toEqual(["shop/web"]);
  });

  it("tells the same name in two namespaces apart", () => {
    expect(rowKeys([{ name: "redis", namespace: "shop" }, { name: "redis", namespace: "ops" }])).toEqual(["shop/redis", "ops/redis"]);
  });

  it("uses the name alone for cluster-scoped rows and counts repeats", () => {
    expect(rowKeys([{ name: "node-1" }, { name: "node-1" }, { name: "node-2", namespace: "" }])).toEqual(["node-1", "node-1#1", "node-2"]);
  });
});
