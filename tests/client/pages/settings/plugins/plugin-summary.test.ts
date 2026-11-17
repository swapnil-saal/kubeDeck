import { describe, expect, it } from "vitest";
import type { PluginStatus } from "@shared/plugins";
import { summarisePlugins } from "@/pages/settings/plugins/plugin-summary";

const p = (name: string, enabled: boolean, state: PluginStatus["state"]) => ({ name, enabled, status: { state } });

describe("summarisePlugins", () => {
  it("counts what is on and says when everything works", () => {
    expect(summarisePlugins([p("Kubernetes tools", true, "ok"), p("Tempo traces", true, "ok"), p("Loki logs", false, "off")]))
      .toEqual({ text: "2 of 3 on · all working", attention: false });
  });

  it("names the plugins that need attention", () => {
    expect(summarisePlugins([p("Kubernetes tools", true, "ok"), p("Tempo traces", true, "unconfigured"), p("Loki logs", true, "error")]))
      .toEqual({ text: "3 of 3 on · Loki logs has an error · Tempo traces needs settings", attention: true });
    expect(summarisePlugins([p("A", true, "error"), p("B", true, "error"), p("C", true, "error")]).text)
      .toBe("3 of 3 on · A, B and C have errors");
  });

  it("ignores a switched-off plugin's state", () => {
    expect(summarisePlugins([p("Tempo traces", false, "error")])).toEqual({ text: "All off", attention: false });
    expect(summarisePlugins([])).toEqual({ text: "None yet", attention: false });
  });
});
