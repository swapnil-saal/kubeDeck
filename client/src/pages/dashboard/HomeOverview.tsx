import { useMemo, type FC, type ReactNode } from "react";
import type { NodeUsage } from "@/hooks/use-cluster-extras";
import type { Change, ClusterHealth } from "@/lib/cluster-health";
import type { Tile } from "@/pages/dashboard/StatTiles";
import { ActivityFeed } from "@/pages/overview/ActivityFeed";
import { AttentionPanel } from "@/pages/overview/AttentionPanel";
import { CapacityPanel } from "@/pages/overview/CapacityPanel";
import { Hero, type HeroSuggestion } from "@/pages/overview/Hero";

export interface HomeOverviewProps {
  context: string;
  namespace: string;
  health: ClusterHealth;
  changes: Change[];
  tiles: Tile[];
  /** live usage totals for the scope, when the user may read metrics */
  usage?: { cpuMilli: number; memMi: number } | null;
  /** what the pods in scope asked for */
  requests: { cpuMilli: number; memMi: number };
  metricsReason?: "forbidden" | "no-metrics-server" | "error";
  nodeUsage?: NodeUsage[];
  /** pinned and recent resources, shown under the hero */
  shortcuts?: ReactNode;
  /** ask the assistant, scoped to this cluster/namespace. Absent when AI is off (shared web mode). */
  onAsk?: (prompt: string) => void;
  onOpen: (type: string, name: string, namespace: string) => void;
  onLogs: (type: string, name: string, namespace: string) => void;
}

/**
 * The home screen's answer to "is anything wrong, and what do I do about it?": the verdict and
 * numbers first, then what needs attention, what changed, and whether there is room.
 * Everything comes from lists that are already being polled.
 */
export const HomeOverview: FC<HomeOverviewProps> = ({
  context, namespace, health, changes, tiles, usage, requests, metricsReason, nodeUsage, shortcuts, onAsk, onOpen, onLogs,
}) => {
  const scopeText = `${context} / ${namespace === "all" ? "all namespaces" : namespace}`;
  const where = namespace === "all" ? "this cluster" : `namespace ${namespace}`;

  const suggestions = useMemo<HeroSuggestion[]>(() => {
    const out: HeroSuggestion[] = [];
    const short = (s: string) => (s.length > 26 ? `${s.slice(0, 24)}…` : s);
    for (const i of health.issues.slice(0, 2)) out.push({ label: `Why is ${short(i.title)} ${i.reason}?`, prompt: i.prompt });
    if (health.flaky[0]) out.push({ label: `Why does ${short(health.flaky[0].title)} restart?`, prompt: health.flaky[0].prompt });
    out.push({ label: "Find hidden risks", prompt: `Give me a short health briefing for ${where}: what is risky even though everything is Running (missing resource limits, single replicas, restart-heavy pods, stale images, no probes)? Rank by impact.` });
    return out.slice(0, 3);
  }, [health.issues, health.flaky, where]);

  return (
    <div className="space-y-5">
      <Hero scopeText={scopeText} health={health} tiles={tiles} suggestions={suggestions} onAsk={onAsk} />
      {shortcuts}
      <div className="grid items-start gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <AttentionPanel health={health} namespace={namespace} onAsk={onAsk} onOpen={onOpen} onLogs={onLogs} />
          <ActivityFeed changes={changes} warnings={health.events} onAsk={onAsk} />
        </div>
        <div className="lg:col-span-5">
          <CapacityPanel health={health} usage={usage} requests={requests} metricsReason={metricsReason} nodeUsage={nodeUsage} onOpen={onOpen} namespace={namespace} />
        </div>
      </div>
    </div>
  );
};
