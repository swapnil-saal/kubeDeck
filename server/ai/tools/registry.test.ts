import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry, type ToolEntry } from "./registry";

const scope = { context: "kind", namespace: "app", threadId: "registry-test", user: "" };
const ctx = { scope };
const echo = (description: string): ToolEntry => ({
  tool: tool({ description, inputSchema: z.object({ q: z.string() }), execute: async ({ q }) => q }),
});

describe("tool registry", () => {
  it("offers every tool in registration order, with scope and approvals", async () => {
    const r = new ToolRegistry();
    const approval = () => "user-approval" as const;
    r.registerTools("a", { tools: { one: { ...echo("1"), scoped: true }, two: { ...echo("2"), risk: "change", approval } } });
    r.registerTools("b", { tools: { three: echo("3") } });
    const call = await r.toolsForCall(ctx);
    expect(Object.keys(call.tools)).toEqual(["one", "two", "three"]);
    expect(call.activeTools).toEqual(["one", "two", "three"]);
    expect(call.toolsContext).toEqual({ one: scope });
    expect(call.toolApproval).toEqual({ two: approval });
    expect(call.promptSections).toEqual([]);
    expect(Object.keys(r.allTools())).toEqual(["one", "two", "three"]);
  });

  it("lets a toolset switch tools off, describe them live and add a prompt section per call", async () => {
    const r = new ToolRegistry();
    const forCall = vi.fn(async () => ({ active: ["live"], descriptions: { live: "now with 3 tools" }, prompt: "## Live" }));
    r.registerTools("live", { tools: { live: echo("default"), off: echo("off") }, forCall });
    r.registerTools("quiet", { tools: { quiet: echo("q") }, forCall: () => ({ active: [], prompt: "## Quiet\nnot set up" }) });
    const call = await r.toolsForCall(ctx);
    expect(forCall).toHaveBeenCalledWith(ctx);
    expect(call.activeTools).toEqual(["live"]);
    expect(Object.keys(call.tools)).toEqual(["live", "off", "quiet"]); // inactive tools stay known
    expect(call.tools.live.description).toBe("now with 3 tools");
    expect(r.allTools().live.description).toBe("default"); // the registered tool is untouched
    expect(call.promptSections).toEqual(["## Live", "## Quiet\nnot set up"]);
  });

  it("leaves out a toolset whose per-call check fails, and keeps the rest", async () => {
    const r = new ToolRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.registerTools("ok", { tools: { ok: echo("ok") } });
    r.registerTools("down", { tools: { down: echo("down") }, forCall: async () => { throw new Error("server down"); } });
    const call = await r.toolsForCall(ctx);
    expect(call.activeTools).toEqual(["ok"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("server down"));
    warn.mockRestore();
  });

  it("refuses duplicate names and owners, and change tools without an approval policy", () => {
    const r = new ToolRegistry();
    r.registerTools("a", { tools: { one: echo("1") } });
    expect(() => r.registerTools("b", { tools: { one: echo("again") } })).toThrow(/"one" of "b" is already registered by "a"/);
    expect(() => r.registerTools("a", { tools: { other: echo("x") } })).toThrow(/"a" are already registered/);
    expect(() => r.registerTools("c", { tools: { risky: { ...echo("x"), risk: "change" } as unknown as ToolEntry } })).toThrow(/no approval policy/);
    // a refused registration adds nothing
    expect(Object.keys(r.allTools())).toEqual(["one"]);
  });

  it("forgets an owner's tools when it unregisters, so the names can be used again", async () => {
    const r = new ToolRegistry();
    r.registerTools("mcp:grafana", { tools: { grafana: echo("g") } });
    r.unregisterTools("mcp:grafana");
    expect((await r.toolsForCall(ctx)).activeTools).toEqual([]);
    r.registerTools("mcp:grafana", { tools: { grafana: echo("g2") } });
    expect(r.allTools().grafana.description).toBe("g2");
  });
});
