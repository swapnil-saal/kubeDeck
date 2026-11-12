/** A picture for each plugin, chosen in the client: the server only names plugins by id. */
import { Cable, ChartArea, Logs, Puzzle, ShipWheel, Waypoints, type LucideIcon } from "lucide-react";
import type { PluginInfo } from "@shared/plugins";

const BY_ID: Record<string, LucideIcon> = {
  kubernetes: ShipWheel,
  tempo: Waypoints,
  loki: Logs,
  grafana: ChartArea,
};

/** The plugin's own icon; an added MCP server gets a cable, anything else a puzzle piece. */
export function pluginIcon(plugin: Pick<PluginInfo, "id" | "kind">): LucideIcon {
  return BY_ID[plugin.id] ?? (plugin.kind === "mcp" ? Cable : Puzzle);
}
