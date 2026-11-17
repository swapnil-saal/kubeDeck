import { describe, expect, it } from "vitest";
import type { PluginInfo, PluginTool } from "@shared/plugins";
import { groupTools, hostOf, serverUrlProblem, splitServers, toolSummary } from "@/pages/settings/mcp/mcp-page";

const tool = (name: string, access: PluginTool["access"]): PluginTool => ({ name, description: "", access });

describe("toolSummary", () => {
  it("counts the offered tools, the ones that wait for approval and the hidden ones", () => {
    expect(toolSummary([tool("a", "read"), tool("b", "read"), tool("c", "approval"), tool("d", "hidden")])).toBe("3 tools · 1 needs approval · 1 hidden");
    expect(toolSummary([tool("a", "read")])).toBe("1 tool");
    expect(toolSummary([tool("a", "approval"), tool("b", "approval")])).toBe("2 tools · 2 need approval");
    expect(toolSummary([tool("a", "hidden")])).toBe("No tools offered · 1 hidden");
    expect(toolSummary([])).toBe("No tools offered");
    expect(toolSummary(undefined)).toBeNull();
  });
});

describe("groupTools", () => {
  it("groups by access, read first, and leaves out empty groups", () => {
    const groups = groupTools([tool("x", "hidden"), tool("a", "read"), tool("b", "read")]);
    expect(groups.map((g) => [g.access, g.tools.map((t) => t.name)])).toEqual([["read", ["a", "b"]], ["hidden", ["x"]]]);
  });
});

describe("splitServers", () => {
  it("puts built-in servers before added ones, each by name, and ignores other plugins", () => {
    const p = (id: string, name: string, kind: "builtin" | "mcp", category: PluginInfo["category"] = "mcp") => ({ id, name, kind, category }) as PluginInfo;
    const { builtin, added } = splitServers([p("b", "Zed", "mcp"), p("grafana", "Grafana", "builtin"), p("a", "Alpha", "mcp"), p("tempo", "Tempo", "builtin", "observability")]);
    expect(builtin.map((x) => x.id)).toEqual(["grafana"]);
    expect(added.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("hostOf", () => {
  it("is the host and port of a URL, or null", () => {
    expect(hostOf("https://mcp.example.com:8443/mcp")).toBe("mcp.example.com:8443");
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf(undefined)).toBeNull();
    expect(hostOf(true)).toBeNull();
  });
});

describe("serverUrlProblem", () => {
  it("takes http and https addresses, as the server does", () => {
    expect(serverUrlProblem(" https://mcp.example.com/mcp ")).toBeNull();
    expect(serverUrlProblem("http://127.0.0.1:5099/mcp")).toBeNull();
  });

  it("explains what is wrong with anything else", () => {
    expect(serverUrlProblem("")).toMatch(/Enter the server's URL/);
    expect(serverUrlProblem("mcp.example.com/mcp")).toMatch(/starting with https:\/\//);
    expect(serverUrlProblem("stdio:///usr/bin/thing")).toMatch(/never runs a local \(stdio\)/);
    expect(serverUrlProblem("ftp://example.com")).toMatch(/remote servers only/);
    expect(serverUrlProblem("https://exa mple.com")).toMatch(/no spaces/);
  });
});
