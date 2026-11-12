/** The one line above a plugin page: how many are on, and which (if any) need attention. */
import type { PluginInfo } from "@shared/plugins";

type Summarised = Pick<PluginInfo, "name" | "enabled" | "status">;

export interface PluginSummary {
  text: string;
  /** some plugin that is on does not work, or is missing settings */
  attention: boolean;
}

const list = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** "2 of 3 on · all working", "2 of 3 on · Tempo traces needs settings", "1 of 3 on · Loki logs has an error". */
export function summarisePlugins(plugins: Summarised[]): PluginSummary {
  const on = plugins.filter((p) => p.enabled);
  const count = `${on.length} of ${plugins.length} on`;
  if (on.length === 0) return { text: plugins.length ? "All off" : "None yet", attention: false };
  const failing = on.filter((p) => p.status.state === "error").map((p) => p.name);
  const unset = on.filter((p) => p.status.state === "unconfigured").map((p) => p.name);
  const issues = [
    failing.length && `${list(failing)} ${failing.length === 1 ? "has an error" : "have errors"}`,
    unset.length && `${list(unset)} ${unset.length === 1 ? "needs" : "need"} settings`,
  ].filter(Boolean);
  return issues.length ? { text: `${count} · ${issues.join(" · ")}`, attention: true } : { text: `${count} · all working`, attention: false };
}
